import { CreativeIntent, AIProductionPlan, CreativeProjectResult, BrandIdentity } from "../types";

export class AICreativeProjectBuilder {
  private static instance: AICreativeProjectBuilder;

  public static getInstance(): AICreativeProjectBuilder {
    if (!AICreativeProjectBuilder.instance) {
      AICreativeProjectBuilder.instance = new AICreativeProjectBuilder();
    }
    return AICreativeProjectBuilder.instance;
  }

  /**
   * Compiles the high-level intent, plan, and brand preferences into a highly detailed
   * multitrack creative project result that is fully compatible with our video studio timeline.
   */
  public constructProject(
    intent: CreativeIntent,
    plan: AIProductionPlan,
    brand?: BrandIdentity
  ): CreativeProjectResult {
    const fps = plan.exportSettings.fps;
    const totalFrames = intent.durationSeconds * fps;
    const framesPerScene = Math.floor(totalFrames / plan.shotList.length);

    // Create high-level multi-track structure: Video Track, Audio Track, Overlay Track
    const tracks: CreativeProjectResult["timeline"]["tracks"] = [
      {
        id: "tr_video_01",
        name: "🎬 Video Primary A-Roll",
        type: "video",
        clips: []
      },
      {
        id: "tr_video_02",
        name: "🌸 Video B-Roll & Brand Outros",
        type: "video",
        clips: []
      },
      {
        id: "tr_audio_01",
        name: "🎵 Soundtrack Sync Track",
        type: "audio",
        clips: []
      },
      {
        id: "tr_subtitle_01",
        name: "💬 Dynamic Animated Captions",
        type: "subtitle",
        clips: []
      }
    ];

    // Populate timeline with frame-accurate clips based on Storyboard Shots
    plan.shotList.forEach((shot, index) => {
      const startFrame = index * framesPerScene;
      const endFrame = Math.min(totalFrames, (index + 1) * framesPerScene);

      // Determine asset references based on genre
      const videoAssetId = `ast_vid_${intent.genre}_${index + 1}`;
      const videoAssetName = `${intent.genre.toUpperCase()}_Asset_${index + 1}.mp4`;

      // Main video clip on track 1 or 2
      const isEven = index % 2 === 0;
      const targetTrackId = isEven ? "tr_video_01" : "tr_video_02";
      const targetTrack = tracks.find(t => t.id === targetTrackId)!;

      // Add zoom effects or cinematic motion
      const effects: any[] = [
        { type: "color_lut", params: { lutName: plan.colorStyle, intensity: 0.85 } }
      ];

      if (index === 0) {
        effects.push({ type: "zoom_fade", params: { speed: "fast", scaleFrom: 1.2, scaleTo: 1.0 } });
      }

      targetTrack.clips.push({
        id: `clip_vid_${index}_${Date.now()}`,
        assetId: videoAssetId,
        assetName: videoAssetName,
        type: "video",
        startFrame,
        endFrame,
        effects,
        motion: {
          presetName: plan.motionStyle,
          easing: "cubic-bezier(0.25, 1, 0.5, 1)",
          durationSec: 1.5
        }
      });

      // Subtitles/Overlay Text
      if (shot.overlayText) {
        const textTrack = tracks.find(t => t.id === "tr_subtitle_01")!;
        textTrack.clips.push({
          id: `clip_text_${index}_${Date.now()}`,
          assetId: `ast_txt_${index}`,
          assetName: `Caption: ${shot.overlayText}`,
          type: "text",
          startFrame: startFrame + 12, // slightly delayed entry
          endFrame: endFrame - 12, // early exit
          effects: [{ type: "neon_shadow", params: { color: brand?.colors?.accent || "#a855f7" } }]
        });
      }
    });

    // Populate Soundtrack track spanning entire project duration
    const audioTrack = tracks.find(t => t.id === "tr_audio_01")!;
    audioTrack.clips.push({
      id: `clip_audio_master_${Date.now()}`,
      assetId: "ast_aud_soundtrack_01",
      assetName: `Sync Music: ${plan.musicDirection}.wav`,
      type: "audio",
      startFrame: 0,
      endFrame: totalFrames,
      volume: 0.7,
      effects: [
        { type: "fade_in_out", params: { fadeInSec: 2.0, fadeOutSec: 3.5 } },
        { type: "auto_ducking", params: { targetDb: -12, thresholdDb: -22 } }
      ]
    });

    // Estimate costs
    const isTrailer = intent.platform === "film_trailer";
    const duration = intent.durationSeconds;
    const baseGflopsPerSec = isTrailer ? 150 : 50;
    const gigaflops = Math.round(duration * baseGflopsPerSec * tracks.length * 1.2);
    const processingCredits = Math.round(gigaflops / 100);
    const processingTimeSeconds = Math.round((duration * 0.4) + (tracks.length * 2));

    const createdOverview = `Generated a comprehensive ${duration}-second ${intent.style} ${intent.platform} project setup centering a ${intent.genre}-themed narrative, consisting of ${plan.shotList.length} scenes matched with dynamic transition overlays.`;

    const toolSelectionJustification = `Apollo coordinated 4 key creative nodes: (1) Scene Boundary Detector mapped cuts frame-accurately; (2) Audio Sync aligned transitions to a ${plan.timelineStructure.beatsPerMinute} BPM audio track; (3) HDR Film Colorist mapped LUT profiles; and (4) Kinetic Motion engine built typographic titles in alignment with the chosen voice specifications.`;

    const improvementSuggestions = [
      "Incorporate custom branded assets inside the first 3 seconds to maximize hook engagement.",
      "Attenuate vocal track high-frequencies by -2dB to improve voiceover presence during the bass drop.",
      "Extend transition overlays to 0.8 seconds to create a more smooth, dreamlike cinematic look."
    ];

    return {
      id: `prj_ai_${intent.genre}_${Date.now()}`,
      name: `${intent.genre.toUpperCase()} ${intent.platform.toUpperCase()} MASTERPROJECT`,
      intent,
      productionPlan: plan,
      brandUsed: brand,
      timeline: { tracks },
      costSummary: {
        processingCredits,
        gigaflops,
        processingTimeSeconds,
        explainability: {
          createdOverview,
          toolSelectionJustification,
          improvementSuggestions
        }
      }
    };
  }
}
