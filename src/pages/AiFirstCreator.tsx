import React, { useState, useEffect, useRef } from "react";
import { 
  Sparkles, 
  Layers, 
  Settings2, 
  HelpCircle, 
  CheckCircle2, 
  Play, 
  ArrowRight, 
  DollarSign, 
  Clock, 
  Activity, 
  Sliders, 
  Compass, 
  Mic, 
  Image as ImageIcon, 
  Video as VideoIcon, 
  Check, 
  Info,
  ChevronRight,
  Workflow,
  Plus,
  RefreshCw,
  Trash2,
  SlidersHorizontal,
  FolderOpen
} from "lucide-react";
import { PageId } from "../types";
import { AIPromptEngine } from "../ai-creation/prompt-engine";
import { AICreativePlanner } from "../ai-creation/creative-planner";
import { AISmartTemplateEngine } from "../ai-creation/template-engine";
import { AIPipelineWorkflowGenerator, PipelineNode } from "../ai-creation/workflow-generator";
import { AICreativeRecommendations, SystemRecommendation } from "../ai-creation/recommendations";
import { AICreativeProjectBuilder } from "../ai-creation/project-builder";
import { BrandIdentity, CreativeProjectResult, StoryboardScene } from "../ai-creation/types";
import WorkspaceAssistant from "../ai-creation/assistant-ui";

interface AiFirstCreatorProps {
  onNavigate: (page: PageId) => void;
}

