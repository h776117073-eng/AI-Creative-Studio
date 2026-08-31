import { BaseEngine, EngineConfigSchema } from '@ai-creative-studio/core';
import { EventEmitter } from 'eventemitter3';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const ConfigSchema = EngineConfigSchema.extend({
  maxTracks: z.number().int().min(1).max(999).default(99),
  frameRate: z.number().positive().default(30),
  snappingTolerance: z.number().nonnegative().default(0.033),
});

export type TimelineEngineConfig = z.infer<typeof ConfigSchema>;
export type TrackType = 'video' | 'audio' | 'text' | 'effect' | 'overlay';
export type Easing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier' | 'hold';
export interface IKeyframe { id: string; time: number; property: string; value: number | string | object; easing: Easing; bezierHandles?: [number, number, number, number] }
export interface IClip {
  id: string; assetId?: string; name: string; startTime: number; endTime: number; trimStart: number; trimEnd: number;
  duration: number; speed: number; opacity: number; effects: string[]; animations: string[]; keyframes: IKeyframe[];
  transitionIn?: { type: string; duration: number }; transitionOut?: { type: string; duration: number };
  linkedClipIds?: string[]; metadata?: Record<string, unknown>;
}
export interface ITrack {
  id: string; name: string; type: TrackType; clips: IClip[]; muted: boolean; locked: boolean; visible: boolean;
  height: number; order: number; color?: string; magnetic?: boolean;
}
export interface IMarker { id: string; time: number; name: string; color: string }
export interface ITimelineState {
  tracks: ITrack[]; currentTime: number; duration: number; isPlaying: boolean; playbackRate: number;
  loopEnabled: boolean; loopRegion?: { start: number; end: number }; markers: IMarker[]; snaps: number[];
}
export interface ITimelineEvents {
  'timeline:changed': { state: ITimelineState }; 'timeline:track:added': { track: ITrack }; 'timeline:track:removed': { trackId: string };
  'timeline:clip:added': { trackId: string; clip: IClip }; 'timeline:clip:removed': { trackId: string; clipId: string };
  'timeline:clip:moved': { clipId: string; trackId: string; time: number }; 'timeline:clip:trimmed': { clipId: string; edge: 'start' | 'end' };
  'timeline:clip:split': { trackId: string; clipIds: string[]; time: number }; 'timeline:keyframe:added': { clipId: string; keyframe: IKeyframe };
  'timeline:marker:added': { marker: IMarker }; 'timeline:time:changed': { time: number }; 'timeline:play': {}; 'timeline:pause': {}; 'timeline:stop': {};
}

const MIN_SPEED = 0.1;
const MAX_SPEED = 100;
const MIN_DURATION = 0.01;

export class TimelineEngine extends BaseEngine {
  private timelineState: ITimelineState = { tracks: [], currentTime: 0, duration: 0, isPlaying: false, playbackRate: 1, loopEnabled: false, markers: [], snaps: [] };
  private timelineEmitter = new EventEmitter<string>();
  private animationFrameId: number | null = null;
  private lastFrameTime = 0;
  readonly frameRate: number;
  readonly maxTracks: number;
  readonly snappingTolerance: number;

  constructor(config: TimelineEngineConfig) {
    const p = ConfigSchema.parse(config); super(p as any);
    this.frameRate = p.frameRate; this.maxTracks = p.maxTracks; this.snappingTolerance = p.snappingTolerance;
  }
  protected async onInitialize(): Promise<void> {}
  protected override async onDestroy(): Promise<void> { this.stop(); }
  getState(): ITimelineState { return structuredClone(this.timelineState); }
  loadState(state: ITimelineState): void { this.stop(); this.timelineState = structuredClone(state); this.recomputeDuration(); this.timelineState.currentTime = this.clamp(this.timelineState.currentTime); this.changed(); }
  getTrack(id: string): ITrack | undefined { return this.timelineState.tracks.find(t => t.id === id); }
  getAllTracks(): ITrack[] { return [...this.timelineState.tracks]; }

  addTrack(type: TrackType, name?: string, options?: Partial<ITrack>): ITrack {
    if (this.timelineState.tracks.length >= this.maxTracks) throw new Error('Maximum track count reached');
    const t: ITrack = { id: uuidv4(), name: name || `${type} ${this.timelineState.tracks.length + 1}`, type, clips: [], muted: false, locked: false, visible: true, height: type === 'audio' ? 80 : 64, order: this.timelineState.tracks.length, magnetic: type === 'video', ...options };
    this.timelineState.tracks.push(t); this.emitT('timeline:track:added', { track: t }); this.changed(); return t;
  }
  removeTrack(id: string): void {
    const i = this.timelineState.tracks.findIndex(t => t.id === id); if (i < 0) return;
    this.timelineState.tracks.splice(i, 1); this.timelineState.tracks.forEach((t, n) => t.order = n); this.recomputeDuration(); this.emitT('timeline:track:removed', { trackId: id }); this.changed();
  }

