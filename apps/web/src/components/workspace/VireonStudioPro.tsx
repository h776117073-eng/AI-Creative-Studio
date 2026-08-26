import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Timeline } from '@xzdarcy/react-timeline-editor';
import {
  AudioLines, Bot, Camera, Captions, CheckCircle2, ChevronDown, CircleDot, Copy, Eye, Film,
  FlipHorizontal2, FolderOpen, Gauge, Headphones, Image as ImageIcon, Layers3, Lightbulb,
  Lock, Maximize2, MessageCircle, Mic2, Minus, MonitorPlay, Move3D, Music2, Palette, Pause,
  Play, Redo2, RotateCcw, Scissors, Settings2, SlidersHorizontal, Sparkles, Split, Star,
  Trash2, Type, Undo2, Upload, Volume2, VolumeX, Wand2, X, ZoomIn, ZoomOut
} from 'lucide-react';

type Category = 'media'|'templates'|'music'|'text'|'filters'|'effects'|'transitions'|'adjust'|'ai';
type Panel = Category|'assistant'|'settings'|'none';
type InspectorTab = 'basic'|'transform'|'color'|'audio'|'ai';
interface Asset { id:string; name:string; url:string; duration:number; mime:string; local?:boolean }
interface Clip {
  id:string; assetId:string; name:string; startTime:number; endTime:number; trimStart:number; trimEnd:number; duration:number;
  speed?:number; volume?:number; opacity?:number; rotate?:number; flipH?:boolean; flipV?:boolean;
  brightness?:number; contrast?:number; saturation?:number; grayscale?:boolean; fadeIn?:number; fadeOut?:number;
  effects?:string[]; transition?:{type:string;duration:number}; text?:string; fontSize?:number; color?:string; keyframes?:any[];
}
interface Track { id:string; name:string; type:string; clips:Clip[]; muted?:boolean; locked?:boolean; visible?:boolean; height?:number; order?:number }
interface TimelineData { version?:number; duration:number; currentTime:number; tracks:Track[]; markers?:any[] }
interface Project { id:string; name:string; timeline:TimelineData; assets:Asset[]; historyIndex:number; historyLength:number }
interface ToolDef { id:string; label:string; icon:any; command?:string; kind?:'command'|'property'|'open'|'local' }
const TimelineEditor:any = Timeline;
const API = (import.meta.env.VITE_API_URL || 'https://ai-creative-studio-api-0gl6.onrender.com').replace(/\/$/,'');
const api = (p:string) => `${API}${p}`;
const fmt=(n:number)=>{const m=Math.floor(n/60).toString().padStart(2,'0');const s=Math.floor(n%60).toString().padStart(2,'0');const cs=Math.floor((n%1)*100).toString().padStart(2,'0');return `${m}:${s}:${cs}`};
const assetSource=(a?:Asset)=>a ? (a.local ? a.url : api(a.url)) : '';

const CATEGORIES:Record<Category,{label:string;icon:any}>={
  media:{label:'الوسائط',icon:FolderOpen},templates:{label:'قوالب',icon:Film},music:{label:'موسيقى',icon:Music2},text:{label:'نص',icon:Type},
  filters:{label:'ملصقات',icon:Star},effects:{label:'تأثيرات',icon:Sparkles},transitions:{label:'انتقالات',icon:Move3D},adjust:{label:'ضبط',icon:SlidersHorizontal},ai:{label:'أدوات AI',icon:Bot}
};

