import type { IClip, ITrack, ITimelineState } from './index';

export type EditMode = 'normal' | 'ripple';
export type SnapKind = 'clip-start' | 'clip-end' | 'marker' | 'playhead' | 'grid';
export type SnapTarget = { time: number; kind: SnapKind };
export type EditOperation = 'move' | 'trim-start' | 'trim-end' | 'roll' | 'slip' | 'slide';

export interface EditResult {
  changed: boolean;
  reason?: string;
  affectedClipIds: string[];
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function cloneTimelineState(state: ITimelineState): ITimelineState {
  return structuredClone(state);
}

export function collectSnapTargets(
  state: ITimelineState,
  excludeClipId?: string,
  includeGrid = true
): SnapTarget[] {
  const targets: SnapTarget[] = [{ time: state.currentTime, kind: 'playhead' }];

  if (includeGrid) {
    const step = 1 / 4;
    for (let t = 0; t <= state.duration + step; t += step) {
      targets.push({ time: Number(t.toFixed(6)), kind: 'grid' });
    }
  }

  for (const marker of state.markers) targets.push({ time: marker.time, kind: 'marker' });
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      if (clip.id === excludeClipId) continue;
      targets.push({ time: clip.startTime, kind: 'clip-start' });
      targets.push({ time: clip.endTime, kind: 'clip-end' });
    }
  }
  return targets.sort((a, b) => a.time - b.time);
}

export function snapTime(
  time: number,
  state: ITimelineState,
  tolerance: number,
  excludeClipId?: string
): number {
  let best = time;
  let distance = Math.max(0, tolerance);
  for (const target of collectSnapTargets(state, excludeClipId)) {
    const d = Math.abs(target.time - time);
    if (d <= distance) {
      best = target.time;
      distance = d;
    }
  }
  return best;
}

export function hasCollision(track: ITrack, clipId: string, start: number, end: number): boolean {
  return track.clips.some(c => c.id !== clipId && start < c.endTime && end > c.startTime);
}

export function sortTracks(state: ITimelineState): void {
  for (const track of state.tracks) track.clips.sort((a, b) => a.startTime - b.startTime);
}

export function recomputeDuration(state: ITimelineState): number {
  state.duration = state.tracks.reduce(
    (max, track) => Math.max(max, ...track.clips.map(c => c.endTime), 0),
    0
  );
  return state.duration;
}

export function moveClip(
  state: ITimelineState,
  clipId: string,
  targetTrackId: string,
  targetStart: number,
  options?: { ripple?: boolean; snap?: boolean; tolerance?: number }
): EditResult {
  const source = findClip(state, clipId);
  const targetTrack = state.tracks.find(t => t.id === targetTrackId);
  if (!source || !targetTrack) return { changed: false, reason: 'Clip or track not found', affectedClipIds: [] };
  if (targetTrack.locked) return { changed: false, reason: 'Target track is locked', affectedClipIds: [] };

  const [clip, sourceTrack] = source;
  const duration = Math.max(0.01, clip.endTime - clip.startTime);
  let start = Math.max(0, targetStart);
  if (options?.snap) start = snapTime(start, state, options.tolerance ?? 0.033, clipId);

  const affected = [clipId];
  if (sourceTrack.id !== targetTrack.id) {
    sourceTrack.clips = sourceTrack.clips.filter(c => c.id !== clipId);
    targetTrack.clips.push(clip);
  }

  if (options?.ripple) {
    const ordered = targetTrack.clips.filter(c => c.id !== clipId).sort((a, b) => a.startTime - b.startTime);
    let cursor = start + duration;
    for (const other of ordered) {
      if (other.startTime >= start && other.startTime < cursor) {
        const delta = cursor - other.startTime;
        other.startTime += delta;
        other.endTime += delta;
        affected.push(other.id);
        cursor = other.endTime;
      }
    }
  } else if (hasCollision(targetTrack, clipId, start, start + duration)) {
    return { changed: false, reason: 'Collision with another clip', affectedClipIds: [] };
  }

  clip.startTime = start;
  clip.endTime = start + duration;
  clip.duration = duration;
  sortTracks(state);
  recomputeDuration(state);
  return { changed: true, affectedClipIds: affected };
}

export function rippleDelete(state: ITimelineState, trackId: string, clipId: string): EditResult {
  const track = state.tracks.find(t => t.id === trackId);
  if (!track || track.locked) return { changed: false, reason: 'Track missing or locked', affectedClipIds: [] };
  const index = track.clips.findIndex(c => c.id === clipId);
  if (index < 0) return { changed: false, reason: 'Clip not found', affectedClipIds: [] };
  const removed = track.clips[index];
  const delta = removed.endTime - removed.startTime;
  track.clips.splice(index, 1);
  const affected: string[] = [];
  for (const clip of track.clips) {
    if (clip.startTime >= removed.endTime) {
      clip.startTime -= delta;
      clip.endTime -= delta;
      affected.push(clip.id);
    }
  }
  recomputeDuration(state);
  return { changed: true, affectedClipIds: [clipId, ...affected] };
}

