import { BaseEngine, EngineConfigSchema } from '@ai-creative-studio/core';
import { EventEmitter } from 'eventemitter3';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const AIEngineConfigSchema = EngineConfigSchema.extend({
  defaultModel: z.string().optional().default('gpt-4'),
  enableVoice: z.boolean().optional().default(false),
  maxTokens: z.number().optional().default(4000),
  temperature: z.number().optional().default(0.7),
});

type AIEngineConfig = z.infer<typeof AIEngineConfigSchema>;

export interface IAICommandRequest { query: string; language?: string; context?: IAIContext; }
export interface IAIContext { projectId?: string; currentPage?: string; selection?: string[]; task?: string; }
export interface IAICommandResult { id: string; query: string; interpretation?: IIntentInterpretation; agents: IAgentResult[]; error?: string; }
export interface IIntentInterpretation { primaryIntent: string; entities: Map<string,string>; confidence: number; requiresClarification: boolean; clarification?: string; }
export interface IAgentResult { agentId: string; agentName: string; status: AgentStatus; message?: string; steps?: IAgentStep[]; error?: string; }
export type AgentStatus = 'idle'|'pending'|'working'|'complete'|'error';
export interface IAgentStep { id:string; action:string; description:string; status:'pending'|'running'|'complete'|'error'; result?:unknown; undo?:()=>Promise<void>; }
export interface IAgent { id:string; name:string; type:AgentType; role:string; capabilities:string[]; priority:number; memory:IAgentMemory; tools:ITool[]; }
export type AgentType = 'creative-director'|'assistant'|'video-director'|'audio-director'|'motion-designer'|'graphic-designer'|'animator'|'colorist'|'audio-producer'|'script-writer'|'storyboard-planner'|'rendering-optimizer'|'performance-optimizer'|'asset-organizer'|'template-generator'|'localization-agent'|'accessibility-agent'|'quality-assurance'|'export-specialist';
export interface IAgentMemory { shortTerm:Map<string,unknown>; longTerm:Map<string,unknown>; conversationHistory:IConversationMessage[]; }
export interface IConversationMessage { role:'user'|'assistant'|'system'|'function'|'tool'; content:string; timestamp:number; }
export interface ITool { name:string; description:string; parameters:z.ZodType; execute:(params:unknown)=>Promise<unknown>; }
export interface IAICapability { id:string; name:string; description:string; category:'generation'|'editing'|'analysis'|'optimization'|'transformation'; inputSchema:z.ZodType; outputSchema:z.ZodType; }
export interface IAIMemoryEntry { id:string; type:'preference'|'pattern'|'context'|'feedback'|'workflow'; content:unknown; confidence:number; timestamp:number; }
export interface IAITask { id:string; type:string; status:'pending'|'running'|'completed'|'failed'; progress:number; message?:string; }
export interface IAIEngineEvents { 'ai:command-start':{commandId:string;query:string}; 'ai:command-complete':{commandId:string;result:IAICommandResult}; 'ai:agent-start':{agentId:string;commandId:string}; 'ai:agent-step':{agentId:string;stepId:string}; 'ai:agent-complete':{agentId:string}; 'ai:agent-error':{agentId:string;error:Error}; 'ai:interpretation':{commandId:string;interpretation:IIntentInterpretation}; }
export type ICommandStatus = IAICommandResult['agents'][number]['status'];

const INTENTS:Array<{keywords:string[];intent:string;confidence:number}>=[
  {keywords:['cut','trim','clip','split'],intent:'video:edit',confidence:.9},{keywords:['animate','animation','motion','key'],intent:'animation:create',confidence:.9},
  {keywords:['add','create','insert','new'],intent:'element:create',confidence:.8},{keywords:['remove','delete','clear'],intent:'element:remove',confidence:.9},
  {keywords:['change','modify','edit','update'],intent:'element:update',confidence:.8},{keywords:['generate','make','produce'],intent:'generation:create',confidence:.9},
  {keywords:['export','render','save','download'],intent:'export:process',confidence:.9},{keywords:['audio','sound','music','voice'],intent:'audio:edit',confidence:.9},
  {keywords:['subtitle','caption','text','title'],intent:'text:create',confidence:.8},{keywords:['color','grade','brightness','contrast'],intent:'color:adjust',confidence:.9},
  {keywords:['background','transparent'],intent:'background:remove',confidence:.9},{keywords:['logo','brand','watermark'],intent:'brand:create',confidence:.9},
  {keywords:['zoom','pan','movement','camera'],intent:'camera:control',confidence:.8},{keywords:['speed','fast','slow','duration'],intent:'timing:adjust',confidence:.9},
  {keywords:['transition','fade','dissolve'],intent:'transition:create',confidence:.9},{keywords:['resize','format','instagram','youtube'],intent:'format:adapt',confidence:.85},
  {keywords:['improve','enhance','better'],intent:'quality:improve',confidence:.8},
];

