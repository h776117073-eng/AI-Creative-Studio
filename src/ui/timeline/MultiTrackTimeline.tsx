import React, { useState } from "react";
import { 
  Scissors, 
  Magnet, 
  ZoomIn, 
  ZoomOut, 
  Plus, 
  Trash2, 
  Bookmark, 
  Move,
  Clock,
  Sliders,
  ChevronRight,
  Sparkles
} from "lucide-react";

export interface TimelineClip {
  id: string;
  name: string;
  trackId: "video" | "audio" | "effects" | "text";
  startSec: number;
  durationSec: number;
  colorClass: string;
}

interface MultiTrackTimelineProps {
  currentTimeSec: number;
  durationSec: number;
  onTimeChange: (time: number) => void;
  selectedClipId: string | null;
  onSelectClip: (clipId: string | null) => void;
  onClipsChange?: (clips: TimelineClip[]) => void;
}

export default function MultiTrackTimeline({
  currentTimeSec,
  durationSec,
  onTimeChange,
  selectedClipId,
  onSelectClip,
  onClipsChange
}: MultiTrackTimelineProps) {
  const [zoomLevel, setZoomLevel] = useState(50); // percentage
  const [magneticSnapping, setMagneticSnapping] = useState(true);
  const [markers, setMarkers] = useState<Array<{ id: string; timeSec: number; label: string }>>([
    { id: "m1", timeSec: 3.5, label: "Beat Drop Cut" },
    { id: "m2", timeSec: 10.2, label: "VFX Particle Burst" }
  ]);

  const [clips, setClips] = useState<TimelineClip[]>([
    { id: "v1", name: "Cyberpunk_Streaks_A.mp4", trackId: "video", startSec: 0, durationSec: 5.5, colorClass: "bg-blue-500 border-blue-400" },
    { id: "v2", name: "Tokyo_Drone_Pan.mp4", trackId: "video", startSec: 5.5, durationSec: 6.5, colorClass: "bg-blue-500 border-blue-400" },
    { id: "v3", name: "Ending_Credits_Logo.mp4", trackId: "video", startSec: 12, durationSec: 3, colorClass: "bg-blue-600 border-blue-500" },
    
    { id: "a1", name: "Ambient_Synthwave_Beat.wav", trackId: "audio", startSec: 0, durationSec: 15, colorClass: "bg-indigo-500 border-indigo-400" },
    
    { id: "e1", name: "CyberGlitch VFX Preset", trackId: "effects", startSec: 4.2, durationSec: 3.0, colorClass: "bg-amber-500 border-amber-400" },
    
    { id: "t1", name: "NEBULA TOKYO 2026", trackId: "text", startSec: 1.0, durationSec: 4.5, colorClass: "bg-rose-500 border-rose-400" },
    { id: "t2", name: "CYBER NETWORKS", trackId: "text", startSec: 6.5, durationSec: 5.0, colorClass: "bg-rose-500 border-rose-400" }
  ]);

  const tracks: Array<{ id: "video" | "audio" | "effects" | "text"; label: string; bg: string }> = [
    { id: "video", label: "Video Tracks (V1)", bg: "bg-blue-50/50" },
    { id: "effects", label: "Adjustment Layer (FX1)", bg: "bg-amber-50/40" },
    { id: "text", label: "Typography (T1)", bg: "bg-rose-50/40" },
    { id: "audio", label: "Audio Mastering (A1)", bg: "bg-indigo-50/50" }
  ];

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // If we clicked a clip, handle selection separately, don't trigger timeline jump immediately
    if ((e.target as HTMLElement).closest(".timeline-clip")) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(1, x / rect.width));
    let targetTime = pct * durationSec;

    // Snap to nearest marker or clip boundary if snapping is enabled
    if (magneticSnapping) {
      const snapPoints = [
        0, 
        durationSec,
        ...markers.map(m => m.timeSec),
        ...clips.map(c => c.startSec),
        ...clips.map(c => c.startSec + c.durationSec)
      ];
      for (const pt of snapPoints) {
        if (Math.abs(targetTime - pt) < 0.2) {
          targetTime = pt;
          break;
        }
      }
    }

    onTimeChange(targetTime);
  };

  const handleSplitClip = () => {
    const currentActiveClip = clips.find(c => c.id === selectedClipId);
    if (!currentActiveClip) {
      alert("Please select a timeline clip to split first.");
      return;
    }

    // Check if playhead intersects with selected clip
    const isIntersecting = 
      currentTimeSec > currentActiveClip.startSec && 
      currentTimeSec < (currentActiveClip.startSec + currentActiveClip.durationSec);

    if (!isIntersecting) {
      alert("The playhead marker is outside the selected clip boundary. Position playhead inside the clip to perform a clean split.");
      return;
    }

    // Split logic
    const leftDuration = currentTimeSec - currentActiveClip.startSec;
    const rightDuration = currentActiveClip.durationSec - leftDuration;

    const leftClip: TimelineClip = {
      ...currentActiveClip,
      id: `${currentActiveClip.id}_split_L`,
      durationSec: leftDuration,
      name: `${currentActiveClip.name} [Part 1]`
    };

    const rightClip: TimelineClip = {
      ...currentActiveClip,
      id: `${currentActiveClip.id}_split_R`,
      startSec: currentTimeSec,
      durationSec: rightDuration,
      name: `${currentActiveClip.name} [Part 2]`
    };

    const updatedClips = clips.filter(c => c.id !== selectedClipId).concat(leftClip, rightClip);
    setClips(updatedClips);
    onSelectClip(leftClip.id);
    if (onClipsChange) onClipsChange(updatedClips);
    console.log(`[Timeline] Splitting clip ${currentActiveClip.name} at ${currentTimeSec.toFixed(2)}s.`);
  };

  const handleTrimClip = (dir: "left" | "right") => {
    const currentActiveClip = clips.find(c => c.id === selectedClipId);
    if (!currentActiveClip) {
      alert("Select a clip to trim.");
      return;
    }

    const updated = clips.map(c => {
      if (c.id === selectedClipId) {
        if (dir === "left") {
          // Trim start of clip
          const newStart = Math.min(currentTimeSec, c.startSec + c.durationSec - 0.5);
          const diff = newStart - c.startSec;
          return {
            ...c,
            startSec: newStart,
            durationSec: Math.max(0.5, c.durationSec - diff)
          };
        } else {
          // Trim end of clip
          return {
            ...c,
            durationSec: Math.max(0.5, currentTimeSec - c.startSec)
          };
        }
      }
      return c;
    });

    setClips(updated);
    if (onClipsChange) onClipsChange(updated);
  };

  const handleDeleteClip = () => {
    if (!selectedClipId) return;
    const updated = clips.filter(c => c.id !== selectedClipId);
    setClips(updated);
    onSelectClip(null);
    if (onClipsChange) onClipsChange(updated);
  };

  const handleAddMarker = () => {
    const label = prompt("Enter Marker Label:", `Marker ${markers.length + 1}`);
    if (label) {
      setMarkers([...markers, {
        id: `m_${Date.now()}`,
        timeSec: currentTimeSec,
        label
      }]);
    }
  };

  return (
    <div className="bg-btn-bg border border-border-light rounded-3xl p-5 flex flex-col space-y-4 shadow-xs select-none">
      {/* Upper Timeline Control Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-light pb-3">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 bg-primary-bg rounded-lg">
            <Clock className="w-4 h-4 text-icon-gray" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-text-dark">Multi-Track Sequencer</h3>
            <p className="text-[10px] text-gray-500 font-medium">Click timeline body to reposition frame playhead</p>
          </div>
        </div>

        {/* Action button hotkeys (Trimming, Splitting, Snapping, Markers) */}
        <div className="flex items-center gap-1.5">
          <button 
            onClick={handleSplitClip}
            className="px-2.5 py-1.5 bg-primary-bg hover:bg-gray-200 border border-border-light rounded-lg text-[10px] font-bold text-text-dark flex items-center space-x-1 transition-all cursor-pointer"
            title="Split selected clip at current playhead"
          >
            <Scissors className="w-3.5 h-3.5 text-gray-600" />
            <span className="hidden sm:inline">Split Clip</span>
          </button>

          <button 
            onClick={() => handleTrimClip("left")}
            className="px-2 py-1.5 bg-primary-bg hover:bg-gray-200 border border-border-light rounded-lg text-[10px] font-bold text-text-dark transition-all cursor-pointer"
            title="Trim left to playhead"
          >
            <span>Trim Start</span>
          </button>

          <button 
            onClick={() => handleTrimClip("right")}
            className="px-2 py-1.5 bg-primary-bg hover:bg-gray-200 border border-border-light rounded-lg text-[10px] font-bold text-text-dark transition-all cursor-pointer"
            title="Trim right to playhead"
          >
            <span>Trim End</span>
          </button>

          <div className="w-[1px] h-4 bg-border-light mx-1"></div>

          <button 
            onClick={() => setMagneticSnapping(!magneticSnapping)}
            className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
              magneticSnapping 
                ? "bg-purple-100 border-purple-200 text-purple-700" 
                : "bg-primary-bg border-border-light text-gray-400 hover:text-text-dark"
            }`}
            title="Toggle Magnetic Snapping"
          >
            <Magnet className="w-3.5 h-3.5" />
          </button>

          <button 
            onClick={handleAddMarker}
            className="p-1.5 bg-primary-bg hover:bg-gray-200 border border-border-light rounded-lg text-gray-600 cursor-pointer transition-all"
            title="Insert frame marker"
          >
            <Bookmark className="w-3.5 h-3.5" />
          </button>

          {selectedClipId && (
            <button 
              onClick={handleDeleteClip}
              className="p-1.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg text-red-600 cursor-pointer transition-all"
              title="Delete active asset block"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Timeline Horizontal Zoom controls */}
        <div className="flex items-center space-x-2 text-[10px] font-mono text-gray-500">
          <ZoomOut className="w-3.5 h-3.5" />
          <input 
            type="range" 
            min="20" 
            max="150" 
            value={zoomLevel} 
            onChange={(e) => setZoomLevel(Number(e.target.value))}
            className="w-20 accent-text-dark h-1 bg-gray-300 rounded-full cursor-pointer"
          />
          <ZoomIn className="w-3.5 h-3.5" />
          <span>({zoomLevel}%)</span>
        </div>
      </div>

      {/* Main Multi-Track body container */}
      <div className="relative border border-border-light/80 rounded-2xl overflow-hidden bg-primary-bg/20">
        {/* SMPTE linear graduation axis ruler bar */}
        <div className="h-7 bg-primary-bg/60 border-b border-border-light flex relative">
          <div className="w-[15%] flex-shrink-0 border-r border-border-light flex items-center pl-3">
            <span className="text-[9px] font-bold text-gray-500 font-sans uppercase tracking-wider">TRACK TRACKER</span>
          </div>
          
          <div 
            onClick={handleTimelineClick}
            className="flex-1 relative cursor-ew-resize select-none overflow-hidden"
          >
            {/* Timeline hour rules markers */}
            {[...Array(16)].map((_, i) => {
              const markerPct = (i / 15) * 100;
              const markerTime = (i / 15) * durationSec;
              return (
                <div 
                  key={i} 
                  className="absolute top-0 bottom-0 border-l border-border-light/60 flex flex-col justify-between"
                  style={{ left: `${markerPct}%` }}
                >
                  <span className="text-[8px] font-mono text-gray-400 font-bold pl-1 pt-0.5">
                    {markerTime.toFixed(1)}s
                  </span>
                  <div className="h-1 w-[1px] bg-gray-400"></div>
                </div>
              );
            })}

            {/* Custom Annotation Timeline Markers representation */}
            {markers.map((m) => {
              const mPct = (m.timeSec / durationSec) * 100;
              return (
                <div 
                  key={m.id}
                  className="absolute top-0 w-3 h-3 -translate-x-1.5 cursor-pointer flex flex-col items-center group z-30"
                  style={{ left: `${mPct}%` }}
                  title={`${m.label} at ${m.timeSec}s`}
                >
                  <div className="w-2 h-2 rotate-45 bg-purple-600 rounded-xs border border-white"></div>
                  <span className="hidden group-hover:block absolute top-4 bg-purple-700 text-white text-[8px] font-bold px-1.5 py-0.5 rounded shadow-lg whitespace-nowrap">
                    {m.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Vertical Track Rows */}
        <div className="divide-y divide-border-light/60">
          {tracks.map((track) => (
            <div key={track.id} className="h-11 flex relative">
              {/* Track Left Title Side */}
              <div className={`w-[15%] shrink-0 flex items-center justify-between px-3 border-r border-border-light bg-panel`}>
                <span className="text-[10px] font-bold text-text-dark font-mono truncate">
                  {track.label}
                </span>
                <span className="text-[8px] text-gray-400 font-bold font-mono uppercase bg-white border px-1 rounded">
                  {track.id}
                </span>
              </div>

              {/* Clip Track Body Lane */}
              <div 
                onClick={handleTimelineClick}
                className={`flex-1 relative ${track.bg} overflow-hidden`}
              >
                {clips
                  .filter(clip => clip.trackId === track.id)
                  .map(clip => {
                    const leftPct = (clip.startSec / durationSec) * 100;
                    const widthPct = (clip.durationSec / durationSec) * 100;
                    const isSelected = selectedClipId === clip.id;

                    return (
                      <div
                        key={clip.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectClip(clip.id);
                        }}
                        className={`timeline-clip absolute top-1.5 bottom-1.5 rounded-lg border flex items-center justify-between px-2.5 cursor-pointer transition-all overflow-hidden ${clip.colorClass} ${
                          isSelected 
                            ? "ring-2 ring-purple-600 border-white shadow-md scale-[0.98] saturate-125" 
                            : "opacity-85 hover:opacity-100 hover:scale-[0.99]"
                        }`}
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      >
                        <div className="flex items-center space-x-1.5 min-w-0 flex-1">
                          <span className="text-[9px] font-bold text-white truncate">
                            {clip.name}
                          </span>
                        </div>
                        
                        {/* Trim handler indicator lines */}
                        <div className="flex items-center space-x-0.5 pointer-events-none">
                          <div className="w-[1.5px] h-3 bg-white/40 rounded-full"></div>
                          <div className="w-[1.5px] h-3 bg-white/40 rounded-full"></div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>

        {/* Synchronized Vertical Playhead marker */}
        <div 
          className="absolute top-0 bottom-0 w-[2px] bg-red-500 z-40 pointer-events-none transition-all duration-75"
          style={{ left: `calc(15% + ${(currentTimeSec / durationSec) * 85}%)` }}
        >
          {/* Playhead Diamond handle */}
          <div className="absolute top-0 -translate-x-1.5 w-3 h-3 bg-red-500 rotate-45 border border-white flex items-center justify-center">
            <div className="w-1 h-1 bg-white rounded-full"></div>
          </div>
        </div>
      </div>

      {/* Info indicator panel for beginners (CapCut style helper tips) */}
      <div className="flex items-center justify-between p-3 bg-primary-bg/40 border border-border-light rounded-xl">
        <div className="flex items-center space-x-2 text-[10px] text-gray-500">
          <Sparkles className="w-3.5 h-3.5 text-purple-600" />
          <span>Double-click any clip to inspect dynamic properties (grading, volume ducking, typography presets).</span>
        </div>
        <span className="text-[9px] text-gray-400 font-mono">Magnetic Timeline Snap: ON</span>
      </div>
    </div>
  );
}