export function rippleTrim(
  state: ITimelineState,
  clipId: string,
  edge: 'start' | 'end',
  newSourceTime: number,
  ripple = true
): EditResult {
  const found = findClip(state, clipId);
  if (!found) return { changed: false, reason: 'Clip not found', affectedClipIds: [] };
  const [clip, track] = found;
  if (track.locked) return { changed: false, reason: 'Track is locked', affectedClipIds: [] };

  const oldStart = clip.startTime;
  const oldEnd = clip.endTime;
  if (edge === 'start') {
    const delta = newSourceTime - clip.trimStart;
    const maxDelta = clip.endTime - clip.startTime - 0.01;
    const boundedDelta = clamp(delta, -clip.trimStart, maxDelta);
    clip.trimStart += boundedDelta;
    clip.startTime += boundedDelta;
    clip.duration = clip.endTime - clip.startTime;
    if (ripple && boundedDelta < 0) {
      for (const other of track.clips) if (other.id !== clipId && other.startTime >= oldStart) {
        other.startTime += boundedDelta;
        other.endTime += boundedDelta;
      }
    }
  } else {
    const nextTrimEnd = Math.max(clip.trimStart + 0.01, newSourceTime);
    const oldDuration = clip.endTime - clip.startTime;
    clip.trimEnd = nextTrimEnd;
    clip.endTime = clip.startTime + (clip.trimEnd - clip.trimStart);
    clip.duration = clip.endTime - clip.startTime;
    const delta = clip.endTime - oldEnd;
    if (ripple && delta !== 0) {
      for (const other of track.clips) if (other.id !== clipId && other.startTime >= oldEnd) {
        other.startTime += delta;
        other.endTime += delta;
      }
    }
    if (oldDuration <= 0) clip.duration = 0.01;
  }

  sortTracks(state);
  recomputeDuration(state);
  return { changed: true, affectedClipIds: track.clips.map(c => c.id) };
}

export function rollEdit(
  state: ITimelineState,
  leftClipId: string,
  rightClipId: string,
  newBoundary: number
): EditResult {
  const leftFound = findClip(state, leftClipId);
  const rightFound = findClip(state, rightClipId);
  if (!leftFound || !rightFound || leftFound[1].id !== rightFound[1].id) {
    return { changed: false, reason: 'Roll requires adjacent clips on the same track', affectedClipIds: [] };
  }
  const [left] = leftFound;
  const [right] = rightFound;
  if (Math.abs(left.endTime - right.startTime) > 0.05) {
    return { changed: false, reason: 'Clips must share a boundary', affectedClipIds: [] };
  }
  const min = left.startTime + 0.01;
  const max = right.endTime - 0.01;
  const boundary = clamp(newBoundary, min, max);
  left.endTime = boundary;
  left.duration = boundary - left.startTime;
  right.startTime = boundary;
  right.duration = right.endTime - boundary;
  sortTracks(state);
  recomputeDuration(state);
  return { changed: true, affectedClipIds: [leftClipId, rightClipId] };
}

export function slipEdit(
  clip: IClip,
  deltaSourceTime: number,
  sourceDuration: number
): EditResult {
  const availableBefore = clip.trimStart;
  const availableAfter = Math.max(0, sourceDuration - clip.trimEnd);
  const delta = clamp(deltaSourceTime, -availableBefore, availableAfter);
  if (delta === 0) return { changed: false, reason: 'No available source media in requested direction', affectedClipIds: [] };
  clip.trimStart += delta;
  clip.trimEnd += delta;
  return { changed: true, affectedClipIds: [clip.id] };
}

export function slideEdit(
  state: ITimelineState,
  clipId: string,
  deltaTime: number,
  snap = true,
  tolerance = 0.033
): EditResult {
  const found = findClip(state, clipId);
  if (!found) return { changed: false, reason: 'Clip not found', affectedClipIds: [] };
  const [clip, track] = found;
  const peers = track.clips.filter(c => c.id !== clipId).sort((a, b) => a.startTime - b.startTime);
  const index = peers.findIndex(c => c.startTime > clip.startTime);
  const next = index >= 0 ? peers[index] : undefined;
  const prev = [...peers].reverse().find(c => c.endTime <= clip.startTime);
  if (!prev || !next) return { changed: false, reason: 'Slide requires adjacent clips on both sides', affectedClipIds: [] };

  let start = clip.startTime + deltaTime;
  if (snap) start = snapTime(start, state, tolerance, clipId);
  const delta = start - clip.startTime;
  const newPrevEnd = prev.endTime + delta;
  const newNextStart = next.startTime + delta;
  if (newPrevEnd < prev.startTime + 0.01 || newNextStart > next.endTime - 0.01) {
    return { changed: false, reason: 'Slide exceeds neighboring media', affectedClipIds: [] };
  }

  clip.startTime += delta;
  clip.endTime += delta;
  prev.endTime += delta;
  prev.duration = prev.endTime - prev.startTime;
  next.startTime += delta;
  next.duration = next.endTime - next.startTime;
  sortTracks(state);
  recomputeDuration(state);
  return { changed: true, affectedClipIds: [prev.id, clip.id, next.id] };
}

export function findClip(state: ITimelineState, clipId: string): [IClip, ITrack] | null {
  for (const track of state.tracks) {
    const clip = track.clips.find(c => c.id === clipId);
    if (clip) return [clip, track];
  }
  return null;
}
