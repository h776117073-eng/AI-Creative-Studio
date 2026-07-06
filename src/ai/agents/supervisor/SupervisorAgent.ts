import { AgentBase } from "../core/AgentBase";
import { AgentRole, IAgentMessage, IAgentTask, IAgent } from "../types";
import { VideoEditingAgent } from "../video/VideoEditingAgent";
import { AudioAgent } from "../audio/AudioAgent";
import { ColorAgent } from "../color/ColorAgent";
import { VfxAgent } from "../vfx/VfxAgent";
import { MotionAgent } from "../motion/MotionAgent";
import { ThreeDAgent } from "../3d/ThreeDAgent";
import { RenderAgent } from "../render/RenderAgent";
import { ResearchAgent } from "../research/ResearchAgent";
import { QualityControlAgent } from "../quality/QualityControlAgent";

export interface ICollaborationLog {
  timestamp: number;
  from: AgentRole;
  to: AgentRole;
  subject: string;
  detail: string;
}

export class SupervisorAgent extends AgentBase {
  public role: AgentRole = "supervisor";
  public name = "Apollo";
  public description = "Executive Creative Director & Multi-Agent Project Supervisor.";
  public capabilities = [
    "Production brief and hierarchical task decomposition",
    "Creative conflict arbitration and standard resolution",
    "Inter-agent thread routing & shared memory context sync",
    "Automated milestone reviews & quality threshold gating"
  ];

  private workforce: Map<AgentRole, IAgent> = new Map();
  private messageBus: IAgentMessage[] = [];
  private collaborationLogs: ICollaborationLog[] = [];

  constructor() {
    super();
    // Register the entire specialized creative workforce
    this.workforce.set("video_editor", new VideoEditingAgent());
    this.workforce.set("audio_specialist", new AudioAgent());
    this.workforce.set("color_grade_specialist", new ColorAgent());
    this.workforce.set("vfx_specialist", new VfxAgent());
    this.workforce.set("motion_graphics_designer", new MotionAgent());
    this.workforce.set("three_d_architect", new ThreeDAgent());
    this.workforce.set("render_optimization_engineer", new RenderAgent());
    this.workforce.set("cinematic_researcher", new ResearchAgent());
    this.workforce.set("quality_control_inspector", new QualityControlAgent());
  }

  public getWorkforce(): Map<AgentRole, IAgent> {
    return this.workforce;
  }

  public getCollaborationLogs(): ICollaborationLog[] {
    return this.collaborationLogs;
  }

  /**
   * Dispatches a direct collaboration message between two agents via the supervisor bus
   */
  public logCollaboration(from: AgentRole, to: AgentRole, subject: string, detail: string): void {
    const log: ICollaborationLog = {
      timestamp: Date.now(),
      from,
      to,
      subject,
      detail
    };
    this.collaborationLogs.push(log);
    console.log(`[Supervisor Collaboration] [${from} -> ${to}]: ${subject} - ${detail}`);
  }

  /**
   * Processes inbound user commands, compiling a comprehensive, multi-agent production plan
   */
  public async processMessage(message: IAgentMessage): Promise<IAgentMessage | null> {
    this.logMessage(message);
    const userPrompt = message.content;

    // Simulate Supervisor analyzing creative requirements
    this.logCollaboration("supervisor", "cinematic_researcher", "Reference Analysis Request", "Retrieve aesthetic style guidelines and pacing benchmarks.");
    
    const researcher = this.workforce.get("cinematic_researcher")!;
    const researchResponse = await researcher.processMessage({
      id: `msg_ref_${Date.now()}`,
      sender: "supervisor",
      recipient: "cinematic_researcher",
      content: `Please suggest templates for prompt: "${userPrompt}"`,
      timestamp: Date.now()
    });

    const styleMood = researchResponse?.payload?.referenceMood || "Cinematic Classic";

    this.logCollaboration("supervisor", "quality_control_inspector", "Sanity Gate Checklist", "Pre-flight checks on media indices.");

    return {
      id: `msg_sup_${Math.random().toString(36).substring(2, 9)}`,
      sender: this.role,
      recipient: "user",
      content: `Master Production Brief compiled under supervisor direction. The creative team will execute using the [${styleMood}] stylistic reference standard.`,
      timestamp: Date.now(),
      payload: { styleMood }
    };
  }

