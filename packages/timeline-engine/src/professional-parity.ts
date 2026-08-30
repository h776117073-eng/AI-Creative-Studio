import type { IClip, ITrack, ITimelineState } from './index.js';
import { findClip, recomputeDuration, sortTracks } from './editing.js';
import { linkedGroup, quantizeFrame, sourceDuration } from './advanced-editing.js';

const EPS = 1e-5;
const MIN_DURATION = 1e-3;
export const MIN_CLIP_SPEED = 0.1;
export const MAX_CLIP_SPEED = 100;

export type TrackRole = 'main' | 'overlay' | 'audio' | 'text' | 'effect';
export type InsertMode = 'insert' | 'overwrite';

export interface RetimePoint {
  time: number;
  speed: number;
}

export interface EditWindow {
  start: number;
  end: number;
}

export interface ParityResult {
  changed: boolean;
  reason?: string;
  affectedClipIds: string[];
}

export function clipSourceDuration(clip: IClip): number {
  return sourceDuration(clip);
}

export function normalizeSpeed(speed: number): number {
  if (!Number.isFinite(speed)) return 1;
  return Math.max(MIN_CLIP_SPEED, Math.min(MAX_CLIP_SPEED, speed));
}

export function setClipSpeed(clip: IClip, speed: number, preservePitch = true): ParityResult {
  const next = normalizeSpeed(speed);
  if (Math.abs(next - clip.speed) < EPS && clip.metadata?.preservePitch === preservePitch) {
    return { changed: false, reason: 'Speed already set', affectedClipIds: [clip.id] };
  }
  clip.speed = next;
  clip.metadata = { ...(clip.metadata ?? {}), preservePitch, speedMode: 'constant' };
  return { changed: true, affectedClipIds: [clip.id] };
}

export function setSpeedCurveCapCutStyle(clip: IClip, points: RetimePoint[], fps = 30): ParityResult {
  if (!points.length) return { changed: false, reason: 'No speed points', affectedClipIds: [clip.id] };
  const normalized = points
    .map(p => ({ time: quantizeFrame(Math.max(0, p.time), fps), speed: normalizeSpeed(p.speed) }))
    .sort((a, b) => a.time - b.time || a.speed - b.speed)
    .filter((p, i, all) => i === 0 || Math.abs(p.time - all[i - 1].time) > EPS);
  const duration = Math.max(MIN_DURATION, clip.duration);
  for (const point of normalized) point.time = Math.min(point.time, duration);
  clip.metadata = {
    ...(clip.metadata ?? {}),
    speedMode: 'curve',
    speedCurve: normalized,
  };
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
  clip.metadata = {
    ...(clip.metadata ?? {}),
    speedMode: 'freeze',
    freezeFrameSourceTime: Math.min(source, clipSourceDuration(clip)),
    freezeFrameTimelineTime: frameTime,
  };
  return { changed: true, affectedClipIds: [clip.id] };
}

export function insertClipAt(state: ITimelineState, trackId: string, clip: IClip, startTime: number, mode: InsertMode = 'insert', fps = 30): ParityResult {
  const track = state.tracks.find(t => t.id === trackId);
  if (!track) return { changed: false, reason: 'Track not found', affectedClipIds: [] };
  if (track.locked) return { changed: false, reason: 'Track is locked', affectedClipIds: [] };
  const next = structuredClone(clip);
  const start = quantizeFrame(Math.max(0, startTime), fps);
  const duration = Math.max(MIN_DURATION, next.duration);
  if (mode === 'insert' || track.magnetic) {
    for (const existing of track.clips) {
      if (existing.startTime >= start - EPS) {
        existing.startTime += duration;
        existing.endTime += duration;
      } else if (existing.startTime < start && existing.endTime > start) {
        const delta = existing.endTime - start;
        existing.startTime += duration;
        existing.endTime += duration;
        if (delta > 0) existing.metadata = { ...(existing.metadata ?? {}), splitByInsert: true };
      }
    }
  }
  if (mode === 'overwrite') {
    const end = start + duration;
    track.clips = track.clips.filter(existing => existing.endTime <= start + EPS || existing.startTime >= end - EPS);
    for (const existing of track.clips) {
      if (existing.startTime < start && existing.endTime > start) existing.endTime = start;
      if (existing.startTime < end && existing.endTime > end) existing.startTime = end;
      existing.duration = Math.max(MIN_DURATION, existing.endTime - existing.startTime);
    }
  }
  next.startTime = start;
  next.endTime = start + duration;
  next.duration = duration;
  track.clips.push(next);
  sortTracks(state);
  recomputeDuration(state);
  return { changed: true, affectedClipIds: [next.id, ...track.clips.filter(c => c.id !== next.id).map(c => c.id)] };
}

