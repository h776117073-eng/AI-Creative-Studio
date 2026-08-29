import { BaseEngine, EngineConfigSchema } from '@ai-creative-studio/core';
import { EventEmitter } from 'eventemitter3';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const TimelineEngineConfigSchema = EngineConfigSchema.extend({
  maxTracks: z.number().int().min(1).max(999).optional().default(99),
  frameRate: z.number().positive().optional().default(30),
  snappingTolerance: z.number().nonnegative().optional().default(0.033),
});

export type TimelineEngineConfig = z.infer<typeof TimelineEngineConfigSchema>;
export type TrackType = 'video'|'audio'|'text'|'effect'|'overlay';
export type Easing = 'linear'|'ease-in'|'ease-out'|'ease-in-out'|'bezier'|'hold';

export interface IKeyframe {
  id: string;
  time: number;
  property: string;
  value: number|string|object;
  easing: Easing;
  bezierHandles?: [number,number,number,number];
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
  transitionIn?: { type:string; duration:number };
  transitionOut?: { type:string; duration:number };
  linkedClipIds?: string[];
  metadata?: Record<string, unknown>;
}

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
  magnetic?: boolean;
}

export interface IMarker { id:string; time:number; name:string; color:string }
export interface ITimelineState {
  tracks:ITrack[];
  currentTime:number;
  duration:number;
  isPlaying:boolean;
  playbackRate:number;
  loopEnabled:boolean;
  loopRegion?:{start:number;end:number};
  markers:IMarker[];
  snaps:number[];
}

export interface ITimelineEvents {
  'timeline:changed': {state:ITimelineState};
  'timeline:track:added': {track:ITrack};
  'timeline:track:removed': {trackId:string};
  'timeline:clip:added': {trackId:string;clip:IClip};
  'timeline:clip:removed': {trackId:string;clipId:string};
  'timeline:clip:moved': {clipId:string;trackId:string;time:number};
  'timeline:clip:trimmed': {clipId:string;edge:'start'|'end'};
  'timeline:clip:split': {trackId:string;clipIds:string[];time:number};
  'timeline:keyframe:added': {clipId:string;keyframe:IKeyframe};
  'timeline:marker:added': {marker:IMarker};
  'timeline:time:changed': {time:number};
  'timeline:play': {};
  'timeline:pause': {};
  'timeline:stop': {};
}

export class TimelineEngine extends BaseEngine {
  private timelineState:ITimelineState={tracks:[],currentTime:0,duration:0,isPlaying:false,playbackRate:1,loopEnabled:false,markers:[],snaps:[]};
  private timelineEmitter=new EventEmitter<string>();
  private animationFrameId:number|null=null;
  private lastFrameTime=0;
  private frameRate:number;
  private maxTracks:number;
  readonly snappingTolerance:number;

  constructor(config:TimelineEngineConfig){
    const parsed=TimelineEngineConfigSchema.parse(config);
    super(parsed as any);
    this.frameRate=parsed.frameRate ?? 30;
    this.maxTracks=parsed.maxTracks ?? 99;
    this.snappingTolerance=parsed.snappingTolerance ?? 0.033;
  }

  protected async onInitialize():Promise<void>{}
  protected override async onDestroy():Promise<void>{this.stop()}

  getState():ITimelineState{return structuredClone(this.timelineState)}

  addTrack(type:TrackType,name?:string,options?:Partial<ITrack>):ITrack{
    if(this.timelineState.tracks.length>=this.maxTracks) throw new Error('Maximum track count reached');
    const track:ITrack={id:uuidv4(),name:name||`${type} ${this.timelineState.tracks.length+1}`,type,clips:[],muted:false,locked:false,visible:true,height:type==='audio'?80:64,order:this.timelineState.tracks.length,magnetic:type==='video',...options};
    this.timelineState.tracks.push(track); this.emitTimeline('timeline:track:added',{track}); this.changed(); return track;
  }

