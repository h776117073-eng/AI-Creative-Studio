import { CreativeIntent, BrandIdentity } from "../types";

export class AIPromptEngine {
  private static instance: AIPromptEngine;

  private stylesDatabase: Record<string, { mood: string; style: string; color: string }> = {
    cinematic: { mood: "dramatic", style: "anamorphic lenses, shallow depth of field", color: "Orange & Teal, low contrast master" },
    commercial: { mood: "vibrant", style: "slick high key, glossy surfaces", color: "Clean commercial highlights, Rec709 punch" },
    documentary: { mood: "authentic", style: "organic handheld, natural daylight", color: "Subtle analog grain, real-world contrast" },
    social: { mood: "high-energy", style: "fast cuts, zoom transitions, kinetic stickers", color: "Warm retro look, modern vibrant tones" },
    animation: { mood: "playful", style: "cel-shaded borders, flat colors, bouncy pacing", color: "Saturated primary hues" }
  };

  public static getInstance(): AIPromptEngine {
    if (!AIPromptEngine.instance) {
      AIPromptEngine.instance = new AIPromptEngine();
    }
    return AIPromptEngine.instance;
  }

  /**
   * Translates a natural language command (optionally with reference media, styles, or brands)
   * into a robust, structured CreativeIntent payload.
   */
  public parsePrompt(
    prompt: string,
    options?: {
      voiceCommand?: boolean;
      imageRef?: string | null;
      videoRef?: string | null;
      stylePreference?: string;
      brandPreset?: BrandIdentity;
    }
  ): CreativeIntent {
    const text = prompt.toLowerCase();
    
    // Default fallback values
    let purpose = "vlog";
    let platform: "youtube" | "tiktok" | "instagram" | "presentation" | "film_trailer" | "product_showcase" | "general" = "youtube";
    let audience = "General creative enthusiasts";
    let durationSeconds = 30;
    let style = options?.stylePreference || "cinematic";
    let mood = "inspiring";
    let genre = "travel";
    let requiredAssets: string[] = ["Main shot", "Overlay titles", "Soundtrack"];

    // 1. Detect platform constraints and aspect ratio directives
    if (text.includes("tiktok") || text.includes("reels") || text.includes("shorts") || text.includes("vertical") || text.includes("9:16")) {
      platform = "tiktok";
      durationSeconds = 15;
      audience = "Mobile-first casual audience";
    } else if (text.includes("instagram") || text.includes("post") || text.includes("square")) {
      platform = "instagram";
      durationSeconds = 30;
      audience = "Social feed scrolling audience";
    } else if (text.includes("trailer") || text.includes("movie") || text.includes("epic") || text.includes("cinematic")) {
      platform = "film_trailer";
      durationSeconds = 90;
      audience = "Cinephiles and theater audience";
      mood = "dramatic";
    } else if (text.includes("ad") || text.includes("promo") || text.includes("commercial") || text.includes("product") || text.includes("showcase")) {
      platform = "product_showcase";
      durationSeconds = 30;
      audience = "Potential consumers & tech buyers";
      purpose = "product_launch";
    } else if (text.includes("presentation") || text.includes("corporate") || text.includes("pitch")) {
      platform = "presentation";
      durationSeconds = 120;
      audience = "Investors and executives";
      purpose = "business_presentation";
    }

    // 2. Identify genre descriptors
    if (text.includes("travel") || text.includes("vlog") || text.includes("nature") || text.includes("explore")) {
      genre = "travel";
      requiredAssets = ["B-roll nature wide shots", "Ambient wind rustle sound", "Cinematic drone capture"];
    } else if (text.includes("tech") || text.includes("software") || text.includes("crypto") || text.includes("cyberpunk")) {
      genre = "tech";
      requiredAssets = ["Software demo screencast", "Glow UI overlays", "Cyberpunk digital hum sound"];
    } else if (text.includes("fashion") || text.includes("beauty") || text.includes("style")) {
      genre = "beauty";
      requiredAssets = ["Close-up macro cloth texture", "Lounge ambient background soundtrack", "Slow motion spin shots"];
    } else if (text.includes("tutorial") || text.includes("cook") || text.includes("how to")) {
      genre = "tutorial";
      requiredAssets = ["Split screen diagram", "Voiceover narration stem", "Step indicators text overlays"];
    }

    // 3. Map styles database
    const detectedStyle = Object.keys(this.stylesDatabase).find(s => text.includes(s) || style.includes(s));
    if (detectedStyle) {
      const config = this.stylesDatabase[detectedStyle];
      style = detectedStyle;
      mood = config.mood;
    }

    // 4. Adjust duration based on literal mentions in prompt
    const secMatch = text.match(/(\d+)\s*(s|sec|second)/);
    if (secMatch) {
      durationSeconds = parseInt(secMatch[1], 10);
    } else if (text.includes("minute") || text.includes("min")) {
      const minMatch = text.match(/(\d+)\s*(m|min|minute)/);
      if (minMatch) {
        durationSeconds = parseInt(minMatch[1], 10) * 60;
      } else {
        durationSeconds = 60;
      }
    }

    // 5. Image or Video references provide style indicators
    if (options?.imageRef) {
      style += " + image-extracted color look";
    }
    if (options?.videoRef) {
      style += " + video-matched timeline pacing";
    }

    // Brand matching
    if (options?.brandPreset) {
      audience = `${audience} (Aligned with ${options.brandPreset.brandVoice} voice)`;
    }

    return {
      purpose,
      platform,
      audience,
      durationSeconds,
      style,
      mood,
      genre,
      brandId: options?.brandPreset?.name,
      requiredAssets
    };
  }
}
