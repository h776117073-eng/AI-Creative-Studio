import { IAgent, AgentRole, IAgentMemory, IAgentMessage, IAgentTask } from "../types";

export abstract class AgentBase implements IAgent {
  public abstract role: AgentRole;
  public abstract name: string;
  public abstract description: string;
  public abstract capabilities: string[];

  public memory: IAgentMemory = {
    shortTermMemory: [],
    taskHistory: [],
    creativePreferences: {},
    previousDecisions: []
  };

  /**
   * Records a message in the agent's localized short-term memory
   */
  public logMessage(msg: IAgentMessage): void {
    this.memory.shortTermMemory.push(msg);
    if (this.memory.shortTermMemory.length > 50) {
      this.memory.shortTermMemory.shift();
    }
  }

  /**
   * Log decision metadata to reinforce learning
   */
  public recordDecision(context: string, decision: string, success: boolean): void {
    this.memory.previousDecisions.push({ context, decision, success });
    if (this.memory.previousDecisions.length > 20) {
      this.memory.previousDecisions.shift();
    }
  }

  /**
   * Set custom preference overrides for specific design patterns
   */
  public updatePreference(key: string, value: any): void {
    this.memory.creativePreferences[key] = value;
  }

  /**
   * Process an inbound message from the supervisor, user, or peer agent
   */
  public abstract processMessage(message: IAgentMessage): Promise<IAgentMessage | null>;

  /**
   * Main runtime implementation of designated tasks
   */
  public abstract executeTask(task: IAgentTask): Promise<Record<string, any>>;
}