  removeTrack(trackId:string):void{
    const i=this.timelineState.tracks.findIndex(t=>t.id===trackId); if(i<0)return;
    this.timelineState.tracks.splice(i,1); this.timelineState.tracks.forEach((t,n)=>t.order=n); this.emitTimeline('timeline:track:removed',{trackId}); this.recomputeDuration(); this.changed();
  }

  getTrack(trackId:string){return this.timelineState.tracks.find(t=>t.id===trackId)}
  getAllTracks(){return [...this.timelineState.tracks]}

  addClip(trackId:string,options:{assetId?:string;name:string;startTime:number;duration:number;trimStart?:number;trimEnd?:number;speed?:number}):IClip|null{
    const track=this.getTrack(trackId); if(!track||track.locked)return null;
    const duration=Math.max(.01,options.duration);
    const clip:IClip={id:uuidv4(),assetId:options.assetId,name:options.name,startTime:Math.max(0,options.startTime),endTime:Math.max(0,options.startTime)+duration,trimStart:Math.max(0,options.trimStart??0),trimEnd:Math.max((options.trimStart??0)+.01,options.trimEnd??duration),duration,speed:options.speed??1,opacity:1,effects:[],animations:[],keyframes:[]};
    track.clips.push(clip); this.sortTrack(track); this.recomputeDuration(); this.emitTimeline('timeline:clip:added',{trackId,clip}); this.changed(); return clip;
  }

  removeClip(clipId:string):void{
    const found=this.findClip(clipId); if(!found)return; const [clip,track]=found; track.clips=track.clips.filter(c=>c.id!==clipId); this.emitTimeline('timeline:clip:removed',{trackId:track.id,clipId}); this.recomputeDuration(); this.changed();
  }

  moveClip(clipId:string,targetTrackId:string,targetStart:number,options?:{ripple?:boolean;snap?:boolean;tolerance?:number}):void{
    const found=this.findClip(clipId); const target=this.getTrack(targetTrackId); if(!found||!target||target.locked)return;
    const [clip,source]=found; const duration=clip.duration; let start=Math.max(0,targetStart);
    if(options?.snap) start=this.snapTime(start,clipId,options.tolerance);
    if(source.id!==target.id){source.clips=source.clips.filter(c=>c.id!==clipId);target.clips.push(clip)}
    if(options?.ripple)this.pushOverlaps(target,clipId,start+duration);
    else if(this.collision(target,clipId,start,start+duration)){if(source.id!==target.id){target.clips=target.clips.filter(c=>c.id!==clipId);source.clips.push(clip);this.sortTrack(source)}return}
    clip.startTime=start; clip.endTime=start+duration; this.sortTrack(target); this.recomputeDuration(); this.emitTimeline('timeline:clip:moved',{clipId,trackId:target.id,time:start}); this.changed();
  }

  trimClip(clipId:string,edge:'start'|'end',newSourceTime:number,ripple=true):void{
    const found=this.findClip(clipId);if(!found)return;const [clip,track]=found;if(track.locked)return;
    if(edge==='start'){
      const next=Math.max(0,Math.min(newSourceTime,clip.trimEnd-.01));const delta=next-clip.trimStart;clip.trimStart=next;clip.startTime=Math.max(0,clip.startTime+delta);clip.duration=clip.endTime-clip.startTime;
      if(ripple)this.shiftFollowing(track,clip.id,clip.startTime-delta,delta);
    }else{
      const next=Math.max(clip.trimStart+.01,newSourceTime);const oldEnd=clip.endTime;clip.trimEnd=next;clip.endTime=clip.startTime+(clip.trimEnd-clip.trimStart);clip.duration=clip.endTime-clip.startTime;const delta=clip.endTime-oldEnd;if(ripple&&delta!==0)this.shiftFollowing(track,clip.id,oldEnd,delta);
    }
    this.sortTrack(track);this.recomputeDuration();this.emitTimeline('timeline:clip:trimmed',{clipId,edge});this.changed();
  }

