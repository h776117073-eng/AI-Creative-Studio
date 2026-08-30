import type { IClip, IKeyframe, ITrack, ITimelineState } from './index.js';
import { findClip, sortTracks, recomputeDuration } from './editing.js';

export type AdvancedEditKind = 'move' | 'ripple-delete' | 'trim-start' | 'trim-end' | 'roll' | 'slip' | 'slide' | 'transition' | 'speed-curve' | 'keyframe';
export type SnapSource = 'frame' | 'playhead' | 'marker' | 'clip-start' | 'clip-end' | 'grid';
export interface SnapCandidate { time: number; source: SnapSource; distance: number }
export interface GroupMoveOptions { snap?: boolean; ripple?: boolean; magnetic?: boolean; fps?: number; tolerance?: number }
export interface AdvancedEditResult { changed: boolean; reason?: string; affectedClipIds: string[]; snappedTime?: number }
export interface SpeedPoint { id: string; time: number; speed: number; easing: 'linear' | 'ease-in' | 'ease-out' | 'bezier' }

const EPS = 1 / 100000;
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const uniq = (ids: Iterable<string>) => [...new Set(ids)];

export function frameDuration(fps: number): number { return 1 / Math.max(1, fps); }
export function quantizeFrame(time: number, fps: number): number {
  const f = Math.max(1, fps);
  return Math.max(0, Math.round(time * f) / f);
}

export function sourceDuration(clip: IClip): number {
  const candidate = clip.metadata?.sourceDuration;
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return Math.max(clip.trimEnd, candidate);
  return Math.max(clip.trimEnd, clip.trimStart + clip.duration);
}

export function collectSnapCandidates(state: ITimelineState, time: number, excludeIds: Set<string> = new Set(), fps = 30, includeGrid = true): SnapCandidate[] {
  const out: SnapCandidate[] = [{ time: quantizeFrame(time, fps), source: 'frame', distance: 0 }];
  const add = (t: number, source: SnapSource) => {
    if (!Number.isFinite(t)) return;
    out.push({ time: t, source, distance: Math.abs(t - time) });
  };
  add(state.currentTime, 'playhead');
  for (const marker of state.markers) add(marker.time, 'marker');
  for (const track of state.tracks) for (const clip of track.clips) if (!excludeIds.has(clip.id)) {
    add(clip.startTime, 'clip-start');
    add(clip.endTime, 'clip-end');
  }
  if (includeGrid) {
    const step = Math.max(frameDuration(fps), state.duration > 60 ? 1 : 0.5);
    const start = Math.max(0, Math.floor((time - 1) / step) * step);
    for (let t = start; t <= time + 1; t += step) add(Number(t.toFixed(6)), 'grid');
  }
  return out.sort((a, b) => a.distance - b.distance || snapPriority(a.source) - snapPriority(b.source));
}

export function snapPriority(source: SnapSource): number {
  return source === 'clip-start' ? 0 : source === 'clip-end' ? 1 : source === 'marker' ? 2 : source === 'playhead' ? 3 : source === 'frame' ? 4 : 5;
}

export function snapAdvanced(state: ITimelineState, time: number, tolerance: number, excludeIds: Set<string> = new Set(), fps = 30): SnapCandidate {
  const frame = quantizeFrame(time, fps);
  const candidates = collectSnapCandidates(state, time, excludeIds, fps);
  const best = candidates.find(c => c.distance <= tolerance);
  if (best) return best;
  return { time: frame, source: 'frame', distance: Math.abs(frame - time) };
}

export function linkedGroup(state: ITimelineState, rootIds: string[]): string[] {
  const result = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const track of state.tracks) for (const clip of track.clips) {
      const links = clip.linkedClipIds ?? [];
      if (result.has(clip.id) || links.some(id => result.has(id))) {
        for (const id of [clip.id, ...links]) if (!result.has(id)) { result.add(id); changed = true; }
      }
    }
  }
  return [...result];
}

