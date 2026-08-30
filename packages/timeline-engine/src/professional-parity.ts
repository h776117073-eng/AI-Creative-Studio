import type { IClip, ITrack, ITimelineState } from './index.js';
import { findClip, recomputeDuration, sortTracks } from './editing.js';
import { linkedGroup, quantizeFrame, sourceDuration } from './advanced-editing.js';

const EPS = 1e-5;
const MIN_DURATION = 1e-3;
export const MIN_CLIP_SPEED = 0.1;
export const MAX_CLIP_SPEED = 100;

export type TrackRole = 'main' | 'overlay' | 'audio' | 'text' | 'effect';
export type InsertMode = 'insert' | 'overwrite';
export interface RetimePoint { time: number; speed: number }
export interface EditWindow { start: number; end: number }
export interface ParityResult { changed: boolean; reason?: string; affectedClipIds: string[] }
type TrackWithMetadata = ITrack & { metadata?: Record<string, unknown> };
const durationOf = (clip: IClip) => Math.max(MIN_DURATION, clip.endTime - clip.startTime);
const updateDuration = (clip: IClip) => { clip.duration = Math.max(MIN_DURATION, clip.endTime - clip.startTime); };

export function clipSourceDuration(clip: IClip): number { return sourceDuration(clip); }
export function normalizeSpeed(speed: number): number { if (!Number.isFinite(speed)) return 1; return Math.max(MIN_CLIP_SPEED, Math.min(MAX_CLIP_SPEED, speed)); }

export function setClipSpeed(clip: IClip, speed: number, preservePitch = true): ParityResult {
  const next = normalizeSpeed(speed);
  if (Math.abs(next - clip.speed) < EPS && clip.metadata?.preservePitch === preservePitch) return { changed: false, reason: 'Speed already set', affectedClipIds: [clip.id] };
  clip.speed = next;
  clip.metadata = { ...(clip.metadata ?? {}), preservePitch, speedMode: 'constant' };
  return { changed: true, affectedClipIds: [clip.id] };
}

export function setSpeedCurveCapCutStyle(clip: IClip, points: RetimePoint[], fps = 30): ParityResult {
  if (!points.length) return { changed: false, reason: 'No speed points', affectedClipIds: [clip.id] };
  const normalized = points.map(p => ({ time: quantizeFrame(Math.max(0, p.time), fps), speed: normalizeSpeed(p.speed) }))
    .sort((a, b) => a.time - b.time || a.speed - b.speed)
    .filter((p, i, all) => i === 0 || Math.abs(p.time - all[i - 1].time) > EPS);
  const duration = durationOf(clip);
  for (const point of normalized) point.time = Math.min(point.time, duration);
  clip.metadata = { ...(clip.metadata ?? {}), speedMode: 'curve', speedCurve: normalized };
  return { changed: true, affectedClipIds: [clip.id] };
}

export function freezeFrame(state: ITimelineState, clipId: string, atTime?: number, fps = 30): ParityResult {
  const found = findClip(state, clipId);
  if (!found) return { changed: false, reason: 'Clip not found', affectedClipIds: [] };
  const [clip, track] = found;
  if (track.locked) return { changed: false, reason: 'Track is locked', affectedClipIds: [] };
  const local = atTime === undefined ? Math.max(0, Math.min(clip.duration, state.currentTime - clip.startTime)) : Math.max(0, Math.min(clip.duration, atTime));
  const frameTime = quantizeFrame(local, fps);
  const source = clip.trimStart + Math.min(frameTime * Math.max(0.01, clip.speed), clip.trimEnd - clip.trimStart);
  clip.metadata = { ...(clip.metadata ?? {}), speedMode: 'freeze', freezeFrameSourceTime: Math.min(source, clipSourceDuration(clip)), freezeFrameTimelineTime: frameTime };
  return { changed: true, affectedClipIds: [clip.id] };
}

function cloneLeftSegment(clip: IClip, end: number, fps: number): IClip {
  const result = structuredClone(clip);
  const ratio = clamp((end - clip.startTime) / durationOf(clip), 0, 1);
  result.endTime = Math.max(result.startTime + MIN_DURATION, quantizeFrame(end, fps));
  result.trimEnd = result.trimStart + (clip.trimEnd - clip.trimStart) * ratio;
  updateDuration(result);
  return result;
}