export function liftRange(state: ITimelineState, trackIds: string[], window: EditWindow): ParityResult {
  const start = Math.max(0, window.start);
  const end = Math.max(start, window.end);
  if (end <= start + EPS) return { changed: false, reason: 'Empty range', affectedClipIds: [] };
  const allowed = new Set(trackIds);
  const removed: string[] = [];
  for (const track of state.tracks) {
    if (!allowed.has(track.id) || track.locked) continue;
    const keep: IClip[] = [];
    for (const clip of track.clips) {
      if (clip.startTime >= start - EPS && clip.endTime <= end + EPS) removed.push(clip.id);
      else keep.push(clip);
    }
    track.clips = keep;
  }
  if (!removed.length) return { changed: false, reason: 'No complete clips in range', affectedClipIds: [] };
  sortTracks(state);
  recomputeDuration(state);
  return { changed: true, affectedClipIds: removed };
}

export function extractRange(state: ITimelineState, trackIds: string[], window: EditWindow): ParityResult {
  const start = Math.max(0, window.start);
  const end = Math.max(start, window.end);
  if (end <= start + EPS) return { changed: false, reason: 'Empty range', affectedClipIds: [] };
  const allowed = new Set(trackIds);
  const removed: string[] = [];
  const keepIds = new Set<string>();
  for (const track of state.tracks) {
    if (!allowed.has(track.id)) continue;
    for (const clip of track.clips) {
      if (clip.endTime > start + EPS && clip.startTime < end - EPS) keepIds.add(clip.id);
    }
  }
  for (const track of state.tracks) {
    if (!allowed.has(track.id) || track.locked) continue;
    const before = track.clips;
    track.clips = before.filter(c => keepIds.has(c.id));
    for (const c of before) if (!keepIds.has(c.id)) removed.push(c.id);
  }
  sortTracks(state);
  recomputeDuration(state);
  return { changed: removed.length > 0, reason: removed.length ? undefined : 'Nothing outside range', affectedClipIds: removed };
}

