import type { Express, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';

const ROOT=resolve(process.cwd(),'../..');
const EXPORTS=join(ROOT,'data','exports');
mkdirSync(EXPORTS,{recursive:true});

function hasAudio(path:string){try{return execFileSync('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=codec_type','-of','default=nw=1:nk=1',path],{encoding:'utf8',timeout:30000}).trim()==='audio';}catch{return false;}}
function atempo(speed:number){let x=Math.max(.25,Math.min(4,speed));const parts:string[]=[];while(x>2){parts.push('atempo=2');x/=2;}while(x<.5){parts.push('atempo=0.5');x/=.5;}parts.push(`atempo=${x}`);return parts.join(',');}
function escText(text:string){return String(text).replace(/\\/g,'\\\\').replace(/:/g,'\\:').replace(/'/g,"\\'").replace(/%/g,'\\%').replace(/\n/g,'\\n');}

export async function renderProject(req:Request,res:Response,db:Database.Database){
  try{
    const id=String(req.params.id);const p:any=db.prepare('SELECT * FROM projects WHERE id=?').get(id);if(!p)return res.status(404).json({error:'Project not found'});
    const timeline=JSON.parse(p.timeline_json);const videoTrack=timeline.tracks.find((t:any)=>t.type==='video');const videos=(videoTrack?.clips||[]).filter((c:any)=>c.duration>0);
    if(!videos.length)return res.status(422).json({error:'No video clips'});
    const inputs:string[]=[];let next=0;const vf:string[]=[];const af:string[]=[];
    for(const clip of videos){
      const asset:any=db.prepare('SELECT * FROM assets WHERE id=?').get(clip.assetId);if(!asset||!existsSync(asset.path))return res.status(404).json({error:`Media missing for ${clip.name}`});
      const audio=hasAudio(asset.path);const input=next;const clipLength=Math.max(.01,Number(clip.trimEnd)-Number(clip.trimStart));
      inputs.push('-ss',String(clip.trimStart),'-t',String(clipLength),'-i',asset.path);next+=audio?1:2;
      if(!audio)inputs.push('-f','lavfi','-t',String(clipLength),' -i'.trim(),'anullsrc=channel_layout=stereo:sample_rate=48000');
      const speed=Math.max(.25,Math.min(4,Number(clip.speed||1)));const dur=Math.max(.01,clipLength/speed);
      const v:string[]=['setpts=PTS-STARTPTS',`setpts=PTS/${speed}`];
      if(clip.flipH)v.push('hflip');if(clip.flipV)v.push('vflip');
      const rot=((Number(clip.rotate||0)%360)+360)%360;if(rot===90)v.push('transpose=1');else if(rot===180)v.push('hflip','vflip');else if(rot===270)v.push('transpose=2');
      const br=Number(clip.brightness||0),ct=Number(clip.contrast||1),sat=Number(clip.saturation||1);if(br!==0||ct!==1||sat!==1||clip.grayscale)v.push(`eq=brightness=${br}:contrast=${ct}:saturation=${clip.grayscale?0:sat}`);
      const effects=Array.isArray(clip.effects)?clip.effects:[];if(effects.includes('blur'))v.push('boxblur=4:1');if(effects.includes('vignette'))v.push('vignette=PI/4');if(effects.includes('grain'))v.push('noise=alls=7:allf=t+u');if(effects.includes('enhance'))v.push('unsharp=5:5:0.6:5:5:0.0');if(effects.includes('night'))v.push('eq=brightness=-0.08:contrast=1.05:saturation=0.9');
      if(Number(clip.fadeIn||0)>0)v.push(`fade=t=in:st=0:d=${Math.min(Number(clip.fadeIn),dur)}`);if(Number(clip.fadeOut||0)>0){const fo=Math.min(Number(clip.fadeOut),dur);v.push(`fade=t=out:st=${Math.max(0,dur-fo)}:d=${fo}`);}
      const textClips=(timeline.tracks.find((t:any)=>t.type==='text')?.clips||[]).filter((t:any)=>t.startTime<clip.endTime&&t.endTime>clip.startTime&&t.text);for(const t of textClips){const from=Math.max(0,t.startTime-clip.startTime);const to=Math.min(dur,t.endTime-clip.startTime);if(to>from)v.push(`drawtext=text='${escText(t.text)}':fontcolor=${t.color||'white'}:fontsize=${Number(t.fontSize||48)}:x=(w-text_w)/2:y=h*0.82:enable='between(t,${from},${to})'`);}
      v.push('scale=1280:720:force_original_aspect_ratio=decrease','pad=1280:720:(ow-iw)/2:(oh-ih)/2','setsar=1');
      vf.push(`[${input}:v:0]${v.join(',')}[v${vf.length}]`);
      const aFilters=['aresample=48000','asetpts=PTS-STARTPTS',atempo(speed),`volume=${Math.max(0,Math.min(4,Number(clip.volume??1)))}`];
      const audioInput=audio?input:input+1;if(Number(clip.fadeIn||0)>0)aFilters.push(`afade=t=in:st=0:d=${Math.min(Number(clip.fadeIn),dur)}`);if(Number(clip.fadeOut||0)>0){const fo=Math.min(Number(clip.fadeOut),dur);aFilters.push(`afade=t=out:st=${Math.max(0,dur-fo)}:d=${fo}`);}
      if(effects.includes('voice-enhance'))aFilters.push('highpass=f=80','lowpass=f=12000','acompressor=threshold=-18dB:ratio=3:attack=20:release=250:makeup=2');if(effects.includes('noise-reduce'))aFilters.push('afftdn=nf=-25');
      af.push(`[${audioInput}:a:0]${aFilters.join(',')}[a${af.length}]`);
    }
    const joinedV=vf.map((_,i)=>`[v${i}]`).join('');const joinedA=af.map((_,i)=>`[a${i}]`).join('');let filter=`${vf.join(';')};${af.join(';')};${joinedV}concat=n=${vf.length}:v=1:a=0[vout];${joinedA}concat=n=${af.length}:v=0:a=1[basea];`;
    const audioMix=['[basea]'];
    const externals=timeline.tracks.filter((t:any)=>t.type==='audio'&&!t.muted).flatMap((t:any)=>t.clips.filter((c:any)=>c.duration>0));
    for(const clip of externals){const asset:any=db.prepare('SELECT * FROM assets WHERE id=?').get(clip.assetId);if(!asset||!existsSync(asset.path)||!hasAudio(asset.path))continue;const input=next++;inputs.push('-ss',String(clip.trimStart),'-t',String(Math.max(.01,clip.trimEnd-clip.trimStart)),'-i',asset.path);const delay=Math.max(0,Math.round(Number(clip.startTime||0)*1000));const vol=Math.max(0,Math.min(4,Number(clip.volume??1)));filter+=`[${input}:a:0]aresample=48000,volume=${vol},adelay=${delay}:all=1[ma${input}];`;audioMix.push(`[ma${input}]`);}
    filter+=audioMix.length===1?'[basea]anull[aout]':`${audioMix.join('')}amix=inputs=${audioMix.length}:duration=longest:dropout_transition=0:normalize=0[aout]`;
    const output=join(EXPORTS,`${randomUUID()}.mp4`);const result=spawnSync('ffmpeg',['-y',...inputs,'-filter_complex',filter,'-map','[vout]','-map','[aout]','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',output],{encoding:'utf8',timeout:180000});
    if(result.status!==0||!existsSync(output))return res.status(500).json({error:'FFmpeg render failed',detail:result.stderr?.slice(-3500)});
    res.download(output,'vireon-export.mp4',()=>{try{unlinkSync(output)}catch{}});
  }catch(error){console.error('render failed',error);res.status(500).json({error:'Render failed'});}
}

export function registerRenderRoutes(app:Express,db:Database.Database){
  app.get('/api/projects/:id/render',(req,res)=>void renderProject(req,res,db));
  app.post('/api/projects/:id/render',(req,res)=>void renderProject(req,res,db));
  app.get('/api/projects/:id/render-advanced',(req,res)=>void renderProject(req,res,db));
  app.post('/api/projects/:id/render-advanced',(req,res)=>void renderProject(req,res,db));
}
