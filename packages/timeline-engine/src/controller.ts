import { TimelineEngine, type IClip, type ITrack, type ITimelineState } from './index.js';
import { rippleTrim, findClip } from './editing.js';
import { addOrUpdateKeyframe, enforceMagneticTrack, linkClips, moveGroup, rippleDeleteGroup, rollEditAdvanced, setSpeedCurve, setTransition, slipEditAdvanced, slideEditAdvanced, unlinkClips, quantizeFrame, sourceDuration, type SpeedPoint } from './advanced-editing.js';
import { SelectionEngine, TrackTargeting, type ClipBounds, type EditIntent } from './interaction.js';
import { TimelineHistory } from './transactions.js';
import { extractRange, freezeFrame, insertClipAt, liftRange, normalizeProfessionalTimeline, rippleTrimLinked, setClipSpeed, setSpeedCurveCapCutStyle, type EditWindow, type InsertMode, type RetimePoint } from './professional-parity.js';

export interface TimelineControllerConfig { id?: string; name?: string; frameRate?: number; maxTracks?: number; snappingTolerance?: number }

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
  boxSelect(bounds: ClipBounds[], rect: { x:number;y:number;width:number;height:number }, additive = false): string[] { return this.selection.boxSelect(bounds, rect, additive); }
  setActiveTrack(trackId: string | null): void { this.targeting.setActive(trackId); }
  toggleTargetTrack(trackId: string): string[] { this.targeting.toggle(trackId); return this.targeting.getTargeted(); }
  setTargetTracks(trackIds: Iterable<string>): void { this.targeting.setTargeted(trackIds); }
  beginInteraction(): void { if (!this.transactionBefore) this.transactionBefore = this.getState(); }

  preview(intent: EditIntent): ITimelineState {
    switch (intent.type) {
      case 'select': if (intent.clipId) this.select(intent.clipId, intent.additive); else this.selection.clear(); return this.getState();
      case 'box-select': return this.getState();
      case 'seek': this.engine.seek(intent.time); return this.getState();
      case 'move': {
        const base = this.transactionBefore ? structuredClone(this.transactionBefore) : this.getState();
        const ids = intent.clipIds.length ? intent.clipIds : this.selection.selectedIds;
        const targetId = intent.trackId || this.targeting.getActive();
        if (!targetId) return this.getState();
        const result = moveGroup(base, ids, targetId, intent.deltaTime, { snap: true, ripple: false, magnetic: true, fps: this.engine.frameRate, tolerance: this.engine.snappingTolerance });
        if (!result.changed) return this.getState();
        this.engine.loadState(base); return this.getState();
      }
      case 'trim-start': {
        const base = this.transactionBefore ? structuredClone(this.transactionBefore) : this.getState();
        const found = findClip(base, intent.clipId); if (!found) return this.getState();
        const max = sourceDuration(found[0]);
        const next = Math.min(max - 0.01, Math.max(0, quantizeFrame(found[0].trimStart + intent.deltaTime, this.engine.frameRate)));
        rippleTrim(base, intent.clipId, 'start', next, false); this.engine.loadState(base); return this.getState();
      }
      case 'trim-end': {
        const base = this.transactionBefore ? structuredClone(this.transactionBefore) : this.getState();
        const found = findClip(base, intent.clipId); if (!found) return this.getState();
        const min = found[0].trimStart + .01; const max = sourceDuration(found[0]);
        const next = Math.min(max, Math.max(min, quantizeFrame(found[0].trimEnd + intent.deltaTime, this.engine.frameRate)));
        rippleTrim(base, intent.clipId, 'end', next, false); this.engine.loadState(base); return this.getState();
      }
      case 'scroll': case 'zoom': return this.getState();
      default: return this.getState();
    }
  }

  previewRoll(leftClipId: string, rightClipId: string, boundary: number): ITimelineState {
    const base = this.transactionBefore ? structuredClone(this.transactionBefore) : this.getState();
    if (rollEditAdvanced(base, leftClipId, rightClipId, boundary, this.engine.frameRate).changed) this.engine.loadState(base);
    return this.getState();
  }
  previewSlip(clipId: string, deltaSourceTime: number): ITimelineState {
    const base = this.transactionBefore ? structuredClone(this.transactionBefore) : this.getState();
    const found = findClip(base, clipId);
    if (found && slipEditAdvanced(found[0], deltaSourceTime, this.engine.frameRate).changed) this.engine.loadState(base);
    return this.getState();
  }
  previewSlide(clipId: string, deltaTime: number): ITimelineState {
    const base = this.transactionBefore ? structuredClone(this.transactionBefore) : this.getState();
    if (slideEditAdvanced(base, clipId, deltaTime, this.engine.frameRate).changed) this.engine.loadState(base);
    return this.getState();
  }

  deleteSelected(ripple = true): ITimelineState {
    const next = this.getState();
    const result = rippleDeleteGroup(next, this.selection.selectedIds, ripple && this.selection.selectedIds.length > 1);
    if (result.changed) this.engine.loadState(next);
    this.selection.clear();
    return this.getState();
  }
  roll(leftClipId: string, rightClipId: string, boundary: number): boolean { return this.transact('Roll Edit', () => rollEditAdvanced(this.engine.getState(), leftClipId, rightClipId, boundary, this.engine.frameRate).changed); }
  slip(clipId: string, deltaSourceTime: number): boolean { return this.transact('Slip Edit', () => { const f=findClip(this.engine.getState(),clipId); return !!f && slipEditAdvanced(f[0],deltaSourceTime,this.engine.frameRate).changed; }); }
  slide(clipId: string, deltaTime: number): boolean { return this.transact('Slide Edit', () => slideEditAdvanced(this.engine.getState(), clipId, deltaTime, this.engine.frameRate).changed); }
  setTransition(clipId: string, edge: 'in'|'out', type: string, duration: number): boolean { return this.transact('Transition', () => setTransition(this.engine.getState(), clipId, edge, type, duration).changed); }
  setSpeedCurve(clipId: string, points: SpeedPoint[]): boolean { return this.transact('Speed Curve', () => { const f=findClip(this.engine.getState(),clipId); return !!f && setSpeedCurve(f[0],points).changed; }); }
  setClipSpeed(clipId: string, speed: number, preservePitch = true): boolean { return this.transact('Clip Speed', () => { const f=findClip(this.engine.getState(),clipId); return !!f && setClipSpeed(f[0],speed,preservePitch).changed; }); }
  setSpeedCurveProfessional(clipId: string, points: RetimePoint[]): boolean { return this.transact('Professional Speed Curve', () => { const f=findClip(this.engine.getState(),clipId); return !!f && setSpeedCurveCapCutStyle(f[0],points,this.engine.frameRate).changed; }); }
  freezeFrame(clipId: string, atTime?: number): boolean { return this.transact('Freeze Frame', () => freezeFrame(this.engine.getState(),clipId,atTime,this.engine.frameRate).changed); }
  insertClip(clip: IClip, trackId: string, startTime: number, mode: InsertMode = 'insert'): boolean { return this.transact('Insert Clip', () => insertClipAt(this.engine.getState(),trackId,clip,startTime,mode,this.engine.frameRate).changed); }
  liftRange(trackIds: string[], window: EditWindow): boolean { return this.transact('Lift Range', () => liftRange(this.engine.getState(),trackIds,window).changed); }
  extractRange(trackIds: string[], window: EditWindow): boolean { return this.transact('Extract Range', () => extractRange(this.engine.getState(),trackIds,window).changed); }
  rippleTrimLinked(clipId: string, edge: 'start'|'end', newSourceTime: number): boolean { return this.transact('Linked Ripple Trim', () => rippleTrimLinked(this.engine.getState(),clipId,edge,newSourceTime,this.engine.frameRate).changed); }
  addKeyframe(clipId: string, keyframe: Omit<import('./index.js').IKeyframe,'id'> & {id?: string}): boolean { return this.transact('Keyframe', () => { const f=findClip(this.engine.getState(),clipId); return !!f && addOrUpdateKeyframe(f[0],keyframe).changed; }); }
  linkSelected(): boolean { return this.transact('Link Clips', () => linkClips(this.engine.getState(), this.selection.selectedIds).changed); }
  unlinkSelected(): boolean { return this.transact('Unlink Clips', () => unlinkClips(this.engine.getState(), this.selection.selectedIds).changed); }
  enforceMagnetic(trackId: string): boolean { return this.transact('Magnetic Track', () => enforceMagneticTrack(this.engine.getState(),trackId).changed); }
  normalize(): boolean { return this.transact('Normalize Timeline', () => normalizeProfessionalTimeline(this.engine.getState(),this.engine.frameRate).changed); }
  commitInteraction(label='تحرير'): void { if (!this.transactionBefore) return; this.history.commit(label,this.transactionBefore,this.getState()); this.transactionBefore=null; }
  cancelInteraction(): void { if (this.transactionBefore) this.engine.loadState(this.transactionBefore); this.transactionBefore=null; }
  undo(): ITimelineState|null { const s=this.history.undo(this.getState()); if (s) this.engine.loadState(s); return s; }
  redo(): ITimelineState|null { const s=this.history.redo(this.getState()); if (s) this.engine.loadState(s); return s; }
  canUndo(): boolean { return this.history.canUndo; }
  canRedo(): boolean { return this.history.canRedo; }
  private transact(label:string, action:()=>boolean): boolean { const before=this.getState(); const changed=action(); if (changed) this.history.commit(label,before,this.getState()); return changed; }
}
