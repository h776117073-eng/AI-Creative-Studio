import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, Plus, Trash2, Copy, Move, Grid2x2 as Grid3X3, ZoomIn, ZoomOut, ChevronDown, ChevronUp, Lock, Clock as Unlock } from "lucide-react";
import {
  KeyframeEngine,
  KeyframePoint,
  KeyframePropertyTrack,
  InterpolationMode
} from "../../keyframes/runtime/KeyframeEngine";
import { PlaybackEngine } from "../../playback/PlaybackEngine";

interface KeyframeGraphEditorProps {
  clipId?: string;
  propertyName?: string;
  onKeyframeChange?: (propertyName: string, frame: number, value: any) => void;
}

const INTERPOLATION_COLORS: Record<InterpolationMode, string> = {
  linear: "#3b82f6",
  bezier: "#8b5cf6",
  "ease-in": "#f59e0b",
  "ease-out": "#10b981",
  hold: "#64748b",
  auto: "#ec4899",
  custom: "#a855f7",
};

const INTERPOLATION_LABELS: Record<InterpolationMode, string> = {
  linear: "Linear",
  bezier: "Bezier",
  "ease-in": "Ease In",
  "ease-out": "Ease Out",
  hold: "Hold",
  auto: "Auto",
  custom: "Custom",
};

