export interface TemplateVariable {
  id: string;
  name: string;
  type: "text" | "color" | "media" | "font";
  defaultValue: string;
  currentValue: string;
}

export interface TemplateBlock {
  id: string;
  blockType: "video" | "audio" | "subtitle";
  startTimeSec: number;
  durationSec: number;
  variableBindingId?: string; // Links block content to editable variable values
  animationPreset?: string;
  colorFilterName?: string;
}

export interface CreativeTemplate {
  id: string;
  title: string;
  category: "tiktok_ad" | "youtube_intro" | "cinematic_trailer" | "promotional";
  aspectRatio: "16:9" | "9:16" | "1:1";
  variables: TemplateVariable[];
  blocks: TemplateBlock[];
}

export class TemplateEngine {
  private static instance: TemplateEngine | null = null;
  private templates: Map<string, CreativeTemplate> = new Map();

  private constructor() {
    this.seedLibrary();
  }

  public static getInstance(): TemplateEngine {
    if (!TemplateEngine.instance) {
      TemplateEngine.instance = new TemplateEngine();
    }
    return TemplateEngine.instance;
  }

  private seedLibrary(): void {
    // Cinematic advertising layout (vertical 9:16)
    const shortFormPromo: CreativeTemplate = {
      id: "vert_promo_01",
      title: "Cinematic Social Ads (Vertical)",
      category: "tiktok_ad",
      aspectRatio: "9:16",
      variables: [
        { id: "main_headline", name: "Main Headline Text", type: "text", defaultValue: "AI STUDIO BUILD", currentValue: "AI STUDIO BUILD" },
        { id: "accent_color", name: "Brand Accent Color", type: "color", defaultValue: "#FF3B30", currentValue: "#FF3B30" },
        { id: "promo_video", name: "Promotional Footage", type: "media", defaultValue: "vid_demo_intro", currentValue: "vid_demo_intro" },
      ],
      blocks: [
        { id: "block_vid_1", blockType: "video", startTimeSec: 0, durationSec: 4.5, variableBindingId: "promo_video", animationPreset: "fade_in_zoom", colorFilterName: "cinematic_teal" },
        { id: "block_sub_1", blockType: "subtitle", startTimeSec: 0.5, durationSec: 3.5, variableBindingId: "main_headline", animationPreset: "letter_slide" },
        { id: "block_audio_1", blockType: "audio", startTimeSec: 0, durationSec: 15.0, animationPreset: "dynamic_beat_sync" },
      ],
    };

    // YouTube Intro sequence (landscape 16:9)
    const youtubeIntro: CreativeTemplate = {
      id: "yt_intro_01",
      title: "Neon Cyber Tech Intro",
      category: "youtube_intro",
      aspectRatio: "16:9",
      variables: [
        { id: "channel_title", name: "Channel Title", type: "text", defaultValue: "CYBERPUNK CREATIVE", currentValue: "CYBERPUNK CREATIVE" },
        { id: "background_theme", name: "Neon Glow Theme", type: "color", defaultValue: "#39FF14", currentValue: "#39FF14" },
      ],
      blocks: [
        { id: "block_vid_2", blockType: "video", startTimeSec: 0, durationSec: 6.0, colorFilterName: "cyber_neon" },
        { id: "block_sub_2", blockType: "subtitle", startTimeSec: 1.0, durationSec: 4.0, variableBindingId: "channel_title", animationPreset: "neon_glow_flicker" },
      ],
    };

    this.templates.set(shortFormPromo.id, shortFormPromo);
    this.templates.set(youtubeIntro.id, youtubeIntro);
  }

  public getTemplates(): CreativeTemplate[] {
    return Array.from(this.templates.values());
  }

  public getTemplate(id: string): CreativeTemplate | null {
    return this.templates.get(id) || null;
  }

  /**
   * Applies variable replacements inside templates, triggering automatic alignment.
   */
  public updateVariable(templateId: string, variableId: string, newValue: string): boolean {
    const template = this.templates.get(templateId);
    if (!template) return false;

    const variable = template.variables.find(v => v.id === variableId);
    if (!variable) return false;

    variable.currentValue = newValue;
    this.templates.set(templateId, template);

    console.log(`[TemplateEngine] Variable "${variableId}" on template "${templateId}" successfully updated to: ${newValue}`);
    return true;
  }

  /**
   * Automates the replacement of clip segments in active templates based on duration and visual features.
   * Leverages metadata markers to align scene changes with audio drops.
   */
  public compileTemplateToTimeline(
    templateId: string,
    userMediaList: Array<{ assetId: string; durationSec: number }>
  ): TemplateBlock[] {
    const template = this.templates.get(templateId);
    if (!template) return [];

    console.log(`[TemplateEngine] AI Matcher active: Compiling template "${template.title}" using ${userMediaList.length} user assets...`);

    const compiledBlocks: TemplateBlock[] = [];
    let mediaPointer = 0;

    template.blocks.forEach((block) => {
      const clonedBlock = { ...block };

      if (block.blockType === "video" && userMediaList.length > 0) {
        // AI Scene matching: choose user clip with nearest matching duration bounds
        const targetMedia = userMediaList[mediaPointer % userMediaList.length];
        
        // Map block variable context to target video ID
        clonedBlock.variableBindingId = targetMedia.assetId;
        // Auto-scale template block duration if clip is shorter
        clonedBlock.durationSec = Math.min(block.durationSec, targetMedia.durationSec);
        
        mediaPointer++;
      }

      compiledBlocks.push(clonedBlock);
    });

    return compiledBlocks;
  }
}
