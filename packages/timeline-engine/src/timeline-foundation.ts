import type { IClip, IMarker, ITrack, ITimelineState } from './index.js';

export interface FrameTimebase {
  fps: number;
  toFrame(seconds: number): number;
  toSeconds(frame: number): number;
  quantize(seconds: number): number;
}

export function createFrameTimebase(fps: number): FrameTimebase {
  const safeFps = Math.max(1, fps);
  return {
    fps: safeFps,
    toFrame: seconds => Math.round(Math.max(0, seconds) * safeFps),
    toSeconds: frame => Math.max(0, Math.round(frame)) / safeFps,
    quantize: seconds => Math.max(0, Math.round(Math.max(0, seconds) * safeFps) / safeFps),
  };
}

export interface SpeedControlPoint {
  time: number;
  speed: number;
}

export interface RetimeMap {
  points: SpeedControlPoint[];
  sourceTimeAt(localTime: number): number;
  timelineDuration(): number;
}

const EPS = 1e-6;
const MIN_SPEED = 0.05;
const MAX_SPEED = 16;

function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

function normalizedPoints(points: SpeedControlPoint[], duration: number): SpeedControlPoint[] {
  const clean = points
    .filter(p => Number.isFinite(p.time) && Number.isFinite(p.speed))
    .map(p => ({ time: clamp(p.time, 0, Math.max(0, duration)), speed: clamp(p.speed, MIN_SPEED, MAX_SPEED) }))
    .sort((a, b) => a.time - b.time);
  const out: SpeedControlPoint[] = [];
  for (const point of clean) {
    const previous = out[out.length - 1];
    if (previous && Math.abs(previous.time - point.time) <= EPS) previous.speed = point.speed;
    else out.push(point);
  }
  if (!out.length || out[0].time > EPS) out.unshift({ time: 0, speed: out[0]?.speed ?? 1 });
  if (out[out.length - 1].time < duration - EPS) out.push({ time: duration, speed: out[out.length - 1].speed });
  return out;
}

function speedAt(points: SpeedControlPoint[], time: number): number {
  if (points.length === 1) return points[0].speed;
  const t = clamp(time, points[0].time, points[points.length - 1].time);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1], b = points[i];
    if (t <= b.time + EPS) {
      const span = b.time - a.time;
      if (span <= EPS) return b.speed;
      const ratio = (t - a.time) / span;
      return a.speed + (b.speed - a.speed) * ratio;
    }
  }
  return points[points.length - 1].speed;
}

/**
 * Builds a deterministic local-timeline -> source-time map using a piecewise-linear speed curve.
 * Numerical integration is kept explicit so later native/web renderers can share the same semantics.
 */
export function createRetimeMap(points: SpeedControlPoint[], duration: number): RetimeMap {
  const d = Math.max(0, duration);
  const normalized = normalizedPoints(points, d);
  const cumulative: Array<{ time: number; source: number }> = [{ time: 0, source: 0 }];
  for (let i = 1; i < normalized.length; i += 1) {
    const a = normalized[i - 1], b = normalized[i];
    const dt = b.time - a.time;
    const area = ((a.speed + b.speed) * 0.5) * dt;
    cumulative.push({ time: b.time, source: cumulative[cumulative.length - 1].source + area });
  }

  const sourceAt = (localTime: number): number => {
    const t = clamp(localTime, 0, d);
    for (let i = 1; i < normalized.length; i += 1) {
      const b = normalized[i], a = normalized[i - 1];
      if (t <= b.time + EPS) {
        const dt = t - a.time;
        const span = Math.max(EPS, b.time - a.time);
        const s0 = a.speed;
        const slope = (b.speed - a.speed) / span;
        return cumulative[i - 1].source + (s0 * dt) + (0.5 * slope * dt * dt);
      }
    }
    return cumulative[cumulative.length - 1].source;
  };

  return {
    points: normalized,
    sourceTimeAt: sourceAt,
    timelineDuration: () => d,
  };
}

export interface TimelineInvariantReport {
  valid: boolean;
  errors: string[];
}

export function validateClipInvariant(clip: IClip): TimelineInvariantReport {
  const errors: string[] = [];
  if (!(clip.startTime >= -EPS)) errors.push('clip.startTime must be non-negative');
  if (!(clip.endTime > clip.startTime + EPS)) errors.push('clip.endTime must be greater than startTime');
  if (!(clip.duration > EPS)) errors.push('clip.duration must be positive');
  if (Math.abs((clip.endTime - clip.startTime) - clip.duration) > 1e-4) errors.push('clip.duration must equal timeline window');
  if (!(clip.trimEnd > clip.trimStart + EPS)) errors.push('trimEnd must be greater than trimStart');
  if (!(clip.speed >= MIN_SPEED && clip.speed <= MAX_SPEED)) errors.push('clip.speed is outside supported range');
  return { valid: errors.length === 0, errors };
}