export default function KeyframeGraphEditor({
  clipId,
  propertyName: initialPropertyName,
  onKeyframeChange
}: KeyframeGraphEditorProps) {
  // Engines
  const keyframeEngine = useRef(KeyframeEngine.getInstance());
  const playbackEngine = useRef(PlaybackEngine.getInstance());

  // State
  const [tracks, setTracks] = useState<Record<string, KeyframePoint[]>>({});
  const [selectedTrack, setSelectedTrack] = useState<string | null>(initialPropertyName || null);
  const [selectedKeyframes, setSelectedKeyframes] = useState<Set<string>>(new Set());
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playbackState, setPlaybackState] = useState<"playing" | "paused" | "stopped">("paused");

  // View
  const [zoom, setZoom] = useState(1);
  const [panOffset, setPanOffset] = useState(0);
  const [showGrid, setShowGrid] = useState(true);

  // Value editing
  const [editingValue, setEditingValue] = useState<{ keyframeId: string; value: string } | null>(null);

  // Drag State
  const [draggingKeyframe, setDraggingKeyframe] = useState<{
    keyframeId: string;
    propertyName: string;
    startX: number;
    startY: number;
    startFrame: number;
    startValue: number;
  } | null>(null);

  // Canvas refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Dimensions
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 300 });

  const fps = 24;
  const maxFrame = 1440; // 60 seconds at 24fps

  // Initialize
  useEffect(() => {
    const tracks = keyframeEngine.current.getTracks();
    setTracks(tracks);

    if (Object.keys(tracks).length > 0 && !selectedTrack) {
      setSelectedTrack(Object.keys(tracks)[0]);
    }
  }, [selectedTrack]);

  // Playback listener
  useEffect(() => {
    const unsubscribe = playbackEngine.current.addListener((frame, state) => {
      setCurrentFrame(frame);
      setPlaybackState(state);
    });
    return unsubscribe;
  }, []);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      setCanvasSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height - 120,
      });
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Canvas drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = canvasSize;
    const track = selectedTrack ? tracks[selectedTrack] : null;

    // Clear
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, height);

    // Grid
    if (showGrid) {
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 1;

      // Vertical grid (time)
      const frameWidth = (width / maxFrame) * zoom;
      for (let i = 0; i <= maxFrame; i += fps * 5) {
        const x = i * frameWidth + panOffset;
        if (x < 0 || x > width) continue;

        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // Horizontal grid (value)
      for (let i = 0; i <= 10; i++) {
        const y = (i / 10) * height;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    // Draw curve
    if (track && track.length >= 2) {
      const frameWidth = (width / maxFrame) * zoom;

      // Compute value bounds
      const values = track.map(k => typeof k.value === 'number' ? k.value : 0);
      let minVal = Math.min(0, ...values);
      let maxVal = Math.max(100, ...values);
      const valueRange = maxVal - minVal;

      // Draw curve
      ctx.strokeStyle = INTERPOLATION_COLORS[track[0].interpolation] || "#3b82f6";
      ctx.lineWidth = 2;
      ctx.beginPath();

      for (let frame = 0; frame <= maxFrame; frame += 1) {
        const value = keyframeEngine.current.evaluateProperty(selectedTrack!, frame, 0);
        if (typeof value !== 'number') continue;

        const x = frame * frameWidth + panOffset;
        const y = height - ((value - minVal) / valueRange) * height;

        if (frame === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }

      ctx.stroke();

      // Draw keyframes
      track.forEach(kf => {
        const x = kf.frameIndex * frameWidth + panOffset;
        const value = typeof kf.value === 'number' ? kf.value : 0;
        const y = height - ((value - minVal) / valueRange) * height;

        const isSelected = selectedKeyframes.has(kf.id);
        const isAtCurrentFrame = kf.frameIndex === currentFrame;

        // Highlight
        if (isSelected) {
          ctx.beginPath();
          ctx.arc(x, y, 8, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(59, 130, 246, 0.3)";
          ctx.fill();
        }

        // Diamond shape
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.PI / 4);

        ctx.fillStyle = isSelected ? "#3b82f6" : INTERPOLATION_COLORS[kf.interpolation];
        ctx.fillRect(-5, -5, 10, 10);

        ctx.strokeStyle = isAtCurrentFrame ? "#fff" : "#0f172a";
        ctx.lineWidth = 1;
        ctx.strokeRect(-5, -5, 10, 10);

        ctx.restore();
      });
    }

    // Playhead
    const playheadX = (currentFrame / maxFrame) * width * zoom + panOffset;
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();
  }, [canvasSize, tracks, selectedTrack, selectedKeyframes, currentFrame, zoom, panOffset, showGrid, maxFrame]);

  // Handlers
  const handleAddKeyframe = useCallback(() => {
    if (!selectedTrack) return;

    const existingAtFrame = tracks[selectedTrack]?.find(k => k.frameIndex === currentFrame);
    if (existingAtFrame) {
      alert("Keyframe already exists at this frame");
      return;
    }

    // Get default value
    let defaultValue: any = 0;
    if (selectedTrack.includes("opacity")) defaultValue = 1;
    if (selectedTrack.includes("scale")) defaultValue = 1;
    if (selectedTrack.includes("rotation")) defaultValue = 0;
    if (selectedTrack.includes("position")) defaultValue = { x: 0, y: 0 };

    // Find nearby keyframe to get reasonable value
    const nearKeyframe = tracks[selectedTrack]?.reduce((nearest, kf) => {
      const dist = Math.abs(kf.frameIndex - currentFrame);
      if (!nearest || dist < Math.abs(nearest.frameIndex - currentFrame)) {
        return kf;
      }
      return nearest;
    }, null as KeyframePoint | null);

    if (nearKeyframe && typeof nearKeyframe.value === 'number') {
      defaultValue = nearKeyframe.value;
    }

    keyframeEngine.current.addKeyframe(selectedTrack, currentFrame, defaultValue, "linear");
    setTracks(keyframeEngine.current.getTracks());

    if (onKeyframeChange) {
      onKeyframeChange(selectedTrack, currentFrame, defaultValue);
    }
  }, [selectedTrack, currentFrame, tracks, onKeyframeChange]);

  const handleDeleteKeyframes = useCallback(() => {
    if (!selectedTrack || selectedKeyframes.size === 0) return;

    selectedKeyframes.forEach(kfId => {
      const kf = tracks[selectedTrack]?.find(k => k.id === kfId);
      if (kf) {
        keyframeEngine.current.removeKeyframe(selectedTrack, kf.frameIndex);
      }
    });

    setTracks(keyframeEngine.current.getTracks());
    setSelectedKeyframes(new Set());
  }, [selectedTrack, selectedKeyframes, tracks]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectedTrack) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const frameWidth = (canvasSize.width / maxFrame) * zoom;
    const clickedFrame = Math.round((x - panOffset) / frameWidth);

    // Check if clicking on a keyframe
    const track = tracks[selectedTrack];
    if (!track) return;

    // Compute value bounds
    const values = track.map(k => typeof k.value === 'number' ? k.value : 0);
    let minVal = Math.min(0, ...values);
    let maxVal = Math.max(100, ...values);
    const valueRange = maxVal - minVal;

    let clickedKeyframe: KeyframePoint | null = null;
    for (const kf of track) {
      const kfx = kf.frameIndex * frameWidth + panOffset;
      const value = typeof kf.value === 'number' ? kf.value : 0;
      const kfy = canvasSize.height - ((value - minVal) / valueRange) * canvasSize.height;

      const dist = Math.sqrt((x - kfx) ** 2 + (y - kfy) ** 2);
      if (dist < 15) {
        clickedKeyframe = kf;
        break;
      }
    }

    if (clickedKeyframe) {
      if (e.shiftKey) {
        setSelectedKeyframes(prev => {
          const next = new Set(prev);
          if (next.has(clickedKeyframe!.id)) {
            next.delete(clickedKeyframe!.id);
          } else {
            next.add(clickedKeyframe!.id);
          }
          return next;
        });
      } else {
        setSelectedKeyframes(new Set([clickedKeyframe!.id]));
      }
    } else {
      // Add new keyframe at clicked position
      if (e.altKey || e.metaKey) {
        const newFrame = Math.max(0, Math.min(maxFrame, clickedFrame));
        const newValue = minVal + ((canvasSize.height - y) / canvasSize.height) * valueRange;

        keyframeEngine.current.addKeyframe(selectedTrack, newFrame, Math.round(newValue), "linear");
        setTracks(keyframeEngine.current.getTracks());
      } else {
        setSelectedKeyframes(new Set());
      }
    }
  }, [selectedTrack, tracks, canvasSize, zoom, panOffset, maxFrame]);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectedTrack || selectedKeyframes.size !== 1) return;

    const kfId = Array.from(selectedKeyframes)[0];
    const kf = tracks[selectedTrack]?.find(k => k.id === kfId);
    if (!kf || typeof kf.value !== 'number') return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    setDraggingKeyframe({
      keyframeId: kfId,
      propertyName: selectedTrack,
      startX: e.clientX,
      startY: e.clientY,
      startFrame: kf.frameIndex,
      startValue: kf.value,
    });
  }, [selectedTrack, selectedKeyframes, tracks]);

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!draggingKeyframe) return;

    const deltaX = e.clientX - draggingKeyframe.startX;
    const deltaY = e.clientY - draggingKeyframe.startY;

    const frameWidth = (canvasSize.width / maxFrame) * zoom;
    const valueRange = 100; // Assume reasonable scale

    const newFrame = Math.max(0, Math.min(maxFrame, draggingKeyframe.startFrame + Math.round(deltaX / frameWidth)));
    const newValue = draggingKeyframe.startValue - (deltaY / canvasSize.height) * valueRange;

    // Move keyframe
    keyframeEngine.current.moveKeyframe(draggingKeyframe.propertyName, draggingKeyframe.startFrame, newFrame);

    const track = tracks[draggingKeyframe.propertyName];
    if (track) {
      const kf = track.find(k => k.id === draggingKeyframe.keyframeId);
      if (kf && typeof kf.value === 'number') {
        kf.value = newValue;
      }
    }

    setTracks(keyframeEngine.current.getTracks());
  }, [draggingKeyframe, canvasSize, zoom, maxFrame, tracks]);

  const handleCanvasMouseUp = useCallback(() => {
    setDraggingKeyframe(null);
  }, []);

  const handleInterpolationChange = useCallback((mode: InterpolationMode) => {
    if (!selectedTrack || selectedKeyframes.size === 0) return;

    const track = tracks[selectedTrack];
    if (!track) return;

    selectedKeyframes.forEach(kfId => {
      const idx = track.findIndex(k => k.id === kfId);
      if (idx >= 0) {
        track[idx].interpolation = mode;
      }
    });

    setTracks(keyframeEngine.current.getTracks());
  }, [selectedTrack, selectedKeyframes, tracks]);

  const handleCopyOrDuplicate = useCallback(() => {
    if (!selectedTrack || selectedKeyframes.size === 0) return;

    const track = tracks[selectedTrack];
    if (!track) return;

    const keyframesToCopy = track.filter(k => selectedKeyframes.has(k.id));
    if (keyframesToCopy.length === 0) return;

    // Copy to internal engine clipboard
    const minFrame = Math.min(...keyframesToCopy.map(k => k.frameIndex));
    keyframeEngine.current.copyKeyframes(selectedTrack, minFrame, maxFrame);

    // Paste at an offset
    const offset = fps; // 1 second offset
    keyframeEngine.current.pasteKeyframes(selectedTrack, minFrame + offset);

    setTracks(keyframeEngine.current.getTracks());
  }, [selectedTrack, selectedKeyframes, tracks, maxFrame]);

  const formatTimecode = (frame: number) => {
    const seconds = Math.floor(frame / fps);
    const frames = frame % fps;
    return `${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
  };

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-surface border border-border-light rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 bg-panel border-b border-border-light p-2 flex items-center gap-2 flex-wrap">
        {/* Track selector */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500">Property:</span>
          <select
            value={selectedTrack || ""}
            onChange={(e) => setSelectedTrack(e.target.value || null)}
            className="px-2 py-1 border border-border-light rounded text-xs bg-btn-bg"
          >
            <option value="">Select Property</option>
            {Object.keys(tracks).map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        <div className="h-4 w-px bg-border-light" />

        {/* Add/Delete */}
        <button
          onClick={handleAddKeyframe}
          disabled={!selectedTrack}
          className="p-1.5 border border-border-light rounded hover:bg-btn-bg disabled:opacity-50"
          title="Add Keyframe"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={handleDeleteKeyframes}
          disabled={selectedKeyframes.size === 0}
          className="p-1.5 border border-border-light rounded hover:bg-btn-bg disabled:opacity-50"
          title="Delete Keyframes"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <button
          onClick={handleCopyOrDuplicate}
          disabled={selectedKeyframes.size === 0}
          className="p-1.5 border border-border-light rounded hover:bg-btn-bg disabled:opacity-50"
          title="Duplicate Keyframes"
        >
          <Copy className="w-4 h-4" />
        </button>

        <div className="h-4 w-px bg-border-light" />

        {/* Interpolation */}
        <select
          disabled={selectedKeyframes.size === 0}
          onChange={(e) => handleInterpolationChange(e.target.value as InterpolationMode)}
          className="px-2 py-1 border border-border-light rounded text-xs bg-btn-bg disabled:opacity-50"
        >
          {Object.entries(INTERPOLATION_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>

        <div className="h-4 w-px bg-border-light" />

        {/* View controls */}
        <button
          onClick={() => setShowGrid(!showGrid)}
          className={`p-1.5 border rounded ${showGrid ? "bg-accent-cyan/10 border-accent-cyan text-accent-cyan" : "border-border-light"}`}
          title="Toggle Grid"
        >
          <Grid3X3 className="w-4 h-4" />
        </button>

        <button
          onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
          className="p-1.5 border border-border-light rounded hover:bg-btn-bg"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <span className="text-xs font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom(Math.min(4, zoom + 0.25))}
          className="p-1.5 border border-border-light rounded hover:bg-btn-bg"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <div className="flex-1" />

        {/* Timecode */}
        <span className="text-xs font-mono px-2 py-1 bg-btn-bg border border-border-light rounded">
          {formatTimecode(currentFrame)}
        </span>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative bg-canvas min-h-0">
        <canvas
          ref={canvasRef}
          width={canvasSize.width}
          height={canvasSize.height}
          onClick={handleCanvasClick}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={handleCanvasMouseUp}
          className="w-full h-full cursor-crosshair"
          style={{ background: "#0f172a" }}
        />

        {/* Ruler */}
        <div className="absolute bottom-0 left-0 right-0 h-6 bg-panel/90 border-t border-border-light flex items-end">
          {Array.from({ length: Math.ceil(maxFrame / (fps * 5)) + 1 }).map((_, i) => {
            const frame = i * fps * 5;
            const x = (frame / maxFrame) * canvasSize.width * zoom + panOffset;
            if (x < -20 || x > canvasSize.width + 20) return null;

            return (
              <div
                key={i}
                className="absolute text-[9px] font-mono text-gray-400"
                style={{ left: x }}
              >
                <div className="w-px h-2 bg-border-light" />
                <span className="px-1">{i * 5}s</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Status bar */}
      <div className="shrink-0 bg-panel border-t border-border-light px-3 py-1 flex items-center justify-between text-xs text-gray-500">
        <div>
          {selectedTrack ? (
            <span>
              Track: <span className="text-text-dark font-semibold">{selectedTrack}</span>
              {tracks[selectedTrack] && (
                <span className="ml-2">{tracks[selectedTrack].length} keyframes</span>
              )}
            </span>
          ) : (
            <span>No track selected</span>
          )}
        </div>
        <div>
          {selectedKeyframes.size > 0 && (
            <span>Selected: {selectedKeyframes.size}</span>
          )}
        </div>
        <div className="text-[10px] text-gray-400">
          Alt+Click to add keyframe • Shift+Click to multi-select • Drag to move
        </div>
      </div>
    </div>
  );
}
