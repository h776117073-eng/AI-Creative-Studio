import type { IClip, IKeyframe, ITrack, ITimelineState } from './index.js';
import { findClip, sortTracks, recomputeDuration } from './editing.js';

export type AdvancedEditKind = 'move' | 'ripple-delete' | 'trim-start' | 'trim-end' | 'roll' | 'slip' | 'slide' | 'transition' | 'speed-curve' | 'keyframe';
export type SnapSource = 'frame' | 'playhead' | 'marker' | 'clip-start' | 'clip-end' | 'grid';
export interface SnapCandidate { time: number; source: SnapSource; distance: number }
export interface GroupMoveOptions { snap?: boolean; ripple?: boolean; magnetic?: boolean; fps?: number; tolerance?: number }
export interface AdvancedEditResult { changed: boolean; reason?: string; affectedClipIds: string[]; snappedTime?: number }
export interface SpeedPoint { id: string; time: number; speed: number; easing: 'linear' | 'ease-in' | 'ease-out' | 'bezier' }

const EPS = 1e-5;
const MIN_DURATION = 0.01;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const uniq = (ids: Iterable<string>) => [...new Set(ids)];

export function frameDuration(fps: number): number { return 1 / Math.max(1, fps); }
export function quantizeFrame(time: number, fps: number): number {
  const f = Math.max(1, fps);
  return Math.max(0, Math.round(time * f) / f);
}

export function sourceDuration(clip: IClip): number {
  const candidate = clip.metadata?.sourceDuration;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return Math.max(candidate, clip.trimEnd);
  return Math.max(clip.trimEnd, clip.trimStart + clip.duration);
}

export function collectSnapCandidates(
  state: ITimelineState,
  time: number,
  excludeIds: Set<string> = new Set(),
  fps = 30,
  includeGrid = true,
): SnapCandidate[] {
  const out: SnapCandidate[] = [{ time: quantizeFrame(time, fps), source: 'frame', distance: Math.abs(quantizeFrame(time, fps) - time) }];
  const add = (candidateTime: number, source: SnapSource) => {
    if (!Number.isFinite(candidateTime)) return;
    out.push({ time: candidateTime, source, distance: Math.abs(candidateTime - time) });
  };
  add(state.currentTime, 'playhead');
  for (const marker of state.markers) add(marker.time, 'marker');
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      if (excludeIds.has(clip.id)) continue;
      add(clip.startTime, 'clip-start');
      add(clip.endTime, 'clip-end');
    }
  }
  if (includeGrid) {
    const step = state.duration > 60 ? 1 : 0.5;
    const start = Math.max(0, Math.floor((time - 1) / step) * step);
    for (let t = start; t <= time + 1 + EPS; t += step) add(Number(t.toFixed(6)), 'grid');
  }
  return out.sort((a, b) => a.distance - b.distance || snapPriority(a.source) - snapPriority(b.source));
}

export function snapPriority(source: SnapSource): number {
  switch (source) {
    case 'clip-start': return 0;
    case 'clip-end': return 1;
    case 'marker': return 2;
    case 'playhead': return 3;
    case 'frame': return 4;
    default: return 5;
  }
}

export function snapAdvanced(
  state: ITimelineState,
  time: number,
  tolerance: number,
  excludeIds: Set<string> = new Set(),
  fps = 30,
): SnapCandidate {
  const frame = quantizeFrame(time, fps);
  const best = collectSnapCandidates(state, time, excludeIds, fps, true).find(c => c.distance <= Math.max(0, tolerance));
  return best ?? { time: frame, source: 'frame', distance: Math.abs(frame - time) };
}

export function linkedGroup(state: ITimelineState, rootIds: string[]): string[] {
  const result = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const track of state.tracks) {
      for (const clip of track.clips) {
        if (!result.has(clip.id) && !(clip.linkedClipIds ?? []).some(id => result.has(id))) continue;
        for (const id of [clip.id, ...(clip.linkedClipIds ?? [])]) {
          if (!result.has(id)) {
            result.add(id);
            changed = true;
          }
        }
      }
    }
  }
  return [...result];
}

function findEntries(state: ITimelineState, ids: Set<string>): Array<{ clip: IClip; track: ITrack }> {
  const out: Array<{ clip: IClip; track: ITrack }> = [];
  for (const track of state.tracks) for (const clip of track.clips) if (ids.has(clip.id)) out.push({ clip, track });
  return out;
}

function shiftClip(clip: IClip, delta: number): void {
  clip.startTime = Math.max(0, clip.startTime + delta);
  clip.endTime = Math.max(clip.startTime + MIN_DURATION, clip.endTime + delta);
  clip.duration = clip.endTime - clip.startTime;
}

