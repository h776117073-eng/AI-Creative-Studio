import { AgentBase } from "../core/AgentBase";
import { AgentRole, IAgentMessage, IAgentTask } from "../types";

export class MotionAgent extends AgentBase {
  public role: AgentRole = "motion_graphics_designer";
  public name = "Miles";
  public description = "Chief Motion Choreographer & Kinetic Typography Designer.";
  public capabilities = [
    "Bezier keyframe interpolation and ease adjustments",
    "Dynamic title text formatting & font styling",
    "SVG vector pathway animation rendering",
    "Multi-layered graphic transition triggers"
  ];

  public async processMessage(message: IAgentMessage): Promise<IAgentMessage | null> {
    this.logMessage(message);
    const content = message.content.toLowerCase();

    if (content.includes("motion") || content.includes("anim") || content.includes("title") || content.includes("font")) {
      return {
        id: `msg_motion_${Math.random().toString(36).substring(2, 9)}`,
        sender: this.role,
        recipient: message.sender,
        content: `Configured cinematic entrance transitions using cubic-bezier(0.25, 1, 0.5, 1) spring-like motion dynamics.`,
        timestamp: Date.now(),
        payload: { fontSelected: "Space Grotesk", easingCurve: "bezier_spring" }
      };
    }

    return null;
  }

  public async executeTask(task: IAgentTask): Promise<Record<string, any>> {
    console.log(`[MotionAgent] Directing animation design timeline: ${task.name}`);
    this.memory.taskHistory.push(task);

    const textContent = task.inputParams.textContent || "AI CREATIVE WORKFORCE";
    const alignment = task.inputParams.alignment || "center_stage";

    this.recordDecision(`Kinetic typography compile`, `Formatted display text title "${textContent}" aligned to ${alignment}`, true);

    return {
      status: "success",
      layoutPosition: [960, 540], // centered in 1080p canvas
      fontFamily: "Space Grotesk",
      fontWeight: "Bold",
      animationSequence: {
        entrance: "staggered_letter_fade_in",
        exit: "directional_slide_right",
        durationFrames: 48,
        easing: [0.16, 1, 0.3, 1] // ultra fast ease-out
      }
    };
  }
}