  addClip(trackId: string, o: { assetId?: string; name: string; startTime: number; duration: number; trimStart?: number; trimEnd?: number; speed?: number; sourceDuration?: number; mediaType?: string }): IClip | null {
    const t = this.getTrack(trackId); if (!t || t.locked) return null;
    const start = this.frameTime(Math.max(0, o.startTime));
    const duration = Math.max(MIN_DURATION, this.frameTime(Math.max(MIN_DURATION, o.duration)));
    const trimStart = Math.max(0, o.trimStart ?? 0);
    const trimEnd = Math.max(trimStart + MIN_DURATION, o.trimEnd ?? duration);
    const speed = clamp(o.speed ?? 1, MIN_SPEED, MAX_SPEED);
    const metadata = o.sourceDuration !== undefined || o.mediaType !== undefined ? { sourceDuration: o.sourceDuration, mediaType: o.mediaType } : {};
    const c: IClip = { id: uuidv4(), assetId: o.assetId, name: o.name, startTime: start, endTime: start + duration, trimStart, trimEnd, duration, speed, opacity: 1, effects: [], animations: [], keyframes: [], metadata };
    t.clips.push(c); this.sort(t); this.recomputeDuration(); this.emitT('timeline:clip:added', { trackId, clip: c }); this.changed(); return c;
  }
  removeClip(id: string): void { const f = this.findClip(id); if (!f) return; const [c, t] = f; t.clips = t.clips.filter(x => x.id !== id); this.recomputeDuration(); this.emitT('timeline:clip:removed', { trackId: t.id, clipId: id }); this.changed(); }

  moveClip(id: string, targetTrackId: string, start: number, options: { ripple?: boolean; snap?: boolean; tolerance?: number } = {}): boolean {
    const f = this.findClip(id), target = this.getTrack(targetTrackId); if (!f || !target || target.locked) return false;
    const [c, source] = f; let s = Math.max(0, this.frameTime(start)); if (options.snap) s = this.snapTime(s, id, options.tolerance);
    const duration = c.duration;
    if (source.id !== target.id) { source.clips = source.clips.filter(x => x.id !== id); target.clips.push(c); }
    if (options.ripple) this.pushOverlaps(target, id, s + duration);
    else if (this.collision(target, id, s, s + duration)) { if (source.id !== target.id) { target.clips = target.clips.filter(x => x.id !== id); source.clips.push(c); this.sort(source); } return false; }
    c.startTime = s; c.endTime = s + duration; this.sort(target); this.recomputeDuration(); this.emitT('timeline:clip:moved', { clipId: id, trackId: target.id, time: s }); this.changed(); return true;
  }

  trimClip(id: string, edge: 'start' | 'end', sourceTime: number, ripple = true): boolean {
    const f = this.findClip(id); if (!f) return false; const [c, t] = f; if (t.locked) return false;
    if (edge === 'start') {
      const next = Math.max(0, Math.min(sourceTime, c.trimEnd - MIN_DURATION)); const delta = this.frameTime(next - c.trimStart); const oldStart = c.startTime;
      c.trimStart = Math.max(0, c.trimStart + delta); c.startTime = Math.max(0, this.frameTime(c.startTime + delta)); c.duration = c.endTime - c.startTime;
      if (ripple && delta) for (const x of t.clips) if (x.id !== id && x.startTime >= oldStart - 1 / this.frameRate) { x.startTime = this.frameTime(x.startTime + delta); x.endTime = this.frameTime(x.endTime + delta); }
    } else {
      const next = Math.max(c.trimStart + MIN_DURATION, Math.min(this.sourceDuration(c), sourceTime)); const oldEnd = c.endTime; c.trimEnd = this.frameTime(next); c.endTime = this.frameTime(c.startTime + (c.trimEnd - c.trimStart)); c.duration = Math.max(MIN_DURATION, c.endTime - c.startTime);
      const delta = c.endTime - oldEnd;
      if (ripple && delta) for (const x of t.clips) if (x.id !== id && x.startTime >= oldEnd - 1 / this.frameRate) { x.startTime = this.frameTime(x.startTime + delta); x.endTime = this.frameTime(x.endTime + delta); }
    }
    this.sort(t); this.recomputeDuration(); this.emitT('timeline:clip:trimmed', { clipId: id, edge }); this.changed(); return true;
  }