const TOOLS:Record<Category,ToolDef[]>={
  media:[
    {id:'import',label:'استيراد',icon:Upload,kind:'open'},{id:'duplicate',label:'تكرار',icon:Copy,command:'كرر المقطع'},
    {id:'snapshot',label:'لقطة',icon:Camera,command:'التقط صورة من الإطار الحالي'},{id:'freeze',label:'تجميد',icon:Minus,command:'جمّد الإطار عند المؤشر'}
  ],
  templates:[
    {id:'cinematic',label:'سينمائي',icon:Film,command:'طبّق قالب سينمائي'},{id:'vlog',label:'Vlog',icon:MonitorPlay,command:'طبّق قالب Vlog'},
    {id:'reels',label:'ريلز',icon:ImageIcon,command:'طبّق قالب ريلز'},{id:'promo',label:'إعلاني',icon:Star,command:'طبّق قالب إعلاني'}
  ],
  music:[
    {id:'audio',label:'إضافة صوت',icon:Music2,kind:'open'},{id:'record',label:'تسجيل',icon:Mic2,command:'سجّل تعليقًا صوتيًا'},
    {id:'enhance',label:'تحسين الصوت',icon:AudioLines,command:'حسّن الصوت'},{id:'noise',label:'تقليل الضوضاء',icon:Headphones,command:'قلّل ضوضاء الخلفية'}
  ],
  text:[
    {id:'title',label:'عنوان',icon:Type,kind:'open'},{id:'captions',label:'ترجمة تلقائية',icon:Captions,command:'أنشئ ترجمة تلقائية'},
    {id:'animated',label:'نص متحرك',icon:Sparkles,command:'أضف نصًا متحركًا'},{id:'lowerthird',label:'شريط سفلي',icon:Layers3,command:'أضف شريطًا سفليًا'}
  ],
  filters:[
    {id:'sticker',label:'ملصق',icon:Star,command:'أضف ملصقًا'},{id:'emoji',label:'رموز',icon:CircleDot,command:'أضف رموزًا'},
    {id:'overlay',label:'تراكب',icon:Layers3,command:'أضف طبقة تراكب'},{id:'logo',label:'شعار',icon:Camera,command:'أضف شعارًا'}
  ],
  effects:[
    {id:'blur',label:'تمويه',icon:Sparkles,command:'طبّق تمويه'},{id:'vignette',label:'تظليل',icon:Sparkles,command:'طبّق Vignette'},
    {id:'glow',label:'وهج',icon:Wand2,command:'أضف وهجًا'},{id:'grain',label:'حبيبات',icon:Sparkles,command:'أضف حبيبات فيلم'}
  ],
  transitions:[
    {id:'fade',label:'تلاشي',icon:Move3D,command:'أضف انتقال تلاشي'},{id:'dissolve',label:'مزج',icon:Move3D,command:'أضف انتقال مزج'},
    {id:'zoom',label:'تكبير',icon:ZoomIn,command:'أضف انتقال تكبير'},{id:'wipe',label:'مسح',icon:Move3D,command:'أضف انتقال مسح'}
  ],
  adjust:[
    {id:'brightness',label:'الإضاءة',icon:Lightbulb,kind:'property'},{id:'contrast',label:'التباين',icon:SlidersHorizontal,kind:'property'},
    {id:'saturation',label:'التشبع',icon:Palette,kind:'property'},{id:'night',label:'ليلي سينمائي',icon:Sparkles,command:'اجعل الإضاءة ليلية سينمائية زرقاء'}
  ],
  ai:[
    {id:'cut',label:'قص ذكي',icon:Scissors,command:'اقترح أفضل القصات'},{id:'silence',label:'حذف الصمت',icon:Scissors,command:'احذف فترات الصمت'},
    {id:'beats',label:'مزامنة الإيقاع',icon:Music2,command:'زامن القطع مع الإيقاع'},{id:'enhance',label:'تحسين الجودة',icon:Wand2,command:'حسّن جودة الفيديو'},
    {id:'camera',label:'حركة كاميرا',icon:Move3D,command:'أضف حركة كاميرا سينمائية'},{id:'tracking',label:'تتبع الحركة',icon:Move3D,command:'افتح تتبع الحركة'},
    {id:'reframe',label:'إعادة تأطير',icon:Maximize2,command:'أعد تأطير الفيديو تلقائيًا'},{id:'style',label:'تحليل الأسلوب',icon:Bot,command:'حلّل أسلوب الفيديو واقترح تحسينات'}
  ]
};

function ClipThumb({asset}:{asset?:Asset}){
  if(!asset)return <div className="h-full w-full bg-white/[.04]"/>;
  const src=assetSource(asset);
  if(asset.mime.startsWith('image/'))return <img src={src} className="h-full w-full object-cover" />;
  if(asset.mime.startsWith('video/'))return <video src={src} muted playsInline preload="metadata" className="h-full w-full object-cover"/>;
  return <div className="h-full w-full flex items-center justify-center bg-emerald-500/10"><Volume2 size={18} className="text-emerald-300"/></div>;
}

function RangeRow({label,value,min,max,unit='',onChange}:{label:string;value:number;min:number;max:number;unit?:string;onChange:(n:number)=>void}){
  return <div className="mb-4"><div className="flex justify-between text-xs text-white/60 mb-2"><span>{label}</span><span>{Math.round(value)}{unit}</span></div><input className="w-full accent-violet-500" type="range" min={min} max={max} step={min<0?1:.01} value={value} onChange={e=>onChange(Number(e.target.value))}/></div>;
}

