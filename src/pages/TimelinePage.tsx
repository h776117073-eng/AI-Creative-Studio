import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, SkipBack, SkipForward, Scissors, Magnet, ZoomIn, ZoomOut, Eye, EyeOff, Volume2, VolumeX, Lock, Clock as Unlock, Plus, Trash2, Copy, Grid2x2 as Grid3X3, Layers, ChevronDown, ChevronUp } from "lucide-react";
import { PageId } from "../types";
import { TimelineEngine, TimelineSequence } from "../timeline/TimelineEngine";
import { ClipEngine, Clip } from "../timeline/ClipEngine";
import { TrackSystem, Track, TrackType } from "../timeline/TrackSystem";
import { PlaybackEngine, PlaybackState } from "../playback/PlaybackEngine";

interface TimelinePageProps {
  onNavigate: (page: PageId) => void;
  projectName: string;
}

const TRACK_COLORS: Record<TrackType, string> = {
  video: "#3b82f6",
  audio: "#10b981",
  subtitle: "#f59e0b",
  motion: "#8b5cf6",
  effect: "#ec4899",
  adjustment: "#6366f1",
  camera: "#14b8a6",
  "3d": "#f97316",
  ai: "#a855f7",
  custom: "#64748b",
};

const TRACK_HEIGHT_DEFAULT = 56;
const TRACK_HEIGHT_COLLAPSED = 28;

