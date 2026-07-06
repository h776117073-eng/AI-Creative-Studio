import { PromptParser, IParsedResult } from "../parser/PromptParser";
import { AiPlanner } from "../planner/AiPlanner";
import { MemoryEngine } from "../memory/MemoryEngine";
import { ToolSelector } from "../tools/ToolSelector";
import { ModuleSelector } from "../router/ModuleSelector";
import { ProjectUnderstanding } from "../project/ProjectUnderstanding";
import { TimelineUnderstanding } from "../timeline/TimelineUnderstanding";
import { ExecutionEngine, ExecutionState } from "../execution/ExecutionEngine";
import { WorkflowGenerator } from "../workflows/WorkflowGenerator";
import { IAiExecutionPlan, IAiPlugin } from "../types";
import { SupervisorAgent } from "../agents";

export class AiOrchestrator {
  private static instance: AiOrchestrator;

  private parser = PromptParser.getInstance();
  private planner = AiPlanner.getInstance();
  private memory = MemoryEngine.getInstance();
  private toolSelector = ToolSelector.getInstance();
  private moduleSelector = ModuleSelector.getInstance();
  private projectInspector = ProjectUnderstanding.getInstance();
  private timelineInspector = TimelineUnderstanding.getInstance();
  private executionEngine = ExecutionEngine.getInstance();
  private workflowGenerator = WorkflowGenerator.getInstance();
  private supervisor = new SupervisorAgent();

  private plugins: Map<string, IAiPlugin> = new Map();

  private constructor() {}

  public static getInstance(): AiOrchestrator {
    if (!AiOrchestrator.instance) {
      AiOrchestrator.instance = new AiOrchestrator();
    }
    return AiOrchestrator.instance;
  }

  /**
   * Orchestrates a raw natural language instruction into full platform execution
   */
  public async orchestrate(prompt: string, previousContext: string[] = []): Promise<{
    parsed: IParsedResult;
    plan: IAiExecutionPlan;
    success: boolean;
    requiresConfirmation: boolean;
    destructiveActions: string[];
    summary: string;
  }> {
    console.log(`[AiOrchestrator] COMMENCING COGNITIVE ORCHESTRATION ON PROMPT: "${prompt}"`);

    // 1. Natural Language parsing (Intent, entities, extracted task blueprints)
    let parsed = await this.parser.parse(prompt, previousContext);

    // Allow third-party custom workflow plugins to enhance or parse prompts
    for (const plugin of this.plugins.values()) {
      if (plugin.onParsePrompt) {
        try {
          const enhancement = await plugin.onParsePrompt(prompt);
          parsed = { ...parsed, ...enhancement };
        } catch (err) {
          console.error(`[AiOrchestrator] Plugin [${plugin.name}] parse prompt error:`, err);
        }
      }
    }

    // 2. Hydrate task listings with active project/timeline context if needed
    const projectSummary = this.projectInspector.summarizeProject();
    const timelineSummary = this.timelineInspector.summarizeTimelineTracks();

    // 3. AI Planner builds complete dependency-ordered DAG execution plan
    let plan = this.planner.generatePlan(prompt, parsed.tasks);

    // Allow third-party planners or tools to optimize plans
    for (const plugin of this.plugins.values()) {
      if (plugin.onExecutePlan) {
        try {
          plan = await plugin.onExecutePlan(plan);
        } catch (err) {
          console.error(`[AiOrchestrator] Plugin [${plugin.name}] execute plan error:`, err);
        }
      }
    }

    // 4. Save dialogue turn inside Memory Engine
    this.memory.addMessage("user", prompt);

    // Translate safety constraints
    const isSafetyBlock = plan.requiresConfirmation && this.memory.getState().userPreferences.safetyConfirmationsEnabled;

    const summary = `Orchestrator parsed intent [${parsed.intent}] in [${parsed.language}] with ${Math.round(parsed.confidence * 100)}% confidence score.
Plan mapped [${plan.graph.priorityQueue.length}] distinct task nodes with an estimated pipeline execution latency of [${Math.round(plan.estimatedTotalRuntimeMs / 1000)}s].`;

    return {
      parsed,
      plan,
      success: true,
      requiresConfirmation: isSafetyBlock,
      destructiveActions: plan.destructiveActions,
      summary
    };
  }

  /**
   * Commences background execution loop of a confirmed AI plan
   */
  public async executePlan(plan: IAiExecutionPlan, onProgressUpdate?: (prog: number) => void): Promise<boolean> {
    const success = await this.executionEngine.executePlan(plan, onProgressUpdate);
    if (success) {
      this.memory.addMessage("ai", `Successfully orchestrated and completed all tasks for "${plan.originalRequest}". Timeline state is fully operational.`);
    } else {
      this.memory.addMessage("ai", `Pipeline execution failed on a critical operation. Timeline changes have been safely rolled back to checkpoint.`);
    }
    return success;
  }

  /**
   * Registers a third-party AI agent plugin or custom planner extension
   */
  public registerPlugin(plugin: IAiPlugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[AiOrchestrator] Plugin ID [${plugin.id}] is already registered. Overwriting.`);
    }
    this.plugins.set(plugin.id, plugin);
    console.log(`[AiOrchestrator] Custom AI Agent Plugin [${plugin.name}] loaded successfully.`);
  }

  public unregisterPlugin(id: string): void {
    if (this.plugins.delete(id)) {
      console.log(`[AiOrchestrator] AI Plugin [${id}] unloaded.`);
    }
  }

  // Exposure utilities to maintain architectural compliance across files
  public getSupervisor() { return this.supervisor; }
  public getParser() { return this.parser; }
  public getPlanner() { return this.planner; }
  public getMemory() { return this.memory; }
  public getToolSelector() { return this.toolSelector; }
  public getModuleSelector() { return this.moduleSelector; }
  public getProjectInspector() { return this.projectInspector; }
  public getTimelineInspector() { return this.timelineInspector; }
  public getExecutionEngine() { return this.executionEngine; }
  public getWorkflowGenerator() { return this.workflowGenerator; }
}
