import {
  BaseEngine,
  EngineConfigSchema,
  EventEmitter,
  globalEventBus,
} from '@ai-creative-studio/core';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const TimelineEngineConfigSchema = EngineConfigSchema.extend({
  maxTracks: z.number().optional().default(99),
  frameRate: z.number().optional().default(30),
  snappingTolerance: z.number().optional().default(0.033),
});

type TimelineEngineConfig = z.infer<typeof TimelineEngineConfigSchema>;

export type TrackType = 'video' | 'audio' | 'text' | 'effect';

export interface ITrack {
  id: string;
  name: string;
  type: TrackType;
  clips: IClip[];
  muted: boolean;
  locked: boolean;
  visible: boolean;
  height: number;
  order: number;
  color?: string;
}

export interface IClip {
  id: string;
  assetId?: string;
  name: string;
  startTime: number;
  endTime: number;
  trimStart: number;
  trimEnd: number;
  duration: number;
  speed: number;
  opacity: number;
  effects: string[];
  animations: string[];
  keyframes: IKeyframe[];
}

export interface IKeyframe {
  id: string;
  time: number;
  property: string;
  value: number | string | object;
  easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier';
  bezierHandles?: [number, number, number, number];
}

export interface IMarker {
  id: string;
  time: number;
  name: string;
  color: string;
}

export interface ITimelineState {
  tracks: ITrack[];
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  loopEnabled: boolean;
  loopRegion?: { start: number; end: number };
  markers: IMarker[];
  snaps: number[];
}

export interface IPlaybackController {
  play(): void;
  pause(): void;
  stop(): void;
  seek(time: number): void;
  setPlaybackRate(rate: number): void;
  setLoop(enabled: boolean, region?: { start: number; end: number }): void;
}

export interface ITimelineEvents {
  'timeline:changed': { state: ITimelineState };
  'timeline:track:added': { track: ITrack };
  'timeline:track:removed': { trackId: string };
  'timeline:clip:added': { trackId: string; clip: IClip };
  'timeline:clip:removed': { clipId: string };
  'timeline:clip:moved': { clipId: string; trackId: string; time: number };
  'timeline:time:changed': { time: number };
  'timeline:play': {};
  'timeline:pause': {};
  'timeline:stop': {};
}

export class TimelineEngine extends BaseEngine implements IPlaybackController {
  private state: ITimelineState;
  private emitter = new EventEmitter<ITimelineEvents>();
  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;
  private frameRate: number;

  constructor(config: TimelineEngineConfig) {
    const parsedConfig = TimelineEngineConfigSchema.parse(config);
    super(parsedConfig);
    this.frameRate = parsedConfig.frameRate!;

    this.state = {
      tracks: [],
      currentTime: 0,
      duration: 0,
      isPlaying: false,
      playbackRate: 1,
      loopEnabled: false,
      markers: [],
      snaps: [],
    };
  }

  protected async onInitialize(): Promise<void> {
    this.eventBus.on('timeline:play' as any, () => this.play());
    this.eventBus.on('timeline:pause' as any, () => this.pause());
    this.eventBus.on('timeline:stop' as any, () => this.stop());
    this.eventBus.on('timeline:seek' as any, ((event: { payload?: { time?: number } }) => {
      if (event.payload?.time !== undefined) {
        this.seek(event.payload.time);
      }
    }) as any);
  }

  protected override async onDestroy(): Promise<void> {
    this.stop();
  }

  addTrack(type: TrackType, name?: string, options?: Partial<ITrack>): ITrack {
    const track: ITrack = {
      id: uuidv4(),
      name: name || `${type.charAt(0).toUpperCase() + type.slice(1)} Track ${this.state.tracks.length + 1}`,
      type,
      clips: [],
      muted: false,
      locked: false,
      visible: true,
      height: type === 'audio' ? 80 : 60,
      order: this.state.tracks.length,
      color: options?.color,
    };

    this.state.tracks.push(track);
    this.emitter.emit('timeline:track:added', { track });
    this.notifyStateChanged();

    return track;
  }

  removeTrack(trackId: string): void {
    const index = this.state.tracks.findIndex(t => t.id === trackId);
    if (index === -1) return;

    this.state.tracks.splice(index, 1);
    this.updateTracksOrder();
    this.emitter.emit('timeline:track:removed', { trackId });
    this.notifyStateChanged();
  }

  getTrack(trackId: string): ITrack | undefined {
    return this.state.tracks.find(t => t.id === trackId);
  }

