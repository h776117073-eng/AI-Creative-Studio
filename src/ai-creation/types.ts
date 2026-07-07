export interface BrandIdentity {
  logoUrl?: string;
  logoName?: string;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
  };
  fonts: {
    heading: string;
    body: string;
    mono?: string;
  };
  brandVoice: string; // e.g. "energetic", "corporate", "empathetic", "futuristic"
  visualStyle: string; // e.g. "minimalist", "bold", "cinematic", "cyberpunk"
  name?: string;
}

export interface CreativeIntent {
  purpose: string; // e.g., "social_ad", "vlog", "product_launch"
  platform: "youtube" | "tiktok" | "instagram" | "presentation" | "film_trailer" | "product_showcase" | "general";
  audience: string; // e.g., "tech-savvy Gen Z", "business executives"
  durationSeconds: number;
  style: string; // e.g., "cinematic", "organic", "vector-art"
  mood: string; // e.g., "dramatic", "inspirational", "playful"
  genre: string; // e.g., "tech", "travel", "beauty", "tutorial"
  brandId?: string;
  requiredAssets: string[]; // e.g. ["A-roll interview", "Product close-up", "B-roll street ambient"]
}

export interface StoryboardScene {
  id: string;
  sceneNumber: number;
  description: string;
  shotSuggestion: string;
  cameraSuggestion: string;
  visualStyleSuggestion: string;
  durationSeconds: number;
  overlayText?: string;
  pacing: "fast" | "moderate" | "slow";
}

export interface AIProductionPlan {
  id: string;
  title: string;
  scenePlan: string[];
  shotList: StoryboardScene[];
  timelineStructure: {
    tracksCount: number;
    estimatedClipsCount: number;
    beatsPerMinute: number;
  };
  musicDirection: string; // e.g. "synthwave ambient", "acoustic corporate"
  colorStyle: string; // e.g. "teal & orange cinematic LUT", "high key bright"
  motionStyle: string; // e.g. "kinetic typography", "smooth elastic eases"
  exportSettings: {
    format: string;
    resolution: string;
    fps: number;
    bitrateMbps: number;
  };
}

export interface SmartTemplate {
  id: string;
  name: string;
  category: "advertisement" | "youtube" | "tiktok" | "instagram" | "film_trailer" | "business_presentation" | "product_showcase";
  description: string;
  durationSeconds: number;
  aspectRatio: "16:9" | "9:16" | "1:1" | "2.39:1";
  defaultMusicGenre: string;
  defaultColorGrade: string;
  visualStyle: string;
  placeholders: {
    id: string;
    type: "video" | "audio" | "image" | "text";
    role: string; // e.g. "hook_bg", "brand_logo", "product_hero", "call_to_action"
    suggestedDuration: number;
  }[];
}

export interface CreativeProjectResult {
  id: string;
  name: string;
  intent: CreativeIntent;
  productionPlan: AIProductionPlan;
  brandUsed?: BrandIdentity;
  timeline: {
    tracks: {
      id: string;
      name: string;
      type: "video" | "audio" | "subtitle" | "fx" | "overlay";
      clips: {
        id: string;
        assetId: string;
        assetName: string;
        type: "video" | "audio" | "image" | "text";
        startFrame: number;
        endFrame: number;
        volume?: number;
        effects: { type: string; params: Record<string, any> }[];
        motion?: { presetName: string; easing: string; durationSec: number };
      }[];
    }[];
  };
  costSummary: {
    processingCredits: number;
    gigaflops: number;
    processingTimeSeconds: number;
    explainability: {
      createdOverview: string;
      toolSelectionJustification: string;
      improvementSuggestions: string[];
    };
  };
}