  rippleDelete(trackId: string, id: string): boolean {
    const t = this.getTrack(trackId); if (!t || t.locked) return false; const c = t.clips.find(x => x.id === id); if (!c) return false;
    const delta = c.duration, end = c.endTime; t.clips = t.clips.filter(x => x.id !== id); for (const x of t.clips) if (x.startTime >= end - 1 / this.frameRate) { x.startTime = this.frameTime(x.startTime - delta); x.endTime = this.frameTime(x.endTime - delta); }
    this.recomputeDuration(); this.changed(); return true;
  }

  splitClip(id: string, time: number): [IClip, IClip] | null {
    const f = this.findClip(id); if (!f) return null; const [c, t] = f; const splitTime = this.frameTime(time); if (splitTime <= c.startTime || splitTime >= c.endTime) return null;
    const localSplit = splitTime - c.startTime; const ratio = localSplit / Math.max(MIN_DURATION, c.duration); const sourceSpan = Math.max(MIN_DURATION, c.trimEnd - c.trimStart);
    const second: IClip = { ...structuredClone(c), id: uuidv4(), name: `${c.name} (2)`, startTime: splitTime, endTime: c.endTime, trimStart: c.trimStart + sourceSpan * ratio, duration: c.endTime - splitTime, keyframes: c.keyframes.filter(k => k.time >= localSplit).map(k => ({ ...k, id: uuidv4(), time: k.time - localSplit })) };
    c.endTime = splitTime; c.trimEnd = c.trimStart + sourceSpan * ratio; c.duration = localSplit; c.keyframes = c.keyframes.filter(k => k.time <= localSplit);
    t.clips.push(second); this.sort(t); this.recomputeDuration(); this.emitT('timeline:clip:split', { trackId: t.id, clipIds: [c.id, second.id], time: splitTime }); this.changed(); return [c, second];
  }

  addKeyframe(id: string, property: string, value: number | string | object, options?: { easing?: Easing; bezierHandles?: [number, number, number, number] }): IKeyframe | null {
    const f = this.findClip(id); if (!f) return null; const c = f[0]; const local = this.frameTime(this.clamp(this.timelineState.currentTime) - c.startTime); if (local < 0 || local > c.duration) return null;
    const k: IKeyframe = { id: uuidv4(), time: local, property, value, easing: options?.easing ?? 'ease-in-out', bezierHandles: options?.bezierHandles };
    c.keyframes = c.keyframes.filter(x => !(x.property === property && Math.abs(x.time - local) < 1 / this.frameRate)); c.keyframes.push(k); c.keyframes.sort((a, b) => a.time - b.time || a.property.localeCompare(b.property)); this.emitT('timeline:keyframe:added', { clipId: id, keyframe: k }); this.changed(); return k;
  }
  addMarker(time: number, name: string, color = '#8b5cf6'): IMarker { const m = { id: uuidv4(), time: this.clamp(this.frameTime(time)), name, color }; this.timelineState.markers.push(m); this.timelineState.markers.sort((a, b) => a.time - b.time); this.emitT('timeline:marker:added', { marker: m }); this.changed(); return m; }
  seek(time: number): void { this.timelineState.currentTime = this.clamp(this.frameTime(time)); this.emitT('timeline:time:changed', { time: this.timelineState.currentTime }); this.changed(); }
  setPlaybackRate(rate: number): void { this.timelineState.playbackRate = clamp(rate, 0.05, 16); this.changed(); }
  setLoop(enabled: boolean, region?: { start: number; end: number }): void { this.timelineState.loopEnabled = enabled; this.timelineState.loopRegion = enabled ? region : undefined; this.changed(); }
  play(): void { if (this.timelineState.isPlaying) return; this.timelineState.isPlaying = true; this.lastFrameTime = performance.now(); this.emitT('timeline:play', {}); this.changed(); this.tick(); }
  pause(): void { this.timelineState.isPlaying = false; if (this.animationFrameId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.animationFrameId); this.animationFrameId = null; this.emitT('timeline:pause', {}); this.changed(); }
  stop(): void { this.timelineState.isPlaying = false; if (this.animationFrameId !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.animationFrameId); this.animationFrameId = null; this.timelineState.currentTime = 0; this.emitT('timeline:stop', {}); this.changed(); }
  snapTime(time: number, excludeClipId?: string, tolerance = this.snappingTolerance): number { const input = this.frameTime(Math.max(0, time)); let best = input, d = Math.max(0, tolerance); for (const target of this.snapTargets(excludeClipId)) { const x = Math.abs(target - input); if (x <= d) { best = target; d = x; } } return this.frameTime(best); }
  getSnapTargets(excludeClipId?: string): number[] { return this.snapTargets(excludeClipId); }
  onTimeline<E extends keyof ITimelineEvents>(event: E, listener: (data: ITimelineEvents[E]) => void): this { this.timelineEmitter.on(event as string, listener as any); return this; }
  offTimeline<E extends keyof ITimelineEvents>(event: E, listener: (data: ITimelineEvents[E]) => void): this { this.timelineEmitter.off(event as string, listener as any); return this; }
  getCapabilities(): string[] { return ['timeline:play','timeline:pause','timeline:stop','timeline:seek','timeline:track-add','timeline:track-remove','timeline:clip-add','timeline:clip-remove','timeline:clip-move','timeline:clip-split','timeline:clip-trim','timeline:ripple-delete','timeline:ripple-trim','timeline:roll','timeline:slip','timeline:slide','timeline:keyframe','timeline:markers','timeline:snapping','timeline:collision-resolution','timeline:multi-track','timeline:loop-playback','timeline:link','timeline:unlink','timeline:transition','timeline:speed-curve','timeline:magnetic-track','timeline:frame-accurate-editing','timeline:thumbnail-cache','timeline:waveform-cache','timeline:transaction-history','timeline:professional-speed','timeline:freeze-frame','timeline:insert-overwrite','timeline:lift-extract','timeline:track-roles']; }

