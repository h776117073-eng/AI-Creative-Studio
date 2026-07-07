import React from "react";
import { 
  Video, 
  Layers, 
  Zap, 
  Palette, 
  Music, 
  Box, 
  Sparkles,
  Tv
} from "lucide-react";

export type CreativeWorkspaceType = 
  | "video" 
  | "motion" 
  | "vfx" 
  | "color" 
  | "audio" 
  | "3d" 
  | "ai";

interface WorkspaceSwitcherProps {
  activeWorkspace: CreativeWorkspaceType;
  onChangeWorkspace: (workspace: CreativeWorkspaceType) => void;
  isProfessionalMode: boolean;
}

export default function WorkspaceSwitcher({
  activeWorkspace,
  onChangeWorkspace,
  isProfessionalMode
}: WorkspaceSwitcherProps) {
  const workspaces = [
    { id: "video", label: "Video Editor", icon: Video, color: "text-blue-600" },
    { id: "motion", label: "Motion Graphics", icon: Layers, color: "text-rose-600" },
    { id: "vfx", label: "VFX Compositor", icon: Zap, color: "text-amber-600" },
    { id: "color", label: "Color Grading", icon: Palette, color: "text-emerald-600" },
    { id: "audio", label: "Audio Mixer", icon: Music, color: "text-indigo-600" },
    { id: "3d", label: "3D Viewport", icon: Box, color: "text-teal-600" },
    { id: "ai", label: "AI Co-Creator", icon: Sparkles, color: "text-purple-600" },
  ];

  return (
    <div className="w-full bg-btn-bg border border-border-light rounded-2xl p-2.5 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0 shadow-xs">
      <div className="flex items-center space-x-3">
        <div className="p-1.5 bg-primary-bg rounded-lg">
          <Tv className="w-4 h-4 text-icon-gray" />
        </div>
        <div>
          <h2 className="text-xs font-bold text-text-dark font-sans tracking-tight">Active Suite Environment</h2>
          <p className="text-[10px] text-gray-500 font-medium">Fluid hot-swapping between creative pipelines</p>
        </div>
      </div>

      {/* Tabs list */}
      <div className="flex flex-wrap items-center gap-1 bg-primary-bg/50 p-1 rounded-xl">
        {workspaces.map((ws) => {
          const Icon = ws.icon;
          const isActive = activeWorkspace === ws.id;
          return (
            <button
              key={ws.id}
              onClick={() => onChangeWorkspace(ws.id as CreativeWorkspaceType)}
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-tight transition-all cursor-pointer ${
                isActive 
                  ? "bg-btn-bg text-text-dark border border-border-light/60 shadow-xs scale-[1.02]" 
                  : "text-gray-500 hover:text-text-dark hover:bg-btn-bg/30"
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? ws.color : "text-gray-400"}`} />
              <span className="hidden md:inline">{ws.label}</span>
            </button>
          );
        })}
      </div>

      {/* Badge indicators */}
      <div className="flex items-center space-x-2">
        <span className={`text-[9px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider font-mono ${
          isProfessionalMode 
            ? "bg-purple-100 text-purple-700 border border-purple-200" 
            : "bg-blue-100 text-blue-700 border border-blue-200"
        }`}>
          {isProfessionalMode ? "PRO STUDIO MODE" : "CREATIVE ESSENTIALS"}
        </span>
      </div>
    </div>
  );
}
