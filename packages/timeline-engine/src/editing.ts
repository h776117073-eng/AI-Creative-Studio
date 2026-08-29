import type { IClip, ITrack, ITimelineState } from './index';

export type EditMode = 'normal' | 'ripple';
export type SnapTarget = { time: number; kind: 'clip-start'|'clip-end'|'marker'|'playhead' };

export function clamp(value:number,min:number,max:number){ return Math.max(min,Math.min(max,value)); }

export function collectSnapTargets(state: ITimelineState, excludeClipId?: string): SnapTarget[] {
  const targets: SnapTarget[] = [{ time: state.currentTime, kind: 'playhead' }];
  for (const marker of state.markers) targets.push({ time: marker.time, kind: 'marker' });
  for (const track of state.tracks) for (const clip of track.clips) {
    if (clip.id === excludeClipId) continue;
    targets.push({ time: clip.startTime, kind: 'clip-start' }, { time: clip.endTime, kind: 'clip-end' });
  }
  return targets.sort((a,b)=>a.time-b.time);
}

export function snapTime(time:number, state:ITimelineState, tolerance:number, excludeClipId?:string):number {
  let best=time, distance=tolerance;
  for (const target of collectSnapTargets(state, excludeClipId)) {
    const d=Math.abs(target.time-time);
    if (d<=distance) { best=target.time; distance=d; }
  }
  return best;
}

export function hasCollision(track:ITrack, clipId:string, start:number, end:number):boolean {
  return track.clips.some(c=>c.id!==clipId && start<c.endTime && end>c.startTime);
}

export function resolveMove(track:ITrack, clipId:string, start:number, duration:number, mode:EditMode):{start:number;end:number;shifted:string[]} {
  let nextStart=Math.max(0,start), nextEnd=nextStart+duration;
  const shifted:string[]=[];
  if (mode==='normal') return {start:nextStart,end:nextEnd,shifted};
  const ordered=track.clips.filter(c=>c.id!==clipId).sort((a,b)=>a.startTime-b.startTime);
  for (const clip of ordered) {
    if (clip.startTime>=nextStart && clip.startTime<nextEnd) {
      const delta=nextEnd-clip.startTime;
      clip.startTime+=delta; clip.endTime+=delta; shifted.push(clip.id);
    }
  }
  return {start:nextStart,end:nextEnd,shifted};
}

export function rippleDelete(state:ITimelineState, trackId:string, clipId:string):boolean {
  const track=state.tracks.find(t=>t.id===trackId);
  if(!track || track.locked) return false;
  const index=track.clips.findIndex(c=>c.id===clipId);
  if(index<0) return false;
  const removed=track.clips[index];
  const delta=removed.endTime-removed.startTime;
  track.clips.splice(index,1);
  for(const clip of track.clips) if(clip.startTime>=removed.endTime){
    clip.startTime=Math.max(0,clip.startTime-delta);
    clip.endTime=Math.max(clip.startTime,clip.endTime-delta);
  }
  return true;
}

export function sortTracks(state:ITimelineState){ for(const track of state.tracks) track.clips.sort((a,b)=>a.startTime-b.startTime); }

export function recomputeDuration(state:ITimelineState):number {
  state.duration=state.tracks.reduce((max,t)=>Math.max(max,...t.clips.map(c=>c.endTime),0),0);
  return state.duration;
}