export function validateTimelineInvariants(state: ITimelineState): TimelineInvariantReport {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      if (seen.has(clip.id)) errors.push(`duplicate clip id: ${clip.id}`);
      seen.add(clip.id);
      const report = validateClipInvariant(clip);
      errors.push(...report.errors.map(error => `${clip.id}: ${error}`));
    }
  }
  const duration = state.tracks.reduce((m, track) => Math.max(m, ...track.clips.map(c => c.endTime), 0), 0);
  if (Math.abs(duration - state.duration) > 1e-4) errors.push(`state.duration mismatch: expected ${duration}, got ${state.duration}`);
  return { valid: errors.length === 0, errors };
}

export interface TimelineSnapProvider {
  id: string;
  type: 'frame' | 'playhead' | 'marker' | 'clip-start' | 'clip-end' | 'beat' | 'grid';
  time: number;
  priority: number;
}

export class SnapRegistry {
  private providers = new Map<string, TimelineSnapProvider>();

  clear(): void { this.providers.clear(); }
  add(provider: TimelineSnapProvider): void {
    if (Number.isFinite(provider.time)) this.providers.set(provider.id, provider);
  }
  addClip(track: ITrack, clip: IClip): void {
    this.add({ id: `${track.id}:${clip.id}:start`, type: 'clip-start', time: clip.startTime, priority: 0 });
    this.add({ id: `${track.id}:${clip.id}:end`, type: 'clip-end', time: clip.endTime, priority: 1 });
  }
  addMarker(marker: IMarker): void { this.add({ id: `marker:${marker.id}`, type: 'marker', time: marker.time, priority: 2 }); }
  addFrame(timebase: FrameTimebase, time: number): void { this.add({ id: `frame:${timebase.toFrame(time)}`, type: 'frame', time: timebase.quantize(time), priority: 4 }); }
  addBeat(time: number, index: number): void { this.add({ id: `beat:${index}`, type: 'beat', time, priority: 1 }); }

  nearest(time: number, tolerance: number): TimelineSnapProvider | null {
    let best: TimelineSnapProvider | null = null;
    let bestDistance = Math.max(0, tolerance);
    for (const candidate of this.providers.values()) {
      const distance = Math.abs(candidate.time - time);
      if (distance > bestDistance) continue;
      if (!best || distance < bestDistance - EPS || (Math.abs(distance - bestDistance) <= EPS && candidate.priority < best.priority)) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return best;
  }

  all(): TimelineSnapProvider[] { return [...this.providers.values()].sort((a, b) => a.time - b.time || a.priority - b.priority); }
}

export interface TransitionBudget {
  maxDuration: number;
  overlapWithPrevious: number;
  overlapWithNext: number;
}

export function transitionBudget(track: ITrack, clipId: string): TransitionBudget {
  const index = track.clips.findIndex(c => c.id === clipId);
  if (index < 0) return { maxDuration: 0, overlapWithPrevious: 0, overlapWithNext: 0 };
  const clip = track.clips[index];
  const previous = track.clips[index - 1];
  const next = track.clips[index + 1];
  const overlapPrev = previous ? Math.max(0, clip.startTime - previous.startTime) : 0;
  const overlapNext = next ? Math.max(0, next.endTime - clip.endTime) : 0;
  const maxDuration = Math.max(0, Math.min(clip.duration / 2, overlapPrev || overlapNext || clip.duration / 2));
  return { maxDuration, overlapWithPrevious: overlapPrev, overlapWithNext: overlapNext };
}

export function normalizeTimelineState(state: ITimelineState, fps: number): ITimelineState {
  const timebase = createFrameTimebase(fps);
  const next = structuredClone(state);
  for (const track of next.tracks) {
    track.clips = track.clips
      .map(clip => {
        clip.startTime = timebase.quantize(clip.startTime);
        clip.endTime = Math.max(clip.startTime + timebase.toSeconds(1), timebase.quantize(clip.endTime));
        clip.duration = clip.endTime - clip.startTime;
        clip.trimStart = Math.max(0, clip.trimStart);
        clip.trimEnd = Math.max(clip.trimStart + timebase.toSeconds(1), clip.trimEnd);
        clip.speed = clamp(clip.speed, MIN_SPEED, MAX_SPEED);
        return clip;
      })
      .sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  }
  next.duration = next.tracks.reduce((m, track) => Math.max(m, ...track.clips.map(c => c.endTime), 0), 0);
  next.currentTime = clamp(timebase.quantize(next.currentTime), 0, next.duration);
  next.markers = next.markers.map(m => ({ ...m, time: clamp(timebase.quantize(m.time), 0, next.duration) }));
  return next;
}