  getAllTracks(): ITrack[] {
    return [...this.state.tracks];
  }

  addClip(
    trackId: string,
    options: {
      assetId?: string;
      name: string;
      startTime: number;
      duration: number;
      trimStart?: number;
      trimEnd?: number;
    }
  ): IClip | null {
    const track = this.getTrack(trackId);
    if (!track) return null;

    const clip: IClip = {
      id: uuidv4(),
      assetId: options.assetId,
      name: options.name,
      startTime: options.startTime,
      endTime: options.startTime + options.duration,
      trimStart: options.trimStart || 0,
      trimEnd: options.trimEnd || options.duration,
      duration: options.duration,
      speed: 1,
      opacity: 1,
      effects: [],
      animations: [],
      keyframes: [],
    };

    track.clips.push(clip);
    this.recalculateDuration();
    this.emitter.emit('timeline:clip:added', { trackId, clip });
    this.notifyStateChanged();

    return clip;
  }

  removeClip(clipId: string): void {
    for (const track of this.state.tracks) {
      const index = track.clips.findIndex(c => c.id === clipId);
      if (index !== -1) {
        track.clips.splice(index, 1);
        this.emitter.emit('timeline:clip:removed', { clipId });
        this.recalculateDuration();
        this.notifyStateChanged();
        return;
      }
    }
  }

  moveToTime(clipId: string, trackId: string, newStartTime: number): void {
    const track = this.getTrack(trackId);
    if (!track) return;

    const clip = track.clips.find(c => c.id === clipId);
    if (!clip) return;

    const duration = clip.endTime - clip.startTime;
    clip.startTime = newStartTime;
    clip.endTime = newStartTime + duration;

    this.emitter.emit('timeline:clip:moved', { clipId, trackId, time: newStartTime });
    this.notifyStateChanged();
  }

