import React, { useState } from "react";
import { 
  Folder, 
  Search, 
  Tag, 
  Upload, 
  Sparkles, 
  Video, 
  Music, 
  Image, 
  Box, 
  LayoutTemplate,
  Plus,
  Play,
  ArrowRight
} from "lucide-react";

export interface LibraryItem {
  id: string;
  name: string;
  type: "video" | "audio" | "image" | "3d" | "font" | "template";
  size: string;
  duration?: string;
  thumbnail: string;
}

interface MediaPanelProps {
  onAddGeneratedAsset: (item: LibraryItem) => void;
  onImportMockFiles: () => void;
  onSelectTemplate: (templateName: string) => void;
}

export default function MediaPanel({
  onAddGeneratedAsset,
  onImportMockFiles,
  onSelectTemplate
}: MediaPanelProps) {
  const [activeFolder, setActiveFolder] = useState<"all" | "video" | "audio" | "template" | "ai">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  // Full rich set of library asset mocks
  const libraryItems: LibraryItem[] = [
    { id: "lib_v1", name: "Tokyo_Skyline_Drone.mp4", type: "video", size: "45.2 MB", duration: "12s", thumbnail: "https://images.unsplash.com/photo-1540959733332-eab4deceeaf7?w=120&h=100&fit=crop" },
    { id: "lib_v2", name: "Neon_Subway_Slowmo.mp4", type: "video", size: "128.0 MB", duration: "18s", thumbnail: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?w=120&h=100&fit=crop" },
    { id: "lib_a1", name: "Cyberpunk_Snares_Loop.wav", type: "audio", size: "12.4 MB", duration: "30s", thumbnail: "https://images.unsplash.com/photo-1614680376593-902f74fa0d41?w=120&h=100&fit=crop" },
    { id: "lib_a2", name: "Lofi_Synthwave_Arpeggio.wav", type: "audio", size: "18.1 MB", duration: "45s", thumbnail: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=120&h=100&fit=crop" },
    { id: "lib_t1", name: "Modern Bold Social Intro", type: "template", size: "1.2 MB", thumbnail: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=120&h=100&fit=crop" },
    { id: "lib_t2", name: "Aesthetic Kinetic Lyrics", type: "template", size: "0.8 MB", thumbnail: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=120&h=100&fit=crop" },
  ];

  // Canva-style Quick Templates Layouts
  const canvaTemplates = [
    { name: "9:16 TikTok Glitch Ad", duration: "15s", category: "Social Marketing", img: "https://images.unsplash.com/photo-1563986768609-322da13575f3?w=100&h=100&fit=crop" },
    { name: "16:9 YouTube Synth Intro", duration: "10s", category: "Creator Video", img: "https://images.unsplash.com/photo-1461151304267-38535e780c79?w=100&h=100&fit=crop" },
    { name: "1:1 Instagram Promo Slate", duration: "12s", category: "E-Commerce", img: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=100&h=100&fit=crop" },
  ];

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    alert("High-Bitrate media files captured. Registering raw buffer metadata maps in local browser session storage.");
    onImportMockFiles();
  };

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) {
      alert("Enter a prompt command describing the desired image/sound (e.g., 'Retro futurist cyber grid landscape')");
      return;
    }

    setIsGenerating(true);
    // Simulate generation pipeline
    setTimeout(() => {
      const generatedId = `ai_${Date.now()}`;
      const generatedAsset: LibraryItem = {
        id: generatedId,
        name: `AI_Gen_${aiPrompt.trim().replace(/\s+/g, "_").substring(0, 15)}.mp4`,
        type: "video",
        size: "32.0 MB",
        duration: "08s",
        thumbnail: "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=120&h=100&fit=crop"
      };

      onAddGeneratedAsset(generatedAsset);
      setIsGenerating(false);
      setAiPrompt("");
      alert(`Generative AI asset successfully compiled and rendered in high depth resolution: ${generatedAsset.name}`);
    }, 1500);
  };

  const filteredItems = libraryItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    if (!matchesSearch) return false;

    if (activeFolder === "all") return true;
    if (activeFolder === "video") return item.type === "video";
    if (activeFolder === "audio") return item.type === "audio";
    if (activeFolder === "template") return item.type === "template";
    return false;
  });

  return (
    <div className="bg-panel border border-border-light rounded-3xl p-5 flex flex-col justify-between overflow-hidden shadow-xs h-full min-h-[420px] text-left">
      <div className="space-y-4 overflow-y-auto no-scrollbar flex-1">
        {/* Search header bar */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-3 text-gray-400" />
          <input 
            type="text" 
            placeholder="Search clips, presets, soundtracks..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-border-light rounded-xl text-xs font-semibold focus:outline-none placeholder-gray-400"
          />
        </div>

        {/* Directory Folder tabs switcher */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          {[
            { id: "all", label: "All Bins", icon: Folder },
            { id: "video", label: "Video", icon: Video },
            { id: "audio", label: "Audio", icon: Music },
            { id: "template", label: "Layouts", icon: LayoutTemplate },
            { id: "ai", label: "AI Synth", icon: Sparkles },
          ].map(f => {
            const Icon = f.icon;
            const isActive = activeFolder === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setActiveFolder(f.id as any)}
                className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-all cursor-pointer border ${
                  isActive 
                    ? "bg-text-dark border-transparent text-white shadow-2xs" 
                    : "bg-white border-border-light text-gray-500 hover:text-text-dark"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{f.label}</span>
              </button>
            );
          })}
        </div>

        {/* 1. CANVA-STYLE TEMPLATES SECTOR */}
        {activeFolder === "template" && (
          <div className="space-y-3 animate-in fade-in-50 duration-150">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide font-mono block">Canva Quick Setup presets</span>
            <div className="grid grid-cols-1 gap-2">
              {canvaTemplates.map((temp, i) => (
                <div 
                  key={i} 
                  onClick={() => onSelectTemplate(temp.name)}
                  className="p-2.5 bg-white hover:bg-rose-50/20 border border-border-light hover:border-rose-300 rounded-xl flex items-center justify-between cursor-pointer transition-all group"
                >
                  <div className="flex items-center space-x-3">
                    <img src={temp.img} alt={temp.name} className="w-10 h-10 object-cover rounded-lg" />
                    <div>
                      <h4 className="text-xs font-bold text-text-dark leading-tight group-hover:text-rose-700">{temp.name}</h4>
                      <span className="text-[9px] font-mono text-gray-400 block mt-0.5">{temp.category} • {temp.duration}</span>
                    </div>
                  </div>
                  <button className="p-1.5 bg-primary-bg hover:bg-rose-100 rounded-lg text-gray-500 transition-colors">
                    <Plus className="w-3.5 h-3.5 text-rose-600" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2. AI GENERATIVE SYNTHESIS */}
        {activeFolder === "ai" && (
          <div className="space-y-4 animate-in fade-in-50 duration-150 bg-purple-50/50 border border-purple-100 rounded-2xl p-4">
            <span className="text-[10px] font-bold text-purple-700 uppercase tracking-wide font-mono flex items-center space-x-1.5">
              <Sparkles className="w-4 h-4" />
              <span>CO-CREATIVE AI GENERATOR</span>
            </span>
            <p className="text-[10px] text-gray-500 leading-relaxed">
              Describe any cinematic video clip, music riff, or asset element. Our server-side neural processors will render high bit-depth files seamlessly.
            </p>

            <div className="space-y-2">
              <textarea 
                rows={2}
                placeholder="E.g., drone flyby above electric cyberpunk streetscape in 4k HDR, cinematic synth music..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                className="w-full p-2.5 bg-white border border-purple-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-purple-400 placeholder-gray-400 resize-none"
              />
              <button
                onClick={handleAiGenerate}
                disabled={isGenerating}
                className="w-full py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white text-xs font-bold rounded-xl transition-all shadow-xs cursor-pointer flex items-center justify-center space-x-1.5"
              >
                {isGenerating ? (
                  <>
                    <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    <span>Synthesizing Raw Buffers...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Run AI Dream-Engine</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* 3. ASSET LIST BINS */}
        {activeFolder !== "template" && activeFolder !== "ai" && (
          <div className="space-y-3">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide font-mono block">Bin assets catalog</span>
            <div className="grid grid-cols-2 gap-2.5">
              {filteredItems.map(item => (
                <div 
                  key={item.id} 
                  onClick={() => alert(`Clip ${item.name} mapped to Multi-Track active video layer.`)}
                  className="bg-white border border-border-light hover:border-gray-400 rounded-xl overflow-hidden cursor-pointer transition-all hover:scale-[1.01] flex flex-col justify-between"
                >
                  <div className="aspect-[4/3] relative bg-slate-950 overflow-hidden">
                    <img src={item.thumbnail} alt={item.name} className="w-full h-full object-cover opacity-80 hover:opacity-100 transition-opacity" />
                    <div className="absolute top-1.5 right-1.5 bg-black/60 px-1 py-0.5 rounded text-[8px] text-white font-mono uppercase tracking-wider font-bold">
                      {item.type}
                    </div>
                    {item.duration && (
                      <div className="absolute bottom-1 right-1 bg-black/65 text-white text-[8px] font-mono px-1 rounded">
                        {item.duration}
                      </div>
                    )}
                  </div>
                  <div className="p-2 border-t border-border-light">
                    <h5 className="text-[10px] font-bold text-text-dark truncate leading-snug">{item.name}</h5>
                    <span className="text-[8px] font-mono text-gray-400 block mt-0.5">{item.size}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* CapCut Drag and Drop target zone */}
      <div 
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={onImportMockFiles}
        className="mt-3 p-4 bg-white hover:bg-indigo-50/10 border border-dashed border-border-light hover:border-indigo-400 rounded-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-colors shrink-0"
      >
        <Upload className="w-5 h-5 text-gray-400 mb-1.5 group-hover:scale-105 transition-transform" />
        <span className="text-xs font-bold text-text-dark">Drag & Drop Footage Bins</span>
        <span className="text-[9px] text-gray-400 block mt-0.5 leading-relaxed">
          Supports ProRes 4444, H.265/HDR, and cinema raw formats
        </span>
      </div>
    </div>
  );
}
