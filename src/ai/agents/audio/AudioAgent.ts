import { AgentBase } from "../core/AgentBase";
import { AgentRole, IAgentMessage, IAgentTask } from "../types";
import { AudioUnderstanding } from "../../audio/AudioUnderstanding";

export class AudioAgent extends AgentBase {
  public role: AgentRole = "audio_specialist";
  public name = "Aurelius";
  public description = "Acoustic Mastering & Vocal Dialogue Architect.";
  public capabilities = [
    "Noise floor attenuation & high-pass filtering",
    "Speech silence gap detection for auto-splicing",
    "Stereo imaging & audio level balancing",
    "Transient hum spectral suppression"
  ];

  public async processMessage(message: IAgentMessage): Promise<IAgentMessage | null> {
    this.logMessage(message);
    const content = message.content.toLowerCase();

    if (content.includes("silence") || content.includes("noise") || content.includes("voice")) {
      const silenceSegments = AudioUnderstanding.getInstance().detectSilenceInSequence(0, -42);
      return {
        id: `msg_audio_${Math.random().toString(36).substring(2, 9)}`,
        sender: this.role,
        recipient: message.sender,
        content: `Acoustic analysis complete. Located [${silenceSegments.length}] silence segments below -42dB threshold.`,
        timestamp: Date.now(),
        payload: { silenceSegments }
      };
    }

    return null;
  }

  public async executeTask(task: IAgentTask): Promise<Record<string, any>> {
    console.log(`[AudioAgent] Processing acoustic waveform task: ${task.name}`);
    this.memory.taskHistory.push(task);

    const audioAnalysis = AudioUnderstanding.getInstance().analyzeAudioAsset(task.inputParams.assetId || "audio_source_01");
    const targetDb = task.inputParams.targetDb || -14;

    this.recordDecision(`Spectral balance adjustment for ${task.id}`, `Target volume mapped to standard ${targetDb} LUFS`, true);

    return {
      status: "success",
      noiseProfile: audioAnalysis.noiseProfile,
      silencesDetected: audioAnalysis.silenceSegments,
      appliedFilters: ["high_pass_80hz", "vocal_compressor_4_1"],
      suggestedTempoBpm: audioAnalysis.musicTracks[0]?.tempoBpm || 120
    };
  }
}