const AGENT_MAP:Record<string,AgentType[]>={
  'video:edit':['video-director','creative-director'],'animation:create':['motion-designer','animator'],'audio:edit':['audio-director','audio-producer'],
  'color:adjust':['colorist'],'generation:create':['creative-director','assistant'],'export:process':['rendering-optimizer','export-specialist'],
  'background:remove':['motion-designer','video-director'],'brand:create':['graphic-designer','asset-organizer'],'text:create':['graphic-designer','assistant'],
  'format:adapt':['template-generator','rendering-optimizer'],'quality:improve':['quality-assurance','performance-optimizer'],
};

export class AIEngine extends BaseEngine {
  private readonly agents=new Map<string,IAgent>();
  private readonly activeTasks=new Map<string,IAITask>();
  private readonly conversations=new Map<string,IConversationMessage[]>();
  private readonly aiEmitter=new EventEmitter<IAIEngineEvents>();
  private readonly defaultModel:string; private readonly temperature:number; private readonly maxTokens:number;

  constructor(config:AIEngineConfig){const parsed=AIEngineConfigSchema.parse(config);super(parsed as any);this.defaultModel=parsed.defaultModel;this.temperature=parsed.temperature;this.maxTokens=parsed.maxTokens;}
  protected async onInitialize():Promise<void>{this.registerCoreAgents();}
  protected override async onDestroy():Promise<void>{this.agents.clear();this.activeTasks.clear();this.conversations.clear();}
  registerAgent(agent:Omit<IAgent,'id'|'memory'>):IAgent{const full:IAgent={...agent,id:uuidv4(),memory:{shortTerm:new Map(),longTerm:new Map(),conversationHistory:[]}};this.agents.set(full.id,full);return full;}
  getAgent(id:string):IAgent|undefined{return this.agents.get(id);}
  getAgentsByType(type:AgentType):IAgent[]{return [...this.agents.values()].filter(a=>a.type===type);}
  getAgentsByCapability(capability:string):IAgent[]{return [...this.agents.values()].filter(a=>a.capabilities.includes(capability));}
  getTask(id:string):IAITask|undefined{return this.activeTasks.get(id);}

  async processCommand(request:IAICommandRequest):Promise<IAICommandResult>{
    const commandId=uuidv4();const result:IAICommandResult={id:commandId,query:request.query,agents:[]};
    this.aiEmitter.emit('ai:command-start',{commandId,query:request.query});
    const interpretation=this.interpretIntent(request.query);result.interpretation=interpretation;this.aiEmitter.emit('ai:interpretation',{commandId,interpretation});
    if(interpretation.requiresClarification){result.error=interpretation.clarification;this.aiEmitter.emit('ai:command-complete',{commandId,result});return result;}
    const types=AGENT_MAP[interpretation.primaryIntent]??['creative-director'];
    for(const type of types){const agent=this.getAgentsByType(type)[0];if(agent)result.agents.push(await this.planAgent(agent,commandId,request,interpretation));}
    this.aiEmitter.emit('ai:command-complete',{commandId,result});return result;
  }

  private interpretIntent(query:string):IIntentInterpretation{const text=query.toLowerCase();let best=INTENTS[0];let bestScore=0;for(const item of INTENTS){const matches=item.keywords.filter(k=>text.includes(k)).length;const score=matches*item.confidence;if(score>bestScore){bestScore=score;best=item;}}const confidence=bestScore?Math.min(best.confidence,bestScore/2):0;return{primaryIntent:best.intent,entities:new Map(),confidence,requiresClarification:bestScore===0,clarification:bestScore===0?'Please provide more details about the requested edit.':undefined};}