function pushOverlaps(track: ITrack, movingIds: Set<string>, inserted: IClip[]): void {
  const ordered = [...track.clips.filter(c => !movingIds.has(c.id)), ...inserted]
    .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  let previousEnd = -Infinity;
  for (const clip of ordered) {
    if (previousEnd !== -Infinity && clip.startTime < previousEnd) shiftClip(clip, previousEnd - clip.startTime);
    previousEnd = Math.max(previousEnd, clip.endTime);
  }
  track.clips = ordered;
}

export function moveGroup(
  state: ITimelineState,
  rootIds: string[],
  targetTrackId: string,
  deltaTime: number,
  options: GroupMoveOptions = {},
): AdvancedEditResult {
  const ids = linkedGroup(state, rootIds);
  const moving = new Set(ids);
  const entries = findEntries(state, moving);
  if (!entries.length) return { changed: false, reason: 'No clips selected', affectedClipIds: [] };

  const target = state.tracks.find(t => t.id === targetTrackId);
  if (!target || target.locked) return { changed: false, reason: 'Target track is locked or missing', affectedClipIds: [] };
  if (entries.some(e => e.track.locked)) return { changed: false, reason: 'A linked source track is locked', affectedClipIds: [] };

  const anchorId = rootIds.find(id => entries.some(e => e.clip.id === id)) ?? entries[0].clip.id;
  const anchorEntry = entries.find(e => e.clip.id === anchorId) ?? entries[0];
  const rawAnchor = anchorEntry.clip.startTime + deltaTime;
  const snapped = options.snap === false
    ? { time: Math.max(0, rawAnchor), source: 'frame' as SnapSource, distance: 0 }
    : snapAdvanced(state, rawAnchor, options.tolerance ?? 0.033, moving, options.fps ?? 30);
  const effectiveDelta = Math.max(-anchorEntry.clip.startTime, snapped.time - anchorEntry.clip.startTime);

  const targetIds = new Set<string>();
  for (const entry of entries) {
    if (entry.track.id === anchorEntry.track.id || entry.clip.id === anchorEntry.clip.id) targetIds.add(entry.clip.id);
  }
  const movingByTrack = new Map<string, Set<string>>();
  for (const entry of entries) {
    const set = movingByTrack.get(entry.track.id) ?? new Set<string>();
    set.add(entry.clip.id);
    movingByTrack.set(entry.track.id, set);
  }

  const pendingByTrack = new Map<string, IClip[]>();
  for (const entry of entries) {
    const next = structuredClone(entry.clip);
    shiftClip(next, effectiveDelta);
    const destination = targetIds.has(entry.clip.id) ? target : entry.track;
    const list = pendingByTrack.get(destination.id) ?? [];
    list.push(next);
    pendingByTrack.set(destination.id, list);
  }

  for (const [trackId, pending] of pendingByTrack) {
    const track = state.tracks.find(t => t.id === trackId)!;
    const movingIds = movingByTrack.get(trackId) ?? new Set<string>();
    const stationary = track.clips.filter(c => !moving.has(c.id));
    const internalCollision = pending.some(c => pending.some(o => o.id !== c.id && c.startTime < o.endTime - EPS && c.endTime > o.startTime + EPS));
    if (internalCollision) return { changed: false, reason: 'Selected clips would overlap each other', affectedClipIds: [] };
    const externalCollision = pending.some(c => stationary.some(o => c.startTime < o.endTime - EPS && c.endTime > o.startTime + EPS));
    if (externalCollision && !(options.ripple || (options.magnetic && track.magnetic))) {
      return { changed: false, reason: 'Move would collide with another clip', affectedClipIds: [] };
    }
    track.clips = stationary;
    if (options.ripple || (options.magnetic && track.magnetic)) pushOverlaps(track, movingIds, pending);
    else track.clips.push(...pending);
  }

  sortTracks(state);
  recomputeDuration(state);
  return { changed: true, affectedClipIds: ids, snappedTime: snapped.time };
}