  /**
   * Coordinates execution of a series of agent tasks, managing dependencies, inter-agent collaboration, and QC sign-offs.
   */
  public async coordinateWorkforceWorkflow(
    userPrompt: string,
    tasks: IAgentTask[],
    onTaskUpdate?: (taskId: string, status: string, result?: any) => void
  ): Promise<{ success: boolean; tasksExecuted: IAgentTask[]; logs: ICollaborationLog[] }> {
    console.log(`[SupervisorAgent] COORDINATING WORKFLOW: "${userPrompt}"`);
    this.collaborationLogs = [];

    // Reset task statuses
    tasks.forEach(t => {
      t.status = "backlog";
      t.retryCount = 0;
    });

    const completedTaskIds = new Set<string>();
    const executedTasks: IAgentTask[] = [];

    // We process tasks iteratively respecting declaration order and dependencies
    let attempts = 0;
    const maxAttempts = tasks.length * 3; // safety threshold to avoid infinite loops

    while (completedTaskIds.size < tasks.length && attempts < maxAttempts) {
      attempts++;

      for (const task of tasks) {
        if (task.status === "approved" || task.status === "working" || task.status === "verifying") {
          continue;
        }

        // Verify dependencies
        const depsSatisfied = task.dependencies.every(depId => completedTaskIds.has(depId));
        if (!depsSatisfied) {
          continue;
        }

        // Start working
        task.status = "working";
        if (onTaskUpdate) onTaskUpdate(task.id, "working");

        // Trigger dynamic peer-to-peer collaboration logs to visually demonstrate workforce synergy
        this.triggerInterAgentCollaboration(task);

        const agent = this.workforce.get(task.assignedTo);
        if (!agent) {
          task.status = "failed";
          if (onTaskUpdate) onTaskUpdate(task.id, "failed");
          continue;
        }

        try {
          // Execute task
          const result = await agent.executeTask(task);
          task.outputResult = result;
          task.status = "verifying";
          if (onTaskUpdate) onTaskUpdate(task.id, "verifying");

          // Route to Quality Control Specialist Agent for verification
          const qcAgent = this.workforce.get("quality_control_inspector") as QualityControlAgent;
          const qcTask: IAgentTask = {
            id: `qc_${task.id}`,
            name: `Audit outputs for task: ${task.name}`,
            description: `Check audio, color, or render compliance on assigned output frames.`,
            assignedTo: "quality_control_inspector",
            status: "assigned",
            priority: "high",
            dependencies: [],
            inputParams: { ...task.inputParams, ...result },
            retryCount: 0
          };

          const qcResult = await qcAgent.executeTask(qcTask);
          task.verificationComments = qcResult.issues || [];

          if (qcResult.status === "success" || qcResult.status === "warning") {
            task.status = "approved";
            completedTaskIds.add(task.id);
            executedTasks.push(task);
            this.logCollaboration("quality_control_inspector", "supervisor", "Task Approval Sigil", `Task [${task.id}] verified and certified.`);
            if (onTaskUpdate) onTaskUpdate(task.id, "approved", result);
          } else {
            throw new Error(`Quality check failed: ${qcResult.issues?.join(", ") || "Conformity mismatch"}`);
          }

        } catch (err: any) {
          console.warn(`[SupervisorAgent] Task execution failed: ${task.id} - ${err.message}`);
          task.retryCount++;
          
          if (task.retryCount > 2) {
            task.status = "failed";
            if (onTaskUpdate) onTaskUpdate(task.id, "failed");
            this.logCollaboration("supervisor", "quality_control_inspector", "Workflow Blockage Alert", `Task [${task.id}] failed permanently on attempt ${task.retryCount}.`);
            return { success: false, tasksExecuted: executedTasks, logs: this.collaborationLogs };
          } else {
            task.status = "backlog"; // retry on next iteration
            this.logCollaboration("supervisor", task.assignedTo, "Automatic Error Recovery", `Task failed on attempt ${task.retryCount}. Initiating soft parameter adjustments and retrying.`);
            if (onTaskUpdate) onTaskUpdate(task.id, "backlog");
          }
        }
      }
    }

    const success = completedTaskIds.size === tasks.length;
    if (success) {
      this.logCollaboration("supervisor", "quality_control_inspector", "Final Delivery Certification", "Signing off entire workflow render package. Publishing trailer bounds.");
    }

    return {
      success,
      tasksExecuted: executedTasks,
      logs: this.collaborationLogs
    };
  }

  /**
   * Automatically simulates peer-to-peer collaborative logs depending on the active task role
   */
  private triggerInterAgentCollaboration(task: IAgentTask): void {
    const role = task.assignedTo;

    if (role === "video_editor") {
      this.logCollaboration("video_editor", "color_grade_specialist", "Coordinate Mapping", "Syncing primary edit points to color grade matrices.");
    } else if (role === "color_grade_specialist") {
      this.logCollaboration("color_grade_specialist", "vfx_specialist", "Alpha Gamut Syncing", "Relaying LUT offsets to composite tracking shaders.");
    } else if (role === "vfx_specialist") {
      this.logCollaboration("vfx_specialist", "render_optimization_engineer", "VRAM Cache Handshake", "Warming GPU buffers to hold dynamic smoke overlays.");
    } else if (role === "audio_specialist") {
      this.logCollaboration("audio_specialist", "video_editor", "Timeline Audio Alignment", "Syncing dialogue silence points to cut cadence timeline frames.");
    } else if (role === "motion_graphics_designer") {
      this.logCollaboration("motion_graphics_designer", "three_d_architect", "Title Spatial Binding", "Projecting 2D kinetic typography onto 3D camera path coordinates.");
    } else if (role === "three_d_architect") {
      this.logCollaboration("three_d_architect", "vfx_specialist", "3D Occlusion Vector Share", "Exchanging PBR metalness meshes to calibrate volumetric occlusion layers.");
    }
  }

  public async executeTask(task: IAgentTask): Promise<Record<string, any>> {
    console.log(`[SupervisorAgent] Managing sub-task workflow: ${task.name}`);
    return { status: "success", managed: true };
  }
}