function cloneRightSegment(clip: IClip, start: number, fps: number): IClip {
  const result = structuredClone(clip);
  const ratio = clamp((start - clip.startTime) / durationOf(clip), 0, 1);
  result.startTime = Math.min(result.endTime - MIN_DURATION, quantizeFrame(start, fps));
  result.trimStart = clip.trimStart + (clip.trimEnd - clip.trimStart) * ratio;
  updateDuration(result);
  return result;
}

export function insertClipAt(state: ITimelineState, trackId: string, clip: IClip, startTime: number, mode: InsertMode = 'insert', fps = 30): ParityResult {
  const track = state.tracks.find(t => t.id === trackId);
  if (!track) return { changed: false, reason: 'Track not found', affectedClipIds: [] };
  if (track.locked) return { changed: false, reason: 'Track is locked', affectedClipIds: [] };
  const next = structuredClone(clip);
  const start = quantizeFrame(Math.max(0, startTime), fps);
  const duration = durationOf(next);
  const end = start + duration;
  const affected = new Set<string>([next.id]);

  if (mode === 'insert' || track.magnetic) {
    const rebuilt: IClip[] = [];
    for (const existing of track.clips) {
      if (existing.endTime <= start + EPS) { rebuilt.push(existing); continue; }
      if (existing.startTime < start - EPS && existing.endTime > start + EPS) {
        const left = cloneLeftSegment(existing, start, fps);
        const right = structuredClone(existing);
        const ratio = clamp((start - existing.startTime) / durationOf(existing), 0, 1);
        right.startTime = start + duration;
        right.endTime = existing.endTime + duration;
        right.trimStart = existing.trimStart + (existing.trimEnd - existing.trimStart) * ratio;
        updateDuration(right);
        rebuilt.push(left, right);
        affected.add(existing.id);
        continue;
      }
      existing.startTime += duration;
      existing.endTime += duration;
      affected.add(existing.id);
      rebuilt.push(existing);
    }
    track.clips = rebuilt;
  } else {
    const rebuilt: IClip[] = [];
    for (const existing of track.clips) {
      if (existing.endTime <= start + EPS || existing.startTime >= end - EPS) { rebuilt.push(existing); continue; }
      affected.add(existing.id);
      if (existing.startTime < start - EPS) rebuilt.push(cloneLeftSegment(existing, start, fps));
      if (existing.endTime > end + EPS) rebuilt.push(cloneRightSegment(existing, end, fps));
    }
    track.clips = rebuilt;
  }
  next.startTime = start; next.endTime = end; next.duration = duration;
  track.clips.push(next);
  sortTracks(state); recomputeDuration(state);
  return { changed: true, affectedClipIds: [...affected] };
}

export function liftRange(state: ITimelineState, trackIds: string[], window: EditWindow): ParityResult {
  const start = Math.max(0, window.start), end = Math.max(start, window.end);
  if (end <= start + EPS) return { changed: false, reason: 'Empty range', affectedClipIds: [] };
  const allowed = new Set(trackIds), removed: string[] = [];
  for (const track of state.tracks) {
    if (!allowed.has(track.id) || track.locked) continue;
    track.clips = track.clips.filter(clip => {
      if (clip.startTime >= start - EPS && clip.endTime <= end + EPS) { removed.push(clip.id); return false; }
      return true;
    });
  }
  sortTracks(state); recomputeDuration(state);
  return { changed: removed.length > 0, reason: removed.length ? undefined : 'No complete clips in range', affectedClipIds: removed };
}

export function extractRange(state: ITimelineState, trackIds: string[], window: EditWindow): ParityResult {
  const start = Math.max(0, window.start), end = Math.max(start, window.end);
  if (end <= start + EPS) return { changed: false, reason: 'Empty range', affectedClipIds: [] };
  const allowed = new Set(trackIds), removed: string[] = [];
  for (const track of state.tracks) {
    if (!allowed.has(track.id) || track.locked) continue;
    track.clips = track.clips.filter(clip => {
      const intersects = clip.endTime > start + EPS && clip.startTime < end - EPS;
      if (!intersects) { removed.push(clip.id); return false; }
      return true;
    });
  }
  sortTracks(state); recomputeDuration(state);
  return { changed: removed.length > 0, reason: removed.length ? undefined : 'Nothing outside range', affectedClipIds: removed };
}