export function rippleDeleteGroup(state: ITimelineState, rootIds: string[], rippleAllTracks = false): AdvancedEditResult {
  const ids = linkedGroup(state, rootIds);
  const removed = findEntries(state, new Set(ids));
  if (!removed.length) return { changed: false, reason: 'No clips found', affectedClipIds: [] };
  if (removed.some(e => e.track.locked)) return { changed: false, reason: 'A selected track is locked', affectedClipIds: [] };

  const byTrack = new Map<string, Array<{ clip: IClip; track: ITrack }>>();
  for (const item of removed) (byTrack.get(item.track.id) ?? byTrack.set(item.track.id, []).get(item.track.id)!).push(item);

  const anchor = removed.slice().sort((a, b) => a.clip.startTime - b.clip.startTime || a.clip.endTime - b.clip.endTime)[0];
  const anchorTrackRemoved = (byTrack.get(anchor.track.id) ?? []).sort((a, b) => a.clip.startTime - b.clip.startTime);
  const gapStart = anchorTrackRemoved[0]?.clip.startTime ?? anchor.clip.startTime;
  const gapEnd = Math.max(...anchorTrackRemoved.map(e => e.clip.endTime));
  const delta = Math.max(MIN_DURATION, gapEnd - gapStart);
  const removedIds = new Set(ids);

  for (const track of state.tracks) {
    track.clips = track.clips.filter(c => !removedIds.has(c.id));
    if (rippleAllTracks || track.id === anchor.track.id) {
      for (const clip of track.clips) {
        if (clip.startTime >= gapEnd - EPS) shiftClip(clip, -delta);
      }
    }
  }
  sortTracks(state);
  recomputeDuration(state);
  return { changed: true, affectedClipIds: ids };
}

export function rollEditAdvanced(state: ITimelineState, leftId: string, rightId: string, boundary: number, fps = 30): AdvancedEditResult {
  const leftFound = findClip(state, leftId);
  const rightFound = findClip(state, rightId);
  if (!leftFound || !rightFound || leftFound[1].id !== rightFound[1].id) {
    return { changed: false, reason: 'Roll requires adjacent clips on the same track', affectedClipIds: [] };
  }
  const left = leftFound[0], right = rightFound[0];
  if (Math.abs(left.endTime - right.startTime) > frameDuration(fps) * 1.5) {
    return { changed: false, reason: 'Clips are not adjacent', affectedClipIds: [] };
  }
  const nextBoundary = quantizeFrame(boundary, fps);
  const minBoundary = left.startTime + MIN_DURATION;
  const maxBoundary = right.endTime - MIN_DURATION;
  if (nextBoundary <= minBoundary || nextBoundary >= maxBoundary) {
    return { changed: false, reason: 'Boundary exceeds clip bounds', affectedClipIds: [] };
  }

  const delta = nextBoundary - left.endTime;
  if (delta > 0 && left.trimEnd + delta > sourceDuration(left) + EPS) {
    return { changed: false, reason: 'Left clip has no additional source media', affectedClipIds: [] };
  }
  if (delta < 0 && right.trimStart + delta < -EPS) {
    return { changed: false, reason: 'Right clip has no earlier source media', affectedClipIds: [] };
  }
  const leftNewDuration = left.duration + delta;
  const rightNewDuration = right.duration - delta;
  if (leftNewDuration <= MIN_DURATION || rightNewDuration <= MIN_DURATION) {
    return { changed: false, reason: 'Roll would make a clip too short', affectedClipIds: [] };
  }

  left.endTime = nextBoundary;
  left.duration = leftNewDuration;
  left.trimEnd += delta;
  right.startTime = nextBoundary;
  right.duration = rightNewDuration;
  right.trimStart += delta;
  sortTracks(state);
  recomputeDuration(state);
  return { changed: true, affectedClipIds: [leftId, rightId], snappedTime: nextBoundary };
}

export function slipEditAdvanced(clip: IClip, deltaSourceTime: number, fps = 30): AdvancedEditResult {
  const window = clip.trimEnd - clip.trimStart;
  if (window <= MIN_DURATION) return { changed: false, reason: 'Clip source window is empty', affectedClipIds: [clip.id] };
  const maxStart = Math.max(0, sourceDuration(clip) - window);
  const nextStart = clamp(quantizeFrame(clip.trimStart + deltaSourceTime, fps), 0, maxStart);
  if (Math.abs(nextStart - clip.trimStart) < EPS) return { changed: false, reason: 'No slip distance available', affectedClipIds: [clip.id] };
  clip.trimStart = nextStart;
  clip.trimEnd = nextStart + window;
  return { changed: true, affectedClipIds: [clip.id] };
}

