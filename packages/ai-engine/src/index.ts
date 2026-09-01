import {
  BaseEngine,
  EngineConfigSchema,
  EventEmitter,
  globalEventBus,
} from '@ai-creative-studio/core';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const AIEngineConfigSchema = EngineConfigSchema.extend({
  defaultModel: z.string().optional().default('gpt-4'),
  enableVoice: z.boolean().optional().default(false),
  maxTokens: z.number().optional().default(4000),
  temperature: z.number().optional().default(0.7),
});



type AIEngineConfig = z.infer<typeof AIEngineConfigSchema>;



export interface IAICommandRequest {
  query: string;
  language?: string;
  context?: IAIContext;
}

export interface IAIContext {
  projectId?: string;
  currentPage?: string;
  selection?: string[];
  task?: string;
}

export interface IAICommandResult {
  id: string;
  query: string;
  interpretation?: IIntentInterpretation;
  agents: IAgentResult[];
  error?: string;
}

export interface IIntentInterpretation {
  primaryIntent: string;
  entities: Map<string, string>;
  confidence: number;
  requiresClarification: boolean;
  clarification?: string;
}

export interface IAgentResult {
  agentId: string;
  agentName: string;
  status: AgentStatus;
  message?: string;
  steps?: IAgentStep[];
  error?: string;
}

export type AgentStatus = 'idle' | 'pending' | 'working' | 'complete' | 'error';

export interface IAgentStep {
  id: string;
  action: string;
  description: string;
  status: 'pending' | 'running' | 'complete' | 'error';
  result?: unknown;
  undo?: () => Promise<void>;
}

export interface IAgent {
  id: string;
  name: string;
  type: AgentType;
  role: string;
  capabilities: string[];
  priority: number;
  memory: IAgentMemory;
  tools: ITool[];
}

export type AgentType =
  | 'creative-director'
  | 'assistant'
  | 'video-director'
  | 'audio-director'
  | 'motion-designer'
  | 'graphic-designer'
  | 'animator'
  | 'colorist'
  | 'audio-producer'
  | 'script-writer'
  | 'storyboard-planner'
  | 'rendering-optimizer'
  | 'performance-optimizer'
  | 'asset-organizer'
  | 'template-generator'
  | 'localization-agent'
  | 'accessibility-agent'
  | 'quality-assurance'
  | 'export-specialist';

export interface IAgentMemory {
  shortTerm: Map<string, unknown>;
  longTerm: Map<string, unknown>;
  conversationHistory: IConversationMessage[];
}

export interface IConversationMessage {
  role: 'user' | 'assistant' | 'system' | 'function' | 'tool';
  content: string;
  timestamp: number;
}

export interface ITool {
  name: string;
  description: string;
  parameters: z.Infer<ReturnType<typeof z.object>>;
  execute: (params: unknown) => Promise<unknown>;
}

export interface IAICapability {
  id: string;
  name: string;
  description: string;
  category: 'generation' | 'editing' | 'analysis' | 'optimization' | 'transformation';
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
}

export interface IAIMemoryEntry {
  id: string;
  type: 'preference' | 'pattern' | 'context' | 'feedback' | 'workflow';
  content: unknown;
  confidence: number;
  timestamp: number;
}

export interface IAITask {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  message?: string;
}

export interface IAIEngineEvents {
  'ai:command-start': { commandId: string; query: string };
  'ai:command-complete': { commandId: string; result: IAICommandResult };
  'ai:agent-start': { agentId: string; commandId: string };
  'ai:agent-step': { agentId: string; stepId: string };
  'ai:agent-complete': { agentId: string };
  'ai:agent-error': { agentId: string; error: Error };
  'ai:interpretation': { commandId: string; interpretation: IIntentInterpretation };
}

export type ICommandStatus = AICommandResult['agents'][number]['status'];