export default function AiFirstCreator({ onNavigate }: AiFirstCreatorProps) {
  // Mode selection: "beginner" (simple) vs "professional" (advanced manual controls)
  const [experienceMode, setExperienceMode] = useState<"beginner" | "professional">("beginner");
  
  // Custom inputs state
  const [ideaPrompt, setIdeaPrompt] = useState("Create a high-energy TikTok product showcase for our sleek headphones");
  const [selectedStyle, setSelectedStyle] = useState<string>("social");
  const [selectedPlatform, setSelectedPlatform] = useState<"tiktok" | "youtube" | "instagram" | "presentation" | "film_trailer" | "product_showcase">("tiktok");
  const [durationSec, setDurationSec] = useState<number>(15);
  
  // Simulated Reference states
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [hasImageRef, setHasImageRef] = useState(false);
  const [hasVideoRef, setHasVideoRef] = useState(false);
  
  // Global brand identity reference state
  const [brandIdentity, setBrandIdentity] = useState<BrandIdentity>({
    name: "Apex Audio",
    logoName: "apex_wave_primary.png",
    colors: {
      primary: "#1e1b4b",
      secondary: "#312e81",
      accent: "#a855f7",
      background: "#09090b"
    },
    fonts: {
      heading: "Outfit",
      body: "Inter"
    },
    brandVoice: "Futuristic & Bold",
    visualStyle: "minimalist"
  });

  // Compiled results
  const [activeProject, setActiveProject] = useState<CreativeProjectResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState(0);
  const [pipelineNodes, setPipelineNodes] = useState<PipelineNode[]>([]);
  const [recommendations, setRecommendations] = useState<SystemRecommendation[]>([]);

  // Selected templates mapping
  const [templates, setTemplates] = useState<any[]>([]);
  const [activeTemplateId, setActiveTemplateId] = useState<string>("");

  useEffect(() => {
    // Load default templates list
    const tplEngine = AISmartTemplateEngine.getInstance();
    setTemplates(tplEngine.getAllTemplates());
    setActiveTemplateId(tplEngine.getAllTemplates()[0].id);
  }, []);

  const handleMicToggle = () => {
    if (isRecordingVoice) {
      setIsRecordingVoice(false);
      setIdeaPrompt("An epic IMAX film trailer for a modern sci-fi cyberpunk odyssey");
      setSelectedStyle("cinematic");
      setSelectedPlatform("film_trailer");
      setDurationSec(60);
    } else {
      setIsRecordingVoice(true);
      setTimeout(() => {
        setIsRecordingVoice(false);
        setIdeaPrompt("An epic IMAX film trailer for a modern sci-fi cyberpunk odyssey");
        setSelectedStyle("cinematic");
        setSelectedPlatform("film_trailer");
        setDurationSec(60);
      }, 3000);
    }
  };

  const handleSelectTemplate = (id: string) => {
    setActiveTemplateId(id);
    const tpl = templates.find(t => t.id === id);
    if (tpl) {
      setIdeaPrompt(`Create a ${tpl.name} template presentation`);
      setSelectedStyle(tpl.category === "tiktok" ? "social" : tpl.category === "film_trailer" ? "cinematic" : "commercial");
      setSelectedPlatform(tpl.category);
      setDurationSec(tpl.durationSeconds);
    }
  };

  // Trigger One-Click Intelligent Creative Generation
  const handleCreateProject = async () => {
    setIsGenerating(true);
    setGenerationStep(1);
    setActiveProject(null);

    // Initialise engines
    const promptEngine = AIPromptEngine.getInstance();
    const planner = AICreativePlanner.getInstance();
    const workflowGen = AIPipelineWorkflowGenerator.getInstance();
    const recEngine = AICreativeRecommendations.getInstance();
    const builder = AICreativeProjectBuilder.getInstance();

    // Compile pipelines
    const strategy = selectedPlatform === "tiktok" ? "high_energy_tiktok" : selectedPlatform === "film_trailer" ? "cinematic_promo" : "highlight_reel";
    const nodes = workflowGen.generateEditingWorkflow(strategy);
    setPipelineNodes(nodes);

    // Cycle through automated generation steps visually
    await new Promise(r => setTimeout(r, 800));
    setGenerationStep(2); // Analysis of prompt intent
    const intent = promptEngine.parsePrompt(ideaPrompt, {
      voiceCommand: false,
      imageRef: hasImageRef ? "style_ref_sunset.jpg" : null,
      videoRef: hasVideoRef ? "pacing_match_reel.mp4" : null,
      stylePreference: selectedStyle,
      brandPreset: brandIdentity
    });

    await new Promise(r => setTimeout(r, 900));
    setGenerationStep(3); // Storyboard Generation
    const plan = planner.generateProductionPlan(intent, brandIdentity);

    await new Promise(r => setTimeout(r, 1000));
    setGenerationStep(4); // Node compilation
    const updatedNodes = nodes.map((n, i) => ({
      ...n,
      status: "completed" as const,
      progress: 100
    }));
    setPipelineNodes(updatedNodes);

    // Build timeline tracks & render outputs
    const result = builder.constructProject(intent, plan, brandIdentity);
    const recReport = recEngine.analyzeProjectDeliverables(intent, plan);
    setRecommendations(recReport.recommendations);

    await new Promise(r => setTimeout(r, 600));
    setActiveProject(result);
    setIsGenerating(false);
    setGenerationStep(0);
    
    // Auto shift to pro experience mode to inspect the complex result if user desires
    setExperienceMode("professional");
  };

  // Callback helper for Assistant triggers
  const handleApplyAssistantModification = (command: string) => {
    if (!activeProject) return;

    // Simulate modifying color, tracks, or titles
    const updatedTracks = activeProject.timeline.tracks.map(track => {
      if (track.type === "video") {
        return {
          ...track,
          clips: track.clips.map(clip => ({
            ...clip,
            assetName: `[Modified by AI] ${clip.assetName}`,
            effects: [...clip.effects, { type: "assistant_filter", params: { filter: command } }]
          }))
        };
      }
      return track;
    });

    setActiveProject({
      ...activeProject,
      timeline: { tracks: updatedTracks }
    });
  };

  const handleRevertVersion = (verId: string) => {
    // Reset back to initial setup
    if (activeProject) {
      handleCreateProject();
    }
  };

  return (
    <div className="p-6 space-y-6 text-left h-full flex flex-col min-h-0 animate-in fade-in-50 duration-200 bg-zinc-950 text-zinc-100">
      
      {/* Top Navigation Banner */}
      <div className="border-b border-zinc-800 pb-4 shrink-0 flex justify-between items-end">
        <div>
          <span className="text-xs font-bold text-purple-500 uppercase tracking-wider font-mono flex items-center space-x-1.5">
            <Sparkles className="w-4 h-4 text-purple-500 animate-pulse" />
            <span>Phase 6C Intelligent Creative System</span>
          </span>
          <h1 className="text-xl font-bold text-white tracking-tight mt-0.5">AI-First Creation Studio</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Leverage multi-agent co-creation models to transform raw ideas or smart templates into editable multitrack projects instantly.
          </p>
        </div>

        {/* Level Switcher (Beginner vs Professional experience) */}
        <div className="flex bg-zinc-900 border border-zinc-800 p-0.5 rounded-xl">
          <button
            onClick={() => setExperienceMode("beginner")}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              experienceMode === "beginner" ? "bg-purple-600 text-white" : "text-zinc-400 hover:text-white"
            }`}
          >
            Simple AI Creator (Canva-Like)
          </button>
          <button
            onClick={() => setExperienceMode("professional")}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
              experienceMode === "professional" ? "bg-purple-600 text-white" : "text-zinc-400 hover:text-white"
            }`}
          >
            AI Production Desk (CapCut-Like)
          </button>
        </div>
      </div>

      {/* Main split dashboard area */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden min-h-0">
        
        {/* LEFT COLUMN(S): Creation Control center */}
        <div className="lg:col-span-2 flex flex-col space-y-4 overflow-y-auto no-scrollbar min-h-0">
          
          {/* Section 1: Dynamic Creative Command Board */}
          <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center">
                <Compass className="w-4 h-4 mr-1.5 text-purple-400" />
                <span>Creative Idea & Pacing Input</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-500 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
                MODEL: GEMINI_FLASH_1.5
              </span>
            </div>

            {/* Main idea input */}
            <div className="relative">
              <textarea
                value={ideaPrompt}
                onChange={(e) => setIdeaPrompt(e.target.value)}
                placeholder="Describe your creative intention (e.g., 'An orange and teal cinematic drone sequence of coastlines paired with deep bass music')"
                className="w-full h-24 p-3 pr-24 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 resize-none leading-relaxed"
              />
              
              {/* Voice and media buttons overlaid inside input box */}
              <div className="absolute bottom-2.5 right-2.5 flex items-center space-x-2">
                <button
                  onClick={handleMicToggle}
                  className={`p-2 rounded-lg transition-all cursor-pointer ${
                    isRecordingVoice ? "bg-red-600 animate-ping text-white" : "bg-zinc-900 text-zinc-400 hover:text-white"
                  }`}
                  title="Simulate Voice Command Transcription Feed"
                >
                  <Mic className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setHasImageRef(!hasImageRef)}
                  className={`p-2 rounded-lg transition-all cursor-pointer ${
                    hasImageRef ? "bg-purple-900 text-white border border-purple-500" : "bg-zinc-900 text-zinc-400 hover:text-white"
                  }`}
                  title="Reference Style Image"
                >
                  <ImageIcon className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setHasVideoRef(!hasVideoRef)}
                  className={`p-2 rounded-lg transition-all cursor-pointer ${
                    hasVideoRef ? "bg-purple-900 text-white border border-purple-500" : "bg-zinc-900 text-zinc-400 hover:text-white"
                  }`}
                  title="Reference Timing Video"
                >
                  <VideoIcon className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Style parameters controls */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Style Presets */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Cinematic Style Transfer</label>
                <select
                  value={selectedStyle}
                  onChange={(e) => setSelectedStyle(e.target.value)}
                  className="w-full p-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs focus:outline-none text-white focus:border-purple-500"
                >
                  <option value="cinematic">Anamorphic Cinematic LUT</option>
                  <option value="commercial">Slick Glossy Product Glow</option>
                  <option value="documentary">Natural High-Key Contrast</option>
                  <option value="social">High-Energy Saturated</option>
                  <option value="animation">Bouncy Keyframed Vector</option>
                </select>
              </div>

              {/* Platform Targets */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Target Platform Ratio</label>
                <select
                  value={selectedPlatform}
                  onChange={(e) => {
                    const plat = e.target.value as any;
                    setSelectedPlatform(plat);
                    setDurationSec(plat === "tiktok" ? 15 : plat === "film_trailer" ? 60 : 30);
                  }}
                  className="w-full p-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs focus:outline-none text-white focus:border-purple-500"
                >
                  <option value="tiktok">TikTok Reels (9:16)</option>
                  <option value="youtube">YouTube Vlog (16:9)</option>
                  <option value="instagram">Instagram Post (1:1)</option>
                  <option value="film_trailer">Movie IMAX (2.39:1)</option>
                  <option value="product_showcase">E-Commerce Promo (1:1)</option>
                  <option value="presentation">Pitch Deck Deck (16:9)</option>
                </select>
              </div>

              {/* Duration Slider */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Scene Duration</label>
                  <span className="text-xs font-mono font-bold text-purple-400">{durationSec} seconds</span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={120}
                  step={5}
                  value={durationSec}
                  onChange={(e) => setDurationSec(parseInt(e.target.value, 10))}
                  className="w-full accent-purple-600"
                />
              </div>
            </div>

            {/* Reference info notifications if toggled */}
            {(hasImageRef || hasVideoRef || isRecordingVoice) && (
              <div className="p-2.5 bg-zinc-950 border border-purple-900/60 rounded-xl text-[10px] text-purple-400 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Info className="w-4 h-4 text-purple-400" />
                  <span>
                    {isRecordingVoice ? "🎙️ Actively capturing mic voice transcription feed..." : ""}
                    {hasImageRef ? "🎨 Locked: style_ref_sunset.jpg loaded (Extracting warm color gradients)." : ""}
                    {hasVideoRef && !isRecordingVoice ? " 🎬 Locked: pacing_match_reel.mp4 loaded (Matching timeline scene changes)." : ""}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setHasImageRef(false);
                    setHasVideoRef(false);
                    setIsRecordingVoice(false);
                  }}
                  className="text-[9px] font-bold text-zinc-400 hover:text-white"
                >
                  Clear References
                </button>
              </div>
            )}

            {/* Create Trigger Action */}
            <button
              onClick={handleCreateProject}
              disabled={isGenerating}
              className="w-full py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl flex items-center justify-center space-x-2 shadow-lg hover:shadow-purple-900/40 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Compiling AI Creative Assets ({generationStep}/4)...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Assemble & Compile Project Track Composition (One-Click)</span>
                </>
              )}
            </button>
          </div>

          {/* GENERATION FLOW INTERMEDIARY BOARD */}
          {isGenerating && (
            <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl space-y-3.5 text-left animate-pulse">
              <span className="text-xs font-bold text-zinc-400 block uppercase">Multi-Agent Workflow Compilation Matrix</span>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className={`p-3 rounded-xl border text-center ${generationStep >= 1 ? "bg-purple-900/20 border-purple-500 text-white" : "bg-zinc-950 border-zinc-800 text-zinc-600"}`}>
                  <span className="text-[10px] block font-mono">STEP 1</span>
                  <span className="text-xs font-bold block mt-1">Initialize pipeline</span>
                  <span className="text-[9px] text-purple-400 block font-mono mt-0.5">{generationStep >= 1 ? "ACTIVE" : "QUEUED"}</span>
                </div>
                <div className={`p-3 rounded-xl border text-center ${generationStep >= 2 ? "bg-purple-900/20 border-purple-500 text-white" : "bg-zinc-950 border-zinc-800 text-zinc-600"}`}>
                  <span className="text-[10px] block font-mono">STEP 2</span>
                  <span className="text-xs font-bold block mt-1">Intent Analysis</span>
                  <span className="text-[9px] text-purple-400 block font-mono mt-0.5">{generationStep >= 2 ? "COMPLETED" : "QUEUED"}</span>
                </div>
                <div className={`p-3 rounded-xl border text-center ${generationStep >= 3 ? "bg-purple-900/20 border-purple-500 text-white" : "bg-zinc-950 border-zinc-800 text-zinc-600"}`}>
                  <span className="text-[10px] block font-mono">STEP 3</span>
                  <span className="text-xs font-bold block mt-1">Storyboard Graph</span>
                  <span className="text-[9px] text-purple-400 block font-mono mt-0.5">{generationStep >= 3 ? "COMPLETED" : "QUEUED"}</span>
                </div>
                <div className={`p-3 rounded-xl border text-center ${generationStep >= 4 ? "bg-purple-900/20 border-purple-500 text-white" : "bg-zinc-950 border-zinc-800 text-zinc-600"}`}>
                  <span className="text-[10px] block font-mono">STEP 4</span>
                  <span className="text-xs font-bold block mt-1">Tracks Rendering</span>
                  <span className="text-[9px] text-purple-400 block font-mono mt-0.5">{generationStep >= 4 ? "COMPLETED" : "QUEUED"}</span>
                </div>
              </div>
            </div>
          )}

          {/* BEGINNER EXPERIENCE VIEW: Smart templates selection */}
          {experienceMode === "beginner" && !isGenerating && (
            <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl space-y-3.5">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center">
                <Compass className="w-4 h-4 mr-1.5 text-purple-400" />
                <span>Beginner Experience: Select Smart Template Preset</span>
              </span>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {templates.map((tpl) => {
                  const isActive = activeTemplateId === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      onClick={() => handleSelectTemplate(tpl.id)}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between h-36 ${
                        isActive ? "bg-purple-950/45 border-purple-500 shadow" : "bg-zinc-950 border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      <div className="space-y-1">
                        <span className="text-xs font-bold text-white block truncate">{tpl.name}</span>
                        <p className="text-[10px] text-zinc-400 line-clamp-2 leading-relaxed">{tpl.description}</p>
                      </div>

                      <div className="flex justify-between items-center border-t border-zinc-800 pt-2 mt-2">
                        <span className="text-[9px] font-mono text-zinc-500">{tpl.aspectRatio} • {tpl.durationSeconds}s</span>
                        <span className="text-[9px] font-bold text-purple-400 bg-purple-950/40 px-1.5 py-0.5 rounded border border-purple-900/60 uppercase">
                          {tpl.category}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* PROFESSIONAL EXPERIENCE VIEW: Complex timeline representation and workflow pipelines */}
          {experienceMode === "professional" && activeProject && (
            <div className="space-y-4">
              
              {/* Segment A: Workflow Pipeline Node View */}
              <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl space-y-3">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wide flex items-center">
                  <Workflow className="w-4 h-4 mr-1.5 text-purple-400" />
                  <span>AI Editing Automated Pipeline Graph</span>
                </span>

                <div className="flex flex-col md:flex-row items-center justify-between gap-2.5">
                  {pipelineNodes.map((node, i) => (
                    <React.Fragment key={node.id}>
                      <div className="flex-1 bg-zinc-950 border border-zinc-800 p-2.5 rounded-xl text-left flex items-center space-x-2 w-full md:w-auto">
                        <span className="h-6 w-6 rounded-full bg-purple-950 text-purple-400 font-mono text-[10px] font-bold flex items-center justify-center border border-purple-900">
                          {i + 1}
                        </span>
                        <div>
                          <span className="text-[11px] font-bold text-white block leading-tight">{node.name}</span>
                          <span className="text-[8.5px] font-mono text-zinc-500 uppercase">{node.type}</span>
                        </div>
                      </div>
                      {i < pipelineNodes.length - 1 && (
                        <ChevronRight className="w-4 h-4 text-zinc-700 hidden md:block" />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Segment B: Multi-Track Timeline Clips Visualizer */}
              <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl space-y-4 text-left">
                <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
                  <span className="text-xs font-bold text-zinc-400 uppercase tracking-wide flex items-center">
                    <SlidersHorizontal className="w-4 h-4 mr-1.5 text-purple-400" />
                    <span>Multi-Track Timeline Composition [{activeProject.name}]</span>
                  </span>
                  <span className="text-[10px] font-mono text-purple-400 font-bold bg-purple-950/50 px-2 py-0.5 rounded border border-purple-900/60">
                    SPEED: 24FPS
                  </span>
                </div>

                {/* Tracks Container */}
                <div className="space-y-3 font-mono text-xs">
                  {activeProject.timeline.tracks.map((track) => (
                    <div key={track.id} className="grid grid-cols-12 bg-zinc-950 border border-zinc-800/80 rounded-xl overflow-hidden min-h-[50px] items-center">
                      
                      {/* Left: Track Title Header */}
                      <div className="col-span-3 p-2 bg-zinc-900/60 border-r border-zinc-800 h-full flex items-center font-sans">
                        <span className="text-[10px] font-bold text-zinc-400 block line-clamp-1">{track.name}</span>
                      </div>

                      {/* Right: Clip timeline cards */}
                      <div className="col-span-9 p-2.5 relative flex space-x-2 overflow-x-auto no-scrollbar">
                        {track.clips.map((clip) => {
                          const durationFrames = clip.endFrame - clip.startFrame;
                          return (
                            <div
                              key={clip.id}
                              className={`p-2 rounded-lg border text-left min-w-[130px] flex flex-col justify-between shrink-0 transition-colors ${
                                clip.type === "video" 
                                  ? "bg-purple-950/20 border-purple-900 text-purple-300" 
                                  : clip.type === "audio" 
                                  ? "bg-blue-950/20 border-blue-900 text-blue-300"
                                  : "bg-emerald-950/20 border-emerald-900 text-emerald-300"
                              }`}
                            >
                              <span className="text-[10px] font-bold font-sans block truncate" title={clip.assetName}>
                                {clip.assetName}
                              </span>
                              <div className="flex justify-between items-center text-[8px] mt-2 text-zinc-500 font-mono">
                                <span>f:{clip.startFrame}-{clip.endFrame}</span>
                                <span className="font-bold">({durationFrames}f)</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                    </div>
                  ))}
                </div>

                {/* Storyboard shot explanations list */}
                <div className="space-y-2 border-t border-zinc-800 pt-4">
                  <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Production Storyboard Breakdown</span>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {activeProject.productionPlan.shotList.map((shot) => (
                      <div key={shot.id} className="p-3 bg-zinc-950 border border-zinc-800/60 rounded-xl space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">Scene {shot.sceneNumber} ({shot.durationSeconds}s)</span>
                          <span className="text-[9px] font-mono text-purple-400 font-bold uppercase">{shot.pacing} Pacing</span>
                        </div>
                        <p className="text-[10.5px] text-zinc-400 leading-normal">{shot.description}</p>
                        <div className="text-[9px] text-zinc-500 font-mono pt-1">
                          🎥 Cam: {shot.cameraSuggestion}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>
          )}

        </div>

        {/* RIGHT COLUMN: Interactive Workspace Assistant panel & cost analysers */}
        <div className="space-y-4 flex flex-col min-h-0 overflow-y-auto no-scrollbar">
          
          {/* Assistant component with integrated brand settings */}
          <div className="flex-1 min-h-0">
            <WorkspaceAssistant
              activeProject={activeProject}
              onApplyModification={handleApplyAssistantModification}
              onRevertVersion={handleRevertVersion}
              brandIdentity={brandIdentity}
              onUpdateBrand={setBrandIdentity}
            />
          </div>

          {/* Explainability, cost summary, & audit metrics */}
          {activeProject && (
            <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-2xl space-y-3.5 text-left shrink-0">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center">
                <Info className="w-4 h-4 mr-1.5 text-purple-400" />
                <span>AI Project Explainability Logs</span>
              </span>

              <div className="space-y-2.5 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-zinc-500 block uppercase">Created Overview</span>
                  <p className="text-[11px] text-zinc-300 leading-relaxed mt-0.5">
                    {activeProject.costSummary.explainability.createdOverview}
                  </p>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-zinc-500 block uppercase">Tool Selection Justification</span>
                  <p className="text-[11px] text-zinc-300 leading-relaxed mt-0.5">
                    {activeProject.costSummary.explainability.toolSelectionJustification}
                  </p>
                </div>

                <div>
                  <span className="text-[10px] font-bold text-zinc-500 block uppercase">Suggested Improvements</span>
                  <ul className="list-disc list-inside text-[11px] text-purple-400 space-y-1 mt-1 leading-relaxed">
                    {activeProject.costSummary.explainability.improvementSuggestions.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Technical performance recommendations */}
              <div className="space-y-2 border-t border-zinc-800 pt-3">
                <span className="text-[10px] font-bold text-zinc-500 uppercase block tracking-wider">Performance Audit Recommendations</span>
                <div className="space-y-2">
                  {recommendations.slice(0, 2).map((rec) => (
                    <div key={rec.id} className="p-2 bg-zinc-950 border border-zinc-800 rounded-lg space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-white">{rec.title}</span>
                        <span className={`text-[8px] font-mono px-1.5 rounded uppercase font-bold ${
                          rec.impactScore === "high" ? "bg-red-950/40 text-red-400 border border-red-900" : "bg-zinc-800 text-zinc-400"
                        }`}>
                          {rec.impactScore} IMPACT
                        </span>
                      </div>
                      <p className="text-[10px] text-zinc-400 leading-normal">{rec.description}</p>
                      <button className="text-[9px] text-purple-400 font-bold hover:text-purple-300 font-mono block pt-1">
                        → Action: {rec.suggestedAction}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          )}

        </div>

      </div>

    </div>
  );
}
