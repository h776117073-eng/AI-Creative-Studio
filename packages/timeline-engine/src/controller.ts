import { TimelineEngine, type IClip, type ITrack, type ITimelineState } from './index.js';
import { rippleDelete, rippleTrim } from './editing.js';
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
    this.engine = new TimelineEngine({ id: config.id ?? 'vireon-timeline', name: config.name ?? 'Vireon Timeline Engine', frameRate: config.frameRate ?? 30, maxTracks: config.maxTracks ?? 99, snappingTolerance: config.snappingTolerance ?? 0.033 });
  }

  async initialize(): Promise<void> { if (!this.engine.isReady()) await this.engine.initialize(); }
  loadState(state: ITimelineState): void { this.engine.loadState(state); this.selection.clear(); this.transactionBefore = null; }
  getState(): ITimelineState { return this.engine.getState(); }
  select(clipId: string, additive = false): string[] { return this.selection.selectClip(clipId, additive); }
  boxSelect(bounds: ClipBounds[], rect: { x: number; y: number; width: number; height: number }, additive = false): string[] { return this.selection.boxSelect(bounds, rect, additive); }
  beginInteraction(): void { if (!this.transactionBefore) this.transactionBefore = this.getState(); }

  preview(intent: EditIntent): ITimelineState {
    const base = this.transactionBefore ? structuredClone(this.transactionBefore) : this.getState();
    switch (intent.type) {
      case 'select': if (intent.clipId) this.select(intent.clipId, intent.additive); else this.selection.clear(); return this.getState();
      case 'box-select': return this.getState();
      case 'seek': this.engine.seek(intent.time); return this.getState();
      case 'move': {
        const ids = intent.clipIds.length ? intent.clipIds : this.selection.selectedIds;
        const moving = new Set(ids);
        const target = base.tracks.find(track => track.id === intent.trackId);
        if (!target || target.locked) return this.getState();
        const entries: Array<{ clip: IClip; source: ITrack }> = [];
        for (const track of base.tracks) for (const clip of track.clips) if (moving.has(clip.id)) entries.push({ clip, source: track });
        if (!entries.length || entries.some(entry => entry.source.locked)) return this.getState();
        const anchor = entries[0].clip;
        const snappedAnchor = this.engine.snapTime(anchor.startTime + intent.deltaTime, anchor.id);
        const effectiveDelta = snappedAnchor - anchor.startTime;
        const nonMoving = target.clips.filter(clip => !moving.has(clip.id));
        for (const entry of entries) {
          const start = entry.clip.startTime + effectiveDelta, end = entry.clip.endTime + effectiveDelta;
          if (nonMoving.some(other => start < other.endTime && end > other.startTime)) return this.engine.getState();
        }
        for (const track of base.tracks) track.clips = track.clips.filter(clip => !moving.has(clip.id));
        for (const entry of entries) { entry.clip.startTime=Math.max(0,entry.clip.startTime+effectiveDelta); entry.clip.endTime=Math.max(entry.clip.startTime+.01,entry.clip.endTime+effectiveDelta); entry.clip.duration=entry.clip.endTime-entry.clip.startTime; target.clips.push(entry.clip); }
        base.tracks.forEach(track => track.clips.sort((a,b)=>a.startTime-b.startTime));
        base.duration=base.tracks.reduce((max,track)=>Math.max(max,...track.clips.map(clip=>clip.endTime),0),0);
        this.engine.loadState(base); return this.getState();
      }
      case 'trim-start': rippleTrim(base,intent.clipId,'start',Math.max(0,(findClip(base,intent.clipId)?.[0].trimStart??0)+intent.deltaTime),false); this.engine.loadState(base); return this.getState();
      case 'trim-end': { const found=findClip(base,intent.clipId); if(found) rippleTrim(base,intent.clipId,'end',Math.max(found[0].trimStart+.01,found[0].trimEnd+intent.deltaTime),false); this.engine.loadState(base); return this.getState(); }
      case 'scroll':
      case 'zoom': return this.getState();
      default: return this.getState();
    }
  }

  deleteSelected(ripple = true): ITimelineState {
    const next=this.getState(), ids=this.selection.selectedIds, graph=new LinkGraph(next);
    for(const id of ids){ const track=findTrack(next,id); if(track) rippleDelete(next,track.id,id); for(const linked of graph.linkedIds(id)){const t=findTrack(next,linked);if(t)rippleDelete(next,t.id,linked);} }
    if(!ripple)return this.getState(); this.engine.loadState(next); this.selection.clear(); return this.getState();
  }
  commitInteraction(label='تحرير'):void{if(!this.transactionBefore)return;this.history.commit(label,this.transactionBefore,this.getState());this.transactionBefore=null;}
  cancelInteraction():void{if(this.transactionBefore)this.engine.loadState(this.transactionBefore);this.transactionBefore=null;}
  undo():ITimelineState|null{const s=this.history.undo(this.getState());if(s)this.engine.loadState(s);return s;}
  redo():ITimelineState|null{const s=this.history.redo(this.getState());if(s)this.engine.loadState(s);return s;}
}
function findClip(state: ITimelineState, clipId: string): [IClip, ITrack] | null { for (const track of state.tracks) { const clip=track.clips.find(c=>c.id===clipId); if(clip)return [clip,track]; } return null; }
function findTrack(state: ITimelineState, clipId: string): ITrack | null { return findClip(state,clipId)?.[1]??null; }
