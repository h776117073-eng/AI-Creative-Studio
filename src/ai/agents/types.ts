export type AgentRole =
  | "supervisor"
  | "video_editor"
  | "audio_specialist"
  | "color_grade_specialist"
  | "vfx_specialist"
  | "motion_graphics_designer"
  | "three_d_architect"
  | "render_optimization_engineer"
  | "cinematic_researcher"
  | "quality_control_inspector";

export type AgentTaskStatus = "backlog" | "assigned" | "working" | "verifying" | "approved" | "failed";

export interface IAgentMessage {
  id: string;
  sender: AgentRole;
  recipient: AgentRole | "all" | "user";
  content: string;
  timestamp: number;
  taskId?: string;
  payload?: Record<string, any>;
}

export interface IAgentTask {
  id: string;
  name: string;
  description: string;
  assignedTo: AgentRole;
  status: AgentTaskStatus;
  priority: "low" | "medium" | "high" | "critical";
  dependencies: string[]; // List of task IDs
  inputParams: Record<string, any>;
  outputResult?: Record<string, any>;
  verificationComments?: string[];
  retryCount: number;
}

export interface IAgentMemory {
  shortTermMemory: IAgentMessage[];
  taskHistory: IAgentTask[];
  creativePreferences: Record<string, any>;
  previousDecisions: { context: string; decision: string; success: boolean }[];
}

export interface IAgent {
  role: AgentRole;
  name: string;
  description: string;
  capabilities: string[];
  memory: IAgentMemory;
  processMessage(message: IAgentMessage): Promise<IAgentMessage | null>;
  executeTask(task: IAgentTask): Promise<Record<string, any>>;
}
