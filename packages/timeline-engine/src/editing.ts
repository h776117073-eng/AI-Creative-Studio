import type { IClip, ITrack, ITimelineState } from './index';

export type EditMode='normal'|'ripple';
export type SnapKind='clip-start'|'clip-end'|'marker'|'playhead'|'grid';
export type SnapTarget={time:number;kind:SnapKind};
export type EditOperation='move'|'trim-start'|'trim-end'|'roll'|'slip'|'slide';
export interface EditResult{changed:boolean;reason?:string;affectedClipIds:string[]}

const clampValue=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
export const cloneTimelineState=(state:ITimelineState):ITimelineState=>structuredClone(state);

export function collectSnapTargets(state:ITimelineState,excludeClipId?:string,includeGrid=true):SnapTarget[]{
  const out:SnapTarget[]=[{time:state.currentTime,kind:'playhead'}];
  if(includeGrid){for(let t=0;t<=state.duration+.25;t+=.25)out.push({time:Number(t.toFixed(6)),kind:'grid'})}
  for(const m of state.markers)out.push({time:m.time,kind:'marker'});
  for(const track of state.tracks)for(const clip of track.clips)if(clip.id!==excludeClipId){out.push({time:clip.startTime,kind:'clip-start'},{time:clip.endTime,kind:'clip-end'})}
  return out.sort((a,b)=>a.time-b.time);
}
export function snapTime(time:number,state:ITimelineState,tolerance:number,excludeClipId?:string):number{
  let best=time,d=Math.max(0,tolerance);for(const x of collectSnapTargets(state,excludeClipId)){const n=Math.abs(x.time-time);if(n<=d){best=x.time;d=n}}return best;
}
export const hasCollision=(track:ITrack,clipId:string,start:number,end:number)=>track.clips.some(c=>c.id!==clipId&&start<c.endTime&&end>c.startTime);
export const sortTracks=(state:ITimelineState)=>state.tracks.forEach(t=>t.clips.sort((a,b)=>a.startTime-b.startTime));
export function recomputeDuration(state:ITimelineState){state.duration=state.tracks.reduce((m,t)=>Math.max(m,...t.clips.map(c=>c.endTime),0),0);return state.duration}

export function moveClip(state:ITimelineState,clipId:string,targetTrackId:string,targetStart:number,options?:{ripple?:boolean;snap?:boolean;tolerance?:number}):EditResult{
  const found=findClip(state,clipId),target=state.tracks.find(t=>t.id===targetTrackId);if(!found||!target)return{changed:false,reason:'Clip or track not found',affectedClipIds:[]};if(target.locked)return{changed:false,reason:'Target track is locked',affectedClipIds:[]};
  const [clip,source]=found;const duration=Math.max(.01,clip.endTime-clip.startTime);let start=Math.max(0,targetStart);if(options?.snap)start=snapTime(start,state,options.tolerance??.033,clipId);
  if(source.id!==target.id){source.clips=source.clips.filter(c=>c.id!==clipId);target.clips.push(clip)}
  if(options?.ripple){let cursor=start+duration;for(const c of target.clips.filter(c=>c.id!==clipId).sort((a,b)=>a.startTime-b.startTime)){if(c.startTime<cursor&&c.endTime>start){const shift=cursor-c.startTime;c.startTime+=shift;c.endTime+=shift;cursor=c.endTime}}}
  else if(hasCollision(target,clipId,start,start+duration)){if(source.id!==target.id){target.clips=target.clips.filter(c=>c.id!==clipId);source.clips.push(clip);sortTracks(state)}return{changed:false,reason:'Collision with another clip',affectedClipIds:[]}}
  clip.startTime=start;clip.endTime=start+duration;clip.duration=duration;sortTracks(state);recomputeDuration(state);return{changed:true,affectedClipIds:[clipId]};
}

export function rippleDelete(state:ITimelineState,trackId:string,clipId:string):EditResult{
  const track=state.tracks.find(t=>t.id===trackId);if(!track||track.locked)return{changed:false,reason:'Track missing or locked',affectedClipIds:[]};const c=track.clips.find(x=>x.id===clipId);if(!c)return{changed:false,reason:'Clip not found',affectedClipIds:[]};const delta=c.duration;track.clips=track.clips.filter(x=>x.id!==clipId);const affected=[clipId];for(const x of track.clips)if(x.startTime>=c.endTime){x.startTime-=delta;x.endTime-=delta;affected.push(x.id)}recomputeDuration(state);return{changed:true,affectedClipIds:affected};
}