export function slideEditAdvanced(state: ITimelineState, clipId: string, deltaTime: number, fps = 30): AdvancedEditResult {
  const found = findClip(state, clipId);
  if (!found) return { changed: false, reason: 'Clip not found', affectedClipIds: [] };
  const [clip, track] = found;
  if (track.locked) return { changed: false, reason: 'Track is locked', affectedClipIds: [] };

  const peers = track.clips.filter(c => c.id !== clip.id).sort((a, b) => a.startTime - b.startTime);
  const prev = [...peers].reverse().find(c => c.endTime <= clip.startTime + EPS);
  const next = peers.find(c => c.startTime >= clip.endTime - EPS);
  if (!prev || !next) return { changed: false, reason: 'Slide requires a clip on both sides', affectedClipIds: [] };

  const d = quantizeFrame(deltaTime, fps);
  if (Math.abs(d) < EPS) return { changed: false, reason: 'No slide distance', affectedClipIds: [] };
  const prevSource = sourceDuration(prev);
  const nextSource = sourceDuration(next);
  const prevTrimEnd = prev.trimEnd + d;
  const nextTrimStart = next.trimStart + d;
  if (prevTrimEnd <= prev.trimStart + MIN_DURATION || prevTrimEnd > prevSource + EPS) {
    return { changed: false, reason: 'Previous clip source bounds exceeded', affectedClipIds: [] };
  }
  if (nextTrimStart < -EPS || nextTrimStart + (next.trimEnd - next.trimStart) > nextSource + EPS) {
    return { changed: false, reason: 'Next clip source bounds exceeded', affectedClipIds: [] };
  }
  if (clip.startTime + d < -EPS) return { changed: false, reason: 'Slide would move before timeline start', affectedClipIds: [] };

  shiftClip(clip, d);
  prev.endTime += d;
  prev.duration = prev.endTime - prev.startTime;
  prev.trimEnd = prevTrimEnd;
  next.startTime += d;
  next.duration = next.endTime - next.startTime;
  next.trimStart = nextTrimStart;
  sortTracks(state);
  recomputeDuration(state);
  return { changed: true, affectedClipIds: [prev.id, clip.id, next.id] };
}

export function setSpeedCurve(clip: IClip, points: SpeedPoint[]): AdvancedEditResult {
  const normalized = points
    .map(p => ({ ...p, time: clamp(p.time, 0, clip.duration), speed: clamp(p.speed, 0.05, 16) }))
    .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
    .filter((p, i, all) => i === 0 || Math.abs(p.time - all[i - 1].time) > EPS);
  if (!normalized.length) return { changed: false, reason: 'Speed curve is empty', affectedClipIds: [clip.id] };
  clip.metadata = { ...(clip.metadata ?? {}), speedCurve: normalized };
  return { changed: true, affectedClipIds: [clip.id] };
}

export function setTransition(
  state: ITimelineState,
  clipId: string,
  edge: 'in' | 'out',
  type: string,
  duration: number,
): AdvancedEditResult {
  const found = findClip(state, clipId);
  if (!found) return { changed: false, reason: 'Clip not found', affectedClipIds: [] };
  const [clip, track] = found;
  if (track.locked) return { changed: false, reason: 'Track is locked', affectedClipIds: [] };
  const maxDuration = Math.min(5, clip.duration * 0.5);
  const d = clamp(duration, 0, maxDuration);
  const value = d <= 0 ? undefined : { type, duration: d };
  if (edge === 'in') clip.transitionIn = value;
  else clip.transitionOut = value;
  const adjacent = track.clips.filter(c => c.id !== clip.id && (Math.abs(c.startTime - clip.endTime) < EPS || Math.abs(c.endTime - clip.startTime) < EPS));
  return { changed: true, affectedClipIds: [clip.id, ...adjacent.map(c => c.id)] };
}

export function addOrUpdateKeyframe(clip: IClip, keyframe: Omit<IKeyframe, 'id'> & { id?: string }): AdvancedEditResult {
  const id = keyframe.id ?? `kf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const next = { ...keyframe, id } as IKeyframe;
  const index = clip.keyframes.findIndex(k => k.property === next.property && Math.abs(k.time - next.time) < EPS);
  if (index >= 0) clip.keyframes[index] = next;
  else clip.keyframes.push(next);
  clip.keyframes.sort((a, b) => a.time - b.time || a.property.localeCompare(b.property));
  return { changed: true, affectedClipIds: [clip.id] };
}

export function enforceMagneticTrack(state: ITimelineState, trackId: string): AdvancedEditResult {
  const track = state.tracks.find(t => t.id === trackId);
  if (!track || !track.magnetic) return { changed: false, reason: 'Track is not magnetic', affectedClipIds: [] };
  const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
  let cursor = sorted[0]?.startTime ?? 0;
  const affected: string[] = [];
  for (const clip of sorted) {
    if (clip.startTime > cursor + EPS) {
      shiftClip(clip, cursor - clip.startTime);
      affected.push(clip.id);
    } else if (clip.startTime < cursor - EPS) {
      shiftClip(clip, cursor - clip.startTime);
      affected.push(clip.id);
    }
    cursor = clip.endTime;
  }
  track.clips = sorted;
  recomputeDuration(state);
  return { changed: affected.length > 0, affectedClipIds: affected };
}