  trimClip(
    clipId: string,
    trimType: 'start' | 'end',
    newTime: number
  ): void {
    for (const track of this.state.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) {
        if (trimType === 'start') {
          const trimDelta = newTime - clip.trimStart;
          clip.trimStart = newTime;
          clip.startTime = newTime > clip.startTime ? clip.startTime + trimDelta : clip.startTime;
          clip.duration = clip.endTime - clip.startTime;
        } else {
          clip.trimEnd = newTime;
          clip.endTime = clip.startTime + (clip.trimEnd - clip.trimStart);
          clip.duration = clip.endTime - clip.startTime;
        }
        this.notifyStateChanged();
        return;
      }
    }
  }

  splitClip(clipId: string, splitTime: number): IClip[] | null {
    for (const track of this.state.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (!clip) continue;

      const relativeTime = splitTime - clip.startTime;
      if (relativeTime <= 0 || relativeTime >= clip.duration) return null;

      const firstDuration = relativeTime;
      const secondDuration = clip.duration - relativeTime;

      const secondClip: IClip = {
        id: uuidv4(),
        assetId: clip.assetId,
        name: `${clip.name} (2)`,
        startTime: splitTime,
        endTime: clip.endTime,
        trimStart: clip.trimStart + firstDuration,
        trimEnd: clip.trimEnd,
        duration: secondDuration,
        speed: clip.speed,
        opacity: clip.opacity,
        effects: [...clip.effects],
        animations: [...clip.animations],
        keyframes: clip.keyframes.filter(k => k.time >= splitTime).map(k => ({
          ...k,
          time: k.time - relativeTime,
        })),
      };

      clip.endTime = splitTime;
      clip.duration = firstDuration;
      clip.trimEnd = clip.trimStart + firstDuration;
      clip.keyframes = clip.keyframes.filter(k => k.time <= splitTime);

      track.clips.push(secondClip);

      this.emitter.emit('timeline:clip:added', { trackId: track.id, clip: secondClip });
      this.notifyStateChanged();

      return [clip, secondClip];
    }
    return null;
  }

  addKeyframe(
    clipId: string,
    property: string,
    value: number | string | object,
    options?: {
      easing?: IKeyframe['easing'];
      bezierHandles?: IKeyframe['bezierHandles'];
    }
  ): IKeyframe | null {
    for (const track of this.state.tracks) {
      const clip = track.clips.find(c => c.id === clipId);
      if (clip) {
        const keyframe: IKeyframe = {
          id: uuidv4(),
          time: this.state.currentTime,
          property,
          value,
          easing: options?.easing || 'ease-in-out',
          bezierHandles: options?.bezierHandles,
        };

        clip.keyframes.push(keyframe);
        this.notifyStateChanged();
        return keyframe;
      }
    }
    return null;
  }

  addMarker(time: number, name: string, color: string = '#ff4444'): IMarker {
    const marker: IMarker = {
      id: uuidv4(),
      time,
      name,
      color,
    };

    this.state.markers.push(marker);
    this.state.markers.sort((a, b) => a.time - b.time);
    this.notifyStateChanged();

    return marker;
  }

  removeMarker(markerId: string): void {
    const index = this.state.markers.findIndex(m => m.id === markerId);
    if (index !== -1) {
      this.state.markers.splice(index, 1);
      this.notifyStateChanged();
    }
  }

  play(): void {
    if (this.state.isPlaying) return;

    this.state.isPlaying = true;
    this.lastFrameTime = performance.now();
    this.tick();

    this.emitter.emit('timeline:play', {});
    this.notifyStateChanged();
  }

  pause(): void {
    this.state.isPlaying = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.emitter.emit('timeline:pause', {});
    this.notifyStateChanged();
  }

  stop(): void {
    this.pause();
    this.state.currentTime = 0;
    this.emitter.emit('timeline:stop', {});
    this.notifyStateChanged();
  }

  seek(time: number): void {
    this.state.currentTime = this.clampTime(time);
    this.emitter.emit('timeline:time:changed', { time: this.state.currentTime });
    this.notifyStateChanged();
  }

  setPlaybackRate(rate: number): void {
    this.state.playbackRate = Math.max(0.1, Math.min(4, rate));
    this.notifyStateChanged();
  }

  setLoop(enabled: boolean, region?: { start: number; end: number }): void {
    this.state.loopEnabled = enabled;
    this.state.loopRegion = enabled ? region : undefined;
    this.notifyStateChanged();
  }

  getState(): ITimelineState {
    return { ...this.state };
  }

  getCurrentTime(): number {
    return this.state.currentTime;
  }

  get isPlaying(): boolean {
    return this.state.isPlaying;
  }

  private tick = (): void => {
    if (!this.state.isPlaying) return;

    const now = performance.now();
    const delta = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    const timeIncrement = delta * this.state.playbackRate;
    let newTime = this.state.currentTime + timeIncrement;

    if (this.state.loopEnabled && this.state.loopRegion) {
      if (newTime >= this.state.loopRegion.end) {
        newTime = this.state.loopRegion.start;
      }
    }

    if (newTime >= this.state.duration) {
      if (this.state.loopEnabled) {
        newTime = 0;
      } else {
        this.pause();
        return;
      }
    }

    this.state.currentTime = newTime;
    this.emitter.emit('timeline:time:changed', { time: this.state.currentTime });

    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  private clampTime(time: number): number {
    return Math.max(0, Math.min(this.state.duration, time));
  }

  private recalculateDuration(): void {
    let maxEnd = 0;

    for (const track of this.state.tracks) {
      for (const clip of track.clips) {
        if (clip.endTime > maxEnd) {
          maxEnd = clip.endTime;
        }
      }
    }

    this.state.duration = maxEnd;
  }

  private updateTracksOrder(): void {
    this.state.tracks.forEach((track, index) => {
      track.order = index;
    });
  }

  private notifyStateChanged(): void {
    this.emitter.emit('timeline:changed', { state: this.getState() });
    this.emitEvent({
      type: 'state:change',
      timestamp: Date.now(),
      source: this.id,
    });
  }

  on<E extends keyof ITimelineEvents>(
    event: E,
    listener: (data: ITimelineEvents[E]) => void
  ): this {
    this.emitter.on(event, listener as any);
    return this;
  }

  off<E extends keyof ITimelineEvents>(
    event: E,
    listener: (data: ITimelineEvents[E]) => void
  ): this {
    this.emitter.off(event, listener as any);
    return this;
  }

  getCapabilities(): string[] {
    return [
      'timeline:play',
      'timeline:pause',
      'timeline:stop',
      'timeline:seek',
      'timeline:track-add',
      'timeline:track-remove',
      'timeline:clip-add',
      'timeline:clip-remove',
      'timeline:clip-split',
      'timeline:clip-trim',
      'timeline:keyframe-add',
      'timeline:marker-add',
      'timeline:snapping',
      'timeline:ripple-edit',
      'timeline:collision-resolution',
      'timeline:loop-playback',
    ];
  }
}

export * from './editing';