  rippleDelete(trackId:string,clipId:string):void{
    const track=this.getTrack(trackId);if(!track||track.locked)return;const clip=track.clips.find(c=>c.id===clipId);if(!clip)return;const delta=clip.duration;track.clips=track.clips.filter(c=>c.id!==clipId);this.shiftFollowing(track,clipId,clip.endTime,-delta);this.recomputeDuration();this.changed();
  }

  splitClip(clipId:string,time:number):[IClip,IClip]|null{
    const found=this.findClip(clipId);if(!found)return null;const [clip,track]=found;if(time<=clip.startTime||time>=clip.endTime)return null;const ratio=(time-clip.startTime)/clip.duration;const firstDuration=time-clip.startTime;const second:IClip={...structuredClone(clip),id:uuidv4(),name:`${clip.name} (2)`,startTime:time,endTime:clip.endTime,trimStart:clip.trimStart+(clip.trimEnd-clip.trimStart)*ratio,duration:clip.endTime-time};clip.endTime=time;clip.trimEnd=clip.trimStart+(clip.trimEnd-clip.trimStart)*ratio;clip.duration=firstDuration;clip.keyframes=clip.keyframes.filter(k=>k.time<=time);second.keyframes=second.keyframes.filter(k=>k.time>=time).map(k=>({...k,time:k.time-time}));track.clips.push(second);this.sortTrack(track);this.emitTimeline('timeline:clip:split',{trackId:track.id,clipIds:[clip.id,second.id],time});this.changed();return [clip,second];
  }

  addKeyframe(clipId:string,property:string,value:number|string|object,options?:{easing?:Easing;bezierHandles?:[number,number,number,number]}):IKeyframe|null{
    const found=this.findClip(clipId);if(!found)return null;const key:IKeyframe={id:uuidv4(),time:this.timelineState.currentTime,property,value,easing:options?.easing??'ease-in-out',bezierHandles:options?.bezierHandles};found[0].keyframes.push(key);found[0].keyframes.sort((a,b)=>a.time-b.time);this.emitTimeline('timeline:keyframe:added',{clipId,keyframe:key});this.changed();return key;
  }

  addMarker(time:number,name:string,color='#8b5cf6'):IMarker{const marker={id:uuidv4(),time:this.clampTime(time),name,color};this.timelineState.markers.push(marker);this.timelineState.markers.sort((a,b)=>a.time-b.time);this.emitTimeline('timeline:marker:added',{marker});this.changed();return marker}
  removeMarker(id:string):void{this.timelineState.markers=this.timelineState.markers.filter(m=>m.id!==id);this.changed()}

