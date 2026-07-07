export interface PipelineNode {
  id: string;
  name: string;
  type: "detection" | "cutter" | "arranger" | "audio_sync" | "color" | "vfx" | "exporter";
  status: "idle" | "running" | "completed" | "failed";
  progress: number;
  config: Record<string, any>;
}

export class AIPipelineWorkflowGenerator {
  private static instance: AIPipelineWorkflowGenerator;

  public static getInstance(): AIPipelineWorkflowGenerator {
    if (!AIPipelineWorkflowGenerator.instance) {
      AIPipelineWorkflowGenerator.instance = new AIPipelineWorkflowGenerator();
    }
    return AIPipelineWorkflowGenerator.instance;
  }

  /**
   * Generates editing pipeline workflows, connecting specialized AI tasks
   * to carry out full automation (e.g., auto cutting, moment detection).
   */
  public generateEditingWorkflow(
    strategy: "highlight_reel" | "pacing_optimized_vlog" | "high_energy_tiktok" | "cinematic_promo"
  ): PipelineNode[] {
    const defaultNodes: Record<string, PipelineNode[]> = {
      highlight_reel: [
        { id: "node_detection", name: "AI Best Moment & Face Detector", type: "detection", status: "idle", progress: 0, config: { minConfidence: 0.85, searchFaces: true } },
        { id: "node_cutter", name: "Dynamic Highlights Extractor", type: "cutter", status: "idle", progress: 0, config: { targetClipDurationSec: 2.5, trimSilence: true } },
        { id: "node_sync", name: "Audio Beat Matcher Sync", type: "audio_sync", status: "idle", progress: 0, config: { matchBeats: true, crossfadeDurationMs: 300 } },
        { id: "node_arranger", name: "Chronological Accent Arranger", type: "arranger", status: "idle", progress: 0, config: { shuffleBroll: false, introLogo: true } },
        { id: "node_export", name: "Multi-Format Export Compiler", type: "exporter", status: "idle", progress: 0, config: { quality: "ProRes 4K", formats: ["16:9", "9:16"] } }
      ],
      pacing_optimized_vlog: [
        { id: "node_detection", name: "Speech & Action Detector", type: "detection", status: "idle", progress: 0, config: { detectInterstellarSilence: true } },
        { id: "node_cutter", name: "Silent Jumps-Cuts Eliminator", type: "cutter", status: "idle", progress: 0, config: { gapToleranceSec: 0.1, autoTrimHum: true } },
        { id: "node_sync", name: "Narrative Voice-Music Leveler", type: "audio_sync", status: "idle", progress: 0, config: { autoDuckDb: -18, normalizeLoudnessLufs: -14 } },
        { id: "node_arranger", name: "B-Roll Intelligent Spacer", type: "arranger", status: "idle", progress: 0, config: { spacerIntervalSec: 15, transitionPreset: "LumaFade" } },
        { id: "node_export", name: "Fast Web YouTube Render", type: "exporter", status: "idle", progress: 0, config: { codec: "H.264 High Profile", bitRate: "12Mbps" } }
      ],
      high_energy_tiktok: [
        { id: "node_detection", name: "TikTok Trend Beat Signature Analyzer", type: "detection", status: "idle", progress: 0, config: { bpmAnalyzeRange: [120, 140] } },
        { id: "node_cutter", name: "Ultra-Fast Whip Cut Creator", type: "cutter", status: "idle", progress: 0, config: { trimLengthSec: 1.2, snapToBeats: true } },
        { id: "node_sync", name: "Bass Drop Alignment Module", type: "audio_sync", status: "idle", progress: 0, config: { zoomOnDrop: true, colorFlashOnDrop: true } },
        { id: "node_arranger", name: "Loop Point Optimizer", type: "arranger", status: "idle", progress: 0, config: { infiniteSeamlessLoop: true } },
        { id: "node_export", name: "Vertical TikTok Transcoder", type: "exporter", status: "idle", progress: 0, config: { cropRatio: "9:16", uploadDirect: false } }
      ],
      cinematic_promo: [
        { id: "node_detection", name: "Visual Scale & Depth Analyzer", type: "detection", status: "idle", progress: 0, config: { depthScoreThreshold: 0.7 } },
        { id: "node_cutter", name: "Slow Cinematic Dissolve Trimmer", type: "cutter", status: "idle", progress: 0, config: { minClipDurationSec: 5, autoFadeTransitions: true } },
        { id: "node_sync", name: "Symphonic Sub-bass Alignment", type: "audio_sync", status: "idle", progress: 0, config: { reverbWetPreset: "Cathedral", filterSweepSec: 4 } },
        { id: "node_arranger", name: "Dynamic Arc Narrative Sequencer", type: "arranger", status: "idle", progress: 0, config: { hookAtEnd: false, narrativeCurve: "exponential" } },
        { id: "node_export", name: "Master Rec2020 Color Encoder", type: "exporter", status: "idle", progress: 0, config: { depth: "10-bit HDR", lookupLut: "HollywoodOrangeTeal" } }
      ]
    };

    return defaultNodes[strategy] || defaultNodes.highlight_reel;
  }
}