export function VireonStudioPro({projectId}:{projectId:string}){
  const [project,setProject]=useState<Project|null>(null);
  const [selectedClip,setSelectedClip]=useState<string|null>(null);
  const [panel,setPanel]=useState<Panel>('media');
  const [inspector,setInspector]=useState<InspectorTab>('basic');
  const [assistantText,setAssistantText]=useState('');
  const [messages,setMessages]=useState<{role:'user'|'assistant';text:string}[]>([]);
  const [playhead,setPlayhead]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [zoom,setZoom]=useState(1);
  const [status,setStatus]=useState('جاهز');
  const [property,setProperty]=useState<'brightness'|'contrast'|'saturation'|null>(null);
  const fileRef=useRef<HTMLInputElement>(null);
  const videoRef=useRef<HTMLVideoElement>(null);
  const audioRef=useRef<HTMLAudioElement>(null);
  const projectRef=useRef<Project|null>(null);
  useEffect(()=>{projectRef.current=project},[project]);

  const tracks=project?.timeline.tracks||[];
  const clips=tracks.flatMap(t=>t.clips||[]);
  const active=clips.find(c=>c.id===selectedClip)||clips.find(c=>playhead>=c.startTime&&playhead<c.endTime)||clips.find(c=>c.assetId);
  const activeAsset=project?.assets.find(a=>a.id===active?.assetId);
  const duration=Math.max(0.01,project?.timeline.duration||1);

  const saveProject=useCallback((next:Project,remote=true)=>{
    setProject(next);projectRef.current=next;
    if(remote)void fetch(api(`/api/projects/${next.id}/timeline`),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({timeline:next.timeline})}).catch(()=>setStatus('التغييرات محفوظة محليًا فقط'));
  },[]);

  useEffect(()=>{
    (async()=>{
      try{
        let id=projectId;
        if(id==='new'){
          const r=await fetch(api('/api/projects'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'مشروع Vireon جديد'})});
          const d=await r.json(); id=d.id; history.replaceState({},'',`/project/${id}`);
        }
        const r=await fetch(api(`/api/projects/${id}`));
        if(!r.ok)throw new Error('تعذر تحميل المشروع');
        const d=await r.json();setProject(d);projectRef.current=d;
        const first=(d.timeline?.tracks||[]).flatMap((t:Track)=>t.clips||[]).find((c:Clip)=>c.assetId);
        if(first){setSelectedClip(first.id);setPlayhead(first.startTime)}
        setStatus('جاهز');
      }catch(e){setStatus((e as Error).message)}
    })();
  },[projectId]);

  useEffect(()=>{
    const el=activeAsset?.mime.startsWith('audio/')?audioRef.current:videoRef.current;
    if(!el||!active)return;
    const localTime=Math.max(0,(active.trimStart||0)+playhead-active.startTime);
    try{if(Math.abs(el.currentTime-localTime)>.12)el.currentTime=Math.min(Number.isFinite(el.duration)?el.duration:localTime,localTime);el.playbackRate=active.speed||1;}catch{}
  },[playhead,active?.id,active?.startTime,active?.trimStart,active?.speed,activeAsset?.id]);

  useEffect(()=>{
    if(!playing)return;
    const t=window.setInterval(()=>{
      setPlayhead(p=>{
        const n=p+0.05*(active?.speed||1);
        if(n>=duration){setPlaying(false);return 0}return n;
      });
    },50);
    return()=>window.clearInterval(t);
  },[playing,duration,active?.speed]);

  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{
      const target=e.target as HTMLElement;
      if(target?.tagName==='INPUT'||target?.tagName==='TEXTAREA')return;
      if(e.code==='Space'){e.preventDefault();setPlaying(v=>!v)}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();void undo()}
      if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='y'){e.preventDefault();void redo()}
      if(e.key.toLowerCase()==='s'){e.preventDefault();void command(`قسّم عند ${playhead.toFixed(2)}`)}
      if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();void command('احذف المقطع')}
    };
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  });

  const seek=(t:number)=>{const n=Math.max(0,Math.min(duration,t));setPlayhead(n);setProject(p=>p?{...p,timeline:{...p.timeline,currentTime:n}}:p)};

  async function command(text:string){
    if(!projectRef.current||!text.trim())return;
    setStatus('جارٍ تنفيذ الأمر…');setMessages(v=>[...v,{role:'user',text}]);
    try{
      const r=await fetch(api(`/api/projects/${projectRef.current.id}/ai-command`),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,clipId:active?.id,playhead})});
      const d=await r.json();if(!r.ok)throw new Error(d.error||'تعذر تنفيذ الأمر');
      const next={...projectRef.current,timeline:d.timeline} as Project;setProject(next);projectRef.current=next;
      setStatus(d.command?.message||'تم التنفيذ');setMessages(v=>[...v,{role:'assistant',text:d.command?.message||'تم التنفيذ'}]);
    }catch(e){setStatus((e as Error).message);setMessages(v=>[...v,{role:'assistant',text:(e as Error).message}])}
  }

  async function undo(){if(!project?.id)return;const r=await fetch(api(`/api/projects/${project.id}/undo`),{method:'POST'});if(r.ok){const d=await r.json();setProject(d);projectRef.current=d;setStatus('تم التراجع')}}
  async function redo(){if(!project?.id)return;const r=await fetch(api(`/api/projects/${project.id}/redo`),{method:'POST'});if(r.ok){const d=await r.json();setProject(d);projectRef.current=d;setStatus('تمت الإعادة')}}

  const importFiles=async(files:FileList|null)=>{
    if(!files?.length||!projectRef.current)return;
    for(const file of Array.from(files)){
      setStatus(`استيراد ${file.name}…`);
      const local=URL.createObjectURL(file);
      try{
        const form=new FormData();form.append('file',file);
        const r=await fetch(api(`/api/projects/${projectRef.current.id}/upload`),{method:'POST',body:form});
        if(!r.ok)throw new Error('فشل الرفع');
        const d=await r.json();setProject(d);projectRef.current=d;
        const c=d.timeline.tracks.flatMap((t:Track)=>t.clips||[]).filter((x:Clip)=>x.name===file.name).at(-1);
        if(c){setSelectedClip(c.id);setPlayhead(c.startTime)}
        setStatus('تم الاستيراد');
      }catch{
        const p=projectRef.current;const durationFallback=5;const aid=crypto.randomUUID();const cid=crypto.randomUUID();
        const track=p.timeline.tracks.find(t=>t.type===(file.type.startsWith('audio/')?'audio':'video'))||p.timeline.tracks[0];
        const start=track.type==='audio'?Math.max(...tracks.flatMap(t=>t.clips.map(c=>c.endTime)),0):p.timeline.duration;
        const asset:Asset={id:aid,name:file.name,url:local,duration:durationFallback,mime:file.type,local:true};
        const clip:Clip={id:cid,assetId:aid,name:file.name,startTime:start,endTime:start+durationFallback,trimStart:0,trimEnd:durationFallback,duration:durationFallback,speed:1,volume:1,opacity:1,rotate:0,flipH:false,flipV:false,brightness:0,contrast:1,saturation:1,effects:[]};
        const next={...p,assets:[...p.assets,asset],timeline:{...p.timeline,duration:Math.max(p.timeline.duration,start+durationFallback),tracks:p.timeline.tracks.map(t=>t.id===track.id?{...t,clips:[...t.clips,clip]}:t)}};
        saveProject(next,false);setSelectedClip(cid);setPlayhead(start);setStatus('وضع المعاينة المحلية');
      }
    }
  };

  const updateClip=(patch:Partial<Clip>)=>{
    if(!projectRef.current||!active)return;
    const next=structuredClone(projectRef.current) as Project;
    for(const t of next.timeline.tracks){const c=t.clips.find(x=>x.id===active.id);if(c)Object.assign(c,patch)}
    next.timeline.tracks.forEach(t=>t.clips.sort((a,b)=>a.startTime-b.startTime));
    next.timeline.duration=Math.max(0,...next.timeline.tracks.flatMap(t=>t.clips.map(c=>c.endTime)));
    saveProject(next);setStatus('تم التعديل');
  };

  const actionForTool=(t:ToolDef)=>{
    if(t.id==='import'||t.id==='audio'){fileRef.current?.click();return;}
    if(t.id==='title'){
      const text=window.prompt('النص','عنوان جديد');if(text)void command(`أضف نص: ${text}`);return;
    }
    if(t.kind==='property'){setProperty(t.id as any);return;}
    if(t.command)void command(t.command);
  };

  const rows=useMemo(()=>tracks.map(t=>({id:t.id,actions:t.clips.map(c=>({id:c.id,start:c.startTime,end:Math.max(c.endTime,c.startTime+.05),effectId:t.type,data:{clipId:c.id,assetId:c.assetId,name:c.name,mime:project?.assets.find(a=>a.id===c.assetId)?.mime||''}}))})),[tracks,project?.assets]);
  const effects:any={video:{id:'video',name:'فيديو'},audio:{id:'audio',name:'صوت'},text:{id:'text',name:'نص'},overlay:{id:'overlay',name:'تراكب'}};
  const onTimelineChange=(data:any[])=>{
    if(!projectRef.current)return;
    const next=structuredClone(projectRef.current) as Project;
    const map=new Map(data.map(r=>[r.id,r]));
    next.timeline.tracks=next.timeline.tracks.map(t=>{const row:any=map.get(t.id);if(!row)return t;const old=new Map(t.clips.map(c=>[c.id,c]));return {...t,clips:(row.actions||[]).map((a:any)=>{const c=old.get(a.id);return c?{...c,startTime:a.start,endTime:a.end,duration:Math.max(.01,a.end-a.start),trimEnd:c.trimStart+Math.max(.01,a.end-a.start)}:null}).filter(Boolean) as Clip[]}});
    next.timeline.duration=Math.max(0,...next.timeline.tracks.flatMap(t=>t.clips.map(c=>c.endTime)));saveProject(next);
  };

  const renderFilter=(c?:Clip):React.CSSProperties=>{
    if(!c)return{};const f=[`brightness(${100+Math.round((c.brightness||0)*100)}%)`,`contrast(${Math.round((c.contrast??1)*100)}%)`,`saturate(${Math.round((c.saturation??1)*100)}%)`];if(c.grayscale)f.push('grayscale(1)');if(c.effects?.includes('blur'))f.push('blur(2px)');if(c.effects?.includes('vignette'))f.push('contrast(1.02)');return{filter:f.join(' '),transform:`rotate(${c.rotate||0}deg) scaleX(${c.flipH?-1:1}) scaleY(${c.flipV?-1:1})`,opacity:c.opacity??1};
  };

  const exportVideo=()=>{if(!project)return;setStatus('تجهيز التصدير…');window.open(api(`/api/projects/${project.id}/render`),'_blank');setTimeout(()=>setStatus('بدأ التصدير من الخادم'),500)};

  return <div dir="rtl" className="h-screen w-screen overflow-hidden bg-[#080a0f] text-white flex flex-col">
    <input ref={fileRef} type="file" multiple accept="video/*,audio/*,image/*" className="hidden" onChange={e=>{void importFiles(e.target.files);e.currentTarget.value=''}} />
    <header className="h-[72px] shrink-0 bg-[#0b0d12] border-b border-white/[.07] flex items-center justify-between px-5">
      <div className="flex items-center gap-4"><div className="text-2xl font-black tracking-tight"><span className="text-violet-400">V</span>ireon</div><div className="h-7 w-px bg-white/10"/><button className="px-3 py-2 rounded-lg hover:bg-white/[.04] text-sm">{project?.name||'مشروع جديد'} <ChevronDown size={14} className="inline mr-1"/></button></div>
      <div className="flex items-center gap-2"><button className="w-9 h-9 rounded-lg hover:bg-white/[.06]" onClick={undo}><Undo2 size={18}/></button><button className="w-9 h-9 rounded-lg hover:bg-white/[.06]" onClick={redo}><Redo2 size={18}/></button><span className="hidden xl:inline text-xs text-white/35 px-3">{status}</span><div className="flex items-center gap-2 text-xs text-emerald-300"><CheckCircle2 size={15}/> محفوظ</div><select className="bg-white/[.04] border border-white/10 rounded-lg px-3 py-2" defaultValue="1080p"><option>1080p</option><option>4K</option><option>720p</option></select><button onClick={exportVideo} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 font-semibold shadow-lg shadow-violet-900/20">تصدير</button></div>
    </header>

    <div className="flex-1 min-h-0 flex flex-row-reverse">
      <aside className="w-[82px] shrink-0 bg-[#0d0f14] border-l border-white/[.07] flex flex-col items-center py-3 gap-1 overflow-y-auto">
        {(Object.entries(CATEGORIES) as [Category,{label:string;icon:any}][]).map(([id,v])=>{const I=v.icon;return <button key={id} onClick={()=>setPanel(panel===id?'none':id)} className={`w-[70px] rounded-xl py-2.5 text-[10px] flex flex-col items-center gap-1.5 transition ${panel===id?'bg-violet-500/15 text-violet-300':'text-white/45 hover:bg-white/[.04] hover:text-white'}`}><I size={21}/>{v.label}</button>})}
        <div className="mt-auto w-full flex flex-col items-center gap-1"><button onClick={()=>setPanel(panel==='assistant'?'none':'assistant')} className={`w-[70px] rounded-xl py-2.5 text-[10px] flex flex-col items-center gap-1.5 ${panel==='assistant'?'bg-violet-500/15 text-violet-300':'text-white/45'}`}><Bot size={21}/>المساعد</button><button onClick={()=>setPanel(panel==='settings'?'none':'settings')} className={`w-[70px] rounded-xl py-2.5 text-[10px] flex flex-col items-center gap-1.5 ${panel==='settings'?'bg-violet-500/15 text-violet-300':'text-white/45'}`}><Settings2 size={21}/>أساسي</button></div>
      </aside>

      {panel!=='none'&&panel!=='assistant'&&panel!=='settings'&&<section className="w-[300px] shrink-0 bg-[#10131a] border-l border-white/[.07] p-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-3"><h2 className="font-semibold">{CATEGORIES[panel].label}</h2><button onClick={()=>setPanel('none')}><X size={17}/></button></div>
        <div className="grid grid-cols-2 gap-2">{TOOLS[panel].map(t=>{const I=t.icon;return <button key={t.id} onClick={()=>actionForTool(t)} className="rounded-xl border border-white/[.07] bg-white/[.025] p-3 min-h-[82px] hover:bg-white/[.06] flex flex-col items-center justify-center gap-2 text-xs"><I size={22}/><span>{t.label}</span></button>})}</div>
        {panel==='media'&&<div className="mt-4 space-y-2">{project?.assets?.map(a=>{const c=clips.find(x=>x.assetId===a.id);return <button key={a.id} onClick={()=>{if(c){setSelectedClip(c.id);seek(c.startTime);setInspector('basic')}}} className={`w-full p-2 rounded-xl border text-right flex gap-2 ${c?.id===selectedClip?'border-violet-500/60 bg-violet-500/10':'border-white/[.06] bg-black/20'}`}><div className="w-20 h-12 rounded-lg overflow-hidden shrink-0"><ClipThumb asset={a}/></div><div className="min-w-0"><div className="text-xs truncate">{a.name}</div><div className="text-[10px] text-white/35 mt-1">{fmt(a.duration)}</div></div></button>})}</div>}
      </section>}

      <main className="flex-1 min-w-0 min-h-0 flex flex-col">
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_330px] gap-3 p-3">
          <section className="min-h-0 rounded-2xl border border-white/[.07] bg-[#0d1016] overflow-hidden flex flex-col">
            <div className="flex-1 min-h-0 flex items-center justify-center bg-black/20 p-4">
              <div className="relative w-full h-full max-w-[960px] flex items-center justify-center rounded-xl overflow-hidden bg-black">
                {activeAsset?.mime.startsWith('video/')&&<video ref={videoRef} src={assetSource(activeAsset)} playsInline className="max-h-full max-w-full object-contain" style={renderFilter(active)} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onTimeUpdate={e=>{const v=e.currentTarget;setPlayhead(Math.min(duration,(active?.startTime||0)+Math.max(0,v.currentTime-(active?.trimStart||0))))}}/>}
                {activeAsset?.mime.startsWith('audio/')&&<div className="w-full max-w-[620px] rounded-2xl border border-white/10 bg-white/[.03] p-8"><div className="flex items-center gap-4 mb-4"><div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center"><Headphones className="text-emerald-300"/></div><div><div className="font-semibold truncate max-w-[460px]">{activeAsset.name}</div><div className="text-xs text-white/35">{fmt(activeAsset.duration)}</div></div></div><audio ref={audioRef} src={assetSource(activeAsset)} controls className="w-full" onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)}/></div>}
                {activeAsset?.mime.startsWith('image/')&&<img src={assetSource(activeAsset)} className="max-h-full max-w-full object-contain" style={renderFilter(active)}/>} 
                {!activeAsset&&<div className="text-sm text-white/30 text-center"><Upload className="mx-auto mb-3"/>استورد فيديو أو صورة أو صوت للبدء</div>}
                {active?.text&&<div className="absolute left-1/2 -translate-x-1/2 bottom-12 px-5 py-3 rounded-lg bg-black/40 text-2xl font-bold" style={{color:active.color||'#fff',fontSize:active.fontSize||34}}>{active.text}</div>}
                <div className="absolute top-3 right-3 text-[10px] bg-black/50 rounded-lg px-2 py-1 text-white/60">Vireon Pro • {fmt(playhead)}</div>
              </div>
            </div>
            <div className="h-16 shrink-0 border-t border-white/[.07] flex items-center justify-center gap-4"><button className="w-9 h-9 rounded-lg hover:bg-white/[.06]" onClick={()=>seek(playhead-.04)}><RotateCcw size={17}/></button><button onClick={()=>setPlaying(v=>!v)} className="w-11 h-11 rounded-full bg-violet-600 flex items-center justify-center shadow-lg shadow-violet-900/25">{playing?<Pause size={19}/>:<Play size={19} fill="currentColor"/>}</button><button className="w-9 h-9 rounded-lg hover:bg-white/[.06]" onClick={()=>seek(playhead+.04)}><RotateCcw size={17} className="rotate-180"/></button><span className="font-mono text-xs text-white/45">{fmt(playhead)} / {fmt(duration)}</span><button className="w-9 h-9 rounded-lg hover:bg-white/[.06]" onClick={()=>setZoom(z=>Math.min(3,z+.25))}><ZoomIn size={17}/></button><span className="text-[10px] text-white/35">{Math.round(zoom*100)}%</span><button className="w-9 h-9 rounded-lg hover:bg-white/[.06]" onClick={()=>setZoom(z=>Math.max(.5,z-.25))}><ZoomOut size={17}/></button></div>
          </section>

          <section className="rounded-2xl border border-white/[.07] bg-[#10131a] overflow-y-auto">
            {panel==='assistant'?<div className="h-full flex flex-col"><div className="p-4 border-b border-white/[.07] flex items-center justify-between"><div><h3 className="font-semibold">مساعد Vireon</h3><div className="text-[10px] text-white/35 mt-1">تحويل اللغة الطبيعية إلى أوامر تحرير</div></div><button onClick={()=>setPanel('none')}><X size={17}/></button></div><div className="flex-1 p-4 overflow-y-auto space-y-3">{messages.length===0&&<div className="rounded-xl bg-violet-500/10 border border-violet-500/20 p-4 text-xs leading-6 text-white/70">أمثلة: «قص أول 5 ثوانٍ»، «زد السرعة إلى 150%»، «أضف نص: أهلاً بكم»، «طبّق تمويه»، «دوّر 90 درجة».</div>}{messages.map((m,i)=><div key={i} className={`rounded-xl p-3 text-xs ${m.role==='user'?'bg-white/[.04]':'bg-violet-500/10 border border-violet-500/10'}`}>{m.text}</div>)}</div><form onSubmit={e=>{e.preventDefault();const t=assistantText.trim();if(t){setAssistantText('');void command(t)}}} className="p-3 border-t border-white/[.07] flex gap-2"><input value={assistantText} onChange={e=>setAssistantText(e.target.value)} placeholder="اكتب أمرًا…" className="flex-1 bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-sm"/><button className="p-2.5 rounded-lg bg-violet-600"><MessageCircle size={17}/></button></form></div>:panel==='settings'?<div className="p-4"><div className="flex justify-between items-center mb-5"><h3 className="font-semibold">الإعدادات الأساسية</h3><button onClick={()=>setPanel('none')}><X size={17}/></button></div><div className="space-y-3 text-xs"><div className="rounded-xl bg-white/[.03] border border-white/[.06] p-3"><div className="text-white/45 mb-1">محرك التحرير</div><div className="font-semibold">Vireon Pro Timeline</div></div><div className="rounded-xl bg-white/[.03] border border-white/[.06] p-3 flex justify-between"><span>حفظ تلقائي</span><span className="text-emerald-300">مفعّل</span></div><div className="rounded-xl bg-white/[.03] border border-white/[.06] p-3 flex justify-between"><span>الإخراج</span><span>H.264 + AAC</span></div></div></div>:<div className="p-4"><div className="flex items-center justify-between gap-2 mb-4"><div className="min-w-0"><div className="font-semibold truncate">{active?.name||'لا يوجد مقطع'}</div><div className="text-[10px] text-white/35 mt-1">Inspector</div></div><button onClick={()=>setPanel('none')}><X size={17}/></button></div>{active?<><div className="flex gap-1 mb-4 p-1 rounded-lg bg-black/20"><button onClick={()=>setInspector('basic')} className={`flex-1 text-[10px] rounded-md py-2 ${inspector==='basic'?'bg-violet-500/15 text-violet-300':''}`}>أساسي</button><button onClick={()=>setInspector('transform')} className={`flex-1 text-[10px] rounded-md py-2 ${inspector==='transform'?'bg-violet-500/15 text-violet-300':''}`}>تحويل</button><button onClick={()=>setInspector('color')} className={`flex-1 text-[10px] rounded-md py-2 ${inspector==='color'?'bg-violet-500/15 text-violet-300':''}`}>لون</button><button onClick={()=>setInspector('audio')} className={`flex-1 text-[10px] rounded-md py-2 ${inspector==='audio'?'bg-violet-500/15 text-violet-300':''}`}>صوت</button><button onClick={()=>setInspector('ai')} className={`flex-1 text-[10px] rounded-md py-2 ${inspector==='ai'?'bg-violet-500/15 text-violet-300':''}`}>AI</button></div>
              {inspector==='basic'&&<div><RangeRow label="الشفافية" value={(active.opacity??1)*100} min={0} max={100} unit="%" onChange={v=>updateClip({opacity:v/100})}/><button className="w-full rounded-xl border border-white/[.08] bg-white/[.03] p-3 mb-2 flex items-center justify-center gap-2" onClick={()=>updateClip({volume:active.volume===0?1:0})}>{active.volume===0?<VolumeX size={17}/>:<Volume2 size={17}/>} {active.volume===0?'إلغاء الكتم':'كتم الصوت'}</button><button className="w-full rounded-xl border border-white/[.08] bg-white/[.03] p-3 flex items-center justify-center gap-2" onClick={()=>command(`قسّم عند ${playhead.toFixed(2)}`)}><Split size={17}/> تقسيم عند المؤشر</button></div>}
              {inspector==='transform'&&<div><RangeRow label="الدوران" value={active.rotate||0} min={-180} max={180} unit="°" onChange={v=>updateClip({rotate:v})}/><RangeRow label="السرعة" value={(active.speed||1)*100} min={25} max={400} unit="%" onChange={v=>updateClip({speed:v/100})}/><div className="grid grid-cols-2 gap-2"><button className="panel-btn" onClick={()=>updateClip({flipH:!active.flipH})}><FlipHorizontal2 size={17}/>قلب أفقي</button><button className="panel-btn" onClick={()=>updateClip({rotate:(active.rotate||0)+90})}><RotateCcw size={17}/>+90°</button></div></div>}
              {inspector==='color'&&<div><RangeRow label="الإضاءة" value={(active.brightness||0)*100} min={-100} max={100} unit="%" onChange={v=>updateClip({brightness:v/100})}/><RangeRow label="التباين" value={(active.contrast??1)*100} min={25} max={300} unit="%" onChange={v=>updateClip({contrast:v/100})}/><RangeRow label="التشبع" value={(active.saturation??1)*100} min={0} max={300} unit="%" onChange={v=>updateClip({saturation:v/100})}/><button className="panel-btn w-full" onClick={()=>updateClip({grayscale:!active.grayscale})}>{active.grayscale?'إلغاء أبيض وأسود':'أبيض وأسود'}</button></div>}
              {inspector==='audio'&&<div><RangeRow label="مستوى الصوت" value={(active.volume??1)*100} min={0} max={200} unit="%" onChange={v=>updateClip({volume:v/100})}/><RangeRow label="تلاشي دخول" value={(active.fadeIn||0)} min={0} max={4} unit="ث" onChange={v=>updateClip({fadeIn:v})}/><RangeRow label="تلاشي خروج" value={(active.fadeOut||0)} min={0} max={4} unit="ث" onChange={v=>updateClip({fadeOut:v})}/><button className="panel-btn w-full" onClick={()=>command('قلّل ضوضاء الخلفية')}><Headphones size={17}/>تقليل الضوضاء</button></div>}
              {inspector==='ai'&&<div className="space-y-2"><button className="panel-btn w-full" onClick={()=>command('حسّن جودة الفيديو')}><Wand2 size={17}/>تحسين الجودة</button><button className="panel-btn w-full" onClick={()=>command('أنشئ ترجمة تلقائية')}><Captions size={17}/>ترجمة تلقائية</button><button className="panel-btn w-full" onClick={()=>command('أضف حركة كاميرا سينمائية')}><Move3D size={17}/>حركة كاميرا</button><button className="panel-btn w-full" onClick={()=>command('افتح تتبع الحركة')}><Bot size={17}/>تتبع الحركة</button></div>}
            </>:<div className="text-sm text-white/35 text-center py-10">حدد مقطعًا في الخط الزمني.</div>}</div>}
          </section>
        </div>

        <div className="h-[52px] shrink-0 border-t border-white/[.07] bg-[#0b0d12] flex items-center gap-2 px-3 overflow-x-auto"><button className="panel-btn whitespace-nowrap" onClick={()=>command(`قسّم عند ${playhead.toFixed(2)}`)}><Scissors size={16}/>قص</button><button className="panel-btn whitespace-nowrap" onClick={()=>setInspector('transform')}><Gauge size={16}/>سرعة</button><button className="panel-btn whitespace-nowrap" onClick={()=>setPanel(panel==='transitions'?'none':'transitions')}><Move3D size={16}/>انتقال</button><button className="panel-btn whitespace-nowrap" onClick={()=>setPanel(panel==='effects'?'none':'effects')}><Sparkles size={16}/>فلاتر</button><button className="panel-btn whitespace-nowrap" onClick={()=>setInspector('color')}><Palette size={16}/>تعديل اللون</button><button className="panel-btn whitespace-nowrap" onClick={()=>setPanel(panel==='assistant'?'none':'assistant')}><Bot size={16}/>مفتاح AI</button><button className="panel-btn whitespace-nowrap" onClick={()=>command('أضف حركة كاميرا سينمائية')}><Move3D size={16}/>تحريك</button><button className="panel-btn whitespace-nowrap" onClick={()=>command('أضف طبقة تراكب')}><Layers3 size={16}/>مزج</button><button className="panel-btn whitespace-nowrap" onClick={()=>command('أضف نص متحرك')}><Type size={16}/>نص متحرك</button><div className="mr-auto text-[10px] text-white/30 px-2">Space تشغيل • S تقسيم • Delete حذف • Ctrl/Cmd+Z تراجع</div></div>

        <div className="h-[300px] shrink-0 p-3 pt-2"><div className="relative h-full rounded-2xl overflow-hidden border border-white/[.07] bg-[#0b0d12]"><div className="absolute top-0 right-0 bottom-0 w-[122px] bg-[#0a0c11]/95 border-l border-white/[.06] z-20">{tracks.map(t=><div key={t.id} className="h-[58px] border-b border-white/[.05] px-3 flex items-center gap-2 text-[10px] text-white/50"><Eye size={13}/><span className="truncate">{t.name||t.type}</span>{t.locked&&<Lock size={11}/>}</div>)}</div><div className="absolute inset-0 pr-[122px]"><TimelineEditor editorData={rows} effects={effects} scale={5*zoom} scaleWidth={120} scaleSplitCount={10} rowHeight={58} gridSnap={false} autoScroll dragLine style={{height:'100%',width:'100%'}} onChange={(d:any)=>onTimelineChange(d)} onClickTimeArea={(t:number)=>{seek(t);return true}} onClickAction={(_:any,info:any)=>{const a:any=info.action;const id=a.data?.clipId||a.id;const c=clips.find(x=>x.id===id);if(c){setSelectedClip(c.id);seek(c.startTime);setInspector('basic')}}} getActionRender={(a:any)=>{const media=project?.assets.find(x=>x.id===a.data?.assetId);const selected=a.data?.clipId===selectedClip;return <div className={`h-full overflow-hidden rounded-md relative ${selected?'ring-2 ring-violet-400':''}`}><ClipThumb asset={media}/><div className="absolute bottom-1 right-1 left-1 text-[8px] bg-black/50 rounded px-1 py-0.5 truncate">{a.data?.name||''}</div></div>}} onActionMoveEnd={({action,start,end}:any)=>{const id=action.data?.clipId||action.id;if(!projectRef.current)return;const next=structuredClone(projectRef.current) as Project;for(const t of next.timeline.tracks){const c=t.clips.find(x=>x.id===id);if(c){c.startTime=start;c.endTime=end;c.duration=Math.max(.01,end-start);c.trimEnd=c.trimStart+c.duration;break}}next.timeline.duration=Math.max(0,...next.timeline.tracks.flatMap(t=>t.clips.map(c=>c.endTime)));saveProject(next);}} /></div></div></div>
      </main>
    </div>
  </div>;
}
