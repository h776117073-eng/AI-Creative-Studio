import type { IClip, ITrack, ITimelineState } from './index.js';
import {
  assignTrackRole,
  extractRange,
  freezeFrame,
  getTrackRole,
  insertClipAt,
  liftRange,
  normalizeProfessionalTimeline,
  normalizeSpeed,
  setClipSpeed,
  setSpeedCurveCapCutStyle,
  validateTransitionPair,
} from './professional-parity.js';

const assert = (value: unknown, message: string): asserts value => { if (!value) throw new Error(message); };
const close = (a:number,b:number,eps=1e-4)=>Math.abs(a-b)<=eps;
const clip=(id:string,start:number,end:number,sourceDuration=12):IClip=>({id,name:id,startTime:start,endTime:end,trimStart:0,trimEnd:end-start,duration:end-start,speed:1,opacity:1,effects:[],animations:[],keyframes:[],metadata:{sourceDuration}});
const state=(tracks:ITrack[]):ITimelineState=>({tracks,currentTime:0,duration:Math.max(0,...tracks.flatMap(t=>t.clips.map(c=>c.endTime))),isPlaying:false,playbackRate:1,loopEnabled:false,markers:[],snaps:[]});

export function runProfessionalParitySelfTest(): void {
  assert(normalizeSpeed(1000)===100,'speed max normalization failed');
  assert(normalizeSpeed(0.01)===0.1,'speed min normalization failed');

  const main:ITrack={id:'main',name:'Main',type:'video',clips:[clip('a',0,2),clip('b',2,4)],muted:false,locked:false,visible:true,height:64,order:0,magnetic:true};
  const s=state([main]);
  assignTrackRole(main,'main');
  assert(getTrackRole(main)==='main','track role failed');

  const incoming=clip('new',0,1);
  assert(insertClipAt(s,'main',incoming,1,'insert',30).changed,'insert failed');
  assert(close(main.clips.find(c=>c.id==='a')!.startTime,0),'insert moved first clip');
  assert(close(main.clips.find(c=>c.id==='new')!.startTime,1),'insert position wrong');
  assert(main.clips.some(c=>c.id==='new'),'inserted clip missing');

  const overwrite=clip('over',0,1);
  assert(insertClipAt(s,'main',overwrite,0,'overwrite',30).changed,'overwrite failed');
  assert(main.clips.some(c=>c.id==='over'),'overwrite clip missing');

  const speed=clip('speed',0,4);
  assert(setClipSpeed(speed,100,true).changed && speed.speed===100,'100x clip speed failed');
  assert(speed.metadata?.preservePitch===true,'pitch flag missing');
  assert(setSpeedCurveCapCutStyle(speed,[{time:0,speed:0.1},{time:2,speed:100}],30).changed,'speed curve failed');
  const curve=speed.metadata?.speedCurve as Array<{time:number;speed:number}>;
  assert(curve.length===2 && curve[1].speed===100,'speed curve range failed');

  const freeze=clip('freeze',0,3,10);
  const freezeState=state([{...main,id:'freeze-track',clips:[freeze]}]); freezeState.currentTime=1.1;
  assert(freezeFrame(freezeState,'freeze',undefined,30).changed,'freeze frame failed');
  assert(freeze.metadata?.speedMode==='freeze','freeze mode missing');

  const sourceA=clip('sa',0,2,20), sourceB=clip('sb',2,4,20);
  sourceA.trimEnd=5; sourceB.trimStart=2;
  assert(validateTransitionPair(sourceA,sourceB,99) > 0,'transition capacity missing');

  const rangeTrack:ITrack={...main,id:'range',clips:[clip('r1',0,1),clip('r2',1,2),clip('r3',2,3)]};
  const rangeState=state([rangeTrack]);
  const lift=liftRange(rangeState,['range'],{start:1,end:2});
  assert(lift.changed && !rangeTrack.clips.some(c=>c.id==='r2'),'lift range failed');
  const extTrack:ITrack={...main,id:'extract',clips:[clip('e1',0,1),clip('e2',1,2),clip('e3',2,3)]};
  const extState=state([extTrack]);
  const extract=extractRange(extState,['extract'],{start:1,end:2});
  assert(extract.changed && extTrack.clips.length===1 && extTrack.clips[0].id==='e2','extract range failed');

  const messy=state([{...main,id:'normalize',clips:[{...clip('n',0.011,1.021),speed:1000,trimStart:-2,trimEnd:0.1}]}]);
  assert(normalizeProfessionalTimeline(messy,30).changed,'normalization failed');
  const n=messy.tracks[0].clips[0];
  assert(close(n.startTime,0) && n.speed===100 && n.trimStart===0 && n.duration>0,'normalization constraints failed');

  console.log('professional timeline parity self-test: PASS');
}

if (import.meta.url.endsWith('/professional-parity-self-test.ts')) {
  try { runProfessionalParitySelfTest(); } catch (error) { console.error(error); process.exitCode=1; }
}