  private async planAgent(agent:IAgent,commandId:string,request:IAICommandRequest,interpretation:IIntentInterpretation):Promise<IAgentResult>{
    this.aiEmitter.emit('ai:agent-start',{agentId:agent.id,commandId});const task:IAITask={id:uuidv4(),type:interpretation.primaryIntent,status:'running',progress:0};this.activeTasks.set(task.id,task);
    const steps=this.buildPlan(agent,interpretation.primaryIntent);for(const step of steps){step.status='running';this.aiEmitter.emit('ai:agent-step',{agentId:agent.id,stepId:step.id});step.result={mode:'plan-only',query:request.query,agent:agent.type};step.status='complete';task.progress+=100/steps.length;this.aiEmitter.emit('ai:agent-step',{agentId:agent.id,stepId:step.id});}
    task.status='completed';task.progress=100;task.message='Plan generated; execution requires bound editor/rendering tools.';this.aiEmitter.emit('ai:agent-complete',{agentId:agent.id});return{agentId:agent.id,agentName:agent.name,status:'complete',steps,message:task.message};
  }

  private buildPlan(agent:IAgent,intent:string):IAgentStep[]{const descriptions:{action:string;description:string}[]=intent==='video:edit'?[{action:'analyze',description:'Inspect the current timeline and selected media.'},{action:'plan',description:'Create a typed editing plan.'},{action:'preview',description:'Prepare a preview transaction.'}]:intent==='animation:create'?[{action:'analyze',description:'Inspect target object properties.'},{action:'keyframes',description:'Define keyframe changes and easing.'},{action:'validate',description:'Validate the animation plan.'}]:intent.startsWith('audio')?[{action:'analyze',description:'Inspect audio tracks and available processing.'},{action:'process',description:'Create an audio processing plan.'},{action:'validate',description:'Validate levels and timing.'}]:[{action:'analyze',description:`Analyze request using ${agent.type}.`},{action:'plan',description:'Produce deterministic editor actions.'},{action:'validate',description:'Check the action plan before execution.'}];return descriptions.map(d=>({id:uuidv4(),action:d.action,description:d.description,status:'pending'}));}

  private registerCoreAgents():void{
    const specs:Array<[AgentType,string,string,string[]]>=[
      ['creative-director','Creative Director','Coordinates editing intent and workflows',['planning','orchestration']],['assistant','AI Assistant','General editor assistance',['assistant','planning']],
      ['video-director','Video Director','Video timeline planning',['video-edit','timeline']],['audio-director','Audio Director','Audio workflow planning',['audio-edit','audio']],['motion-designer','Motion Designer','Motion and compositing planning',['motion','animation']],
      ['graphic-designer','Graphic Designer','Text and graphic planning',['text','graphics']],['animator','Animator','Animation/keyframe planning',['animation','keyframes']],['colorist','Colorist','Color workflow planning',['color','grading']],
      ['audio-producer','Audio Producer','Audio processing planning',['audio','mixing']],['rendering-optimizer','Rendering Optimizer','Render settings planning',['rendering','performance']],['performance-optimizer','Performance Optimizer','Performance planning',['performance']],
      ['asset-organizer','Asset Organizer','Asset organization planning',['assets']],['template-generator','Template Generator','Template and format planning',['templates']],['quality-assurance','Quality Assurance','Quality validation planning',['qa']],['export-specialist','Export Specialist','Export workflow planning',['export']],
    ];
    for(const [type,name,role,capabilities] of specs)this.registerAgent({name,type,role,capabilities,priority:50,tools:[]});
  }

  onAI<E extends keyof IAIEngineEvents>(event:E,listener:(data:IAIEngineEvents[E])=>void):this{this.aiEmitter.on(event,listener as any);return this;}
  offAI<E extends keyof IAIEngineEvents>(event:E,listener:(data:IAIEngineEvents[E])=>void):this{this.aiEmitter.off(event,listener as any);return this;}
  getCapabilities():string[]{return['ai:command-planning','ai:intent-classification','ai:agent-orchestration','ai:task-tracking','ai:deterministic-planning'];}
  getModelInfo(){return{defaultModel:this.defaultModel,temperature:this.temperature,maxTokens:this.maxTokens};}
}
