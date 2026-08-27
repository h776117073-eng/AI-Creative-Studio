import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines, Bot, Camera, Captions, ChevronDown, ChevronLeft, ChevronRight, CircleDot,
  Copy, Download, Eye, EyeOff, FileInput, Film, FolderOpen, Gauge, GripVertical, Headphones,
  Image as ImageIcon, Layers3, Lightbulb, Lock, Maximize2, MessageCircle, Mic2, Minus, Move3D,
  Music2, Pause, Play, Plus, Redo2, RotateCcw, Save, Scissors, Settings2, SlidersHorizontal,
  Sparkles, Split, Star, Trash2, Type, Undo2, Upload, Volume2, VolumeX, Wand2, X, ZoomIn, ZoomOut
} from 'lucide-react';

type Category = 'media'|'templates'|'music'|'text'|'filters'|'effects'|'transitions'|'adjust'|'ai';
type Panel = Category|'assistant'|'settings'|'project'|'none';
type InspectorTab = 'basic'|'transform'|'color'|'audio'|'ai';
interface Asset { id:string; name:string; url:string; duration:number; mime:string; local?:boolean }
interface Clip {
  id:string; assetId:string; name:string; startTime:number; endTime:number; trimStart:number; trimEnd:number; duration:number;
  speed?:number; volume?:number; opacity?:number; rotate?:number; flipH?:boolean; flipV?:boolean;
  brightness?:number; contrast?:number; saturation?:number; grayscale?:boolean; fadeIn?:number; fadeOut?:number;
  effects?:string[]; transition?:{type:string;duration:number}; text?:string; fontSize?:number; color?:string;
}
interface Track { id:string; name:string; type:string; clips:Clip[]; muted?:boolean; locked?:boolean; visible?:boolean; height?:number; order?:number }
interface Timeline { version?:number; duration:number; currentTime:number; tracks:Track[]; markers?:Array<{id:string,time:number,label?:string}> }
interface Project { id:string; name:string; timeline:Timeline; assets:Asset[]; historyIndex:number; historyLength:number }
type Tool = { id:string; label:string; icon:any; command?:string; property?:'brightness'|'contrast'|'saturation'; open?:boolean };

const API=(import.meta.env.VITE_API_URL||'https://ai-creative-studio-api-0gl6.onrender.com').replace(/\/$/,'');
const api=(path:string)=>`${API}${path}`;
const fmt=(value:number)=>{const mm=Math.floor(value/60).toString().padStart(2,'0');const ss=Math.floor(value%60).toString().padStart(2,'0');const cs=Math.floor((value%1)*100).toString().padStart(2,'0');return `${mm}:${ss}:${cs}`};
const assetUrl=(asset?:Asset)=>asset?(asset.local?asset.url:api(asset.url)):'';

const categoryMeta:Record<Category,{label:string;icon:any}>= {
  media:{label:'الوسائط',icon:FolderOpen}, templates:{label:'قوالب',icon:Film}, music:{label:'موسيقى',icon:Music2},
  text:{label:'نص',icon:Type}, filters:{label:'ملصقات',icon:Star}, effects:{label:'تأثيرات',icon:Sparkles},
  transitions:{label:'انتقالات',icon:Move3D}, adjust:{label:'ضبط',icon:SlidersHorizontal}, ai:{label:'أدوات AI',icon:Bot}
};
const toolMap:Record<Category,Tool[]>= {
  media:[{id:'import',label:'استيراد',icon:Upload,open:true},{id:'duplicate',label:'تكرار',icon:Copy,command:'كرر المقطع'},{id:'snapshot',label:'لقطة',icon:Camera,command:'التقط صورة من الإطار الحالي'},{id:'freeze',label:'تجميد',icon:Minus,command:'جمّد الإطار عند المؤشر'}],
  templates:[{id:'cinematic',label:'سينمائي',icon:Film,command:'طبّق قالب سينمائي'},{id:'vlog',label:'Vlog',icon:Film,command:'طبّق قالب Vlog'},{id:'reels',label:'ريلز',icon:ImageIcon,command:'طبّق قالب ريلز'},{id:'promo',label:'إعلاني',icon:Star,command:'طبّق قالب إعلاني'}],
  music:[{id:'audio',label:'إضافة صوت',icon:Music2,open:true},{id:'record',label:'تسجيل',icon:Mic2,command:'سجّل تعليقًا صوتيًا'},{id:'enhance',label:'تحسين الصوت',icon:AudioLines,command:'حسّن الصوت'},{id:'noise',label:'تقليل الضوضاء',icon:Headphones,command:'قلّل ضوضاء الخلفية'}],
  text:[{id:'title',label:'عنوان',icon:Type,open:true},{id:'captions',label:'ترجمة تلقائية',icon:Captions,command:'أنشئ ترجمة تلقائية'},{id:'animated',label:'نص متحرك',icon:Sparkles,command:'أضف نصًا متحركًا'},{id:'lowerthird',label:'شريط سفلي',icon:Layers3,command:'أضف شريطًا سفليًا'}],
  filters:[{id:'sticker',label:'ملصق',icon:Star,command:'أضف ملصقًا'},{id:'emoji',label:'رموز',icon:CircleDot,command:'أضف رموزًا'},{id:'overlay',label:'تراكب',icon:Layers3,command:'أضف طبقة تراكب'},{id:'logo',label:'شعار',icon:Camera,command:'أضف شعارًا'}],
  effects:[{id:'blur',label:'تمويه',icon:Sparkles,command:'طبّق تمويه'},{id:'vignette',label:'تظليل',icon:Sparkles,command:'طبّق Vignette'},{id:'glow',label:'وهج',icon:Wand2,command:'أضف وهجًا'},{id:'grain',label:'حبيبات',icon:Sparkles,command:'أضف حبيبات فيلم'}],
  transitions:[{id:'fade',label:'تلاشي',icon:Move3D,command:'أضف انتقال تلاشي'},{id:'dissolve',label:'مزج',icon:Move3D,command:'أضف انتقال مزج'},{id:'zoom',label:'تكبير',icon:ZoomIn,command:'أضف انتقال تكبير'}],
  adjust:[{id:'brightness',label:'الإضاءة',icon:Lightbulb,property:'brightness'},{id:'contrast',label:'التباين',icon:SlidersHorizontal,property:'contrast'},{id:'saturation',label:'التشبع',icon:SlidersHorizontal,property:'saturation'},{id:'night',label:'ليلي سينمائي',icon:Sparkles,command:'اجعل الإضاءة ليلية سينمائية زرقاء'}],
  ai:[{id:'cut',label:'قص ذكي',icon:Scissors,command:'اقترح أفضل القصات'},{id:'silence',label:'حذف الصمت',icon:Scissors,command:'احذف فترات الصمت'},{id:'beats',label:'مزامنة الإيقاع',icon:Music2,command:'زامن القطع مع الإيقاع'},{id:'enhance',label:'تحسين الجودة',icon:Wand2,command:'حسّن جودة الفيديو'},{id:'camera',label:'حركة كاميرا',icon:Move3D,command:'أضف حركة كاميرا سينمائية'},{id:'tracking',label:'تتبع الحركة',icon:Move3D,command:'افتح تتبع الحركة'},{id:'reframe',label:'إعادة تأطير',icon:Maximize2,command:'أعد تأطير الفيديو تلقائيًا'},{id:'style',label:'تحليل الأسلوب',icon:Bot,command:'حلّل أسلوب الفيديو واقترح تحسينات'}]
};

