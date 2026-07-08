export type TrackType = 'video' | 'audio' | 'text' | 'subtitle' | 'effect' | 'overlay';

export interface TimelineEffect {
  id: string;
  type: 'transition' | 'opacity' | 'volume' | 'transform' | 'lut' | 'filter' | string;
  enabled: boolean;
  startOffset?: number;
  duration?: number;
  params: Record<string, unknown>;
}

export interface TimelineClip {
  id: string;
  sourceUrl: string;
  localPath?: string;
  startOffset: number;
  timelineStart: number;
  duration: number;
  playbackRate: number;
  effects: TimelineEffect[];
  transform?: { x: number; y: number; scaleX: number; scaleY: number; rotation: number };
  text?: { value: string; fontFamily: string; fontSize: number; color: string };
}

export interface TimelineTrack {
  id: string;
  name: string;
  type: TrackType;
  muted: boolean;
  locked: boolean;
  visible: boolean;
  zIndex: number;
  clips: TimelineClip[];
}

export interface Timeline {
  id: string;
  version: 1;
  fps: number;
  width: number;
  height: number;
  sampleRate: number;
  duration: number;
  tracks: TimelineTrack[];
  updatedAt: string;
}

export type TimelineAction =
  | { type: 'track/add'; track: TimelineTrack }
  | { type: 'clip/upsert'; trackId: string; clip: TimelineClip }
  | { type: 'clip/remove'; trackId: string; clipId: string }
  | { type: 'cursor/refresh' };

export function cloneTimeline(timeline: Timeline): Timeline {
  return JSON.parse(JSON.stringify(timeline));
}

export function reduceTimeline(current: Timeline, action: TimelineAction): Timeline {
  const next = cloneTimeline(current);
  if (action.type === 'track/add') next.tracks.push(cloneTimeline({ tracks: [action.track] } as any).tracks[0]);
  if (action.type === 'clip/upsert') {
    const track = next.tracks.find(t => t.id === action.trackId);
    if (!track || track.locked) return current;
    const idx = track.clips.findIndex(c => c.id === action.clip.id);
    if (idx >= 0) track.clips[idx] = action.clip; else track.clips.push(action.clip);
  }
  if (action.type === 'clip/remove') {
    const track = next.tracks.find(t => t.id === action.trackId);
    if (track && !track.locked) track.clips = track.clips.filter(c => c.id !== action.clipId);
  }
  next.duration = Math.max(0, ...next.tracks.flatMap(t => t.clips.map(c => c.timelineStart + c.duration)));
  next.updatedAt = new Date().toISOString();
  return next;
}
