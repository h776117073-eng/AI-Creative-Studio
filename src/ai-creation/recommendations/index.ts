import { CreativeIntent, AIProductionPlan } from "../types";

export interface SystemRecommendation {
  id: string;
  category: "performance" | "creative" | "pricing" | "asset";
  title: string;
  description: string;
  impactScore: "high" | "medium" | "low";
  suggestedAction: string;
}

export class AICreativeRecommendations {
  private static instance: AICreativeRecommendations;

  public static getInstance(): AICreativeRecommendations {
    if (!AICreativeRecommendations.instance) {
      AICreativeRecommendations.instance = new AICreativeRecommendations();
    }
    return AICreativeRecommendations.instance;
  }

  /**
   * Evaluates creative parameters to generate cost metrics, processing times, and actionable recommendations.
   */
  public analyzeProjectDeliverables(
    intent: CreativeIntent,
    plan: AIProductionPlan
  ): {
    processingCredits: number;
    gigaflops: number;
    processingTimeSeconds: number;
    explainability: {
      createdOverview: string;
      toolSelectionJustification: string;
      improvementSuggestions: string[];
    };
    recommendations: SystemRecommendation[];
  } {
    const isTrailer = intent.platform === "film_trailer";
    const duration = intent.durationSeconds;
    
    // Estimate computational complexity (GigaFLOPs / credits / processing time)
    const baseGflopsPerSec = isTrailer ? 150 : 50;
    const gigaflops = Math.round(duration * baseGflopsPerSec * plan.timelineStructure.tracksCount * 1.2);
    
    const processingCredits = Math.round(gigaflops / 100);
    const processingTimeSeconds = Math.round((duration * 0.4) + (plan.timelineStructure.tracksCount * 2));

    // Explainability summaries
    const createdOverview = `Generated a comprehensive ${duration}-second ${intent.style} ${intent.platform} project setup centering a ${intent.genre}-themed narrative, consisting of ${plan.shotList.length} scenes matched with dynamic transition overlays.`;

    const toolSelectionJustification = `Apollo coordinated 4 key creative nodes: (1) Scene Boundary Detector mapped cuts frame-accurately; (2) Audio Sync aligned transitions to a ${plan.timelineStructure.beatsPerMinute} BPM audio track; (3) HDR Film Colorist mapped LUT profiles; and (4) Kinetic Motion engine built typographic titles in alignment with the chosen voice specifications.`;

    const improvementSuggestions = [
      "Incorporate custom branded assets inside the first 3 seconds to maximize hook engagement.",
      "Attenuate vocal track high-frequencies by -2dB to improve voiceover presence during the bass drop.",
      "Extend transition overlays to 0.8 seconds to create a more smooth, dreamlike cinematic look."
    ];

    // Build standard recommendations list
    const recommendations: SystemRecommendation[] = [
      {
        id: "rec_perf_01",
        category: "performance",
        title: "Activate Multi-Pass GPU Transcoding",
        description: "Your current sequence utilizes high-resolution ProRes layers. Enabling Multi-Pass encoding will reduce output file size by up to 24% with no visual loss.",
        impactScore: "high",
        suggestedAction: "Enable Multi-Pass on Render Panel"
      },
      {
        id: "rec_creative_02",
        category: "creative",
        title: "Adopt 128BPM Bass Hook Beat Alignment",
        description: "Your TikTok trend clips align best with rapid rhythmic structures. Syncing scene transitions directly with bass-lines increases user retention metrics.",
        impactScore: "medium",
        suggestedAction: "Apply Auto-Beat Matching on Audio Settings"
      },
      {
        id: "rec_asset_03",
        category: "asset",
        title: "Missing High-Resolution Brand Logo",
        description: "The current storyboard references a logo outro transition, but only a placeholder is available in the library folder.",
        impactScore: "high",
        suggestedAction: "Upload Brand Logo PNG"
      },
      {
        id: "rec_pricing_04",
        category: "pricing",
        title: "Off-peak Server Schedule Optimization",
        description: "Rendering high-density HDR sequences costs 2x credits during high congestion. Queueing this job for midnight cuts processing cost in half.",
        impactScore: "low",
        suggestedAction: "Schedule Render for Off-Peak"
      }
    ];

    return {
      processingCredits,
      gigaflops,
      processingTimeSeconds,
      explainability: {
        createdOverview,
        toolSelectionJustification,
        improvementSuggestions
      },
      recommendations
    };
  }
}
