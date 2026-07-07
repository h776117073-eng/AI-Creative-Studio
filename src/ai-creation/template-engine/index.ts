import { SmartTemplate, BrandIdentity } from "../types";

export class AISmartTemplateEngine {
  private static instance: AISmartTemplateEngine;

  private templatesDatabase: SmartTemplate[] = [
    {
      id: "tpl_social_tiktok_01",
      name: "⚡ TikTok Dynamic Trend Hook",
      category: "tiktok",
      description: "Fast-paced trend style featuring intense audio sync cuts and glowing captions.",
      durationSeconds: 15,
      aspectRatio: "9:16",
      defaultMusicGenre: "Future Bass trend pop",
      defaultColorGrade: "Saturated retro vibrant",
      visualStyle: "Glow aesthetic, neon glitch overlays",
      placeholders: [
        { id: "pl_hook_v01", type: "video", role: "0-3s: Immediate action visual hook", suggestedDuration: 3 },
        { id: "pl_build_v02", type: "video", role: "3-8s: Fast cut compilation of details", suggestedDuration: 5 },
        { id: "pl_climax_v03", type: "video", role: "8-12s: Peak dynamic shot, high motion", suggestedDuration: 4 },
        { id: "pl_brand_logo", type: "image", role: "12-15s: Brand sticker and outro card", suggestedDuration: 3 }
      ]
    },
    {
      id: "tpl_advertisement_01",
      name: "🛒 E-Commerce Product Showcase",
      category: "advertisement",
      description: "Perfect for Shopify stores, featuring slow panning shots, sleek pricing labels, and rich audio.",
      durationSeconds: 30,
      aspectRatio: "1:1",
      defaultMusicGenre: "Upbeat corporate chillhop",
      defaultColorGrade: "High-key studio white glow",
      visualStyle: "Minimalist borders, clean sans-serif callouts",
      placeholders: [
        { id: "pl_intro_hero", type: "video", role: "0-5s: Beautiful pan across product body", suggestedDuration: 5 },
        { id: "pl_macro_features", type: "video", role: "5-15s: Micro texture macro focus", suggestedDuration: 10 },
        { id: "pl_customer_review", type: "text", role: "15-22s: Glowing testimonial over video", suggestedDuration: 7 },
        { id: "pl_cta_button", type: "image", role: "22-30s: Brand buy action, promo code", suggestedDuration: 8 }
      ]
    },
    {
      id: "tpl_film_trailer_01",
      name: "🎬 Epic Cinematic IMAX Trailer",
      category: "film_trailer",
      description: "Low-frequency brass, dramatic slow-dissolve overlays, film grain, and letterboxed ratios.",
      durationSeconds: 60,
      aspectRatio: "2.39:1",
      defaultMusicGenre: "Aggressive orchestral brass sweeps",
      defaultColorGrade: "Teal and orange cinematic master",
      visualStyle: "Widescreen letterbox, heavy film grain, mist filters",
      placeholders: [
        { id: "pl_mystery_establish", type: "video", role: "0-10s: Misty landscape, slow horizontal track", suggestedDuration: 10 },
        { id: "pl_protagonist_reveal", type: "video", role: "10-25s: Low-key silhouette portrait frame", suggestedDuration: 15 },
        { id: "pl_action_montage", type: "video", role: "25-45s: Fast beat-matched cuts of conflict", suggestedDuration: 20 },
        { id: "pl_title_logo_card", type: "text", role: "45-60s: Metallic embossed massive titles", suggestedDuration: 15 }
      ]
    },
    {
      id: "tpl_youtube_vlog_01",
      name: "☕ Warm Cozy Travel Vlog Intro",
      category: "youtube",
      description: "Chilled acoustic vibes, pastel warmth, hand-drawn font elements, and seamless luma transitions.",
      durationSeconds: 45,
      aspectRatio: "16:9",
      defaultMusicGenre: "Chilled acoustic indie guitar",
      defaultColorGrade: "Warm vintage pastel",
      visualStyle: "Soft organic focus, elegant film border",
      placeholders: [
        { id: "pl_scenic_drone", type: "video", role: "0-12s: Slow panning aerial shot", suggestedDuration: 12 },
        { id: "pl_broll_coffee", type: "video", role: "12-25s: Cozy morning action sequence", suggestedDuration: 13 },
        { id: "pl_selfie_talk", type: "video", role: "25-40s: Direct speaker visual conversation", suggestedDuration: 15 },
        { id: "pl_subscribe_badge", type: "image", role: "40-45s: Animated bell and handle profile", suggestedDuration: 5 }
      ]
    },
    {
      id: "tpl_business_pitch_01",
      name: "📈 Tech Pitch Deck Video Presentation",
      category: "business_presentation",
      description: "Sophisticated vector outlines, clear chart inserts, corporate blue grades, and professional tone.",
      durationSeconds: 120,
      aspectRatio: "16:9",
      defaultMusicGenre: "Empathetic tech corporate ambient",
      defaultColorGrade: "Deep navy and cool white accents",
      visualStyle: "Sleek infographics, dynamic layout splits",
      placeholders: [
        { id: "pl_title_problem", type: "text", role: "0-15s: Dramatic typography of problem", suggestedDuration: 15 },
        { id: "pl_solution_demo", type: "video", role: "15-50s: Mobile screen recording swipe", suggestedDuration: 35 },
        { id: "pl_market_charts", type: "image", role: "50-90s: Elegant graph slide overlay", suggestedDuration: 40 },
        { id: "pl_team_summary", type: "video", role: "90-120s: Headshots and contact card", suggestedDuration: 30 }
      ]
    }
  ];

