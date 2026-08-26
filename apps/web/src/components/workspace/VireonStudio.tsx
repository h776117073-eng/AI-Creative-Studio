import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines, AudioWaveform, Bot, Captions, CircleHelp, Contrast, Copy, Download,
  Eye, EyeOff, Film, FolderOpen, Gauge, Home, Image, Layers3, Lightbulb, Lock,
  Maximize2, MessageCircle, Music2, Palette, Pause, Play, Redo2, RotateCcw,
  Scissors, Settings2, Sparkles, Split, Trash2, Type, Undo2, Upload, Volume2,
  VolumeX, Wand2, X, ZoomIn, ZoomOut, FlipHorizontal2, FlipVertical2, Move3D,
  ArrowLeftRight, Snowflake, Camera, CircleDot, Brush, Shapes, MoveHorizontal,
  SlidersHorizontal, ChevronRight, ChevronLeft, Check, Mic2, Search, MonitorPlay
} from 'lucide-react';

type Category = 'media'|'templates'|'music'|'text'|'filters'|'effects'|'transitions'|'adjust'|'ai';
type Panel = 'none'|'media'|'audio'|'text'|'filters'|'effects'|'transitions'|'adjust'|'speed'|'transform'|'assistant'|'settings';
type Tool = { id:string; label:string; icon:React.ComponentType<{size?:number;strokeWidth?:number}>; command?:string; min?:number; max?:number; step?:number; value?:number; unit?:string };
interface Asset { id:string; name:string; url:string; duration:number; mime?:string; pending?:boolean; local?:boolean }
interface Clip { id:string; assetId:string; name:string; startTime:number; endTime:number; trimStart:number; trimEnd:number; duration:number; speed?:number; volume?:number; rotate?:number; brightness?:number; contrast?:number; saturation?:number; grayscale?:boolean; text?:string; effects?:string[] }
interface Track { id:string; type:string; name:string; clips:Clip[]; muted?:boolean; locked?:boolean; visible?:boolean }
interface Timeline { tracks:Track[]; duration:number; currentTime:number }
interface Project { id:string; name:string; timeline:Timeline; assets:Asset[]; historyIndex:number; historyLength:number }

const API=(import.meta.env.VITE_API_URL||'https://ai-creative-studio-api-0gl6.onrender.com').replace(/\/$/,'');
const api=(p:string)=>`${API}${p}`;

const CATEGORIES:Record<Category,{label:string;en:string;icon:React.ComponentType<{size?:number;strokeWidth?:number}>}>={
  media:{label:'الوسائط',en:'Media',icon:FolderOpen},
  templates:{label:'قوالب',en:'Templates',icon:Shapes},
  music:{label:'موسيقى',en:'Music',icon:Music2},
  text:{label:'نص',en:'Text',icon:Type},
  filters:{label:'ملصقات',en:'Stickers',icon:CircleDot},
  effects:{label:'تأثيرات',en:'Effects',icon:Sparkles},
  transitions:{label:'انتقالات',en:'Transitions',icon:ArrowLeftRight},
  adjust:{label:'ضبط',en:'Adjust',icon:SlidersHorizontal},
  ai:{label:'أدوات AI',en:'AI Tools',icon:Bot}
};

