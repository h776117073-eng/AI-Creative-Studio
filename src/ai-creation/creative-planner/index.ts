import { StoryboardScene, AIProductionPlan, CreativeIntent, BrandIdentity } from "../types";

export class AICreativePlanner {
  private static instance: AICreativePlanner;

  public static getInstance(): AICreativePlanner {
    if (!AICreativePlanner.instance) {
      AICreativePlanner.instance = new AICreativePlanner();
    }
    return AICreativePlanner.instance;
  }

  /**
   * Generates a comprehensive storyboard and production plan based on user intent and brand.
   */
  public generateProductionPlan(intent: CreativeIntent, brand?: BrandIdentity): AIProductionPlan {
    const totalDuration = intent.durationSeconds;
    const mood = intent.mood;
    const platform = intent.platform;

    // Determine average duration of scenes based on platform/pacing rules
    const targetSceneDuration = platform === "tiktok" || platform === "instagram" ? 3 : 6;
    const scenesCount = Math.max(3, Math.ceil(totalDuration / targetSceneDuration));
    
    // Set style prompts
    const styleTransferMap: Record<string, string> = {
      cinematic: "Teal and orange cinematic color depth, high dynamic range shadows, anamorphic lens flares",
      animation: "Cel-shaded outlines, lively keyframed vector motions, whimsical character-driven shading",
      documentary: "Natural high-fidelity lighting, real-world field textures, minimal vignette borders",
      commercial: "High-key studio glow, extremely clean motion blur, elegant product highlights",
      social: "Vibrant saturated color palette, dynamic glitch cuts, fast slide transitions, stickers"
    };

    const visualStyle = styleTransferMap[intent.style.toLowerCase()] || styleTransferMap.cinematic;

    // Audio recommendations
    const musicMap: Record<string, string> = {
      tiktok: "High-energy trending bass-house with heavy drops",
      instagram: "Smooth retro-lofi beats or chill acoustic",
      film_trailer: "Epic Hans Zimmer-style orchestral swells with low brass hits",
      product_showcase: "Upbeat corporate tech synthwave or modern electronic",
      general: "Ambient electronic with cinematic pads"
    };

    const musicDirection = brand?.brandVoice === "futuristic" 
      ? "Cyberpunk synth waves and heavy modular bass"
      : musicMap[platform] || "Epic orchestral ambient";

    // Build the scene plans and shot lists
    const shotList: StoryboardScene[] = [];
    const scenePlan: string[] = [];

    const hooks = [
      "Dynamic hook: Fast zoom intro revealing the central theme with bold animated text.",
      "Immersive overview: Ambient panoramic establishing shot setting the exact scene location.",
      "Intense focus: Close-up macro transition highlighting detail and dramatic action."
    ];

    const bodies = [
      "In-depth analysis: Slow dolly shot focusing on detail while kinetic typography outlines metrics.",
      "Character connection: Mid-shot presenting the central protagonist with elegant lighting.",
      "Abstract motion: Fluid cinematic sweep panning across modern tech elements.",
      "Detailed overview: Crane shot shifting perspective from top-down to profile angle."
    ];

    const outros = [
      "Call to action: Logo sweep transition with sleek motion blur and brand sound triggers.",
      "Ending slide: Fading sunset backdrop with social media icons and glowing signature.",
      "Corporate sign-off: Minimalist brand colors card paired with product display."
    ];

    for (let i = 0; i < scenesCount; i++) {
      const sceneNum = i + 1;
      let description = "";
      let shotSuggestion = "";
      let cameraSuggestion = "Static cinematic track";
      let overlayText = "";

      // Distribute scenes logically
      if (i === 0) {
        description = hooks[Math.floor(Math.random() * hooks.length)];
        shotSuggestion = "Establishing wide-angle to capture high scale atmosphere.";
        cameraSuggestion = "Slow drone pull-back or rapid forward dolly zoom.";
        overlayText = brand?.name ? `Introducing ${brand.name}` : "UNVEIL THE FUTURE";
      } else if (i === scenesCount - 1) {
        description = outros[Math.floor(Math.random() * outros.length)];
        shotSuggestion = "Clean flat close-up focusing directly on brand logo.";
        cameraSuggestion = "Slow push-in transition ending on brand colors.";
        overlayText = brand?.brandVoice ? `Voice: ${brand.brandVoice}` : "SUBSCRIBE NOW";
      } else {
        description = bodies[Math.floor(Math.random() * bodies.length)];
        shotSuggestion = "Detail tracking shot utilizing shallow depth-of-field.";
        cameraSuggestion = "Handheld orbital panning or linear slider glide.";
        overlayText = "CREATIVE PRECISION";
      }

      scenePlan.push(`Scene ${sceneNum}: ${description}`);

      shotList.push({
        id: `sc_${intent.purpose}_${sceneNum}_${Date.now()}`,
        sceneNumber: sceneNum,
        description,
        shotSuggestion,
        cameraSuggestion,
        visualStyleSuggestion: visualStyle,
        durationSeconds: targetSceneDuration,
        overlayText,
        pacing: platform === "tiktok" ? "fast" : "moderate"
      });
    }

    // Standardize timeline specifications
    const tracksCount = platform === "tiktok" ? 3 : 5; // video, audio, sound fx, branding, texts
    const estimatedClipsCount = shotList.length;

    return {
      id: `plan_${intent.platform}_${Date.now()}`,
      title: `${intent.genre.toUpperCase()} ${intent.platform.toUpperCase()} CREATIVE ASSEMBLY`,
      scenePlan,
      shotList,
      timelineStructure: {
        tracksCount,
        estimatedClipsCount,
        beatsPerMinute: platform === "tiktok" ? 128 : 95
      },
      musicDirection,
      colorStyle: brand?.colors?.accent 
        ? `Calibrated color wash utilizing brand hex ${brand.colors.accent}` 
        : "Warm Hollywood Cinema look with deep shadows",
      motionStyle: brand?.fonts?.heading 
        ? `Typography animation customized in font '${brand.fonts.heading}' with elastic slide-in` 
        : "Kinetic typography overlay with standard CapCut ease presets",
      exportSettings: {
        format: platform === "presentation" ? "MP4" : "ProRes 422",
        resolution: platform === "tiktok" ? "1080x1920" : "3840x2160",
        fps: platform === "tiktok" ? 30 : 24,
        bitrateMbps: platform === "tiktok" ? 15 : 45
      }
    };
  }
}