function ClipThumbnail({asset}:{asset?:Asset}){
  if(!asset) return <div className="h-full bg-white/[.04]"/>;
  const src=assetUrl(asset);
  if(asset.mime.startsWith('image/')) return <img src={src} alt="" className="h-full w-full object-cover"/>;
  if(asset.mime.startsWith('video/')) return <video src={src} muted playsInline preload="metadata" className="h-full w-full object-cover"/>;
  return <div className="h-full w-full flex items-center justify-center bg-emerald-500/10"><Volume2 size={18}/></div>;
}
function Btn({children,onClick,className=''}:{children:React.ReactNode;onClick?:()=>void;className?:string}){return <button onClick={onClick} className={`transition active:scale-[.98] ${className}`}>{children}</button>}

export function VireonMobileStudio({projectId}:{projectId:string}){
  const [project,setProject]=useState<Project|null>(null);
  const [panel,setPanel]=useState<Panel>('none');
  const [inspector,setInspector]=useState<InspectorTab>('basic');
  const [selectedClip,setSelectedClip]=useState<string|null>(null);
  const [playhead,setPlayhead]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [zoom,setZoom]=useState(1);
  const [status,setStatus]=useState('جاري تجهيز الاستوديو…');
  const [messages,setMessages]=useState<Array<{role:'user'|'assistant';text:string}>>([]);
  const [assistant,setAssistant]=useState('');
  const [property,setProperty]=useState<'brightness'|'contrast'|'saturation'|null>(null);
  const [propertyValue,setPropertyValue]=useState(0);
  const [resolution,setResolution]=useState('1080P');
  const [timelineHeight,setTimelineHeight]=useState(350);
  const mediaRef=useRef<HTMLInputElement>(null);
  const projectRef=useRef<HTMLInputElement>(null);
  const videoRef=useRef<HTMLVideoElement>(null);
  const audioRef=useRef<HTMLAudioElement>(null);
  const hostRef=useRef<HTMLDivElement>(null);
  const drag=useRef<{id:string;mode:'move'|'left'|'right';x:number;start:number;end:number}|null>(null);
  const projectState=useRef<Project|null>(null);

  useEffect(()=>{projectState.current=project},[project]);
  const tracks=project?.timeline.tracks||[];
  const clips=tracks.flatMap(track=>track.clips||[]);
  const active=clips.find(clip=>clip.id===selectedClip)||clips.find(clip=>playhead>=clip.startTime&&playhead<clip.endTime)||clips.find(clip=>clip.assetId);
  const activeAsset=project?.assets.find(asset=>asset.id===active?.assetId);
  const duration=Math.max(.05,project?.timeline.duration||1);
  const pxPerSec=Math.max(34,45*zoom);
  const timelineWidth=Math.max(760,duration*pxPerSec+150);

  useEffect(()=>{
    (async()=>{
      try{
        let id=projectId;
        if(id==='new'){
          const created=await fetch(api('/api/projects'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'مشروع جديد'})});
          if(!created.ok) throw Error('تعذر إنشاء المشروع');
          const d=await created.json(); id=d.id; history.replaceState({},'',`/project/${id}`);
        }
        const r=await fetch(api(`/api/projects/${id}`));
        if(!r.ok) throw Error('تعذر تحميل المشروع');
        const d=await r.json() as Project; setProject(d); projectState.current=d;
        const first=(d.timeline.tracks||[]).flatMap(track=>track.clips||[]).find(clip=>clip.assetId);
        if(first){setSelectedClip(first.id);setPlayhead(first.startTime)}
        setStatus('جاهز');
      }catch(error){setStatus((error as Error).message)}
    })();
  },[projectId]);

  useEffect(()=>{
    const el=activeAsset?.mime.startsWith('audio/')?audioRef.current:videoRef.current;
    if(!el||!active)return;
    const localTime=Math.max(0,(active.trimStart||0)+playhead-active.startTime);
    try{
      if(Math.abs(el.currentTime-localTime)>.12) el.currentTime=Math.min(Number.isFinite(el.duration)?el.duration:localTime,localTime);
      el.playbackRate=active.speed||1;
      if(playing) void el.play(); else el.pause();
    }catch{}
  },[playhead,active?.id,active?.startTime,active?.trimStart,active?.speed,activeAsset?.id,playing]);

  useEffect(()=>{if(!playing)return;const timer=window.setInterval(()=>setPlayhead(v=>{const next=v+0.04*(active?.speed||1);if(next>=duration){setPlaying(false);return 0}return next}),40);return()=>window.clearInterval(timer)},[playing,duration,active?.speed]);

  const save=useCallback(async(next:Project)=>{
    setProject(next); projectState.current=next; setStatus('جارٍ الحفظ…');
    try{const r=await fetch(api(`/api/projects/${next.id}/timeline`),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({timeline:next.timeline})});if(!r.ok)throw Error();setStatus('تم الحفظ ✓')}catch{setStatus('تم الحفظ محليًا مؤقتًا')}
  },[]);

  const seek=(time:number)=>{const next=Math.max(0,Math.min(duration,time));setPlayhead(next);setProject(p=>p?{...p,timeline:{...p.timeline,currentTime:next}}:p)};

  const updateClip=(id:string,patch:Partial<Clip>,persist=true)=>{
    const p=projectState.current;if(!p)return;const next=structuredClone(p) as Project;
    for(const track of next.timeline.tracks){const clip=track.clips.find(item=>item.id===id);if(clip){Object.assign(clip,patch);break}}
    if(persist)void save(next);else{setProject(next);projectState.current=next}
  };

  const command=async(text:string)=>{
    const p=projectState.current;if(!p||!text.trim())return;
    setMessages(old=>[...old,{role:'user',text}]);setStatus('جارٍ تنفيذ الأمر…');
    try{const r=await fetch(api(`/api/projects/${p.id}/ai-command`),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,clipId:active?.id,playhead})});const d=await r.json();if(!r.ok)throw Error(d.error||'تعذر تنفيذ الأمر');const next={...p,timeline:d.timeline} as Project;setProject(next);projectState.current=next;setMessages(old=>[...old,{role:'assistant',text:d.command?.message||'تم التنفيذ'}]);setStatus(d.command?.message||'تم');}catch(error){const msg=(error as Error).message;setMessages(old=>[...old,{role:'assistant',text:msg}]);setStatus(msg)}
  };

  const importMedia=async(files:FileList|null)=>{
    if(!files?.length||!projectState.current)return;
    for(const file of Array.from(files)){
      setStatus(`جارٍ استيراد ${file.name}…`);
      const local=URL.createObjectURL(file);const probe=document.createElement(file.type.startsWith('audio/')?'audio':'video');probe.src=local;probe.preload='metadata';
      const length=await new Promise<number>(resolve=>{probe.onloadedmetadata=()=>resolve(Number.isFinite(probe.duration)?probe.duration:0);probe.onerror=()=>resolve(0)});
      try{const form=new FormData();form.append('file',file);const r=await fetch(api(`/api/projects/${projectState.current.id}/upload`),{method:'POST',body:form});if(!r.ok)throw Error();const d=await r.json();setProject(d);projectState.current=d;const c=d.timeline.tracks.flatMap((t:Track)=>t.clips).filter((x:Clip)=>x.name===file.name).slice(-1)[0];if(c){setSelectedClip(c.id);setPlayhead(c.startTime)}}
      catch{const p=projectState.current;const mediaTrack=p.timeline.tracks.find(t=>t.type===(file.type.startsWith('audio/')?'audio':'video'))||p.timeline.tracks[0];const start=file.type.startsWith('audio/')?Math.max(0,...p.timeline.tracks.flatMap(t=>t.clips.map(c=>c.endTime)),0):p.timeline.duration;const asset:Asset={id:`local-${crypto.randomUUID()}`,name:file.name,url:local,duration:length,mime:file.type,local:true};const clip:Clip={id:`clip-${crypto.randomUUID()}`,assetId:asset.id,name:file.name,startTime:start,endTime:start+length,trimStart:0,trimEnd:length,duration:length,speed:1,volume:1,opacity:1,brightness:0,contrast:1,saturation:1,effects:[]};const next={...p,assets:[...p.assets,asset],timeline:{...p.timeline,duration:file.type.startsWith('audio/')?p.timeline.duration:start+length,tracks:p.timeline.tracks.map(t=>t.id===mediaTrack.id?{...t,clips:[...t.clips,clip]}:t)}};setProject(next);projectState.current=next;setSelectedClip(clip.id);setPlayhead(start)}
      URL.revokeObjectURL(local);
    }
    setStatus('تم الاستيراد ✓');
  };

  const exportProject=()=>{
    if(!project)return;
    const payload={format:'vireon-project-v1',name:project.name,timeline:project.timeline,assets:project.assets.map(a=>({id:a.id,name:a.name,url:a.url,duration:a.duration,mime:a.mime,local:a.local||false}))};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${project.name||'vireon-project'}.vireon.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),5000);
  };

  const importProject=async(file:File|null)=>{
    if(!file)return;
    try{
      const payload=JSON.parse(await file.text());
      const r=await fetch(api('/api/projects/import'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
      if(!r.ok)throw Error('تعذر استيراد المشروع');
      const d=await r.json();setProject(d);projectState.current=d;history.replaceState({},'',`/project/${d.id}`);setSelectedClip(null);setPlayhead(0);setStatus('تم استيراد المشروع ✓');
    }catch(error){setStatus((error as Error).message)}
  };

  const tool=(item:Tool)=>{
    if(item.open){
      if(item.id==='title'){const text=window.prompt('نص العنوان','عنوان جديد');if(text)void command(`أضف نص: ${text}`);}
      else mediaRef.current?.click();
      return;
    }
    if(item.property){const val=item.property==='brightness'?(active?.brightness||0)*100:(active?.[item.property]||1)*100;setProperty(item.property);setPropertyValue(Math.round(val));return;}
    if(item.command)void command(item.command);
  };

  const beginDrag=(e:React.PointerEvent,c:Clip,mode:'move'|'left'|'right')=>{e.preventDefault();(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);drag.current={id:c.id,mode,x:e.clientX,start:c.startTime,end:c.endTime};setSelectedClip(c.id)};
  useEffect(()=>{
    const onMove=(e:PointerEvent)=>{const d=drag.current;if(!d||!projectState.current)return;const delta=(e.clientX-d.x)/pxPerSec;const next=structuredClone(projectState.current) as Project;for(const track of next.timeline.tracks){const clip=track.clips.find(x=>x.id===d.id);if(!clip)continue;const min=0.08;if(d.mode==='move'){const span=d.end-d.start;const start=Math.max(0,Math.min(Math.max(0,duration-span),d.start+delta));clip.startTime=start;clip.endTime=start+span;}else if(d.mode==='left'){const start=Math.max(0,Math.min(clip.endTime-min,d.start+delta));clip.trimStart=Math.max(0,Math.min(clip.trimEnd-min,clip.trimStart+(start-d.start)));clip.startTime=start;clip.duration=clip.endTime-clip.startTime;}else{const end=Math.max(clip.startTime+min,Math.min(duration,d.end+delta));clip.trimEnd=Math.max(clip.trimStart+min,clip.trimEnd+(end-d.end));clip.endTime=end;clip.duration=clip.endTime-clip.startTime;}break;}setProject(next);projectState.current=next};
    const onUp=()=>{if(drag.current&&projectState.current)void save(projectState.current);drag.current=null};window.addEventListener('pointermove',onMove);window.addEventListener('pointerup',onUp);return()=>{window.removeEventListener('pointermove',onMove);window.removeEventListener('pointerup',onUp)};
  },[duration,pxPerSec,save]);

  const setTrack=(id:string,patch:Partial<Track>)=>{const p=projectState.current;if(!p)return;const next=structuredClone(p) as Project;const t=next.timeline.tracks.find(x=>x.id===id);if(t)Object.assign(t,patch);void save(next)};
  const addTrack=()=>{const p=projectState.current;if(!p)return;const next=structuredClone(p) as Project;next.timeline.tracks.push({id:crypto.randomUUID(),name:`مسار ${next.timeline.tracks.length+1}`,type:'video',clips:[],visible:true,muted:false,locked:false,order:next.timeline.tracks.length,height:64});void save(next)};
  const addMarker=()=>{const p=projectState.current;if(!p)return;const next=structuredClone(p) as Project;next.timeline.markers=[...(next.timeline.markers||[]),{id:crypto.randomUUID(),time:playhead,label:fmt(playhead)}];void save(next)};

  const isDesktop=typeof window!=='undefined'&&window.innerWidth>=1280;
  const sideCategories=Object.entries(categoryMeta) as Array<[Category,{label:string;icon:any}]>;
  const rows=useMemo(()=>tracks.map(track=>({...track,clips:[...track.clips].sort((a,b)=>a.startTime-b.startTime)})),[tracks]);

  return <div ref={hostRef} dir="rtl" className="h-screen w-screen bg-[#080a0f] text-white overflow-hidden flex flex-col select-none">
    <input ref={mediaRef} className="hidden" type="file" accept="video/*,audio/*,image/*" multiple onChange={e=>{void importMedia(e.target.files);e.currentTarget.value=''}}/>
    <input ref={projectRef} className="hidden" type="file" accept="application/json,.json,.vireon.json" onChange={e=>{void importProject(e.target.files?.[0]||null);e.currentTarget.value=''}}/>
    <style>{`.v-card{background:linear-gradient(180deg,rgba(24,27,36,.98),rgba(15,17,24,.98));border:1px solid rgba(255,255,255,.08);box-shadow:0 10px 30px rgba(0,0,0,.2)}.v-btn{background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.08);border-radius:14px}.v-scroll::-webkit-scrollbar{width:5px;height:5px}.v-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.13);border-radius:99px}.timeline-grid{background-image:linear-gradient(to right,rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,.035) 1px,transparent 1px);background-size:${pxPerSec}px 64px}.safe-bottom{padding-bottom:max(8px,env(safe-area-inset-bottom))}`}</style>

    <header className="h-16 shrink-0 px-3 sm:px-5 flex items-center justify-between bg-[#0a0c11]/95 backdrop-blur-xl border-b border-white/[.07] z-50">
      <div className="flex items-center gap-3 min-w-0"><div className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 flex items-center justify-center font-black">V</div><div className="font-black text-lg">Vireon</div><Btn onClick={()=>setPanel(panel==='project'?'none':'project')} className="text-sm text-white/85 truncate max-w-[32vw] flex items-center gap-1">{project?.name||'مشروع جديد'} <ChevronDown size={15}/></Btn></div>
      <div className="flex items-center gap-1.5"><Btn className="v-btn p-2" onClick={()=>project&&void fetch(api(`/api/projects/${project.id}/undo`),{method:'POST'}).then(r=>r.ok?r.json():null).then(d=>d&&(setProject(d),projectState.current=d))}><Undo2 size={18}/></Btn><Btn className="v-btn p-2" onClick={()=>project&&void fetch(api(`/api/projects/${project.id}/redo`),{method:'POST'}).then(r=>r.ok?r.json():null).then(d=>d&&(setProject(d),projectState.current=d))}><Redo2 size={18}/></Btn><select value={resolution} onChange={e=>setResolution(e.target.value)} className="hidden sm:block bg-white/[.04] border border-white/10 rounded-xl px-3 py-2 text-xs"><option>720P</option><option>1080P</option><option>4K</option></select><Btn onClick={()=>window.open(api(`/api/projects/${project?.id}/render`),'_blank')} className="rounded-xl px-4 py-2 bg-violet-600 hover:bg-violet-500 font-semibold text-sm">تصدير</Btn></div>
    </header>

    <div className="flex-1 min-h-0 flex flex-col xl:flex-row-reverse bg-[#080a0f]">
      <aside className="order-3 xl:order-none xl:w-[80px] shrink-0 border-t xl:border-t-0 xl:border-l border-white/[.07] bg-[#0d0f14] overflow-x-auto xl:overflow-y-auto v-scroll z-40 safe-bottom"><div className="flex xl:flex-col items-center min-w-max xl:min-w-0 gap-1 px-1 py-1.5">{sideCategories.map(([id,meta])=>{const I=meta.icon;return <Btn key={id} onClick={()=>setPanel(panel===id?'none':id)} className={`w-[68px] xl:w-[70px] shrink-0 rounded-xl py-2 text-[10px] flex flex-col items-center gap-1.5 ${panel===id?'bg-violet-500/15 text-violet-300':'text-white/48'}`}><I size={20}/>{meta.label}</Btn>})}<Btn onClick={()=>setPanel('assistant')} className={`w-[68px] rounded-xl py-2 text-[10px] flex flex-col items-center gap-1.5 ${panel==='assistant'?'bg-violet-500/15 text-violet-300':'text-white/48'}`}><Bot size={20}/>المساعد</Btn><Btn onClick={()=>setPanel('settings')} className={`w-[68px] rounded-xl py-2 text-[10px] flex flex-col items-center gap-1.5 ${panel==='settings'?'bg-violet-500/15 text-violet-300':'text-white/48'}`}><Settings2 size={20}/>الإعدادات</Btn></div></aside>

      {panel!=='none'&&panel!=='project'&&<section className={`absolute xl:static z-60 ${isDesktop?'top-16 bottom-0':'top-16 bottom-[80px]'} right-0 w-[min(360px,92vw)] xl:w-[300px] v-card m-2 xl:m-3 rounded-2xl p-3 overflow-y-auto v-scroll`}>
        <div className="flex items-center justify-between mb-3"><b>{panel==='assistant'?'مساعد Vireon':panel==='settings'?'الإعدادات':categoryMeta[panel as Category]?.label}</b><Btn onClick={()=>setPanel('none')}><X size={18}/></Btn></div>
        {panel==='assistant'?<div className="h-[calc(100%-42px)] flex flex-col"><div className="flex-1 space-y-2 overflow-y-auto v-scroll">{messages.length===0&&<div className="rounded-xl bg-violet-500/10 p-3 text-xs text-white/60">أوامر مباشرة: قص، تقسيم، تكرار، سرعة، لون، ترجمة، تحسين، حركة كاميرا.</div>}{messages.map((m,i)=><div key={i} className={`p-3 rounded-xl text-sm ${m.role==='user'?'bg-white/[.04]':'bg-violet-500/10'}`}>{m.text}</div>)}</div><form className="flex gap-2 pt-3 mt-3 border-t border-white/[.07]" onSubmit={e=>{e.preventDefault();const t=assistant.trim();if(t){setAssistant('');void command(t)}}}><input value={assistant} onChange={e=>setAssistant(e.target.value)} placeholder="اكتب أمرًا…" className="flex-1 bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-sm"/><Btn className="bg-violet-600 rounded-xl p-2"><MessageCircle size={17}/></Btn></form></div>:panel==='settings'?<div className="text-xs text-white/55 leading-7">المحرر مبني Mobile First. على الهاتف تتوزع الأدوات في الشريط السفلي مع لوحات عائمة، وعلى الشاشات العريضة تتمدد المساحة تلقائيًا لملء الشاشة. لا يعتمد التشغيل على اختصارات لوحة المفاتيح.</div>:<div><div className="grid grid-cols-2 gap-2">{toolMap[panel as Category].map(item=>{const I=item.icon;return <Btn key={item.id} onClick={()=>tool(item)} className="v-btn min-h-[80px] p-3 flex flex-col items-center justify-center gap-2 text-xs"><I size={22}/>{item.label}</Btn>})}</div>{panel==='media'&&<div className="mt-4 space-y-2">{project?.assets.map(asset=><Btn key={asset.id} onClick={()=>{const c=clips.find(x=>x.assetId===asset.id);if(c){setSelectedClip(c.id);seek(c.startTime)}}} className="w-full p-2 rounded-xl bg-black/20 border border-white/[.06] flex gap-2 text-right"><div className="w-20 h-12 rounded-lg overflow-hidden shrink-0"><ClipThumbnail asset={asset}/></div><div className="min-w-0"><div className="text-xs truncate">{asset.name}</div><div className="text-[10px] text-white/35">{fmt(asset.duration)}</div></div></Btn>)}</div>}</div>}
      </section>}

      {panel==='project'&&<section className="absolute z-60 top-16 right-2 w-[min(350px,92vw)] v-card rounded-2xl p-4"><div className="flex items-center justify-between mb-4"><b>إدارة المشروع</b><Btn onClick={()=>setPanel('none')}><X size={18}/></Btn></div><div className="grid grid-cols-2 gap-2"><Btn className="v-btn p-4 flex flex-col gap-2 items-center text-xs" onClick={()=>projectRef.current?.click()}><FileInput size={20}/>استيراد مشروع</Btn><Btn className="v-btn p-4 flex flex-col gap-2 items-center text-xs" onClick={exportProject}><Download size={20}/>تصدير مشروع</Btn><Btn className="v-btn p-4 flex flex-col gap-2 items-center text-xs" onClick={()=>mediaRef.current?.click()}><Upload size={20}/>استيراد وسائط</Btn><Btn className="v-btn p-4 flex flex-col gap-2 items-center text-xs" onClick={()=>setStatus('الحفظ متصل بالخادم ✓')}><Save size={20}/>حالة الحفظ</Btn></div></section>}

      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_330px] gap-3 p-2.5 sm:p-3">
          <section className="v-card rounded-2xl overflow-hidden min-h-0 flex flex-col"><div className="flex-1 min-h-0 flex items-center justify-center bg-[#090b10] p-2 sm:p-4"><div className="relative h-full max-h-full aspect-[9/16] rounded-[20px] bg-black overflow-hidden border border-white/10 shadow-2xl">
            {activeAsset?.mime.startsWith('audio/')?<div className="h-full w-full flex flex-col items-center justify-center p-7 gap-5"><div className="w-20 h-20 rounded-3xl bg-emerald-500/10 flex items-center justify-center"><Volume2 size={36}/></div><div className="text-sm text-white/75 truncate max-w-[80%]">{activeAsset.name}</div><audio ref={audioRef} src={assetUrl(activeAsset)} controls className="w-full"/></div>:activeAsset?.mime.startsWith('image/')?<img src={assetUrl(activeAsset)} alt="" className="h-full w-full object-contain" style={{filter:`brightness(${100+(active?.brightness||0)*100}%) contrast(${(active?.contrast||1)*100}%) saturate(${(active?.saturation||1)*100}%)`,transform:`rotate(${active?.rotate||0}deg) scaleX(${active?.flipH?-1:1}) scaleY(${active?.flipV?-1:1})`}}/>:activeAsset?<video ref={videoRef} src={assetUrl(activeAsset)} muted={active?.volume===0} playsInline className="h-full w-full object-contain" onClick={()=>setPlaying(v=>!v)}/>:<div className="h-full w-full flex items-center justify-center text-sm text-white/35">استورد فيديو للبدء</div>}
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-3"><div className="flex items-center justify-between text-[11px] text-white/55"><span>{fmt(playhead)} / {fmt(duration)}</span><span>9:16</span></div><div className="flex items-center justify-center gap-4 mt-1"><Btn onClick={()=>seek(playhead-.04)}><ChevronRight size={18}/></Btn><Btn onClick={()=>setPlaying(v=>!v)} className="w-11 h-11 rounded-full bg-violet-600 flex items-center justify-center">{playing?<Pause size={19}/>:<Play size={19} fill="currentColor"/>}</Btn><Btn onClick={()=>seek(playhead+.04)}><ChevronLeft size={18}/></Btn><Btn><Maximize2 size={18}/></Btn></div></div>
          </div></div></section>

          <section className="v-card rounded-2xl hidden xl:flex flex-col min-h-0 overflow-hidden"><div className="flex gap-1 p-2 border-b border-white/[.07] overflow-x-auto v-scroll">{(['basic','transform','color','audio','ai'] as InspectorTab[]).map(item=><Btn key={item} onClick={()=>setInspector(item)} className={`px-3 py-2 rounded-lg text-xs ${inspector===item?'bg-violet-500/15 text-violet-300':'text-white/45'}`}>{item==='basic'?'أساسي':item==='transform'?'تحويل':item==='color'?'لون':item==='audio'?'صوت':'AI'}</Btn>)}</div><div className="p-4 overflow-y-auto v-scroll">{active?<>{inspector==='basic'&&<div className="space-y-3"><div className="text-sm font-semibold truncate">{active.name}</div><div className="grid grid-cols-2 gap-2"><Btn className="v-btn p-3 text-xs" onClick={()=>void command(`قسّم عند ${playhead.toFixed(2)}`)}><Split size={17}/> تقسيم</Btn><Btn className="v-btn p-3 text-xs" onClick={()=>void command('كرر المقطع')}><Copy size={17}/> تكرار</Btn><Btn className="v-btn p-3 text-xs" onClick={()=>void command('احذف المقطع')}><Trash2 size={17}/> حذف</Btn><Btn className="v-btn p-3 text-xs" onClick={()=>void command('دوّر المقطع 90 درجة')}><RotateCcw size={17}/> دوران</Btn></div></div>}{inspector==='transform'&&<div className="grid grid-cols-2 gap-2"><Btn className="v-btn p-3" onClick={()=>void command('دوّر المقطع 90 درجة')}>90°</Btn><Btn className="v-btn p-3" onClick={()=>void command('دوّر المقطع 180 درجة')}>180°</Btn><Btn className="v-btn p-3" onClick={()=>void command('اقلب المقطع أفقيًا')}>قلب أفقي</Btn><Btn className="v-btn p-3" onClick={()=>void command('اقلب المقطع رأسيًا')}>قلب رأسي</Btn></div>}{inspector==='color'&&<div>{(['brightness','contrast','saturation'] as const).map(key=>{const value=key==='brightness'?Math.round((active.brightness||0)*100):Math.round((active[key]||1)*100);return <div key={key} className="mb-5"><div className="flex justify-between text-xs text-white/60 mb-2"><span>{key==='brightness'?'الإضاءة':key==='contrast'?'التباين':'التشبع'}</span><span>{value}%</span></div><input className="w-full accent-violet-500" type="range" min={key==='brightness'?-100:0} max={key==='brightness'?100:300} value={value} onChange={e=>updateClip(active.id,{[key]:Number(e.target.value)/100} as Partial<Clip>)}/></div>})}</div>}{inspector==='audio'&&<div className="space-y-3"><div className="text-xs text-white/60">مستوى الصوت</div><input className="w-full accent-violet-500" type="range" min="0" max="200" value={Math.round((active.volume??1)*100)} onChange={e=>updateClip(active.id,{volume:Number(e.target.value)/100})}/><Btn className="v-btn w-full p-3" onClick={()=>updateClip(active.id,{volume:0})}><VolumeX size={17}/> كتم</Btn></div>}{inspector==='ai'&&<div className="grid grid-cols-2 gap-2">{toolMap.ai.map(item=>{const I=item.icon;return <Btn key={item.id} className="v-btn p-3 min-h-[72px] text-xs flex flex-col items-center gap-2" onClick={()=>tool(item)}><I size={21}/>{item.label}</Btn>})}</div>}</>:<div className="text-sm text-white/35">حدد مقطعًا من التايملاين.</div>}</div></section>
        </div>

        <div className="shrink-0 bg-[#0b0d12] border-t border-white/[.07] px-2 py-2 overflow-x-auto v-scroll flex gap-2">{[
          ['قص',Scissors,()=>void command(`قسّم عند ${playhead.toFixed(2)}`)],['سرعة',Gauge,()=>void command('اضبط السرعة إلى 150%')],['انتقال',Move3D,()=>setPanel('transitions')],['فلاتر',Sparkles,()=>setPanel('effects')],['تعديل اللون',SlidersHorizontal,()=>setPanel('adjust')],['AI',Bot,()=>setPanel('assistant')],['تحريك',Move3D,()=>void command('أضف حركة كاميرا سينمائية')],['مزج',Layers3,()=>void command('أضف طبقة تراكب')]
        ].map(([label,I,act])=><Btn key={String(label)} onClick={()=>{(act as ()=>void)()}} className="v-btn shrink-0 px-3 py-2 text-xs flex items-center gap-2"><(I as any) size={16}/>{label}</Btn>)}</div>

        <section className="shrink-0 bg-[#0a0c11] border-t border-white/[.07] p-2.5" style={{height:Math.max(250,Math.min(520,timelineHeight))}}><div className="h-full v-card rounded-2xl overflow-hidden flex flex-col">
          <div className="h-10 shrink-0 border-b border-white/[.07] flex items-center gap-2 px-2"><Btn className="v-btn p-2" onClick={addTrack}><Plus size={16}/></Btn><Btn className="v-btn p-2" onClick={addMarker}><CircleDot size={15}/></Btn><Btn className="v-btn p-2" onClick={()=>setTimelineHeight(v=>Math.min(520,v+40))}><ChevronDown size={16}/></Btn><Btn className="v-btn p-2" onClick={()=>setTimelineHeight(v=>Math.max(250,v-40))}><ChevronDown size={16} className="rotate-180"/></Btn><div className="text-[11px] text-white/40 mr-2">{status}</div><div className="mr-auto flex items-center gap-1"><Btn onClick={()=>setZoom(v=>Math.max(.5,v-.25))}><ZoomOut size={16}/></Btn><span className="text-[11px] text-white/40 w-10 text-center">{Math.round(zoom*100)}%</span><Btn onClick={()=>setZoom(v=>Math.min(4,v+.25))}><ZoomIn size={16}/></Btn></div></div>
          <div className="flex-1 min-h-0 overflow-auto v-scroll"><div className="relative" style={{width:timelineWidth,minWidth:'100%'}}>
            <div className="h-8 sticky top-0 z-30 bg-[#0a0c11]/98 border-b border-white/[.06]" onPointerDown={e=>{const r=e.currentTarget.getBoundingClientRect();const x=e.clientX-r.left+(e.currentTarget.parentElement?.parentElement?.scrollLeft||0)-150;seek(x/pxPerSec)}}><div className="absolute right-0 w-[150px] px-2 pt-2 text-[10px] text-white/35">الوقت</div>{Array.from({length:Math.ceil(duration)+1}).map((_,i)=><span key={i} className="absolute top-2 text-[9px] text-white/30" style={{left:150+i*pxPerSec}}>{fmt(i).slice(0,5)}</span>)}</div>
            <div className="timeline-grid relative"><div className="absolute top-0 bottom-0 w-px bg-violet-400 z-40 pointer-events-none" style={{left:150+playhead*pxPerSec}}><div className="w-3 h-3 rounded-full bg-violet-400 -translate-x-1/2"/></div>
              {rows.map(track=><div key={track.id} className="h-16 border-b border-white/[.05] flex">
                <div className="sticky right-0 z-20 w-[150px] shrink-0 bg-[#0b0d12]/98 border-l border-white/[.06] px-2 flex items-center gap-2"><Btn onClick={()=>setTrack(track.id,{visible:track.visible===false})}>{track.visible===false?<EyeOff size={14}/>:<Eye size={14}/>}</Btn><div className="min-w-0"><div className="text-[10px] text-white/70 truncate">{track.name}</div><div className="text-[9px] text-white/30">{track.type}</div></div><div className="mr-auto flex items-center gap-1"><Btn onClick={()=>setTrack(track.id,{muted:!track.muted})}>{track.muted?<VolumeX size={13}/>:<Volume2 size={13}/>}</Btn><Btn onClick={()=>setTrack(track.id,{locked:!track.locked})}>{track.locked?<Lock size={13}/>:<GripVertical size={13}/>}</Btn></div></div>
                <div className="relative flex-1" onPointerDown={e=>{if((e.target as HTMLElement).closest('[data-clip]'))return;const r=e.currentTarget.getBoundingClientRect();seek((e.clientX-r.left)/pxPerSec)}}>{track.clips.map(clip=>{const selected=clip.id===selectedClip;return <div data-clip key={clip.id} onPointerDown={e=>{if(!track.locked)beginDrag(e,clip,'move')}} className={`absolute top-2 h-12 rounded-[10px] overflow-hidden border ${selected?'border-violet-400 ring-2 ring-violet-500/20':'border-white/10'} ${track.locked?'opacity-50':''}`} style={{left:clip.startTime*pxPerSec,width:Math.max(30,(clip.endTime-clip.startTime)*pxPerSec),touchAction:'none'}}><div className="absolute inset-0"><ClipThumbnail asset={project?.assets.find(a=>a.id===clip.assetId)}/></div><div className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent"/><div className="absolute left-1 right-1 bottom-1 text-[9px] truncate">{clip.text||clip.name}</div>{selected&&!track.locked&&<><div className="absolute left-0 top-0 bottom-0 w-3 bg-violet-300/65 cursor-ew-resize" onPointerDown={e=>{e.stopPropagation();beginDrag(e,clip,'left')}}/><div className="absolute right-0 top-0 bottom-0 w-3 bg-violet-300/65 cursor-ew-resize" onPointerDown={e=>{e.stopPropagation();beginDrag(e,clip,'right')}}/></>}</div>})}</div>
              </div>)}
            </div>
          </div></div>
        </div></section>
      </main>
    </div>

    {property&&active&&<div className="fixed inset-0 z-[90] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-3"><div className="v-card w-full max-w-md rounded-2xl p-5"><div className="flex items-center justify-between mb-5"><b>{property==='brightness'?'الإضاءة':property==='contrast'?'التباين':'التشبع'}</b><Btn onClick={()=>setProperty(null)}><X size={18}/></Btn></div><input className="w-full accent-violet-500" type="range" min={property==='brightness'?-100:0} max={property==='brightness'?100:300} value={propertyValue} onChange={e=>{const v=Number(e.target.value);setPropertyValue(v);updateClip(active.id,{[property]:v/100} as Partial<Clip>)}}/><div className="flex justify-between text-xs text-white/45 mt-2"><span>منخفض</span><span>{propertyValue}%</span><span>مرتفع</span></div><Btn className="w-full bg-violet-600 rounded-xl p-3 mt-5" onClick={()=>setProperty(null)}>تم</Btn></div></div>}
  </div>;
}