const TOOLS:Record<Category,Tool[]>={
  media:[{id:'import',label:'استيراد',icon:Upload},{id:'duplicate',label:'تكرار',icon:Copy,command:'كرر المقطع'},{id:'freeze',label:'تجميد',icon:Snowflake,command:'جمّد الإطار عند المؤشر'},{id:'snapshot',label:'لقطة',icon:Camera,command:'التقط صورة من الإطار الحالي'}],
  templates:[{id:'template-cinematic',label:'سينمائي',icon:Film,command:'طبّق قالب سينمائي'},{id:'template-vlog',label:'Vlog',icon:MonitorPlay,command:'طبّق قالب Vlog'},{id:'template-reels',label:'ريلز',icon:Image,command:'طبّق قالب ريلز'}],
  music:[{id:'add-audio',label:'إضافة صوت',icon:Music2},{id:'record',label:'تسجيل',icon:Mic2,command:'سجّل تعليقًا صوتيًا'},{id:'voice',label:'تحسين الصوت',icon:AudioLines,command:'حسّن الصوت'}],
  text:[{id:'title',label:'عنوان',icon:Type},{id:'caption',label:'ترجمة',icon:Captions,command:'أنشئ ترجمة تلقائية'},{id:'animated-text',label:'نص متحرك',icon:Sparkles,command:'أضف نصًا متحركًا'}],
  filters:[{id:'sticker',label:'ملصق',icon:Shapes,command:'أضف ملصقًا'},{id:'emoji',label:'رموز',icon:CircleDot,command:'أضف رموزًا'},{id:'overlay',label:'تراكب',icon:Layers3,command:'أضف طبقة تراكب'}],
  effects:[{id:'blur',label:'تمويه',icon:CircleDot,command:'طبّق تمويه'},{id:'vignette',label:'تظليل',icon:CircleDot,command:'طبّق Vignette'},{id:'glow',label:'وهج',icon:Sparkles,command:'أضف وهجًا'},{id:'grain',label:'حبيبات',icon:Brush,command:'أضف حبيبات فيلم'}],
  transitions:[{id:'fade',label:'تلاشي',icon:ArrowLeftRight,command:'أضف انتقال تلاشي'},{id:'dissolve',label:'مزج',icon:ArrowLeftRight,command:'أضف انتقال Dissolve'},{id:'zoom',label:'تكبير',icon:ZoomIn,command:'أضف انتقال تكبير'}],
  adjust:[{id:'brightness',label:'الإضاءة',icon:Lightbulb,min:-100,max:100,step:1,value:0,unit:'%'},{id:'contrast',label:'التباين',icon:Contrast,min:10,max:300,step:1,value:100,unit:'%'},{id:'saturation',label:'التشبع',icon:Palette,min:0,max:300,step:1,value:100,unit:'%'},{id:'color',label:'منحنى اللون',icon:Palette,command:'افتح منحنى الألوان'},{id:'night',label:'ليلي سينمائي',icon:Sparkles,command:'اجعل الإضاءة ليلية سينمائية زرقاء'}],
  ai:[{id:'captions',label:'ترجمة تلقائية',icon:Captions,command:'أنشئ ترجمة تلقائية'},{id:'silence',label:'حذف الصمت',icon:Scissors,command:'احذف فترات الصمت'},{id:'beats',label:'مزامنة الإيقاع',icon:Music2,command:'زامن القطع مع الإيقاع'},{id:'enhance',label:'تحسين الجودة',icon:Sparkles,command:'حسّن جودة الفيديو'},{id:'camera',label:'حركة كاميرا',icon:Move3D,command:'أضف حركة كاميرا سينمائية'},{id:'tracking',label:'تتبع الحركة',icon:Move3D,command:'افتح تتبع الحركة'}]
};

const sideTools=[
  {cat:'media' as Category,label:'الوسائط',icon:FolderOpen},
  {cat:'templates' as Category,label:'قوالب',icon:Shapes},
  {cat:'music' as Category,label:'موسيقى',icon:Music2},
  {cat:'text' as Category,label:'نص',icon:Type},
  {cat:'filters' as Category,label:'ملصقات',icon:CircleDot},
  {cat:'effects' as Category,label:'تأثيرات',icon:Sparkles},
  {cat:'transitions' as Category,label:'انتقالات',icon:ArrowLeftRight},
  {cat:'adjust' as Category,label:'ضبط',icon:SlidersHorizontal},
  {cat:'ai' as Category,label:'أدوات AI',icon:Bot}
];

function trackColor(type:string){return type==='video'?'#26395f':type==='audio'?'#174b40':type==='text'?'#63306a':type==='effect'?'#4b3d17':'#313442'}
function formatTime(s:number){const m=Math.floor(s/60).toString().padStart(2,'0');const sec=Math.floor(s%60).toString().padStart(2,'0');const ms=Math.floor((s%1)*100).toString().padStart(2,'0');return `${m}:${sec}:${ms}`}

