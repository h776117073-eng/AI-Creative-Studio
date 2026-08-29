import { TimelineEngine, type IClip, type ITrack, type ITimelineState } from './index.js';
import { moveClip, rippleDelete, rippleTrim } from './editing.js';
import { SelectionEngine, TrackTargeting, type ClipBounds, type EditIntent, LinkGraph } from './interaction.js';
import { TimelineHistory } from './transactions.js';

export interface TimelineControllerConfig {
  id?: string;
  name?: string;
  frameRate?: number;
  maxTracks?: number;
  snappingTolerance?: number;
}

export class TimelineInteractionController {
  readonly engine: TimelineEngine;
  readonly selection = new SelectionEngine();
  readonly targeting = new TrackTargeting();
  readonly history = new TimelineHistory(100);

  private transactionBefore: ITimelineState | null = null;

  constructor(config: TimelineControllerConfig = {}) {
    this.engine = new TimelineEngine({
      id: config.id ?? 'vireon-timeline',
      name: config.name ?? 'Vireon Timeline Engine',
      frameRate: config.frameRate ?? 30,
      maxTracks: config.maxTracks ?? 99,
      snappingTolerance: config.snappingTolerance ?? 0.033,
    });
  }

  async initialize(): Promise<void> {
    if (!this.engine.isReady()) await this.engine.initialize();
  }

  loadState(state: ITimelineState): void {
    this.engine.loadState(state);
    this.selection.clear();
    this.transactionBefore = null;
  }

  getState(): ITimelineState { return this.engine.getState(); }

  select(clipId: string, additive = false): string[] {
    return this.selection.selectClip(clipId, additive);
  }

  boxSelect(bounds: ClipBounds[], rect: { x: number; y: number; width: number; height: number }, additive = false): string[] {
    return this.selection.boxSelect(bounds, rect, additive);
  }

  beginInteraction(): void {
    if (!this.transactionBefore) this.transactionBefore = this.getState();
  }

  preview(intent: EditIntent): ITimelineState {
    switch (intent.type) {
      case 'select': {
        if (intent.clipId) this.select(intent.clipId, intent.additive);
        else this.selection.clear();
        return this.getState();
      }
      case 'box-select': {
        return this.getState();
      }
      case 'seek':
        this.engine.seek(intent.time);
        return this.getState();
      case 'move': {
        const next = this.getState();
        const selected = intent.clipIds.length ? intent.clipIds : this.selection.selectedIds;
        for (const clipId of selected) {
          const found = findClip(next, clipId);
          if (!found) continue;
          const [clip] = found;
          moveClip(next, clip.id, intent.trackId, Math.max(0, clip.startTime + intent.deltaTime), {
            snap: true,
            tolerance: 0.033,
            ripple: false,
          });
        }
        this.engine.loadState(next);
        return this.getState();
      }
      case 'trim-start': {
        const next = this.getState();
        rippleTrim(next, intent.clipId, 'start', Math.max(0, (findClip(next, intent.clipId)?.[0].trimStart ?? 0) + intent.deltaTime), false);
        this.engine.loadState(next);
        return this.getState();
      }
      case 'trim-end': {
        const next = this.getState();
        const found = findClip(next, intent.clipId);
        if (found) rippleTrim(next, intent.clipId, 'end', Math.max(found[0].trimStart + 0.01, found[0].trimEnd + intent.deltaTime), false);
        this.engine.loadState(next);
        return this.getState();
      }
      case 'scroll':
      case 'zoom':
        return this.getState();
      default:
        return this.getState();
    }
  }

  deleteSelected(ripple = true): ITimelineState {
    const next = this.getState();
    const ids = this.selection.selectedIds;
    const graph = new LinkGraph(next);
    for (const id of ids) {
      const found = findTrack(next, id);
      if (found) rippleDelete(next, found.id, id);
      for (const linked of graph.linkedIds(id)) {
        const linkedTrack = findTrack(next, linked);
        if (linkedTrack) rippleDelete(next, linkedTrack.id, linked);
      }
    }
    if (!ripple) return this.getState();
    this.engine.loadState(next);
    this.selection.clear();
    return this.getState();
  }

  commitInteraction(label = 'تحرير'): void {
    if (!this.transactionBefore) return;
    const after = this.getState();
    this.history.commit(label, this.transactionBefore, after);
    this.transactionBefore = null;
  }

  cancelInteraction(): void {
    if (this.transactionBefore) this.engine.loadState(this.transactionBefore);
    this.transactionBefore = null;
  }

  undo(): ITimelineState | null {
    const state = this.history.undo(this.getState());
    if (state) this.engine.loadState(state);
    return state;
  }

  redo(): ITimelineState | null {
    const state = this.history.redo(this.getState());
    if (state) this.engine.loadState(state);
    return state;
  }
}

function findClip(state: ITimelineState, clipId: string): [IClip, ITrack] | null {
  for (const track of state.tracks) {
    const clip = track.clips.find((clip) => clip.id === clipId);
    if (clip) return [clip, track];
  }
  return null;
}

function findTrack(state: ITimelineState, clipId: string): ITrack | null {
  return findClip(state, clipId)?.[1] ?? null;
}