export function moveGroup(state: ITimelineState, rootIds: string[], targetTrackId: string, deltaTime: number, options: GroupMoveOptions = {}): AdvancedEditResult {
  const ids = linkedGroup(state, rootIds);
  const moving = new Set(ids);
  const entries: Array<{ clip: IClip; track: ITrack }> = [];
  for (const track of state.tracks) for (const clip of track.clips) if (moving.has(clip.id)) entries.push({ clip, track });
  if (!entries.length) return { changed: false, reason: 'No clips selected', affectedClipIds: [] };
  const target = state.tracks.find(t => t.id === targetTrackId);
  if (!target || target.locked) return { changed: false, reason: 'Target track is locked or missing', affectedClipIds: [] };
  if (entries.some(e => e.track.locked)) return { changed: false, reason: 'A linked source track is locked', affectedClipIds: [] };

  const anchor = entries.slice().sort((a, b) => a.clip.startTime - b.clip.startTime)[0].clip;
  const snap = options.snap === false ? { time: anchor.startTime + deltaTime, source: 'frame' as SnapSource, distance: 0 } : snapAdvanced(state, anchor.startTime + deltaTime, options.tolerance ?? 0.033, moving, options.fps ?? 30);
  const effectiveDelta = Math.max(-anchor.startTime, snap.time - anchor.startTime);
  const candidateByTrack = new Map<string, IClip[]>();
  for (const entry of entries) {
    const next = structuredClone(entry.clip);
    next.startTime = Math.max(0, next.startTime + effectiveDelta);
    next.endTime = Math.max(next.startTime + 0.01, next.endTime + effectiveDelta);
    next.duration = next.endTime - next.startTime;
    const list = candidateByTrack.get(target.id) ?? [];
    list.push(next);
    candidateByTrack.set(target.id, list);
  }

  const stationary = target.clips.filter(c => !moving.has(c.id));
  const candidateClips = candidateByTrack.get(target.id) ?? [];
  if (!options.ripple && candidateClips.some(c => stationary.some(o => c.startTime < o.endTime - EPS && c.endTime > o.startTime + EPS))) {
    return { changed: false, reason: 'Move would collide with another clip', affectedClipIds: [] };
  }

  for (const track of state.tracks) track.clips = track.clips.filter(c => !moving.has(c.id));
  if (options.ripple || (options.magnetic && target.magnetic)) {
    const ordered = [...stationary, ...candidateClips].sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
    let cursor = 0;
    for (const clip of ordered) {
      if (clip.startTime < cursor) { const shift = cursor - clip.startTime; clip.startTime += shift; clip.endTime += shift; }
      cursor = clip.endTime;
    }
    target.clips.push(...ordered);
  } else {
    target.clips.push(...candidateClips);
  }
  sortTracks(state);
  recomputeDuration(state);
  return { changed: true, affectedClipIds: ids, snappedTime: snap.time };
}