export default function TimelinePage({ onNavigate, projectName }: TimelinePageProps) {
  // Engine instances
  const timelineEngine = useRef(TimelineEngine.getInstance());
  const playbackEngine = useRef(PlaybackEngine.getInstance());

  // Track and clip systems
  const [trackSystem, setTrackSystem] = useState<TrackSystem | null>(null);
  const [clipEngine, setClipEngine] = useState<ClipEngine | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [clips, setClips] = useState<Clip[]>([]);

  // Playback state
  const [playbackState, setPlaybackState] = useState<PlaybackState>("paused");
  const [currentFrame, setCurrentFrame] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isLooping, setIsLooping] = useState(false);

  // Timeline settings
  const [zoom, setZoom] = useState(1.0);
  const [isSnapping, setIsSnapping] = useState(true);
  const [snapTolerance, setSnapTolerance] = useState(5);
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set());
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null);

  // Drag state
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartFrame, setDragStartFrame] = useState(0);

  // Trim state
  const [trimmingClip, setTrimmingClip] = useState<{clipId: string, edge: 'left' | 'right', startX: number} | null>(null);

  // Playhead
  const playheadRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // FPS from sequence
  const fps = 24;

  // Initialize engines
  useEffect(() => {
    const engine = timelineEngine.current;
    const trackSys = engine.getTrackSystem();
    const clipEng = engine.getClipEngine();

    setTrackSystem(trackSys);
    setClipEngine(clipEng);
    setTracks(trackSys.getTracks());
    setClips(clipEng.getClips());

    // Set playback bounds
    const sequence = engine.getActiveSequence();
    if (sequence) {
      playbackEngine.current.setFPS(sequence.fps);
      playbackEngine.current.setTimelineBounds(sequence.durationFrames);
    }
  }, []);

  // Playback listener
  useEffect(() => {
    const unsubscribe = playbackEngine.current.addListener((frame, state) => {
      setCurrentFrame(frame);
      setPlaybackState(state);
    });
    return unsubscribe;
  }, []);

  // Handlers
  const handlePlay = useCallback(() => {
    if (playbackState === "playing") {
      playbackEngine.current.pause();
    } else {
      playbackEngine.current.play();
    }
  }, [playbackState]);

  const handleStop = useCallback(() => {
    playbackEngine.current.stop();
  }, []);

  const handleSkipBack = useCallback(() => {
    const newFrame = Math.max(0, currentFrame - fps);
    playbackEngine.current.seek(newFrame);
  }, [currentFrame, fps]);

  const handleSkipForward = useCallback(() => {
    const sequence = timelineEngine.current.getActiveSequence();
    const maxFrame = sequence?.durationFrames || 14400;
    const newFrame = Math.min(maxFrame, currentFrame + fps);
    playbackEngine.current.seek(newFrame);
  }, [currentFrame, fps]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const sequence = timelineEngine.current.getActiveSequence();
    const maxFrame = sequence?.durationFrames || 14400;
    const frame = Math.floor(percentage * maxFrame);
    playbackEngine.current.seek(frame);
  }, []);

  const handleTrackToggle = useCallback((trackId: string, property: 'isMuted' | 'isLocked' | 'isSolo') => {
    if (!trackSystem) return;
    const track = trackSystem.getTrack(trackId);
    if (!track) return;

    if (property === 'isMuted') {
      trackSystem.setTrackMute(trackId, !track.isMuted);
    } else if (property === 'isLocked') {
      trackSystem.setTrackLock(trackId, !track.isLocked);
    } else if (property === 'isSolo') {
      trackSystem.setTrackSolo(trackId, !track.isSolo);
    }
    setTracks(trackSystem.getTracks());
  }, [trackSystem]);

  const handleTrackCollapse = useCallback((trackId: string) => {
    if (!trackSystem) return;
    const track = trackSystem.getTrack(trackId);
    if (!track) return;
    trackSystem.setTrackCollapsed(trackId, !track.isCollapsed);
    setTracks(trackSystem.getTracks());
  }, [trackSystem]);

  const handleAddTrack = useCallback((type: TrackType) => {
    if (!trackSystem) return;
    const id = `track_${Date.now()}`;
    const name = `${type.charAt(0).toUpperCase() + type.slice(1)} Track ${tracks.filter(t => t.type === type).length + 1}`;
    const index = tracks.length;
    trackSystem.createTrack(id, name, type, index, TRACK_COLORS[type]);
    setTracks(trackSystem.getTracks());
  }, [trackSystem, tracks]);

  const handleDeleteTrack = useCallback((trackId: string) => {
    if (!trackSystem || !clipEngine) return;
    const track = trackSystem.getTrack(trackId);
    if (!track || track.isLocked) return;

    // Remove clips from track
    track.clipIds.forEach(clipId => {
      clipEngine.deleteClip(clipId);
    });
    trackSystem.deleteTrack(trackId);

    setTracks(trackSystem.getTracks());
    setClips(clipEngine.getClips());
    timelineEngine.current.commitSnapshot("Delete Track");
  }, [trackSystem, clipEngine]);

  // Clip drag handlers
  const handleClipMouseDown = useCallback((e: React.MouseEvent, clipId: string) => {
    e.stopPropagation();
    if (!clipEngine) return;

    const clip = clipEngine.getClip(clipId);
    if (!clip || clip.isLocked) return;

    // Multi-selection with Shift
    if (e.shiftKey) {
      setSelectedClipIds(prev => {
        const next = new Set(prev);
        if (next.has(clipId)) {
          next.delete(clipId);
        } else {
          next.add(clipId);
        }
        return next;
      });
    } else {
      setSelectedClipIds(new Set([clipId]));
    }

    setDraggingClipId(clipId);
    setDragStartX(e.clientX);
    setDragStartFrame(clip.timelineStartFrame);
  }, [clipEngine]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (draggingClipId && clipEngine && trackSystem && timelineRef.current) {
      const clip = clipEngine.getClip(draggingClipId);
      if (!clip) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const deltaX = e.clientX - dragStartX;
      const deltaFrames = Math.round((deltaX / rect.width) * (14400 * zoom));
      let newFrame = dragStartFrame + deltaFrames;

      // Snapping
      if (isSnapping) {
        const otherClips = clips.filter(c => c.id !== draggingClipId);
        const tempClip = { ...clip, timelineStartFrame: newFrame };
        const snapOffset = clipEngine.calculateSnapOffset(tempClip, otherClips, snapTolerance);
        newFrame += snapOffset;
      }

      clip.timelineStartFrame = Math.max(0, newFrame);
      setClips([...clipEngine.getClips()]);
    }

    if (trimmingClip && clipEngine && timelineRef.current) {
      const clip = clipEngine.getClip(trimmingClip.clipId);
      if (!clip) return;

      const rect = timelineRef.current.getBoundingClientRect();
      const deltaX = e.clientX - trimmingClip.startX;
      const deltaFrames = Math.round((deltaX / rect.width) * (14400 * zoom));

      if (trimmingClip.edge === 'left') {
        const newStartFrame = Math.max(0, clip.startFrame + deltaFrames);
        const newDuration = clip.durationFrames - (newStartFrame - clip.startFrame);
        if (newDuration > 1) {
          clip.startFrame = newStartFrame;
          clip.durationFrames = newDuration;
          clip.timelineStartFrame = Math.max(0, clip.timelineStartFrame + deltaFrames);
        }
      } else {
        const newDuration = Math.max(1, clip.durationFrames + deltaFrames);
        clip.durationFrames = newDuration;
      }

      setClips([...clipEngine.getClips()]);
      setTrimmingClip({ ...trimmingClip, startX: e.clientX });
    }
  }, [draggingClipId, trimmingClip, clipEngine, trackSystem, clips, isSnapping, snapTolerance, zoom, dragStartFrame, dragStartX]);

  const handleMouseUp = useCallback(() => {
    if (draggingClipId || trimmingClip) {
      timelineEngine.current.commitSnapshot("Edit Clips");
    }
    setDraggingClipId(null);
    setTrimmingClip(null);
  }, [draggingClipId, trimmingClip]);

  // Clip operations
  const handleSplitClip = useCallback((clipId: string) => {
    if (!clipEngine || !currentFrame) return;
    const clip = clipEngine.getClip(clipId);
    if (!clip || clip.isLocked) return;

    const splitFrame = currentFrame;
    if (splitFrame <= clip.timelineStartFrame || splitFrame >= clip.timelineStartFrame + clip.durationFrames) {
      return;
    }

    const newClipId = `clip_${Date.now()}`;
    clipEngine.splitClip(clipId, splitFrame, newClipId);
    if (trackSystem) {
      const track = trackSystem.getTrack(clip.trackId);
      if (track) {
        const idx = track.clipIds.indexOf(clipId);
        track.clipIds.splice(idx + 1, 0, newClipId);
      }
    }

    setClips(clipEngine.getClips());
    setTracks(trackSystem?.getTracks() || []);
    timelineEngine.current.commitSnapshot("Split Clip");
  }, [clipEngine, trackSystem, currentFrame]);

  const handleDeleteClips = useCallback(() => {
    if (!clipEngine || !trackSystem || selectedClipIds.size === 0) return;

    selectedClipIds.forEach(clipId => {
      const clip = clipEngine.getClip(clipId);
      if (clip && !clip.isLocked) {
        clipEngine.deleteClip(clipId);
        trackSystem.removeClipFromTrack(clip.trackId, clipId);
      }
    });

    setClips(clipEngine.getClips());
    setTracks(trackSystem.getTracks());
    setSelectedClipIds(new Set());
    timelineEngine.current.commitSnapshot("Delete Clips");
  }, [clipEngine, trackSystem, selectedClipIds]);

  const handleDuplicateClips = useCallback(() => {
    if (!clipEngine || !trackSystem || selectedClipIds.size === 0) return;

    const newClipIds: string[] = [];
    selectedClipIds.forEach(clipId => {
      const newId = `clip_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      const newClip = clipEngine.duplicateClip(clipId, newId, 50);
      if (newClip) {
        trackSystem.addClipToTrack(newClip.trackId, newId);
        newClipIds.push(newId);
      }
    });

    setClips(clipEngine.getClips());
    setTracks(trackSystem.getTracks());
    setSelectedClipIds(new Set(newClipIds));
    timelineEngine.current.commitSnapshot("Duplicate Clips");
  }, [clipEngine, trackSystem, selectedClipIds]);

  // Frame to pixel conversion
  const frameToPixel = useCallback((frame: number, totalWidth: number) => {
    const sequence = timelineEngine.current.getActiveSequence();
    const maxFrame = sequence?.durationFrames || 14400;
    return (frame / maxFrame) * totalWidth;
  }, []);

  const pixelToFrame = useCallback((pixel: number, totalWidth: number) => {
    const sequence = timelineEngine.current.getActiveSequence();
    const maxFrame = sequence?.durationFrames || 14400;
    return Math.floor((pixel / totalWidth) * maxFrame);
  }, []);

  // Format timecode
  const formatTimecode = useCallback((frame: number) => {
    const totalSeconds = frame / fps;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const frames = Math.floor(frame % fps);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
  }, [fps]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDeleteClips();
      } else if (e.key === ' ' && !e.repeat) {
        e.preventDefault();
        handlePlay();
      } else if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSplitClip(selectedClipIds.values().next().value || '');
      } else if (e.key === 'd' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleDuplicateClips();
      } else if (e.key === 'j') {
        handleSkipBack();
      } else if (e.key === 'k') {
        handlePlay();
      } else if (e.key === 'l') {
        handleSkipForward();
      } else if (e.key === 'Escape') {
        setSelectedClipIds(new Set());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDeleteClips, handlePlay, handleSkipBack, handleSkipForward, handleSplitClip, handleDuplicateClips, selectedClipIds]);

  // Undo/Redo
  const handleUndo = useCallback(() => {
    timelineEngine.current.triggerUndo();
    const trackSys = timelineEngine.current.getTrackSystem();
    const clipEng = timelineEngine.current.getClipEngine();
    setTrackSystem(trackSys);
    setClipEngine(clipEng);
    setTracks(trackSys.getTracks());
    setClips(clipEng.getClips());
  }, []);

  const handleRedo = useCallback(() => {
    timelineEngine.current.triggerRedo();
    const trackSys = timelineEngine.current.getTrackSystem();
    const clipEng = timelineEngine.current.getClipEngine();
    setTrackSystem(trackSys);
    setClipEngine(clipEng);
    setTracks(trackSys.getTracks());
    setClips(clipEng.getClips());
  }, []);

  return (
    <div
      className="h-full flex flex-col bg-surface text-text-dark select-none"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Toolbar */}
      <div className="shrink-0 bg-panel border-b border-border-light p-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {/* Transport controls */}
          <button
            onClick={handleStop}
            className="p-1.5 hover:bg-btn-bg rounded text-gray-500 hover:text-text-dark"
            title="Stop"
          >
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={handlePlay}
            className="p-2 bg-text-dark text-white rounded-full hover:scale-105 transition-transform"
            title="Play/Pause (Space)"
          >
            {playbackState === "playing" ? (
              <Pause className="w-4 h-4 fill-white" />
            ) : (
              <Play className="w-4 h-4 fill-white ml-0.5" />
            )}
          </button>
          <button
            onClick={handleSkipForward}
            className="p-1.5 hover:bg-btn-bg rounded text-gray-500 hover:text-text-dark"
            title="Skip Forward"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          <div className="h-4 w-px bg-border-light mx-2" />

          {/* Timecode */}
          <div className="font-mono text-sm font-bold px-3 py-1 bg-btn-bg rounded border border-border-light">
            {formatTimecode(currentFrame)}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Tools */}
          <button
            onClick={() => setIsSnapping(!isSnapping)}
            className={`px-2.5 py-1.5 rounded border text-xs font-semibold flex items-center gap-1.5 transition-all ${
              isSnapping
                ? "bg-accent-cyan/10 border-accent-cyan text-accent-cyan"
                : "bg-transparent border-border-light text-gray-500 hover:text-text-dark"
            }`}
            title="Toggle Snapping (N)"
          >
            <Magnet className="w-3.5 h-3.5" />
            Snap
          </button>

          <button
            onClick={() => selectedClipIds.size === 1 && handleSplitClip(Array.from(selectedClipIds)[0])}
            disabled={selectedClipIds.size !== 1}
            className="px-2.5 py-1.5 rounded border border-border-light text-xs font-semibold flex items-center gap-1.5 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Split Clip at Playhead (S)"
          >
            <Scissors className="w-3.5 h-3.5" />
            Split
          </button>

          <button
            onClick={handleDeleteClips}
            disabled={selectedClipIds.size === 0}
            className="px-2.5 py-1.5 rounded border border-border-light text-xs font-semibold flex items-center gap-1.5 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Delete Selected (Delete)"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-500" />
            Delete
          </button>

          <button
            onClick={handleDuplicateClips}
            disabled={selectedClipIds.size === 0}
            className="px-2.5 py-1.5 rounded border border-border-light text-xs font-semibold flex items-center gap-1.5 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Duplicate (Cmd+D)"
          >
            <Copy className="w-3.5 h-3.5" />
            Duplicate
          </button>

          <div className="h-4 w-px bg-border-light mx-2" />

          {/* Zoom */}
          <button
            onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
            className="p-1.5 hover:bg-btn-bg rounded text-gray-500 hover:text-text-dark"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom(Math.min(4, zoom + 0.25))}
            className="p-1.5 hover:bg-btn-bg rounded text-gray-500 hover:text-text-dark"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleUndo}
            className="p-1.5 hover:bg-btn-bg rounded text-gray-500 hover:text-text-dark text-xs"
            title="Undo (Cmd+Z)"
          >
            Undo
          </button>
          <button
            onClick={handleRedo}
            className="p-1.5 hover:bg-btn-bg rounded text-gray-500 hover:text-text-dark text-xs"
            title="Redo (Cmd+Shift+Z)"
          >
            Redo
          </button>
        </div>
      </div>

      {/* Add Track Buttons */}
      <div className="shrink-0 bg-panel/50 border-b border-border-light px-4 py-2 flex items-center gap-2">
        <span className="text-xs text-gray-500 font-semibold">Add Track:</span>
        {(["video", "audio", "subtitle", "motion", "effect", "ai"] as TrackType[]).map(type => (
          <button
            key={type}
            onClick={() => handleAddTrack(type)}
            className="px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 hover:bg-btn-bg border border-border-light"
            style={{ color: TRACK_COLORS[type] }}
          >
            <Plus className="w-3 h-3" />
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Timeline Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Track Headers */}
        <div className="w-48 shrink-0 bg-panel border-r border-border-light overflow-y-auto">
          {tracks.map(track => (
            <div
              key={track.id}
              className="flex items-center justify-between px-3 border-b border-border-light/50 hover:bg-btn-bg/50"
              style={{ height: track.isCollapsed ? TRACK_HEIGHT_COLLAPSED : TRACK_HEIGHT_DEFAULT }}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: track.color }}
                />
                <span className="text-xs font-semibold truncate">{track.name}</span>
                <button
                  onClick={() => handleTrackCollapse(track.id)}
                  className="p-0.5 hover:bg-btn-bg rounded text-gray-400"
                >
                  {track.isCollapsed ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronUp className="w-3 h-3" />
                  )}
                </button>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleTrackToggle(track.id, 'isMuted')}
                  className={`p-1 rounded hover:bg-btn-bg ${track.isMuted ? 'text-red-500' : 'text-gray-400'}`}
                  title="Mute"
                >
                  {track.isMuted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => handleTrackToggle(track.id, 'isLocked')}
                  className={`p-1 rounded hover:bg-btn-bg ${track.isLocked ? 'text-orange-500' : 'text-gray-400'}`}
                  title="Lock"
                >
                  {track.isLocked ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => handleDeleteTrack(track.id)}
                  disabled={track.isLocked}
                  className="p-1 rounded hover:bg-btn-bg text-gray-400 hover:text-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Delete Track"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Timeline Tracks */}
        <div
          ref={timelineRef}
          className="flex-1 relative overflow-auto bg-canvas"
          onClick={handleSeek}
        >
          {/* Grid Lines */}
          <div className="absolute inset-0 pointer-events-none">
            {Array.from({ length: Math.ceil(14400 / (fps * 10)) }).map((_, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 w-px bg-border-light/30"
                style={{ left: `${(i / (14400 / (fps * 10))) * 100}%` }}
              />
            ))}
          </div>

          {/* Track Clips */}
          {tracks.map(track => {
            const trackClips = clips.filter(c => c.trackId === track.id);
            return (
              <div
                key={track.id}
                className="relative border-b border-border-light/30"
                style={{ height: track.isCollapsed ? TRACK_HEIGHT_COLLAPSED : TRACK_HEIGHT_DEFAULT }}
              >
                {trackClips.map(clip => {
                  const isSelected = selectedClipIds.has(clip.id);
                  const isHovered = hoveredClipId === clip.id;
                  const left = (clip.timelineStartFrame / 14400) * 100;
                  const width = (clip.durationFrames / 14400) * 100;

                  return (
                    <div
                      key={clip.id}
                      className={`absolute top-1 bottom-1 rounded border flex items-center px-2 cursor-pointer transition-all ${
                        isSelected
                          ? 'ring-2 ring-text-dark shadow-lg z-10'
                          : isHovered
                            ? 'shadow z-5'
                            : ''
                      } ${clip.isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor: `${track.color}20`,
                        borderColor: track.color,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleClipMouseDown(e, clip.id);
                      }}
                      onMouseEnter={() => setHoveredClipId(clip.id)}
                      onMouseLeave={() => setHoveredClipId(null)}
                    >
                      {/* Clip content */}
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold truncate block">
                          {clip.name}
                        </span>
                        {!track.isCollapsed && (
                          <span className="text-[10px] text-gray-500 font-mono">
                            {formatTimecode(clip.timelineStartFrame)} - {formatTimecode(clip.timelineStartFrame + clip.durationFrames)}
                          </span>
                        )}
                      </div>

                      {/* Resize handles */}
                      {isSelected && !clip.isLocked && (
                        <>
                          <div
                            className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-inherit hover:bg-accent-cyan/50 rounded-l"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setTrimmingClip({ clipId: clip.id, edge: 'left', startX: e.clientX });
                            }}
                          />
                          <div
                            className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-inherit hover:bg-accent-cyan/50 rounded-r"
                            onMouseDown={(e) => {
                              e.stopPropagation();
                              setTrimmingClip({ clipId: clip.id, edge: 'right', startX: e.clientX });
                            }}
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Playhead */}
          <div
            ref={playheadRef}
            className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-20 pointer-events-none"
            style={{ left: `${(currentFrame / 14400) * 100}%` }}
          >
            <div className="absolute -top-0 -left-1.5 w-3 h-3 bg-red-500 rounded-sm flex items-center justify-center">
              <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-red-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Status Bar */}
      <div className="shrink-0 bg-panel border-t border-border-light px-4 py-2 flex items-center justify-between text-xs text-gray-500">
        <div className="flex items-center gap-4">
          <span>Selected: {selectedClipIds.size} clip{selectedClipIds.size !== 1 ? 's' : ''}</span>
          <span>|</span>
          <span>Playback: {playbackRate}x</span>
          <span>|</span>
          <span>Snapping: {isSnapping ? 'On' : 'Off'}</span>
        </div>
        <div className="flex items-center gap-4">
          <span>FPS: {fps}</span>
          <span>|</span>
          <span className="font-mono">{formatTimecode(currentFrame)}</span>
        </div>
      </div>
    </div>
  );
}