export function rippleTrim(state:ITimelineState,clipId:string,edge:'start'|'end',newSourceTime:number,ripple=true):EditResult{
  const found=findClip(state,clipId);if(!found)return{changed:false,reason:'Clip not found',affectedClipIds:[]};const [clip,track]=found;if(track.locked)return{changed:false,reason:'Track is locked',affectedClipIds:[]};
  if(edge==='start'){const next=clampValue(newSourceTime,0,clip.trimEnd-.01);const delta=next-clip.trimStart;const oldStart=clip.startTime;clip.trimStart=next;clip.startTime=Math.max(0,clip.startTime+delta);clip.duration=clip.endTime-clip.startTime;if(ripple){for(const x of track.clips)if(x.id!==clipId&&x.startTime>=oldStart){x.startTime+=delta;x.endTime+=delta}}}
  else{const next=Math.max(clip.trimStart+.01,newSourceTime);const oldEnd=clip.endTime;clip.trimEnd=next;clip.endTime=clip.startTime+(clip.trimEnd-clip.trimStart);clip.duration=clip.endTime-clip.startTime;const delta=clip.endTime-oldEnd;if(ripple&&delta)for(const x of track.clips)if(x.id!==clipId&&x.startTime>=oldEnd){x.startTime+=delta;x.endTime+=delta}}
  sortTracks(state);recomputeDuration(state);return{changed:true,affectedClipIds:track.clips.map(x=>x.id)};
}

export function rollEdit(state:ITimelineState,leftClipId:string,rightClipId:string,newBoundary:number):EditResult{
  const a=findClip(state,leftClipId),b=findClip(state,rightClipId);if(!a||!b||a[1].id!==b[1].id)return{changed:false,reason:'Roll requires the same track',affectedClipIds:[]};const[left],[right]=[a,b];if(Math.abs(left.endTime-right.startTime)>.05)return{changed:false,reason:'Clips are not adjacent',affectedClipIds:[]};const boundary=clampValue(newBoundary,left.startTime+.01,right.endTime-.01);left.endTime=boundary;left.duration=boundary-left.startTime;right.startTime=boundary;right.duration=right.endTime-boundary;recomputeDuration(state);return{changed:true,affectedClipIds:[left.id,right.id]};
}

export function slipEdit(clip:IClip,deltaSourceTime:number,sourceDuration:number):EditResult{
  const delta=clampValue(deltaSourceTime,-clip.trimStart,Math.max(0,sourceDuration-clip.trimEnd));if(delta===0)return{changed:false,reason:'No source media available',affectedClipIds:[]};clip.trimStart+=delta;clip.trimEnd+=delta;return{changed:true,affectedClipIds:[clip.id]};
}

export function slideEdit(state:ITimelineState,clipId:string,deltaTime:number,snap=true,tolerance=.033):EditResult{
  const found=findClip(state,clipId);if(!found)return{changed:false,reason:'Clip not found',affectedClipIds:[]};const[clip,track]=found;const peers=track.clips.filter(c=>c.id!==clipId).sort((a,b)=>a.startTime-b.startTime);const prev=[...peers].reverse().find(c=>c.endTime<=clip.startTime);const next=peers.find(c=>c.startTime>=clip.endTime);if(!prev||!next)return{changed:false,reason:'Slide requires adjacent clips',affectedClipIds:[]};let start=clip.startTime+deltaTime;if(snap)start=snapTime(start,state,tolerance,clipId);const d=start-clip.startTime;if(prev.endTime+d<prev.startTime+.01||next.startTime+d>next.endTime-.01)return{changed:false,reason:'Slide exceeds neighbor media',affectedClipIds:[]};clip.startTime+=d;clip.endTime+=d;prev.endTime+=d;prev.duration=prev.endTime-prev.startTime;next.startTime+=d;next.duration=next.endTime-next.startTime;sortTracks(state);recomputeDuration(state);return{changed:true,affectedClipIds:[prev.id,clip.id,next.id]};
}

export function findClip(state:ITimelineState,clipId:string):[IClip,ITrack]|null{for(const track of state.tracks){const clip=track.clips.find(c=>c.id===clipId);if(clip)return[clip,track]}return null}