  private emitT(e: keyof ITimelineEvents, d: unknown): void { this.timelineEmitter.emit(e as string, d); }
  private findClip(id: string): [IClip, ITrack] | null { for (const t of this.timelineState.tracks) { const c = t.clips.find(x => x.id === id); if (c) return [c, t]; } return null; }
  private sort(t: ITrack): void { t.clips.sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id)); }
  private collision(t: ITrack, id: string, s: number, e: number): boolean { return t.clips.some(c => c.id !== id && s < c.endTime && e > c.startTime); }
  private pushOverlaps(t: ITrack, id: string, end: number): void { let cursor = end; for (const c of t.clips.filter(x => x.id !== id).sort((a, b) => a.startTime - b.startTime)) { if (c.startTime < cursor && c.endTime > cursor) { const d = cursor - c.startTime; c.startTime = this.frameTime(c.startTime + d); c.endTime = this.frameTime(c.endTime + d); cursor = c.endTime; } } }
  private recomputeDuration(): void { this.timelineState.duration = this.timelineState.tracks.reduce((m, t) => Math.max(m, ...t.clips.map(c => c.endTime), 0), 0); }
  private clamp(v: number): number { return clamp(v, 0, this.timelineState.duration); }
  private frameTime(v: number): number { return Math.max(0, Math.round(v * this.frameRate) / this.frameRate); }
  private sourceDuration(clip: IClip): number { const d = clip.metadata?.sourceDuration; return typeof d === 'number' && Number.isFinite(d) ? Math.max(d, clip.trimEnd) : Math.max(clip.trimEnd, clip.trimStart + clip.duration); }
  private snapTargets(id?: string): number[] { const a: number[] = [this.timelineState.currentTime, ...this.timelineState.markers.map(m => m.time)]; for (const t of this.timelineState.tracks) for (const c of t.clips) if (c.id !== id) a.push(c.startTime, c.endTime); return a.sort((x, y) => x - y); }
  private changed(): void { this.emitT('timeline:changed', { state: this.getState() }); this.emitEvent({ type: 'state:change', timestamp: Date.now(), source: this.id }); }
  private tick = (): void => { if (!this.timelineState.isPlaying) return; const now = performance.now(); const delta = Math.max(1 / 240, (now - this.lastFrameTime) / 1000); this.lastFrameTime = now; let next = this.timelineState.currentTime + delta * this.timelineState.playbackRate; if (this.timelineState.loopEnabled && this.timelineState.loopRegion && next >= this.timelineState.loopRegion.end) next = this.timelineState.loopRegion.start; if (next >= this.timelineState.duration && !this.timelineState.loopEnabled) { this.timelineState.currentTime = this.timelineState.duration; this.pause(); return; } this.timelineState.currentTime = next; this.emitT('timeline:time:changed', { time: next }); if (typeof requestAnimationFrame === 'function') this.animationFrameId = requestAnimationFrame(this.tick); else this.animationFrameId = setTimeout(this.tick, 1000 / this.frameRate) as unknown as number; };
}

export const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v));
export * from './editing.js';
export * from './interaction.js';
export * from './transactions.js';
export * from './caches.js';
export * from './controller.js';
export * from './advanced-editing.js';
export * from './timeline-foundation.js';
export * from './professional-parity.js';