  seek(time:number):void{this.timelineState.currentTime=this.clampTime(time);this.emitTimeline('timeline:time:changed',{time:this.timelineState.currentTime});this.changed()}
  setPlaybackRate(rate:number):void{this.timelineState.playbackRate=clamp(rate,.05,16);this.changed()}
  setLoop(enabled:boolean,region?:{start:number;end:number}):void{this.timelineState.loopEnabled=enabled;this.timelineState.loopRegion=enabled?region:undefined;this.changed()}
  play():void{if(this.timelineState.isPlaying)return;this.timelineState.isPlaying=true;this.lastFrameTime=performance.now();this.emitTimeline('timeline:play',{});this.changed();this.tick()}
  pause():void{this.timelineState.isPlaying=false;if(this.animationFrameId!==null&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(this.animationFrameId);this.animationFrameId=null;this.emitTimeline('timeline:pause',{});this.changed()}
  stop():void{this.pause();this.timelineState.currentTime=0;this.emitTimeline('timeline:stop',{});this.changed()}
  canUndo(){return false}

  snapTime(time:number,excludeClipId?:string,tolerance=this.snappingTolerance):number{
    let best=time,bestDistance=Math.max(0,tolerance);for(const target of this.snapTargets(excludeClipId)){const d=Math.abs(target-time);if(d<=bestDistance){best=target;bestDistance=d}}return best;
  }
  getSnapTargets(excludeClipId?:string){return this.snapTargets(excludeClipId)}

  private snapTargets(excludeClipId?:string):number[]{const targets=[this.timelineState.currentTime,...this.timelineState.markers.map(m=>m.time)];for(const t of this.timelineState.tracks)for(const c of t.clips)if(c.id!==excludeClipId)targets.push(c.startTime,c.endTime);return targets.sort((a,b)=>a-b)}
  private pushOverlaps(track:ITrack,clipId:string,end:number){let cursor=end;for(const c of track.clips.filter(x=>x.id!==clipId).sort((a,b)=>a.startTime-b.startTime)){if(c.startTime<cursor&&c.endTime>cursor){const d=cursor-c.startTime;c.startTime+=d;c.endTime+=d;cursor=c.endTime}}}
  private shiftFollowing(track:ITrack,_exclude:string,threshold:number,delta:number){for(const c of track.clips)if(c.startTime>=threshold){c.startTime=Math.max(0,c.startTime+delta);c.endTime=Math.max(c.startTime+.01,c.endTime+delta)}}
  private collision(track:ITrack,clipId:string,start:number,end:number){return track.clips.some(c=>c.id!==clipId&&start<c.endTime&&end>c.startTime)}
  private findClip(id:string):[IClip,ITrack]|null{for(const t of this.timelineState.tracks){const c=t.clips.find(x=>x.id===id);if(c)return[c,t]}return null}
  private sortTrack(track:ITrack){track.clips.sort((a,b)=>a.startTime-b.startTime)}
  private recomputeDuration(){this.timelineState.duration=this.timelineState.tracks.reduce((m,t)=>Math.max(m,...t.clips.map(c=>c.endTime),0),0)}
  private clampTime(time:number){return clamp(time,0,this.timelineState.duration)}
  private changed(){this.emitTimeline('timeline:changed',{state:this.getState()});this.emitEvent({type:'state:change',timestamp:Date.now(),source:this.id})}
  private emitTimeline(event:keyof ITimelineEvents,data:unknown){this.timelineEmitter.emit(event as string,data)}
  private tick=()=>{if(!this.timelineState.isPlaying)return;const now=performance.now();const delta=Math.max(1/240,(now-this.lastFrameTime)/1000);this.lastFrameTime=now;let next=this.timelineState.currentTime+delta*this.timelineState.playbackRate;if(this.timelineState.loopEnabled&&this.timelineState.loopRegion&&next>=this.timelineState.loopRegion.end)next=this.timelineState.loopRegion.start;if(next>=this.timelineState.duration&&!this.timelineState.loopEnabled){this.timelineState.currentTime=this.timelineState.duration;this.pause();return}this.timelineState.currentTime=next;this.emitTimeline('timeline:time:changed',{time:next});if(typeof requestAnimationFrame==='function')this.animationFrameId=requestAnimationFrame(this.tick);else this.animationFrameId=setTimeout(this.tick,1000/this.frameRate) as unknown as number}

  on<E extends keyof ITimelineEvents>(event:E,listener:(data:ITimelineEvents[E])=>void):this{this.timelineEmitter.on(event as string,listener as any);return this}
  off<E extends keyof ITimelineEvents>(event:E,listener:(data:ITimelineEvents[E])=>void):this{this.timelineEmitter.off(event as string,listener as any);return this}
  getCapabilities():string[]{return['timeline:play','timeline:pause','timeline:stop','timeline:seek','timeline:track-add','timeline:track-remove','timeline:clip-add','timeline:clip-remove','timeline:clip-move','timeline:clip-split','timeline:clip-trim','timeline:ripple-delete','timeline:ripple-trim','timeline:roll','timeline:slip','timeline:slide','timeline:keyframe','timeline:markers','timeline:snapping','timeline:collision-resolution','timeline:multi-track','timeline:loop-playback']}
}

export function clamp(value:number,min:number,max:number){return Math.max(min,Math.min(max,value))}
export * from './editing.js';