export function rippleTrimLinked(state: ITimelineState, clipId: string, edge: 'start' | 'end', newSourceTime: number, fps = 30): ParityResult {
  const found = findClip(state, clipId);
  if (!found) return { changed: false, reason: 'Clip not found', affectedClipIds: [] };
  const linkedIds = linkedGroup(state, [clipId]);
  const selected = new Set(linkedIds);
  const [clip, track] = found;
  if (track.locked) return { changed: false, reason: 'Track is locked', affectedClipIds: [] };
  const before = structuredClone(state);
  const value = quantizeFrame(newSourceTime, fps);
  if (edge === 'start') {
    const next = Math.max(0, Math.min(value, clip.trimEnd - MIN_DURATION));
    const delta = next - clip.trimStart;
    const oldStart = clip.startTime;
    clip.trimStart = next;
    clip.startTime = Math.max(0, oldStart + delta);
    clip.duration = Math.max(MIN_DURATION, clip.endTime - clip.startTime);
    for (const t of state.tracks) for (const c of t.clips) if (c.id !== clipId && c.startTime >= oldStart - EPS) {
      c.startTime += delta;
      c.endTime += delta;
    }
  } else {
    const next = Math.min(clipSourceDuration(clip), Math.max(clip.trimStart + MIN_DURATION, value));
    const delta = next - clip.trimEnd;
    const oldEnd = clip.endTime;
    clip.trimEnd = next;
    clip.endTime = clip.startTime + (clip.trimEnd - clip.trimStart);
    clip.duration = Math.max(MIN_DURATION, clip.endTime - clip.startTime);
    for (const t of state.tracks) for (const c of t.clips) if (c.id !== clipId && c.startTime >= oldEnd - EPS) {
      c.startTime += delta;
      c.endTime += delta;
    }
  }
  // Keep linked A/V items duration-aligned while preserving their own source windows.
  const deltaDuration = clip.duration - (before.tracks.flatMap(t => t.clips).find(c => c.id === clipId)?.duration ?? clip.duration);
  if (Math.abs(deltaDuration) > EPS) {
    for (const t of state.tracks) for (const c of t.clips) if (selected.has(c.id) && c.id !== clipId) {
      if (edge === 'end') {
        c.endTime = Math.max(c.startTime + MIN_DURATION, c.endTime + deltaDuration);
        c.duration = c.endTime - c.startTime;
      } else {
        c.startTime = Math.max(0, c.startTime + deltaDuration);
        c.endTime = Math.max(c.startTime + MIN_DURATION, c.endTime + deltaDuration);
        c.duration = c.endTime - c.startTime;
      }
    }
  }
  sortTracks(state);
  recomputeDuration(state);
  return { changed: true, affectedClipIds: linkedIds };
}

export function validateTransitionPair(left: IClip, right: IClip, requestedDuration: number): number {
  const leftHandle = Math.max(0, clipSourceDuration(left) - left.trimEnd);
  const rightHandle = Math.max(0, right.trimStart);
  const adjacentCapacity = Math.max(0, Math.min(left.duration + leftHandle, right.duration + rightHandle) / 2);
  return Math.max(0, Math.min(requestedDuration, adjacentCapacity));
}

export function assignTrackRole(track: ITrack, role: TrackRole): void {
  track.metadata = { ...(track as ITrack & { metadata?: Record<string, unknown> }).metadata, role };
  if (role === 'main') track.magnetic = true;
  if (role === 'audio') track.muted = false;
}

export function getTrackRole(track: ITrack): TrackRole {
  const role = (track as ITrack & { metadata?: Record<string, unknown> }).metadata?.role;
  if (role === 'main' || role === 'overlay' || role === 'audio' || role === 'text' || role === 'effect') return role;
  return track.type === 'audio' ? 'audio' : track.type === 'text' ? 'text' : track.type === 'effect' ? 'effect' : track.magnetic ? 'main' : 'overlay';
}

export function normalizeProfessionalTimeline(state: ITimelineState, fps = 30): ParityResult {
  let changed = false;
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      const start = quantizeFrame(Math.max(0, clip.startTime), fps);
      const end = quantizeFrame(Math.max(start + MIN_DURATION, clip.endTime), fps);
      if (start !== clip.startTime || end !== clip.endTime) changed = true;
      clip.startTime = start;
      clip.endTime = Math.max(start + MIN_DURATION, end);
      clip.duration = clip.endTime - clip.startTime;
      clip.speed = normalizeSpeed(clip.speed);
      clip.trimStart = Math.max(0, clip.trimStart);
      clip.trimEnd = Math.max(clip.trimStart + MIN_DURATION, clip.trimEnd);
    }
  }
  sortTracks(state);
  recomputeDuration(state);
  state.currentTime = Math.max(0, Math.min(state.currentTime, state.duration));
  return { changed, affectedClipIds: state.tracks.flatMap(t => t.clips.map(c => c.id)) };
}
