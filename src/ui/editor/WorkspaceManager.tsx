import React, { useState, useEffect } from "react";
import WorkspaceSwitcher, { CreativeWorkspaceType } from "../workspaces/WorkspaceSwitcher";
import VideoPreview from "../canvas/VideoPreview";
import MultiTrackTimeline, { TimelineClip } from "../timeline/MultiTrackTimeline";
import ContextualInspector from "../inspector/ContextualInspector";
import MediaPanel, { LibraryItem } from "../panels/MediaPanel";
import AIAssistantPanel from "../ai-assistant/AIAssistantPanel";
import Viewport3D from "../viewport/Viewport3D";

import { 
  Sparkles, 
  HelpCircle, 
  Zap, 
  Share2, 
  CloudLightning,
  ChevronDown,
  MonitorPlay,
  Grid
} from "lucide-react";

interface WorkspaceManagerProps {
  onNavigate?: (page: any) => void;
  projectName?: string;
}

export default function WorkspaceManager({
  onNavigate,
  projectName = "Cyberpunk Tokyo Sequence 2026"
}: WorkspaceManagerProps) {
  // Global Workspace synchronizer states
  const [activeWorkspace, setActiveWorkspace] = useState<CreativeWorkspaceType>("video");
  const [isProfessionalMode, setIsProfessionalMode] = useState(true);
  
  const [currentTimeSec, setCurrentTimeSec] = useState(3.5);
  const [durationSec, setDurationSec] = useState(15.0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>("v1");
  const [selectedMeshId, setSelectedMeshId] = useState<string>("obj_m1");
  const [colorGradeEnabled, setColorGradeEnabled] = useState(false);

  // Playback timeline interval ticker simulation
  useEffect(() => {
    let ticker: any = null;
    if (isPlaying) {
      ticker = setInterval(() => {
        setCurrentTimeSec(prev => {
          if (prev >= durationSec) {
            return 0; // loop back to start
          }
          return prev + 0.1; // increment 100ms
        });
      }, 100);
    } else {
      if (ticker) clearInterval(ticker);
    }
    return () => {
      if (ticker) clearInterval(ticker);
    };
  }, [isPlaying, durationSec]);

  // AI macro automated helper triggers
  const handleTriggerAutoCut = () => {
    setCurrentTimeSec(0);
    alert("Antigravity scene-parser completed. Generated 4 split cuts and synced to audio snare beats.");
  };

  const handleTriggerAutoSub = () => {
    alert("AI Transcriber completed: Generated text clips with 99.4% speech-to-text accuracy.");
  };

  const handleTriggerAutoColor = () => {
    setColorGradeEnabled(true);
    alert("AI LUT grading active. Bypassed Log spectrum to match standard Rec.709 profile.");
  };

  const handleAiSendMessage = (msg: string) => {
    console.log(`[AI Assistant Command Processed]: ${msg}`);
  };

  const handleAddGeneratedAsset = (asset: LibraryItem) => {
    alert(`Imported Generative AI Clip: ${asset.name} (${asset.size})`);
  };

  const handleImportMockFiles = () => {
    alert("Bulk raw production buffers compiled. Sliced 4 ProRes streams to Active Bins.");
  };

  const handleSelectTemplate = (templateName: string) => {
    alert(`Initialized Quick Canva-style template layout: '${templateName}'`);
    setIsProfessionalMode(false); // Quick mode
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 text-left h-full flex flex-col min-h-0 animate-in fade-in-50 duration-200">
      
      {/* Top Professional App bar */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border-light pb-4 shrink-0">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest font-mono">WORKSPACE SEQUENCER</span>
            <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full font-mono uppercase border border-indigo-200 animate-pulse">V2.4 Active</span>
          </div>
          <div className="flex items-center space-x-2.5 mt-1">
            <h1 className="text-xl font-bold text-text-dark tracking-tight mt-0">{projectName}</h1>
            <span className="text-[11px] font-mono text-gray-400 font-bold bg-white px-2 py-0.5 rounded-lg border">4K HDR @ 23.976 fps</span>
          </div>
        </div>

        {/* Action button toggles */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Pro Mode / Beginner mode switcher (Canva accessibility vs Adobe workflows) */}
          <div className="flex items-center bg-primary-bg p-1 rounded-xl border">
            <button
              onClick={() => {
                setIsProfessionalMode(false);
                alert("Switched to Canva Mode: Simple single-click panels and rapid template formats.");
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                !isProfessionalMode 
                  ? "bg-btn-bg text-text-dark shadow-2xs" 
                  : "text-gray-500 hover:text-text-dark"
              }`}
            >
              Canva (Simple)
            </button>
            <button
              onClick={() => {
                setIsProfessionalMode(true);
                alert("Switched to Studio Mode: Full Multi-Track linear timeline, color grading, and node FX.");
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                isProfessionalMode 
                  ? "bg-btn-bg text-text-dark shadow-2xs" 
                  : "text-gray-500 hover:text-text-dark"
              }`}
            >
              Studio (Pro)
            </button>
          </div>

          <button 
            onClick={() => alert("Generating high-bitrate WebM render link. Shared on cloud CDN channels.")}
            className="px-3.5 py-1.5 bg-btn-bg border border-border-light hover:border-gray-400 text-text-dark text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-all cursor-pointer"
          >
            <Share2 className="w-3.5 h-3.5" />
            <span>Publish Share Link</span>
          </button>

          {onNavigate && (
            <button
              onClick={() => onNavigate("export-center")}
              className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl shadow-xs hover:scale-[1.02] active:scale-95 transition-all cursor-pointer flex items-center space-x-1.5"
            >
              <CloudLightning className="w-3.5 h-3.5" />
              <span>Export Render</span>
            </button>
          )}
        </div>
      </div>

      {/* Workspace Switcher Component */}
      <WorkspaceSwitcher 
        activeWorkspace={activeWorkspace}
        onChangeWorkspace={setActiveWorkspace}
        isProfessionalMode={isProfessionalMode}
      />

      {/* Main Grid Viewport - Layout matches CapCut architecture */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 min-h-0 flex-1 overflow-hidden">
        
        {/* LEFT BAR: Asset Library Media/Effects panel (Col span 3) */}
        <div className="xl:col-span-3 h-full min-h-[300px] xl:min-h-0">
          <MediaPanel 
            onAddGeneratedAsset={handleAddGeneratedAsset}
            onImportMockFiles={handleImportMockFiles}
            onSelectTemplate={handleSelectTemplate}
          />
        </div>

        {/* CENTER COLUMN: Playback monitor, viewports (Col span 6) */}
        <div className="xl:col-span-6 h-full min-h-[380px] xl:min-h-0 flex flex-col justify-between">
          {activeWorkspace === "3d" ? (
            <Viewport3D 
              selectedMeshId={selectedMeshId}
              onSelectMesh={setSelectedMeshId}
            />
          ) : activeWorkspace === "ai" ? (
            <AIAssistantPanel 
              onTriggerAutoCut={handleTriggerAutoCut}
              onTriggerAutoSub={handleTriggerAutoSub}
              onTriggerAutoColor={handleTriggerAutoColor}
              onSendMessage={handleAiSendMessage}
            />
          ) : (
            <VideoPreview 
              currentTimeSec={currentTimeSec}
              durationSec={durationSec}
              onTimeChange={setCurrentTimeSec}
              isPlaying={isPlaying}
              onPlayToggle={() => setIsPlaying(!isPlaying)}
              colorGradeCurveEnabled={colorGradeEnabled}
              activeWorkspace={activeWorkspace}
            />
          )}
        </div>

        {/* RIGHT COLUMN: Inspector properties (Col span 3) */}
        <div className="xl:col-span-3 h-full min-h-[300px] xl:min-h-0">
          <ContextualInspector 
            selectedClipId={selectedClipId}
            activeWorkspace={activeWorkspace}
            isProfessionalMode={isProfessionalMode}
            colorGradeEnabled={colorGradeEnabled}
            onToggleColorGrade={() => setColorGradeEnabled(!colorGradeEnabled)}
          />
        </div>
      </div>

      {/* BOTTOM AREA: Multi-Track Timeline (Rendered in advanced mode or when requested) */}
      {isProfessionalMode && (
        <div className="shrink-0 pt-1 animate-in slide-in-from-bottom-5 duration-300">
          <MultiTrackTimeline 
            currentTimeSec={currentTimeSec}
            durationSec={durationSec}
            onTimeChange={setCurrentTimeSec}
            selectedClipId={selectedClipId}
            onSelectClip={setSelectedClipId}
          />
        </div>
      )}

      {/* Bottom small HUD footer status */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-3 py-1 bg-white border border-border-light rounded-xl shrink-0 text-[10px] text-gray-400 font-mono">
        <div className="flex items-center space-x-3">
          <span>Engine Status: <strong className="text-emerald-600 font-bold">● ONLINE</strong></span>
          <span>Buffer: <strong className="text-text-dark font-bold">2.4 GB / 4.0 GB Cached</strong></span>
          <span>Codec pipeline: <strong className="text-text-dark font-bold">GPU Accelerated WebGL2</strong></span>
        </div>
        <div>
          <span>Antigravity Creative AI Workspace System • All rights reserved</span>
        </div>
      </div>

    </div>
  );
}
