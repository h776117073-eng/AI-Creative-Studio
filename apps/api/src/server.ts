import express from 'express';
import cors from 'cors';
import multer from 'multer';
import Database from 'better-sqlite3';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { extname, join, resolve, basename } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { registerAIRoute } from './aiRoute.js';

const ROOT=resolve(process.cwd(),'../..');
const DATA=join(ROOT,'data');
const MEDIA=join(DATA,'media');
const EXPORTS=join(DATA,'exports');
mkdirSync(MEDIA,{recursive:true}); mkdirSync(EXPORTS,{recursive:true});

export const db=new Database(join(DATA,'creative-studio.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,timeline_json TEXT NOT NULL,history_json TEXT NOT NULL,history_index INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,name TEXT NOT NULL,path TEXT NOT NULL,mime TEXT NOT NULL,duration REAL NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
`);

export const app=express();
app.use(cors());
app.use(express.json({limit:'2mb'}));
app.use('/media',express.static(MEDIA));

const upload=multer({storage:multer.diskStorage({destination:MEDIA,filename:(_req,file,cb)=>cb(null,`${randomUUID()}${extname(file.originalname).toLowerCase()||'.bin`)}),limits:{fileSize:1024*1024*1024}}});
const now=()=>new Date().toISOString();
const newTrack=(type:string,name:string,order:number)=>({id:randomUUID(),name,type,clips:[],muted:false,locked:false,visible:true,height:type==='audio'?80:60,order});
const timelineTemplate=()=>({version:3,duration:0,currentTime:0,tracks:[newTrack('video','Video 1',0),newTrack('audio','Audio 1',1),newTrack('text','Text 1',2),newTrack('overlay','Overlay 1',3)],markers:[]});
function readDuration(path:string){try{return Number(execFileSync('ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',path],{encoding:'utf8',timeout:30000}).trim())||0;}catch{return 0;}}
function hasAudio(path:string){try{return execFileSync('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=codec_type','-of','default=nw=1:nk=1',path],{encoding:'utf8',timeout:30000}).trim()==='audio';}catch{return false;}}
function getProject(id:string){return db.prepare('SELECT * FROM projects WHERE id=?').get(id) as any;}
function getAssets(id:string){return db.prepare('SELECT * FROM assets WHERE project_id=? ORDER BY created_at').all(id) as any[];}
function payload(id:string){const p=getProject(id);if(!p)return null;return{id:p.id,name:p.name,updatedAt:p.updated_at,createdAt:p.created_at,timeline:JSON.parse(p.timeline_json),historyIndex:p.history_index,historyLength:JSON.parse(p.history_json).length,assets:getAssets(id).map(a=>({...a,url:`/media/${basename(a.path)}`}))};}
function saveTimeline(id:string,timeline:any){const p=getProject(id);if(!p)throw new Error('Project not found');const history=JSON.parse(p.history_json) as any[];const trimmed=history.slice(0,Number(p.history_index)+1);trimmed.push(timeline);const bounded=trimmed.slice(-100);db.prepare('UPDATE projects SET timeline_json=?,history_json=?,history_index=?,updated_at=? WHERE id=?').run(JSON.stringify(timeline),JSON.stringify(bounded),bounded.length-1,now(),id);}
function ensureTrack(timeline:any,type:string,name:string,order:number){let track=timeline.tracks.find((t:any)=>t.type===type);if(!track){track=newTrack(type,name,order);timeline.tracks.push(track);}return track;}
function videoTrack(timeline:any){return ensureTrack(timeline,'video','Video 1',0);}
function audioTrack(timeline:any){return ensureTrack(timeline,'audio','Audio 1',1);}
function normalizeTimeline(timeline:any){for(const track of timeline.tracks)track.clips.sort((a:any,b:any)=>a.startTime-b.startTime);timeline.duration=Math.max(0,...timeline.tracks.flatMap((t:any)=>t.clips.map((c:any)=>c.endTime)));return timeline;}

app.get('/api/health',(_req,res)=>{let ffmpeg=false,ffprobe=false;try{execFileSync('ffmpeg',['-version'],{stdio:'ignore'});ffmpeg=true;}catch{}try{execFileSync('ffprobe',['-version'],{stdio:'ignore'});ffprobe=true;}catch{}res.json({ok:true,ffmpeg,ffprobe,version:'1.3.0-pro-timeline'});});
app.get('/api/projects',(_req,res)=>{const rows=db.prepare('SELECT id,name,created_at,updated_at FROM projects ORDER BY updated_at DESC').all() as any[];res.json(rows.map(p=>({id:p.id,name:p.name,createdAt:p.created_at,updatedAt:p.updated_at})))});
app.post('/api/projects',(req,res)=>{const id=randomUUID();const timeline=timelineTemplate();const ts=now();db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?)').run(id,req.body?.name||'مشروعي الجديد',JSON.stringify(timeline),JSON.stringify([timeline]),0,ts,ts);res.json(payload(id));});
app.get('/api/projects/:id',(req,res)=>{const p=payload(String(req.params.id));if(!p)return res.status(404).json({error:'Project not found'});res.json(p);});

app.post('/api/projects/:id/upload',upload.single('file'),(req,res)=>{
  const projectId=String(req.params.id); const p=getProject(projectId);
  if(!p||!req.file)return res.status(400).json({error:'Project or file missing'});
  const mime=req.file.mimetype||'application/octet-stream';
  const measured=readDuration(req.file.path);
  const duration=measured>0?measured:5;
  const assetId=randomUUID();
  db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').run(assetId,projectId,req.file.originalname,req.file.path,mime,duration,now());
  const timeline=JSON.parse(p.timeline_json);
  const isAudio=mime.startsWith('audio/');
  const track=isAudio?audioTrack(timeline):videoTrack(timeline);
  const start=isAudio?Math.max(0,...timeline.tracks.flatMap((t:any)=>t.clips.map((c:any)=>c.endTime)),0):timeline.duration;
  track.clips.push({id:randomUUID(),assetId,name:req.file.originalname,startTime:start,endTime:start+duration,trimStart:0,trimEnd:duration,duration,speed:1,volume:1,opacity:1,rotate:0,flipH:false,flipV:false,brightness:0,contrast:1,saturation:1,grayscale:false,fadeIn:0,fadeOut:0,effects:[],animations:[],keyframes:[]});
  saveTimeline(projectId,normalizeTimeline(timeline));
  res.json(payload(projectId));
});

app.post('/api/projects/:id/undo',(req,res)=>{const id=String(req.params.id);const p=getProject(id);if(!p)return res.status(404).json({error:'Project not found'});const history=JSON.parse(p.history_json) as any[];if(Number(p.history_index)<=0)return res.status(409).json({error:'Nothing to undo'});const index=Number(p.history_index)-1;db.prepare('UPDATE projects SET timeline_json=?,history_index=?,updated_at=? WHERE id=?').run(JSON.stringify(history[index]),index,now(),id);res.json(payload(id));});
app.post('/api/projects/:id/redo',(req,res)=>{const id=String(req.params.id);const p=getProject(id);if(!p)return res.status(404).json({error:'Project not found'});const history=JSON.parse(p.history_json) as any[];const index=Number(p.history_index)+1;if(index>=history.length)return res.status(409).json({error:'Nothing to redo'});db.prepare('UPDATE projects SET timeline_json=?,history_index=?,updated_at=? WHERE id=?').run(JSON.stringify(history[index]),index,now(),id);res.json(payload(id));});

function atempo(speed:number){let x=Math.max(.25,Math.min(4,speed));const parts:string[]=[];while(x>2){parts.push('atempo=2');x/=2;}while(x<.5){parts.push('atempo=0.5');x/=.5;}parts.push(`atempo=${x}`);return parts.join(',');}

app.post('/api/projects/:id/render',(req,res)=>{
  const id=String(req.params.id);const p=getProject(id);if(!p)return res.status(404).json({error:'Project not found'});
  const timeline=normalizeTimeline(JSON.parse(p.timeline_json));const vtrack=videoTrack(timeline);const videoClips=vtrack.clips.filter((c:any)=>c.duration>0);if(!videoClips.length)return res.status(422).json({error:'No video clips'});
  const audioTracks=timeline.tracks.filter((t:any)=>t.type==='audio'&&!t.muted);const externalAudio=audioTracks.flatMap((t:any)=>t.clips.filter((c:any)=>c.duration>0).map((c:any)=>({...c,track:t})));
  const inputs:string[]=[];let videoInputCount=0;
  for(const clip of videoClips){const asset=db.prepare('SELECT * FROM assets WHERE id=?').get(clip.assetId) as any;if(!asset||!existsSync(asset.path))return res.status(404).json({error:`Media missing for ${clip.name}`});inputs.push('-ss',String(clip.trimStart),'-t',String(Math.max(.01,clip.trimEnd-clip.trimStart)),'-i',asset.path);videoInputCount+=1;if(!hasAudio(asset.path))inputs.push('-f','lavfi','-t',String(Math.max(.01,clip.trimEnd-clip.trimStart)),'-i','anullsrc=channel_layout=stereo:sample_rate=48000');else{}}
  let filter='';let concatInputs='';let idx=0;
  for(const clip of videoClips){const asset=db.prepare('SELECT * FROM assets WHERE id=?').get(clip.assetId) as any;const audio=hasAudio(asset.path);const speed=Math.max(.25,Math.min(4,Number(clip.speed||1)));const volume=Math.max(0,Math.min(4,Number(clip.volume??1)));const vf:string[]=['setpts=PTS-STARTPTS',`setpts=PTS/${speed}`];if(clip.flipH)vf.push('hflip');if(clip.flipV)vf.push('vflip');const rot=((Number(clip.rotate||0)%360)+360)%360;if(rot===90)vf.push('transpose=1');else if(rot===180)vf.push('hflip','vflip');else if(rot===270)vf.push('transpose=2');const br=Number(clip.brightness||0),ct=Number(clip.contrast||1),sat=Number(clip.saturation||1);if(br!==0||ct!==1||sat!==1||clip.grayscale)vf.push(`eq=brightness=${br}:contrast=${ct}:saturation=${clip.grayscale?0:sat}`);if(Number(clip.fadeIn||0)>0)vf.push(`fade=t=in:st=0:d=${Number(clip.fadeIn)}`);const clipDur=Math.max(.01,(clip.trimEnd-clip.trimStart)/speed);if(Number(clip.fadeOut||0)>0){const fo=Math.min(Number(clip.fadeOut),clipDur);vf.push(`fade=t=out:st=${Math.max(0,clipDur-fo)}:d=${fo}`);}filter+=`[${idx}:v:0]${vf.join(',')}[v${idx}];`;const af:string[]=['aresample=48000','asetpts=PTS-STARTPTS'];if(speed!==1)af.push(atempo(speed));if(volume!==1)af.push(`volume=${volume}`);if(Number(clip.fadeIn||0)>0)af.push(`afade=t=in:st=0:d=${Number(clip.fadeIn)}`);if(Number(clip.fadeOut||0)>0){const fo=Math.min(Number(clip.fadeOut),clipDur);af.push(`afade=t=out:st=${Math.max(0,clipDur-fo)}:d=${fo}`);}filter+=audio?`[${idx}:a:0]${af.join(',')}[a${idx}];`:`[${idx+1}:a:0]${af.join(',')}[a${idx}];`;concatInputs+=`[v${idx}][a${idx}]`;idx+=audio?1:2;}
  filter+=`${concatInputs}concat=n=${videoClips.length}:v=1:a=1[cv][ca];`;
  const mainVideoDuration=Math.max(.01,Number(timeline.duration||0));
  const audioLabels:string[]=['[ca]'];
  for(const clip of externalAudio){const asset=db.prepare('SELECT * FROM assets WHERE id=?').get(clip.assetId) as any;if(!asset||!existsSync(asset.path))continue;const inputIndex=idx;inputs.push('-ss',String(clip.trimStart),'-t',String(Math.max(.01,clip.trimEnd-clip.trimStart)),'-i',asset.path);const delay=Math.max(0,Math.round(Number(clip.startTime||0)*1000));const vol=Math.max(0,Math.min(4,Number(clip.volume??1)));filter+=`[${inputIndex}:a:0]aresample=48000,volume=${vol},adelay=${delay}:all=1[ma${inputIndex}];`;audioLabels.push(`[ma${inputIndex}]`);idx+=1;}
  if(audioLabels.length===1)filter+='[ca]apad=pad_dur=0[aout];';else filter+=`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0[aout];`;
  const output=join(EXPORTS,`${randomUUID()}.mp4`);
  const args=['-y',...inputs,'-filter_complex',filter,'-map','[cv]','-map','[aout]','-c:v','libx264','-preset','veryfast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',output];
  const result=spawnSync('ffmpeg',args,{encoding:'utf8',timeout:180000});
  if(result.status!==0||!existsSync(output))return res.status(500).json({error:'FFmpeg render failed',detail:result.stderr?.slice(-3500)});
  res.download(output,'ai-creative-studio.mp4',()=>{try{unlinkSync(output);}catch{}});
});

registerAIRoute(app,db);
if(process.env.NODE_ENV!=='test')app.listen(Number(process.env.PORT||8787),()=>console.log('AI Creative Studio API listening on 8787'));