export class AIEngine extends BaseEngine {
  private agents: Map<string, IAgent> = new Map();
  private activeTasks: Map<string, IAITask> = new Map();
  private conversationHistory: Map<string, IConversationMessage[]> = new Map();
  private emitter = new EventEmitter<IAIEngineEvents>();
  private defaultModel: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: AIEngineConfig) {
    const parsedConfig = AIEngineConfigSchema.parse(config);
    super(parsedConfig);
    this.defaultModel = parsedConfig.defaultModel!;
    this.temperature = parsedConfig.temperature!;
    this.maxTokens = parsedConfig.maxTokens!;
  }

  protected async onInitialize(): Promise<void> {
    this.registerCoreAgents();
  }

  protected override async onDestroy(): Promise<void> {
    this.agents.clear();
    this.activeTasks.clear();
    this.conversationHistory.clear();
  }

  registerAgent(agent: Omit<IAgent, 'id' | 'memory'>): IAgent {
    const fullAgent: IAgent = {
      ...agent,
      id: uuidv4(),
      memory: {
        shortTerm: new Map(),
        longTerm: new Map(),
        conversationHistory: [],
      },
    };

    this.agents.set(fullAgent.id, fullAgent);
    return fullAgent;
  }

  getAgent(agentId: string): IAgent | undefined {
    return this.agents.get(agentId);
  }

  getAgentsByType(type: AgentType): IAgent[] {
    const result: IAgent[] = [];
    this.agents.forEach(agent => {
      if (agent.type === type) {
        result.push(agent);
      }
    });
    return result;
  }

  getAgentsByCapability(capability: string): IAgent[] {
    const result: IAgent[] = [];
    this.agents.forEach(agent => {
      if (agent.capabilities.includes(capability)) {
        result.push(agent);
      }
    });
    return result;
  }

  async processCommand(request: IAICommandRequest): Promise<IAICommandResult> {
    const commandId = uuidv4();
    const result: IAICommandResult = {
      id: commandId,
      query: request.query,
      agents: [],
    };

    this.emitter.emit('ai:command-start', { commandId, query: request.query });

    const interpretation = await this.interpretIntent(request.query);
    result.interpretation = interpretation;

    this.emitter.emit('ai:interpretation', { commandId, interpretation });

    const relevantAgents = await this.findRelevantAgents(interpretation, request.context);
    const agentResults: IAgentResult[] = [];

    for (const agent of relevantAgents) {
      const agentResult = await this.executeAgent(agent.id, commandId, request, interpretation);
      agentResults.push(agentResult);

      if (agentResult.status === 'error') {
        result.error = `Agent ${agent.name} failed: ${agentResult.error}`;
      }
    }

    result.agents = agentResults;

    this.emitter.emit('ai:command-complete', { commandId, result });
    return result;
  }

  private async interpretIntent(query: string): Promise<IIntentInterpretation> {
    const knownIntents = [
      { keywords: ['cut', 'trim', 'clip', 'split'], intent: 'video:edit', confidence: 0.9 },
      { keywords: ['animate', 'animation', 'motion', 'key'], intent: 'animation:create', confidence: 0.9 },
      { keywords: ['add', 'create', 'insert', 'new'], intent: 'element:create', confidence: 0.8 },
      { keywords: ['remove', 'delete', 'clear'], intent: 'element:remove', confidence: 0.9 },
      { keywords: ['change', 'modify', 'edit', 'update'], intent: 'element:update', confidence: 0.8 },
      { keywords: ['generate', 'create', 'make', 'produce'], intent: 'generation:create', confidence: 0.9 },
      { keywords: ['export', 'render', 'save', 'download'], intent: 'export:process', confidence: 0.9 },
      { keywords: ['audio', 'sound', 'music', 'voice'], intent: 'audio:edit', confidence: 0.9 },
      { keywords: ['subtitle', 'caption', 'text', 'title'], intent: 'text:create', confidence: 0.8 },
      { keywords: ['color', 'grade', 'brightness', 'contrast'], intent: 'color:adjust', confidence: 0.9 },
      { keywords: ['background', 'remove', 'transparent'], intent: 'background:remove', confidence: 0.9 },
      { keywords: ['logo', 'brand', 'watermark'], intent: 'brand:create', confidence: 0.9 },
      { keywords: ['zoom', 'pan', 'movement', 'camera'], intent: 'camera:control', confidence: 0.8 },
      { keywords: ['speed', 'fast', 'slow', 'duration'], intent: 'timing:adjust', confidence: 0.9 },
      { keywords: ['transition', 'fade', 'dissolve'], intent: 'transition:create', confidence: 0.9 },
      { keywords: ['version', 'resize', 'format', 'instagram', 'youtube'], intent: 'format:adapt', confidence: 0.85 },
      { keywords: ['smoother', 'improve', 'enhance', 'better'], intent: 'quality:improve', confidence: 0.8 },
    ];

    let bestMatch = knownIntents[0];
    let bestScore = 0;

    for (const intentData of knownIntents) {
      const matchCount = intentData.keywords.filter(kw =>
        query.toLowerCase().includes(kw)
      ).length;

      const score = matchCount * intentData.confidence;
      if (score > bestScore) {
        bestScore = score;
        bestMatch = intentData;
      }
    }

    return {
      primaryIntent: bestMatch.intent,
      entities: new Map(),
      confidence: bestScore > 0 ? Math.min(bestMatch.confidence, bestScore / 2) : 0.5,
      requiresClarification: bestScore === 0,
      clarification: bestScore === 0 ? 'Could you provide more details about what you want to do?' : undefined,
    };
  }

  private async findRelevantAgents(
    interpretation: IIntentInterpretation,
    context?: IAIContext
  ): Promise<IAgent[]> {
    const primaryIntent = interpretation.primaryIntent;
    const result: IAgent[] = [];

    const agentIntentMap: Record<string, AgentType[]> = {
      'video:edit': ['video-director', 'creative-director'],
      'animation:create': ['motion-designer', 'animator'],
      'audio:edit': ['audio-director', 'audio-producer'],
      'color:adjust': ['colorist'],
      'generation:create': ['creative-director', 'assistant'],
      'export:process': ['rendering-optimizer', 'export-specialist'],
      'background:remove': ['motion-designer', 'video-director'],
      'brand:create': ['graphic-designer', 'asset-organizer'],
      'text:create': ['graphic-designer', 'assistant'],
      'format:adapt': ['template-generator', 'rendering-optimizer'],
      'quality:improve': ['quality-assurance', 'performance-optimizer'],
    };

    const agentTypes = agentIntentMap[primaryIntent] ?? [];

    if (agentTypes.length === 0) {
      const creativeDirector = this.getAgentsByType('creative-director')[0];
      if (creativeDirector) result.push(creativeDirector);
    } else {
      for (const type of agentTypes) {
        const agents = this.getAgentsByType(type);
        if (agents.length > 0) {
          result.push(agents[0]);
        }
      }
    }

    return result;
  }

  private async executeAgent(
    agentId: string,
    commandId: string,
    request: IAICommandRequest,
    interpretation: IIntentInterpretation
  ): Promise<IAgentResult> {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return {
        agentId,
        agentName: 'Unknown',
        status: 'error',
        error: 'Agent not found',
      };
    }

    this.emitter.emit('ai:agent-start', { agentId, commandId });

    const steps = await this.planAgentSteps(agent, request, interpretation);

    const result: IAgentResult = {
      agentId,
      agentName: agent.name,
      status: 'working',
      steps,
    };

    for (const step of steps) {
      step.status = 'running';
      this.emitter.emit('ai:agent-step', { agentId, stepId: step.id });

      try {
        step.result = await this.executeStep(step, agent, request);
        step.status = 'complete';
        this.emitter.emit('ai:agent-step', { agentId, stepId: step.id });
      } catch (error) {
        step.status = 'error';
        step.result = error instanceof Error ? error.message : String(error);
        result.status = 'error';
        result.error = step.result as string;
        this.emitter.emit('ai:agent-error', { agentId, error: error instanceof Error ? error : new Error(String(error)) });
        break;
      }
    }

    if (result.status !== 'error') {
      result.status = 'complete';
      result.message = 'Successfully completed the task';
    }

    this.emitter.emit('ai:agent-complete', { agentId });
    return result;
  }

  private async planAgentSteps(
    agent: IAgent,
    request: IAICommandRequest,
    interpretation: IIntentInterpretation
  ): Promise<IAgentStep[]> {
    const intent = interpretation.primaryIntent;
    const steps: IAgentStep[] = [];

    if (intent.startsWith('video:edit')) {
      steps.push(
        { id: uuidv4(), action: 'analyze', description: 'Analyze current video state', status: 'pending' },
        { id: uuidv4(), action: 'identify', description: 'Identify target clips', status: 'pending' },
        { id: uuidv4(), action: 'execute', description: 'Apply video edits', status: 'pending' },
        { id: uuidv4(), action: 'preview', description: 'Generate preview', status: 'pending' }
      );
    } else if (intent.startsWith('animation')) {
      steps.push(
        { id: uuidv4(), action: 'analyze', description: 'Analyze target object', status: 'pending' },
        { id: uuidv4(), action: 'plan', description: 'Plan animation path', status: 'pending' },
        { id: uuidv4(), action: 'create-keyframes', description: 'Create keyframes', status: 'pending' },
        { id: uuidv4(), action: 'test', description: 'Test animation', status: 'pending' }
      );
    } else if (intent.startsWith('audio')) {
      steps.push(
        { id: uuidv4(), action: 'analyze', description: 'Analyze audio source', status: 'pending' },
        { id: uuidv4(), action: 'process', description: 'Apply audio processing', status: 'pending' },
        { id: uuidv4(), action: 'sync', description: 'Sync with timeline', status: 'pending' }
      );
    } else {
      steps.push(
        { id: uuidv4(), action: 'understand', description: 'Understand request', status: 'pending' },
        { id: uuidv4(), action: 'execute', description: 'Execute operation', status: 'pending' },
        { id: uuidv4(), action: 'verify', description: 'Verify result', status: 'pending' }
      );
    }

    return steps;
  }

  private async executeStep(
    step: IAgentStep,
    agent: IAgent,
    request: IAICommandRequest
  ): Promise<unknown> {
    return { success: true, step: step.description, agent: agent.name };
  }

  private registerCoreAgents(): void {
    this.registerAgent({
      name: 'Creative Director',
      type: 'creative-director',
      role: 'Orchestrates creative decisions and manages overall project direction',
      capabilities: ['generation:all', 'planning', 'review', 'orchestration:agents'],
      priority: 10,
      tools: [],
    });

    this.registerAgent({
      name: 'Video Director',
      type: 'video-director',
      role: 'Manages video editing, cuts, transitions and visual effects',
      capabilities: ['video:edit', 'video:cut', 'video:trim', 'transition:create', 'effects:video'],
      priority: 9,
      tools: [],
    });

    this.registerAgent({
      name: 'Motion Designer',
      type: 'motion-designer',
      role: 'Creates and manages animations, motion graphics and visual dynamics',
      capabilities: ['animation:create', 'animation:edit', 'motion:graphics', 'keyframes:all'],
      priority: 9,
      tools: [],
    });

    this.registerAgent({
      name: 'Audio Producer',
      type: 'audio-producer',
      role: 'Handles audio editing, mixing, effects and synchronization',
      capabilities: ['audio:edit', 'audio:mix', 'audio:effects', 'audio:sync'],
      priority: 8,
      tools: [],
    });

    this.registerAgent({
      name: 'AI Assistant',
      type: 'assistant',
      role: 'Provides general assistance and interprets user commands',
      capabilities: ['assistant:general', 'interpretation', 'clarification', 'explanation'],
      priority: 11,
      tools: [],
    });

    this.registerAgent({
      name: 'Rendering Optimizer',
      type: 'rendering-optimizer',
      role: 'Optimizes render settings and manages export processes',
      capabilities: ['render:optimize', 'export:process', 'quality:balance'],
      priority: 7,
      tools: [],
    });
  }

  getActiveTasks(): IAITask[] {
    const tasks: IAITask[] = [];
    this.activeTasks.forEach(task => tasks.push(task));
    return tasks;
  }

  cancelTask(taskId: string): boolean {
    const task = this.activeTasks.get(taskId);
    if (task) {
      task.status = 'failed';
      task.message = 'Task cancelled by user';
      return true;
    }
    return false;
  }

  on<E extends keyof IAIEngineEvents>(
    event: E,
    listener: (data: IAIEngineEvents[E]) => void
  ): this {
    this.emitter.on(event, listener as any);
    return this;
  }

  off<E extends keyof IAIEngineEvents>(
    event: E,
    listener: (data: IAIEngineEvents[E]) => void
  ): this {
    this.emitter.off(event, listener as any);
    return this;
  }

  getCapabilities(): string[] {
    return [
      'ai:process-command',
      'ai:interpret-intent',
      'ai:multi-agent',
      'ai:orchestration',
      'ai:planning',
      'ai:execution',
      'ai:tools',
      'ai:memory',
    ];
  }
}
