import React, { useState, useEffect } from "react";
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Maximize2, 
  Volume2, 
  Grid, 
  Sliders, 
  RotateCw, 
  Check, 
  Eye, 
  EyeOff,
  Video,
  Monitor
} from "lucide-react";

interface VideoPreviewProps {
  currentTimeSec: number;
  durationSec: number;
  onTimeChange: (time: number) => void;
  isPlaying: boolean;
  onPlayToggle: () => void;
  colorGradeCurveEnabled?: boolean;
  activeWorkspace?: string;
}

export default function VideoPreview({
  currentTimeSec,
  durationSec,
  onTimeChange,
  isPlaying,
  onPlayToggle,
  colorGradeCurveEnabled = false,
  activeWorkspace = "video"
}: VideoPreviewProps) {
  const [resolution, setResolution] = useState<"1080p" | "4K" | "8K">("4K");
  const [aspectRatio, setAspectRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [isFullScreen, setIsFullScreen] = useState(false);
  const [showSafeAreas, setShowSafeAreas] = useState(false);
  const [showBeforeAfterSplit, setShowBeforeAfterSplit] = useState(false);
  const [beforeAfterSplitPos, setBeforeAfterSplitPos] = useState(50); // percentage

  // Format frames to human SMPTE
  const formatTimecode = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 30); // 30fps frames
    
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}:${pad(ms)}`;
  };

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    onTimeChange(pct * durationSec);
  };

  return (
    <div className="bg-panel border border-border-light rounded-3xl p-4 flex flex-col justify-between overflow-hidden shadow-xs h-full min-h-[380px] text-left">
      {/* Viewport Top Header */}
      <div className="flex justify-between items-center pb-3 border-b border-border-light shrink-0">
        <div className="flex items-center space-x-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></div>
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider font-mono">
            {isPlaying ? "LIVE FEED" : "PAUSED MONITOR"}
          </span>
          <span className="text-[11px] font-mono text-gray-400">|</span>
          <span className="text-[11px] font-semibold text-text-dark font-mono bg-primary-bg px-2 py-0.5 rounded-md">
            {formatTimecode(currentTimeSec)}
          </span>
        </div>

        {/* Video format presets (CapCut-style) */}
        <div className="flex items-center space-x-1.5">
          <select 
            value={aspectRatio} 
            onChange={(e) => setAspectRatio(e.target.value as any)}
            className="px-2 py-1 bg-btn-bg border border-border-light rounded-lg text-[10px] font-bold text-text-dark cursor-pointer focus:outline-none"
          >
            <option value="16:9">YouTube (16:9)</option>
            <option value="9:16">TikTok (9:16)</option>
            <option value="1:1">Instagram (1:1)</option>
          </select>

          <select 
            value={resolution} 
            onChange={(e) => setResolution(e.target.value as any)}
            className="px-2 py-1 bg-btn-bg border border-border-light rounded-lg text-[10px] font-bold text-text-dark cursor-pointer focus:outline-none"
          >
            <option value="1080p">1080p HD</option>
            <option value="4K">4K UHD</option>
            <option value="8K">8K Master</option>
          </select>

          {/* Grid Overlay Toggle */}
          <button 
            onClick={() => setShowSafeAreas(!showSafeAreas)}
            className={`p-1 rounded-lg border transition-colors cursor-pointer ${
              showSafeAreas 
                ? "bg-text-dark border-transparent text-white" 
                : "bg-btn-bg border-border-light text-gray-500 hover:text-text-dark"
            }`}
            title="Toggle Action Safe Areas Guide"
          >
            <Grid className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Screen Monitor Space */}
      <div className="flex-1 bg-black/95 rounded-2xl my-3 flex items-center justify-center p-4 relative group overflow-hidden border border-gray-800 shadow-inner">
        {/* Aspect Ratio Box Wrapper */}
        <div 
          className={`relative bg-gray-900 border border-gray-800 transition-all duration-300 shadow-2xl rounded-lg overflow-hidden flex items-center justify-center ${
            aspectRatio === "16:9" 
              ? "aspect-video w-full max-w-xl" 
              : aspectRatio === "9:16" 
                ? "aspect-[9/16] h-full max-h-[350px] sm:max-h-[400px]" 
                : "aspect-square w-full max-w-[320px] sm:max-w-[360px]"
          }`}
        >
          {/* Mock Canvas Display stream background */}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-indigo-950/40 via-slate-900/40 to-black"></div>

          {/* Scene content mapping based on active workspace */}
          {activeWorkspace === "3d" ? (
            <div className="absolute inset-0 flex flex-col justify-between p-4 pointer-events-none">
              <div className="text-center mt-20 space-y-1.5">
                <span className="text-[10px] font-mono font-bold text-teal-400 block tracking-widest uppercase">3D RENDER SPACE</span>
                <span className="text-[11px] text-white/90 font-medium">Orbiting Camera Simulation</span>
              </div>
            </div>
          ) : activeWorkspace === "color" && showBeforeAfterSplit ? (
            /* Split Before After comparison view (DaVinci/Color wheels style) */
            <div className="absolute inset-0">
              {/* Left side is Graded, right is Raw log */}
              <div 
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-950/20 to-teal-950/20 flex items-center justify-start pl-4"
                style={{ width: `${beforeAfterSplitPos}%` }}
              >
                <span className="absolute bottom-2 left-2 bg-emerald-500/80 text-white text-[9px] font-bold font-mono px-1.5 py-0.5 rounded">GRADED</span>
              </div>
              <div 
                className="absolute inset-y-0 right-0 bg-slate-950/40 flex items-center justify-end pr-4"
                style={{ left: `${beforeAfterSplitPos}%` }}
              >
                <span className="absolute bottom-2 right-2 bg-gray-600/80 text-white text-[9px] font-bold font-mono px-1.5 py-0.5 rounded">RAW LOG</span>
              </div>
              {/* Splitting divider */}
              <div 
                className="absolute inset-y-0 w-0.5 bg-white cursor-ew-resize hover:w-1 transition-all"
                style={{ left: `${beforeAfterSplitPos}%` }}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1.5 w-3.5 h-3.5 bg-white border border-gray-600 rounded-full flex items-center justify-center">
                  <span className="text-[8px] text-gray-700 font-bold font-mono">↔</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col justify-center items-center p-4">
              {/* Live Canvas Wave representation */}
              <div className="flex items-end justify-center space-x-1 h-14 w-full">
                {[...Array(24)].map((_, i) => {
                  const amplitude = isPlaying 
                    ? Math.sin(currentTimeSec * 2 + i * 0.4) * 100 
                    : Math.sin(i * 0.3) * 30;
                  const finalHeight = Math.max(8, Math.min(100, Math.abs(amplitude)));
                  return (
                    <div 
                      key={i} 
                      className={`w-1 rounded-full transition-all duration-100 ${
                        activeWorkspace === "color" && colorGradeCurveEnabled 
                          ? "bg-emerald-400" 
                          : activeWorkspace === "audio" 
                            ? "bg-indigo-400" 
                            : activeWorkspace === "vfx" 
                              ? "bg-amber-400" 
                              : "bg-purple-500"
                      }`}
                      style={{ height: `${finalHeight}%` }}
                    />
                  );
                })}
              </div>
              <div className="text-center mt-3 z-10">
                <span className="text-white text-xs font-semibold block tracking-tight">
                  {isPlaying ? "Rendering Frame Engine..." : "Sequencer Paused"}
                </span>
                <span className="text-gray-400 text-[10px] font-mono block mt-0.5">
                  Clip: Cyberpunk_Ad_Master ({aspectRatio})
                </span>
              </div>
            </div>
          )}

          {/* Action Safe guides overlay */}
          {showSafeAreas && (
            <div className="absolute inset-4 border border-dashed border-white/20 pointer-events-none rounded-lg flex items-center justify-center">
              <div className="w-11/12 h-11/12 border border-dotted border-white/10 rounded-sm"></div>
            </div>
          )}
        </div>

        {/* Double-click popup reminder/HUD indicator */}
        <div className="absolute bottom-4 left-4 bg-black/75 px-2.5 py-1 text-[9px] font-mono text-gray-400 rounded-lg border border-white/10">
          Codec: H.264 High | BitDepth: 8-bit
        </div>

        <div className="absolute bottom-4 right-4 bg-black/75 px-2.5 py-1 text-[9px] font-mono text-gray-400 rounded-lg border border-white/10 flex items-center space-x-1.5">
          <Monitor className="w-3.5 h-3.5" />
          <span>LUT: {colorGradeCurveEnabled ? "Active Rec.709" : "Pass-Through"}</span>
        </div>
      </div>

      {/* Playback & Advanced Timeline scrubbing controls */}
      <div className="space-y-3 shrink-0">
        {/* Playback Scrubber slider */}
        <div className="flex items-center space-x-3 text-[10px] font-mono text-gray-500 select-none">
          <span>00:00:00:00</span>
          <div 
            onClick={handleProgressClick}
            className="flex-1 h-2 bg-primary-bg/70 rounded-lg relative cursor-pointer group"
          >
            <div 
              className="absolute left-0 top-0 bottom-0 bg-text-dark rounded-l-lg transition-all"
              style={{ width: `${(currentTimeSec / durationSec) * 100}%` }}
            ></div>
            <div 
              className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border border-gray-400 shadow-md cursor-grab active:cursor-grabbing transition-transform hover:scale-110"
              style={{ left: `calc(${(currentTimeSec / durationSec) * 100}% - 7px)` }}
            ></div>
          </div>
          <span className="text-text-dark font-bold bg-white px-2 py-0.5 rounded border border-border-light shadow-2xs">
            {formatTimecode(currentTimeSec)}
          </span>
        </div>

        {/* Lower buttons row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5">
            {/* Split Before/After Trigger (Only in Color Studio Workspace) */}
            {activeWorkspace === "color" && (
              <button
                onClick={() => setShowBeforeAfterSplit(!showBeforeAfterSplit)}
                className={`px-3 py-1.5 rounded-xl border text-[11px] font-bold transition-all cursor-pointer flex items-center space-x-1.5 ${
                  showBeforeAfterSplit 
                    ? "bg-emerald-600 text-white border-transparent" 
                    : "bg-btn-bg border-border-light text-gray-600 hover:text-text-dark"
                }`}
                title="Split screen color grading comparison"
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Split Compare</span>
              </button>
            )}

            {/* General Volume display level indicator */}
            <div className="flex items-center space-x-1.5 px-2.5 py-1.5 bg-primary-bg/50 rounded-xl">
              <Volume2 className="w-4 h-4 text-gray-500" />
              <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden flex">
                <div className="bg-emerald-500 w-3/4 h-full"></div>
                <div className="bg-yellow-500 w-1/12 h-full"></div>
                <div className="bg-red-500 w-1/12 h-full"></div>
              </div>
            </div>
          </div>

          {/* Primary playback control hub */}
          <div className="flex items-center space-x-2">
            <button 
              onClick={() => onTimeChange(0)}
              className="p-1.5 bg-btn-bg hover:bg-primary-bg rounded-xl border border-border-light cursor-pointer text-icon-gray transition-all"
              title="Return to start frame"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <button 
              onClick={onPlayToggle}
              className="p-3 bg-text-dark text-white rounded-full hover:scale-105 active:scale-95 transition-all shadow-sm cursor-pointer"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white translate-x-[1px]" />}
            </button>
            <button 
              onClick={() => onTimeChange(durationSec)}
              className="p-1.5 bg-btn-bg hover:bg-primary-bg rounded-xl border border-border-light cursor-pointer text-icon-gray transition-all"
              title="Skip to end frame"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          <button 
            onClick={() => {
              setIsFullScreen(!isFullScreen);
              alert("Fullscreen Preview Display mode simulated. Press Escape to exit.");
            }}
            className="p-1.5 bg-btn-bg hover:bg-primary-bg rounded-xl border border-border-light cursor-pointer text-icon-gray transition-all"
            title="Simulate cinematic preview"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