export function VireonStudio({projectId}:{projectId:string}){
  const [project,setProject]=useState<Project|null>(null);
  const [status,setStatus]=useState('جاري تجهيز المحرر…');
  const [category,setCategory]=useState<Category>('media');
  const [panel,setPanel]=useState<Panel>('media');
  const [selectedClip,setSelectedClip]=useState<string|null>(null);
  const [playhead,setPlayhead]=useState(0);
  const [zoom,setZoom]=useState(1);
  const [playing,setPlaying]=useState(false);
  const [assistant,setAssistant]=useState(false);
  const [settings,setSettings]=useState(false);
  const [language,setLanguage]=useState<'ar'|'en'>('ar');
  const [commandText,setCommandText]=useState('');
  const [chat,setChat]=useState<{role:'user'|'assistant';text:string}[]>([]);
  const [property,setProperty]=useState<Tool|null>(null);
  const [propertyValue,setPropertyValue]=useState(0);
  const fileRef=useRef<HTMLInputElement>(null);
  const videoRef=useRef<HTMLVideoElement>(null);
  const projectRef=useRef<Project|null>(null);

  useEffect(()=>{projectRef.current=project},[project]);
  useEffect(()=>{(async()=>{try{let id=projectId;if(id==='new'){const r=await fetch(api('/api/projects'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'مشروع جديد'})});id=(await r.json()).id;window.history.replaceState({},'',`/project/${id}`)}const r=await fetch(api(`/api/projects/${id}`));const d=await r.json();setProject(d);const first=d.timeline?.tracks?.flatMap((t:Track)=>t.clips||[])[0];if(first)setSelectedClip(first.id);setPlayhead(d.timeline?.currentTime||0);setStatus('جاهز للعمل')}catch{setStatus('تعذر الاتصال بالخادم')}})()},[projectId]);

  const tracks=project?.timeline?.tracks||[];
  const clips=tracks.flatMap(t=>t.clips||[]);
  const selected=clips.find(c=>c.id===selectedClip)||clips[0];
  const asset=project?.assets?.find(a=>a.id===selected?.assetId);
  const duration=Math.max(project?.timeline?.duration||1,1);
  const px=75*zoom;
  const timelineWidth=Math.max(900,duration*px+200);

  useEffect(()=>{if(asset?.mime?.startsWith('video/')&&videoRef.current){const src=asset.local?asset.url:api(asset.url);if(videoRef.current.src!==src){videoRef.current.src=src;videoRef.current.load()}}},[asset?.id]);

  const seek=(t:number)=>{const next=Math.max(0,Math.min(duration,t));setPlayhead(next);setProject(p=>p?{...p,timeline:{...p.timeline,currentTime:next}}:p);if(videoRef.current&&Number.isFinite(videoRef.current.duration))videoRef.current.currentTime=Math.min(next,videoRef.current.duration)};
  const timeFromX=(x:number,rect:DOMRect)=>Math.max(0,(x-rect.left)/px);

  async function command(text:string,id=selected?.id){if(!projectRef.current||!text.trim())return;setStatus(language==='ar'?'جارٍ التنفيذ…':'Executing…');setChat(v=>[...v,{role:'user',text}]);try{const r=await fetch(api(`/api/projects/${projectRef.current.id}/ai-command`),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,clipId:id,playhead})});const d=await r.json();if(!r.ok)throw Error(d?.error||'تعذر تنفيذ الأمر');setProject(p=>p?{...p,timeline:d.timeline}:p);setStatus(d.command?.message||'تم');setChat(v=>[...v,{role:'assistant',text:d.command?.message||'تم تنفيذ الأمر'}])}catch(e){setStatus((e as Error).message);setChat(v=>[...v,{role:'assistant',text:(e as Error).message}])}}

  async function importFiles(files:FileList|null){if(!files?.length||!project)return;for(const file of Array.from(files)){const local=URL.createObjectURL(file);const m=document.createElement(file.type.startsWith('audio/')?'audio':'video');m.preload='metadata';const dur=await new Promise<number>(resolve=>{m.onloadedmetadata=()=>resolve(Number.isFinite(m.duration)?m.duration:0);m.onerror=()=>resolve(0);m.src=local});const kind=file.type.startsWith('audio/')?'audio':'video';const target=project.timeline.tracks.find(t=>t.type===kind)||project.timeline.tracks.find(t=>t.type==='video');if(!target)continue;const start=project.timeline.duration;const aid=`local-${crypto.randomUUID()}`;const cid=`clip-${crypto.randomUUID()}`;const a:Asset={id:aid,name:file.name,url:local,duration:dur,mime:file.type,pending:true,local:true};const c:Clip={id:cid,assetId:aid,name:file.name,startTime:start,endTime:start+dur,trimStart:0,trimEnd:dur,duration:dur,speed:1,volume:1,effects:[]};setProject(p=>p?{...p,assets:[...p.assets,a],timeline:{...p.timeline,duration:Math.max(p.timeline.duration,start+dur),tracks:p.timeline.tracks.map(t=>t.id===target.id?{...t,clips:[...t.clips,c]}:t)}}:p);setSelectedClip(cid);setStatus('المقطع متاح فورًا — الرفع يعمل في الخلفية');try{const f=new FormData();f.append('file',file);const r=await fetch(api(`/api/projects/${project.id}/upload`),{method:'POST',body:f});if(r.ok)setProject(await r.json());setStatus('تم الحفظ')}catch{setStatus('المعاينة المحلية جاهزة')}}}

  const openTool=(tool:Tool)=>{if(tool.id==='import'||tool.id==='add-audio'){fileRef.current?.click();return}if(tool.id==='title'){const text=window.prompt('النص','عنوان جديد');if(text)void command(`أضف نص: ${text}`);return}if(tool.min!==undefined){setProperty(tool);setPropertyValue(tool.value??0);return}if(tool.command)void command(tool.command)};

  const applyProperty=(v:number)=>{setPropertyValue(v);if(!property)return;const map:Record<string,string>={brightness:`اضبط السطوع إلى ${v}%`,contrast:`اضبط التباين إلى ${v}%`,saturation:`اضبط التشبع إلى ${v}%`};if(property.id==='brightness'||property.id==='contrast'||property.id==='saturation')void command(map[property.id]);};

  const split=()=>selected&&void command(`قسّم عند ${playhead.toFixed(2)}`,selected.id);
  const deleteClip=()=>selected&&void command('احذف المقطع',selected.id);
  const mute=()=>selected&&void command('اكتم الصوت',selected.id);
  const undo=async()=>{if(!project)return;const r=await fetch(api(`/api/projects/${project.id}/undo`),{method:'POST'});if(r.ok)setProject(await r.json())};
  const redo=async()=>{if(!project)return;const r=await fetch(api(`/api/projects/${project.id}/redo`),{method:'POST'});if(r.ok)setProject(await r.json())};
  const exportVideo=async()=>{if(!project)return;setStatus('جاري التصدير…');const r=await fetch(api(`/api/projects/${project.id}/render`),{method:'POST'});if(r.ok)setStatus('اكتمل التصدير');else setStatus('تعذر التصدير')};

  const activeTools=TOOLS[category];
  const title=language==='ar'?'Vireon':'Vireon';
  const L=(ar:string,en:string)=>language==='ar'?ar:en;

  return <div dir={language==='ar'?'rtl':'ltr'} className="h-screen w-screen overflow-hidden bg-[#090b10] text-white font-sans select-none">
    <input ref={fileRef} className="hidden" type="file" accept="video/*,audio/*,image/*" multiple onChange={e=>void importFiles(e.target.files)}/>

    <header className="h-16 border-b border-white/10 bg-[#0b0d12] flex items-center justify-between px-4 gap-3">
      <div className="flex items-center gap-3 min-w-0"><div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 grid place-items-center text-lg font-black">V</div><div><div className="font-semibold tracking-wide">{title}</div><div className="text-[10px] text-white/40 truncate">{project?.name||L('مشروع جديد','New Project')}</div></div></div>
      <div className="flex items-center gap-2"><button className="p-2 rounded-lg hover:bg-white/5"><Undo2 size={18}/></button><button className="p-2 rounded-lg hover:bg-white/5"><Redo2 size={18}/></button><div className="text-white/80 text-sm px-3">{L('مشروع جديد','New project')} ✎</div></div>
      <div className="flex items-center gap-2"><button onClick={()=>setSettings(true)} className="p-2 rounded-lg hover:bg-white/5"><Settings2 size={18}/></button><button className="px-3 py-2 rounded-lg bg-white/5 text-sm">☁ {L('حفظ','Save')} <span className="text-emerald-400">✓</span></button><select value="1080p" className="bg-[#141722] border border-white/10 rounded-lg px-3 py-2 text-sm"><option>1080P</option><option>4K</option></select><button onClick={()=>void exportVideo()} className="px-4 py-2 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 font-semibold shadow-lg shadow-violet-900/20">{L('تصدير','Export')}</button></div>
    </header>

    <div className="h-[calc(100vh-64px)] grid grid-cols-[88px_minmax(0,1fr)_96px] gap-2 p-2">
      <aside className="rounded-2xl bg-[#11131a] border border-white/10 overflow-y-auto flex flex-col items-center py-2 gap-1">
        {sideTools.map(({cat,label,icon:Icon})=><button key={cat} onClick={()=>{setCategory(cat);setPanel(cat==='media'?'media':cat as Panel)}} className={`w-[68px] min-h-[64px] rounded-xl flex flex-col items-center justify-center gap-1 text-[11px] ${category===cat?'bg-violet-500/15 text-violet-300 border border-violet-400/30':'text-white/60 hover:bg-white/5'}`}><Icon size={20}/><span>{language==='ar'?label:CATEGORIES[cat].en}</span></button>)}
        <div className="mt-auto w-full px-2"><button onClick={()=>setSettings(true)} className="w-full rounded-xl p-3 text-white/60 hover:bg-white/5 flex flex-col items-center gap-1 text-[11px]"><Settings2 size={18}/><span>{L('إعدادات','Settings')}</span></button></div>
      </aside>

      <main className="min-w-0 grid grid-rows-[minmax(260px,1fr)_minmax(240px,42%)] gap-2 overflow-hidden">
        <section className="grid grid-cols-[minmax(220px,28%)_minmax(360px,1fr)_minmax(220px,28%)] gap-2 min-h-0">
          <div className="rounded-2xl bg-[#11131a] border border-white/10 overflow-hidden min-h-0">
            <div className="h-11 border-b border-white/10 flex items-center justify-between px-3"><span className="font-semibold">{panel==='media'?L('الوسائط','Media'):CATEGORIES[category].label}</span><button onClick={()=>setPanel('none')} className="p-1.5 rounded-md hover:bg-white/5"><X size={16}/></button></div>
            {panel!=='none' && <div className="p-3 space-y-2 overflow-y-auto h-[calc(100%-44px)]">
              {activeTools.map(t=><button key={t.id} onClick={()=>openTool(t)} className="w-full rounded-xl bg-white/[0.03] border border-white/5 p-3 flex items-center justify-between hover:bg-white/[0.06]"><span className="flex items-center gap-3"><span className="w-9 h-9 rounded-lg bg-violet-500/10 text-violet-300 grid place-items-center"><t.icon size={18}/></span><span className="text-sm text-right">{t.label}</span></span><ChevronLeft size={16} className="text-white/30"/></button>)}
              {category==='audio' && <div className="pt-2 space-y-4"><div className="text-sm font-medium">{L('مستوى الصوت','Volume')}</div><input type="range" min="0" max="200" defaultValue="100" className="w-full accent-violet-500" onChange={e=>void command(`اضبط الصوت إلى ${e.target.value}%`)}/><button onClick={mute} className="w-full py-2 rounded-lg border border-white/10">{L('كتم الصوت','Mute')}</button></div>}
              {category==='adjust' && <div className="pt-2 space-y-3"><SliderRow label={L('السطوع','Brightness')} value={property?.id==='brightness'?propertyValue:0} min={-100} max={100} onChange={v=>applyProperty(v)}/><SliderRow label={L('التباين','Contrast')} value={property?.id==='contrast'?propertyValue:100} min={10} max={300} onChange={v=>applyProperty(v)}/><SliderRow label={L('التشبع','Saturation')} value={property?.id==='saturation'?propertyValue:100} min={0} max={300} onChange={v=>applyProperty(v)}/></div>}
            </div>}
          </div>

          <div className="rounded-2xl bg-[#11131a] border border-white/10 overflow-hidden flex flex-col min-h-0">
            <div className="flex-1 min-h-0 p-2 grid place-items-center bg-[#0f1116]"><div className="relative w-full h-full max-w-[680px] rounded-xl bg-black overflow-hidden border border-white/10"><video ref={videoRef} className="w-full h-full object-contain" controls={false} playsInline/><div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 to-transparent flex items-center gap-3"><span className="text-[11px] font-mono">{formatTime(playhead)} / {formatTime(duration)}</span><button onClick={()=>setPlaying(v=>!v)} className="w-9 h-9 rounded-full bg-white/10 grid place-items-center">{playing?<Pause size={17}/>:<Play size={17}/>}</button><button className="p-2 rounded-lg bg-white/10"><Maximize2 size={16}/></button><span className="ml-auto text-xs">9:16</span></div></div></div>
            <div className="h-10 px-3 flex items-center justify-between border-t border-white/10 text-xs text-white/50"><span>{status}</span><span className="flex items-center gap-2"><span>•</span>{selected?.name||L('لا يوجد مقطع','No clip')}</span></div>
          </div>

          <div className="rounded-2xl bg-[#11131a] border border-white/10 overflow-hidden min-h-0">
            <div className="h-11 border-b border-white/10 flex items-center justify-between px-3"><span className="font-semibold">{category==='audio'?L('الصوت','Audio'):category==='adjust'?L('الضبط','Adjust'):CATEGORIES[category].label}</span><button className="p-1.5 rounded-md hover:bg-white/5"><SlidersHorizontal size={16}/></button></div>
            <div className="p-3 space-y-3 overflow-y-auto h-[calc(100%-44px)]">
              {selected ? <><div className="rounded-xl bg-white/[0.03] border border-white/5 p-3"><div className="text-xs text-white/40 mb-1">{L('المقطع المحدد','Selected clip')}</div><div className="text-sm font-medium truncate">{selected.name}</div></div><SliderRow label={L('الصوت','Volume')} value={Math.round((selected.volume??1)*100)} min={0} max={200} onChange={v=>void command(`اضبط الصوت إلى ${v}%`)}/><SliderRow label={L('السطوع','Brightness')} value={selected.brightness??0} min={-100} max={100} onChange={v=>void command(`اضبط السطوع إلى ${v}%`)}/><SliderRow label={L('التباين','Contrast')} value={selected.contrast??100} min={10} max={300} onChange={v=>void command(`اضبط التباين إلى ${v}%`)}/><div className="grid grid-cols-2 gap-2"><button onClick={split} className="py-2.5 rounded-lg bg-violet-500/15 border border-violet-400/20 text-violet-200 flex items-center justify-center gap-2"><Split size={16}/>{L('تقسيم عند المؤشر','Split at playhead')}</button><button onClick={deleteClip} className="py-2.5 rounded-lg bg-red-500/10 border border-red-400/10 text-red-200 flex items-center justify-center gap-2"><Trash2 size={16}/>{L('حذف','Delete')}</button></div></>:<div className="h-full grid place-items-center text-white/30 text-sm">{L('حدد مقطعًا لعرض أدواته','Select a clip')}</div>}
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-[#11131a] border border-white/10 overflow-hidden flex flex-col min-h-0">
          <div className="h-12 border-b border-white/10 flex items-center gap-2 px-3"><button onClick={undo} className="p-2 rounded-lg hover:bg-white/5"><Undo2 size={18}/></button><button onClick={redo} className="p-2 rounded-lg hover:bg-white/5"><Redo2 size={18}/></button><div className="w-px h-6 bg-white/10 mx-1"/><button onClick={()=>setZoom(z=>Math.max(.25,z*.8))} className="p-2 rounded-lg hover:bg-white/5"><ZoomOut size={18}/></button><button onClick={()=>setZoom(z=>Math.min(6,z*1.25))} className="p-2 rounded-lg hover:bg-white/5"><ZoomIn size={18}/></button><div className="text-xs text-white/40 ml-auto">{L('المؤشر','Playhead')}: {formatTime(playhead)}</div></div>
          <div className="flex-1 overflow-auto" onPointerDown={e=>{const el=e.currentTarget.getBoundingClientRect();seek((e.clientX-el.left+e.currentTarget.scrollLeft)/px)}}>
            <div style={{minWidth:timelineWidth}} className="p-3">
              <div className="h-7 flex items-end border-b border-white/5" style={{paddingInlineStart:96}}>{Array.from({length:Math.ceil(duration)+1},(_,i)=><div key={i} style={{width:px}} className="text-[10px] text-white/35 relative"><span>{`00:${i.toString().padStart(2,'0')}`}</span><span className="absolute bottom-0 left-0 w-px h-2 bg-white/20"/></div>)}</div>
              {tracks.map(track=><div key={track.id} className="flex min-h-[64px] border-b border-white/5"><div className="w-24 shrink-0 flex items-center gap-2 text-xs text-white/50 px-2"><Eye size={14}/><span className="truncate">{track.name}</span></div><div className="relative flex-1" style={{height:track.type==='audio'?56:68}}>{track.clips.map(c=>{const left=c.startTime*px;const w=Math.max(60,c.duration*px);const active=c.id===selectedClip;return <button key={c.id} data-clip onClick={e=>{e.stopPropagation();setSelectedClip(c.id);seek(c.startTime)}} className={`absolute top-2 h-[calc(100%-8px)] rounded-lg overflow-hidden border ${active?'border-violet-400 ring-2 ring-violet-500/30':'border-white/10'}`} style={{left,width:w,background:trackColor(track.type)}}><div className="absolute inset-0 bg-gradient-to-r from-black/10 to-white/5"/><div className="relative h-full flex flex-col justify-between p-2 text-left"><div className="text-[10px] font-medium truncate">{c.name}</div>{track.type==='audio'?<div className="h-3 flex items-end gap-px opacity-80">{Array.from({length:20},(_,i)=><span key={i} style={{height:`${20+((i*17)%70)}%`}} className="w-1 rounded-sm bg-emerald-300/80"/>)}</div>:<div className="text-[9px] text-white/40">{formatTime(c.duration)}</div>}</div></button>})}</div></div>)}
              <div className="relative h-0" style={{marginInlineStart:96}}><div className="absolute top-[-calc(100%+100px)] z-30" style={{left:playhead*px-1}}><div className="w-0.5 h-[200px] bg-red-500"/><div className="w-3 h-3 rotate-45 bg-red-500 absolute -top-1 -left-[5px]"/></div></div>
            </div>
          </div>

          <div className="h-[116px] border-t border-white/10 bg-[#0f1117] px-3 py-2 flex flex-col gap-2">
            <div className="flex-1 flex items-stretch gap-2 overflow-x-auto" style={{scrollbarWidth:'none'}}>{activeTools.map(tool=><button key={tool.id} onClick={()=>openTool(tool)} className="min-w-[76px] px-2 rounded-xl flex flex-col items-center justify-center gap-1.5 text-[10px] text-white/70 hover:bg-white/5"><span className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/5 grid place-items-center"><tool.icon size={19}/></span><span>{tool.label}</span></button>)}</div>
            <div className="flex items-center justify-center gap-1 text-[10px] text-white/40"><span className="w-1.5 h-1.5 rounded-full bg-violet-400"/>{L('حرّك الشريط أفقيًا لرؤية المزيد من الأدوات','Swipe horizontally for more tools')}</div>
          </div>
        </section>
      </main>

      <aside className="rounded-2xl bg-[#11131a] border border-white/10 overflow-hidden flex flex-col items-center py-2 gap-1"><div className="text-[10px] text-white/30 py-2">{L('أدوات','Tools')}</div><button onClick={()=>setPanel('adjust')} className={`w-[70px] min-h-[60px] rounded-xl flex flex-col items-center justify-center gap-1 text-[10px] ${panel==='adjust'?'bg-violet-500/15 text-violet-300':'text-white/60'}`}><SlidersHorizontal size={19}/><span>{L('أساسي','Basic')}</span></button><button onClick={()=>setPanel('speed')} className="w-[70px] min-h-[60px] rounded-xl flex flex-col items-center justify-center gap-1 text-[10px] text-white/60"><Gauge size={19}/><span>{L('سرعة','Speed')}</span></button><button onClick={()=>setPanel('transform')} className="w-[70px] min-h-[60px] rounded-xl flex flex-col items-center justify-center gap-1 text-[10px] text-white/60"><Move3D size={19}/><span>{L('تحويل','Transform')}</span></button><button onClick={()=>setPanel('audio')} className={`w-[70px] min-h-[60px] rounded-xl flex flex-col items-center justify-center gap-1 text-[10px] ${panel==='audio'?'bg-violet-500/15 text-violet-300':'text-white/60'}`}><Volume2 size={19}/><span>{L('الصوت','Audio')}</span></button><button onClick={()=>setAssistant(true)} className="w-[70px] min-h-[60px] rounded-xl flex flex-col items-center justify-center gap-1 text-[10px] text-white/60"><Bot size={19}/><span>{L('المساعد','AI')}</span></button><button onClick={()=>setSettings(true)} className="w-[70px] min-h-[60px] rounded-xl flex flex-col items-center justify-center gap-1 text-[10px] text-white/60 mt-auto"><Settings2 size={19}/><span>{L('الإعدادات','Settings')}</span></button></aside>
    </div>

    <button onClick={()=>setAssistant(true)} className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-2xl shadow-violet-900/40 grid place-items-center border border-white/20"><MessageCircle size={23}/></button>

    {assistant&&<Overlay title={L('المساعد الذكي','AI Assistant')} onClose={()=>setAssistant(false)}><div className="space-y-3"><div className="max-h-64 overflow-y-auto space-y-2">{chat.length===0?<div className="rounded-xl bg-white/5 p-3 text-sm text-white/60">{L('قل مثلًا: اجعل الإضاءة ليلية سينمائية زرقاء، أضف حركة كاميرا، ثم خفّض الموسيقى إلى 30%','Try: make the lighting cinematic blue, add camera movement, then lower music to 30%')}</div>:chat.map((m,i)=><div key={i} className={`p-3 rounded-xl text-sm ${m.role==='user'?'bg-violet-500/15 mr-8':'bg-white/5 ml-8'}`}>{m.text}</div>)}</div><div className="flex gap-2"><input value={commandText} onChange={e=>setCommandText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&commandText.trim()){void command(commandText);setCommandText('')}}} placeholder={L('اكتب الأمر…','Write a command…')} className="flex-1 rounded-xl bg-black/20 border border-white/10 px-3 py-3 outline-none"/><button onClick={()=>{if(commandText.trim()){void command(commandText);setCommandText('')}}} className="px-4 rounded-xl bg-violet-500"><Check size={18}/></button></div></div></Overlay>}
    {settings&&<Overlay title={L('الإعدادات','Settings')} onClose={()=>setSettings(false)}><div className="space-y-4"><div className="flex items-center justify-between p-3 rounded-xl bg-white/5"><span>{L('لغة التطبيق','App language')}</span><select value={language} onChange={e=>setLanguage(e.target.value as 'ar'|'en')} className="bg-[#141722] border border-white/10 rounded-lg px-3 py-2"><option value="ar">العربية</option><option value="en">English</option></select></div><div className="p-3 rounded-xl bg-white/5 text-sm text-white/60">{L('الواجهة عربية بالكامل مع ترجمة الأدوات الأساسية واللوحات.','The editor is fully localized for the main tools and panels.')}</div></div></Overlay>}
    {property&&<Overlay title={property.label} onClose={()=>setProperty(null)}><div className="space-y-4"><SliderRow label={property.label} value={propertyValue} min={property.min??0} max={property.max??100} onChange={applyProperty}/><div className="text-xs text-white/40">{propertyValue}{property.unit||''}</div></div></Overlay>}
  </div>;
}

function SliderRow({label,value,min,max,onChange}:{label:string;value:number;min:number;max:number;onChange:(v:number)=>void}){return <div className="space-y-2"><div className="flex items-center justify-between text-xs text-white/70"><span>{label}</span><span>{Math.round(value)}</span></div><input type="range" min={min} max={max} value={value} onChange={e=>onChange(Number(e.target.value))} className="w-full accent-violet-500"/></div>}
function Overlay({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}){return <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm grid place-items-center p-4"><div className="w-full max-w-md rounded-2xl bg-[#151823] border border-white/10 shadow-2xl overflow-hidden" dir="rtl"><div className="h-12 px-4 border-b border-white/10 flex items-center justify-between"><div className="font-semibold">{title}</div><button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5"><X size={17}/></button></div><div className="p-4">{children}</div></div></div>}