  public static getInstance(): AISmartTemplateEngine {
    if (!AISmartTemplateEngine.instance) {
      AISmartTemplateEngine.instance = new AISmartTemplateEngine();
    }
    return AISmartTemplateEngine.instance;
  }

  public getAllTemplates(): SmartTemplate[] {
    return this.templatesDatabase;
  }

  public getTemplatesByCategory(category: string): SmartTemplate[] {
    if (category === "all") return this.templatesDatabase;
    return this.templatesDatabase.filter(t => t.category === category);
  }

  /**
   * Automatically replaces placeholders, generates copy aligned with brand voice,
   * matches colors to hex values, and aligns audio/animation variables.
   */
  public compileTemplate(
    templateId: string,
    brand?: BrandIdentity,
    userCustomText?: string
  ): {
    compiledTemplate: SmartTemplate;
    autoGeneratedTexts: Record<string, string>;
    colorStyleResult: string;
    musicSelection: string;
    animationPreset: string;
  } {
    const template = this.templatesDatabase.find(t => t.id === templateId) || this.templatesDatabase[0];
    const voice = brand?.brandVoice || "friendly & casual";
    
    // Auto-generate promotional copy aligned with brand voice
    const generatedTexts: Record<string, string> = {};
    template.placeholders.forEach(pl => {
      if (pl.type === "text" || pl.role.includes("CTA") || pl.role.includes("logo")) {
        if (pl.role.includes("CTA") || pl.role.includes("button")) {
          generatedTexts[pl.id] = brand?.name 
            ? `🔥 Shop now at ${brand.name}`
            : "⚡ DISCOVER MORE NOW";
        } else if (pl.role.includes("testimonial") || pl.role.includes("review")) {
          generatedTexts[pl.id] = `⭐️ "Game-changing quality!" - Built in harmony with ${voice} brand specs.`;
        } else if (pl.role.includes("title") || pl.role.includes("problem")) {
          generatedTexts[pl.id] = userCustomText || `Unveiling the future. Optimized for ${voice} audiences.`;
        } else {
          generatedTexts[pl.id] = `Empowered by ${brand?.name || "AI Creative Studio"}`;
        }
      }
    });

    // Color adaptation matrices
    const colorStyleResult = brand?.colors?.accent
      ? `Auto-calibrated brand balance: Match highlights to ${brand.colors.accent}, background to ${brand.colors.background || "#09090b"}`
      : `Matched to template presets: ${template.defaultColorGrade}`;

    // Music adaptations
    const musicSelection = brand?.brandVoice === "futuristic" 
      ? "AI Cyberpunk Synth 130BPM track"
      : `${template.defaultMusicGenre} synchronized ambient track`;

    // Animation presets
    const animationPreset = brand?.visualStyle === "minimalist"
      ? "Smooth organic fade-in with minor 1.02x zoom-outs"
      : "Spring bezier bouncy 0.4s slide animations";

    return {
      compiledTemplate: template,
      autoGeneratedTexts: generatedTexts,
      colorStyleResult,
      musicSelection,
      animationPreset
    };
  }
}