export function rippleTrimLinked(state: ITimelineState, clipId: string, edge: 'start'|'end', newSourceTime: number, fps = 30): ParityResult {
  const found = findClip(state, clipId);
  if (!found) return { changed: false, reason: 'Clip not found', affectedClipIds: [] };
  const linkedIds = linkedGroup(state, [clipId]), selected = new Set(linkedIds), [clip, track] = found;
  if (track.locked) return { changed: false, reason: 'Track is locked', affectedClipIds: [] };
  const beforeDuration = clip.duration, value = quantizeFrame(newSourceTime, fps);
  if (edge === 'start') {
    const next = Math.max(0, Math.min(value, clip.trimEnd - MIN_DURATION)), delta = next - clip.trimStart, oldStart = clip.startTime;
    clip.trimStart = next; clip.startTime = Math.max(0, oldStart + delta); updateDuration(clip);
    for (const t of state.tracks) for (const c of t.clips) if (c.id !== clipId && c.startTime >= oldStart - EPS) { c.startTime += delta; c.endTime += delta; }
  } else {
    const next = Math.min(clipSourceDuration(clip), Math.max(clip.trimStart + MIN_DURATION, value)), oldEnd = clip.endTime;
    clip.trimEnd = next; clip.endTime = clip.startTime + (clip.trimEnd - clip.trimStart); updateDuration(clip);
    const delta = clip.duration - beforeDuration;
    if (delta) for (const t of state.tracks) for (const c of t.clips) if (c.id !== clipId && c.startTime >= oldEnd - EPS) { c.startTime += delta; c.endTime += delta; }
  }
  const deltaDuration = clip.duration - beforeDuration;
  if (Math.abs(deltaDuration) > EPS) for (const t of state.tracks) for (const c of t.clips) if (selected.has(c.id) && c.id !== clipId) {
    if (edge === 'end') c.endTime = Math.max(c.startTime + MIN_DURATION, c.endTime + deltaDuration);
    else { c.startTime = Math.max(0, c.startTime + deltaDuration); c.endTime = Math.max(c.startTime + MIN_DURATION, c.endTime + deltaDuration); }
    updateDuration(c);
  }
  sortTracks(state); recomputeDuration(state);
  return { changed: true, affectedClipIds: linkedIds };
}

export function validateTransitionPair(left: IClip, right: IClip, requestedDuration: number): number {
  const leftHandle = Math.max(0, clipSourceDuration(left) - left.trimEnd), rightHandle = Math.max(0, right.trimStart);
  const capacity = Math.max(0, Math.min(left.duration + leftHandle, right.duration + rightHandle) / 2);
  return Math.max(0, Math.min(requestedDuration, capacity));
}

export function assignTrackRole(track: ITrack, role: TrackRole): void {
  const target = track as TrackWithMetadata;
  target.metadata = { ...(target.metadata ?? {}), role };
  if (role === 'main') track.magnetic = true;
  if (role === 'audio') track.muted = false;
}

export function getTrackRole(track: ITrack): TrackRole {
  const role = (track as TrackWithMetadata).metadata?.role;
  if (role === 'main' || role === 'overlay' || role === 'audio' || role === 'text' || role === 'effect') return role;
  return track.type === 'audio' ? 'audio' : track.type === 'text' ? 'text' : track.type === 'effect' ? 'effect' : track.magnetic ? 'main' : 'overlay';
}

export function normalizeProfessionalTimeline(state: ITimelineState, fps = 30): ParityResult {
  let changed = false;
  for (const track of state.tracks) for (const clip of track.clips) {
    const start = quantizeFrame(Math.max(0, clip.startTime), fps), end = quantizeFrame(Math.max(start + MIN_DURATION, clip.endTime), fps);
    if (start !== clip.startTime || end !== clip.endTime) changed = true;
    clip.startTime = start; clip.endTime = Math.max(start + MIN_DURATION, end); updateDuration(clip);
    const speed = normalizeSpeed(clip.speed); if (speed !== clip.speed) { clip.speed = speed; changed = true; }
    if (clip.trimStart < 0) { clip.trimStart = 0; changed = true; }
    if (clip.trimEnd < clip.trimStart + MIN_DURATION) { clip.trimEnd = clip.trimStart + MIN_DURATION; changed = true; }
  }
  sortTracks(state); recomputeDuration(state); state.currentTime = Math.max(0, Math.min(state.currentTime, state.duration));
  return { changed, affectedClipIds: state.tracks.flatMap(t => t.clips.map(c => c.id)) };
}

export function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }
