import { Timeline, TimelineAction, reduceTimeline } from './timeline';

export interface TimelinePersistenceAdapter {
  load(projectId: string): Promise<Timeline | null>;
  save(projectId: string, compressedTimeline: string): Promise<void>;
  enqueueCloudDelta(projectId: string, action: TimelineAction, version: number): Promise<void>;
}

export class MemoryTimelineAdapter implements TimelinePersistenceAdapter {
  private timelines = new Map<string, string>();
  readonly cloudDeltas: Array<{ projectId: string; action: TimelineAction; version: number }> = [];
  async load(projectId: string): Promise<Timeline | null> {
    const value = this.timelines.get(projectId);
    return value ? JSON.parse(decodeURIComponent(value)) : null;
  }
  async save(projectId: string, compressedTimeline: string): Promise<void> { this.timelines.set(projectId, compressedTimeline); }
  async enqueueCloudDelta(projectId: string, action: TimelineAction, version: number): Promise<void> { this.cloudDeltas.push({ projectId, action, version }); }
}

export class TimelineStateManager {
  private timeline: Timeline;
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<(timeline: Timeline) => void>();
  constructor(private projectId: string, initial: Timeline, private adapter: TimelinePersistenceAdapter, private throttleMs = 500) { this.timeline = initial; }
  getSnapshot(): Timeline { return JSON.parse(JSON.stringify(this.timeline)); }
  subscribe(listener: (timeline: Timeline) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  dispatch(action: TimelineAction): Timeline {
    this.timeline = reduceTimeline(this.timeline, action);
    this.version += 1;
    this.listeners.forEach(listener => listener(this.getSnapshot()));
    void this.adapter.enqueueCloudDelta(this.projectId, action, this.version);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.throttleMs);
    return this.getSnapshot();
  }
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.adapter.save(this.projectId, encodeURIComponent(JSON.stringify(this.timeline)));
  }
}