export function rippleDeleteGroup(state: ITimelineState, rootIds: string[], rippleAllTracks = false): AdvancedEditResult {
  const ids = linkedGroup(state, rootIds);
  const removed: Array<{ clip: IClip; track: ITrack }> = [];
  for (const track of state.tracks) for (const clip of track.clips) if (ids.includes(clip.id)) removed.push({ clip, track });
  if (!removed.length) return { changed: false, reason: 'No clips found', affectedClipIds: [] };
  if (removed.some(x => x.track.locked)) return { changed: false, reason: 'A selected track is locked', affectedClipIds: [] };

  const anchor = removed.slice().sort((a, b) => a.clip.startTime - b.clip.startTime)[0];
  const gapStart = anchor.clip.startTime;
  const gapEnd = Math.max(...removed.filter(x => x.track.id === anchor.track.id).map(x => x.clip.endTime));
  const delta = Math.max(0, gapEnd - gapStart);
  const removedSet = new Set(ids);
  for (const track of state.tracks) {
    const trackRemoved = track.clips.some(c => removedSet.has(c.id));
    track.clips = track.clips.filter(c => !removedSet.has(c.id));
    if ((rippleAllTracks || track.id === anchor.track.id) && trackRemoved) {
      for (const clip of track.clips) if (clip.startTime >= gapEnd - EPS) {
        clip.startTime -= delta; clip.endTime -= delta;
      }
    }
  }
  sortTracks(state);
  recomputeDuration(state);
  return { changed: true, affectedClipIds: uniq([...ids, ...state.tracks.flatMap(t => t.clips.filter(c => c.startTime >= gapStart - EPS).map(c => c.id)]) };
}

export function rollEditAdvanced(state: ITimelineState, leftId: string, rightId: string, boundary: number, fps = 30): AdvancedEditResult {
  const leftFound = findClip(state, leftId), rightFound = findClip(state, rightId);
  if (!leftFound || !rightFound || leftFound[1].id !== rightFound[1].id) return { changed: false, reason: 'Roll requires adjacent clips on the same track', affectedClipIds: [] };
  const left = leftFound[0], right = rightFound[0];
  const originalBoundary = left.endTime;
  if (Math.abs(originalBoundary - right.startTime) > frameDuration(fps) * 1.5) return { changed: false, reason: 'Clips are not adjacent', affectedClipIds: [] };
  const sourceLeft = sourceDuration(left), sourceRight = sourceDuration(right);
  const delta = quantizeFrame(boundary, fps) - originalBoundary;
  const nextBoundary = originalBoundary + delta;
  const leftMax = sourceLeft - left.trimStart;
  const rightMaxBack = right.trimEnd - Math.max(0, right.trimStart - delta);
  if (nextBoundary <= left.startTime + 0.01 || nextBoundary >= right.endTime - 0.01) return { changed: false, reason: 'Boundary exceeds clip bounds', affectedClipIds: [] };
  if (delta > 0 && left.trimEnd + delta > sourceLeft + EPS) return { changed: false, reason: 'Left clip has no extra source media for roll', affectedClipIds: [] };
  if (delta < 0 && right.trimStart + delta < -EPS) return { changed: false, reason: 'Right clip has no earlier source media for roll', affectedClipIds: [] };
  if (left.trimStart + (left.duration + delta) > sourceLeft + EPS || right.trimEnd - delta > sourceRight + EPS) return { changed: false, reason: 'Source bounds exceeded', affectedClipIds: [] };
  void leftMax; void rightMaxBack;
  left.endTime = nextBoundary;
  left.duration = left.endTime - left.startTime;
  left.trimEnd += delta;
  right.startTime = nextBoundary;
  right.duration = right.endTime - right.startTime;
  right.trimStart += delta;
  sortTracks(state);
  recomputeDuration(state);
  return { changed: true, affectedClipIds: [leftId, rightId], snappedTime: nextBoundary };
}

export function slipEditAdvanced(clip: IClip, deltaSourceTime: number, fps = 30): AdvancedEditResult {
  const max = sourceDuration(clip);
  const nextStart = clamp(quantizeFrame(clip.trimStart + deltaSourceTime, fps), 0, max - 0.01);
  const window = clip.trimEnd - clip.trimStart;
  const nextEnd = nextStart + window;
  if (nextEnd > max + EPS) return { changed: false, reason: 'Slip exceeds source media', affectedClipIds: [clip.id] };
  if (Math.abs(nextStart - clip.trimStart) < EPS) return { changed: false, reason: 'No slip distance available', affectedClipIds: [clip.id] };
  clip.trimStart = nextStart; clip.trimEnd = nextEnd;
  return { changed: true, affectedClipIds: [clip.id] };
}

export function slideEditAdvanced(state: ITimelineState, clipId: string, deltaTime: number, fps = 30): AdvancedEditResult {
  const found = findClip(state, clipId);
  if (!found) return { changed: false, reason: 'Clip not found', affectedClipIds: [] };
  const [clip, track] = found;
  if (track.locked) return { changed: false, reason: 'Track is locked', affectedClipIds: [] };
  const peers = track.clips.filter(c => c.id !== clipId).sort((a, b) => a.startTime - b.startTime);
  const prev = [...peers].reverse().find(c => c.endTime <= clip.startTime + EPS);
  const next = peers.find(c => c.startTime >= clip.endTime - EPS);
  if (!prev || !next) return { changed: false, reason: 'Slide requires a clip on both sides', affectedClipIds: [] };
  const d = quantizeFrame(deltaTime, fps);
  if (d === 0) return { changed: false, reason: 'No slide distance', affectedClipIds: [] };
  const prevSource = sourceDuration(prev), nextSource = sourceDuration(next);
  const prevEnd = prev.trimEnd + d;
  const nextStart = next.trimStart + d;
  if (prevEnd <= prev.trimStart + 0.01 || prevEnd > prevSource + EPS) return { changed: false, reason: 'Previous clip source bounds exceeded', affectedClipIds: [] };
  if (nextStart < 0 || next.startTime + d <= 0.001 || nextStart > next.trimEnd - 0.01) return { changed: false, reason: 'Next clip source bounds exceeded', affectedClipIds: [] };
  clip.startTime += d; clip.endTime += d;
  prev.endTime += d; prev.duration = prev.endTime - prev.startTime; prev.trimEnd = prevEnd;
  next.startTime += d; next.duration = next.endTime - next.startTime; next.trimStart = nextStart;
  sortTracks(state); recomputeDuration(state);
  return { changed: true, affectedClipIds: [prev.id, clip.id, next.id] };
}

export function setSpeedCurve(clip: IClip, points: SpeedPoint[]): AdvancedEditResult {
  const normalized = points.map(p => ({ ...p, time: clamp(p.time, 0, clip.duration), speed: clamp(p.speed, 0.05, 16) }))
    .sort((a, b) => a.time - b.time)
    .filter((p, i, all) => i === 0 || Math.abs(p.time - all[i - 1].time) > EPS);
  if (!normalized.length) return { changed: false, reason: 'Speed curve is empty', affectedClipIds: [clip.id] };
  clip.metadata = { ...(clip.metadata ?? {}), speedCurve: normalized };
  return { changed: true, affectedClipIds: [clip.id] };
}

export function setTransition(state: ITimelineState, clipId: string, edge: 'in' | 'out', type: string, duration: number): AdvancedEditResult {
  const found = findClip(state, clipId);
  if (!found) return { changed: false, reason: 'Clip not found', affectedClipIds: [] };
  const [clip, track] = found;
  const d = clamp(duration, 0, Math.min(5, clip.duration * 0.5));
  if (edge === 'in') clip.transitionIn = d <= 0 ? undefined : { type, duration: d };
  else clip.transitionOut = d <= 0 ? undefined : { type, duration: d };
  return { changed: true, affectedClipIds: [clip.id, ...track.clips.filter(c => c.id !== clip.id && (c.startTime === clip.endTime || c.endTime === clip.startTime)).map(c => c.id)] };
}

export function addOrUpdateKeyframe(clip: IClip, keyframe: Omit<IKeyframe, 'id'> & { id?: string }): AdvancedEditResult {
  const id = keyframe.id ?? `kf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const next = { ...keyframe, id } as IKeyframe;
  const index = clip.keyframes.findIndex(k => k.property === next.property && Math.abs(k.time - next.time) < EPS);
  if (index >= 0) clip.keyframes[index] = next; else clip.keyframes.push(next);
  clip.keyframes.sort((a, b) => a.time - b.time || a.property.localeCompare(b.property));
  return { changed: true, affectedClipIds: [clip.id] };
}

export function enforceMagneticTrack(state: ITimelineState, trackId: string): AdvancedEditResult {
  const track = state.tracks.find(t => t.id === trackId);
  if (!track || !track.magnetic) return { changed: false, reason: 'Track is not magnetic', affectedClipIds: [] };
  const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
  let cursor = 0; const affected: string[] = [];
  for (const clip of sorted) {
    if (clip.startTime > cursor + EPS || clip.startTime < cursor - EPS) {
      const shift = cursor - clip.startTime;
      clip.startTime += shift; clip.endTime += shift; affected.push(clip.id);
    }
    cursor = clip.endTime;
  }
  track.clips = sorted; recomputeDuration(state);
  return { changed: affected.length > 0, affectedClipIds: affected };
}
