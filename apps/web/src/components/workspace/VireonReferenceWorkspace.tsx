import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines, Bot, Camera, Captions, ChevronDown, CircleDot, Copy, Download, Eye, EyeOff,
  FolderOpen, Gauge, GripVertical, Headphones, Image as ImageIcon, Layers3, Lock,
  Maximize2, MessageCircle, Mic2, Move3D, Music2, Pause, Play, Plus, Redo2, RotateCcw,
  Scissors, Settings2, SlidersHorizontal, Sparkles, Star, Trash2, Type, Undo2, Upload,
  Volume2, VolumeX, Wand2, X, ZoomIn, ZoomOut, Cloud, MoreHorizontal, Grid2X2
} from 'lucide-react';
import {
  moveClip, rippleDelete, rippleTrim, rollEdit, slideEdit, snapTime
} from '@ai-creative-studio/timeline-engine';

type Category = 'media'|'templates'|'music'|'text'|'filters'|'effects'|'transitions'|'adjust'|'ai';
type InspectorTab = 'basic'|'transform'|'color'|'audio'|'ai';

type Asset = { id:string; name:string; url:string; duration:number; mime:string; local?:boolean };
type Clip = {
  id:string; assetId:string; name:string; startTime:number; endTime:number; trimStart:number; trimEnd:number; duration:number;
  speed?:number; volume?:number; opacity?:number; rotate?:number; flipH?:boolean; flipV?:boolean;
  brightness?:number; contrast?:number; saturation?:number; grayscale?:boolean; text?:string; fontSize?:number; color?:string;
  effects?:string[]; transition?:{type:string;duration:number}; keyframes?:any[];
};
type Track = { id:string; name:string; type:string; clips:Clip[]; muted?:boolean; locked?:boolean; visible?:boolean; height?:number };
type Project = { id:string; name:string; assets:Asset[]; timeline:{duration:number; currentTime:number; tracks:Track[]; markers?:Array<{id:string;time:number;label?:string}>}; historyIndex:number; historyLength:number };

const API=(import.meta.env.VITE_API_URL||'https://ai-creative-studio-api-0gl6.onrender.com').replace(/\/$/,'');
const api=(p:string)=>`${API}${p}`;
const fmt=(n:number)=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(Math.floor(n%60)).padStart(2,'0')}:${String(Math.floor((n%1)*100)).padStart(2,'0')}`;
const src=(a?:Asset)=>a?(a.local?a.url:api(a.url)):'';

const categories:Record<Category,{label:string;icon:any}>={
  media:{label:'الوسائط',icon:FolderOpen}, templates:{label:'قوالب',icon:Layers3}, music:{label:'موسيقى',icon:Music2},
  text:{label:'نص',icon:Type}, filters:{label:'ملصقات',icon:Star}, effects:{label:'تأثيرات',icon:Sparkles},
  transitions:{label:'انتقالات',icon:Move3D}, adjust:{label:'ضبط',icon:SlidersHorizontal}, ai:{label:'أدوات AI',icon:Bot}
};

const toolItems:Record<Category,Array<{label:string;icon:any;command?:string;open?:boolean}>>={
  media:[{label:'استيراد',icon:Upload,open:true},{label:'تكرار',icon:Copy,command:'كرر المقطع'},{label:'لقطة',icon:Camera,command:'التقط صورة من الإطار الحالي'},{label:'تجميد',icon:CircleDot,command:'جمّد الإطار الحالي'}],
  templates:[{label:'سينمائي',icon:Sparkles,command:'طبّق قالب سينمائي'},{label:'Vlog',icon:Grid2X2,command:'طبّق قالب Vlog'},{label:'ريلز',icon:ImageIcon,command:'طبّق قالب ريلز'},{label:'إعلاني',icon:Star,command:'طبّق قالب إعلاني'}],
  music:[{label:'إضافة صوت',icon:Music2,open:true},{label:'تسجيل',icon:Mic2,command:'سجّل تعليقًا صوتيًا'},{label:'تحسين الصوت',icon:AudioLines,command:'حسّن الصوت'},{label:'تقليل الضوضاء',icon:Headphones,command:'قلّل ضوضاء الخلفية'}],
  text:[{label:'عنوان',icon:Type,open:true},{label:'ترجمة تلقائية',icon:Captions,command:'أنشئ ترجمة تلقائية'},{label:'نص متحرك',icon:Sparkles,command:'أضف نصًا متحركًا'},{label:'شريط سفلي',icon:Layers3,command:'أضف شريطًا سفليًا'}],
  filters:[{label:'ملصق',icon:Star,command:'أضف ملصقًا'},{label:'رموز',icon:CircleDot,command:'أضف رموزًا'},{label:'تراكب',icon:Layers3,command:'أضف طبقة تراكب'},{label:'شعار',icon:Camera,command:'أضف شعارًا'}],
  effects:[{label:'تمويه',icon:Sparkles,command:'طبّق تمويه'},{label:'تظليل',icon:Sparkles,command:'طبّق Vignette'},{label:'وهج',icon:Wand2,command:'أضف وهجًا'},{label:'حبيبات',icon:Sparkles,command:'أضف حبيبات فيلم'}],
  transitions:[{label:'تلاشي',icon:Move3D,command:'أضف انتقال تلاشي'},{label:'مزج',icon:Move3D,command:'أضف انتقال مزج'},{label:'تكبير',icon:ZoomIn,command:'أضف انتقال تكبير'},{label:'مسح',icon:Move3D,command:'أضف انتقال مسح'}],
  adjust:[{label:'الإضاءة',icon:SlidersHorizontal,command:'اضبط السطوع إلى 10%'},{label:'التباين',icon:SlidersHorizontal,command:'اضبط التباين إلى 110%'},{label:'التشبع',icon:SlidersHorizontal,command:'اضبط التشبع إلى 110%'},{label:'HSL',icon:CircleDot,command:'افتح ضبط HSL'}],
  ai:[{label:'قص ذكي',icon:Scissors,command:'اقترح أفضل القصات'},{label:'حذف الصمت',icon:Scissors,command:'احذف فترات الصمت'},{label:'مزامنة الإيقاع',icon:Music2,command:'زامن القطع مع الإيقاع'},{label:'إعادة تأطير',icon:Maximize2,command:'أعد تأطير الفيديو تلقائيًا'},{label:'تتبع الحركة',icon:Move3D,command:'افتح تتبع الحركة'},{label:'تحسين الجودة',icon:Wand2,command:'حسّن جودة الفيديو'}]
};

function Button({children,onClick,className=''}:{children:React.ReactNode;onClick?:()=>void;className?:string}){
  return <button type="button" onClick={onClick} className={`transition active:scale-[.98] ${className}`}>{children}</button>;
}

function Thumb({asset}:{asset?:Asset}){
  if(!asset)return <div className="h-full w-full bg-white/[.04]"/>;
  const s=src(asset);
  if(asset.mime.startsWith('image/'))return <img src={s} alt="" className="h-full w-full object-cover"/>;
  if(asset.mime.startsWith('video/'))return <video src={s} muted playsInline preload="metadata" className="h-full w-full object-cover"/>;
  return <div className="h-full w-full flex items-center justify-center"><Volume2 size={18}/></div>;
}

function ToolsPanel({category,project,clips,onTool,onClose}:{category:Category;project:Project|null;clips:Clip[];onTool:(t:any)=>void;onClose:()=>void}){
  return <section className="vireon-panel absolute z-[80] top-2 bottom-2 right-[80px] w-[300px] p-3 rounded-2xl overflow-y-auto xl:static xl:shrink-0 xl:w-[300px] xl:m-2">
    <div className="flex items-center justify-between mb-3"><b>{categories[category].label}</b><Button onClick={onClose}><X size={18}/></Button></div>
    <div className="grid grid-cols-2 gap-2">{toolItems[category].map((t,i)=>{const I=t.icon;return <Button key={i} onClick={()=>onTool(t)} className="vireon-btn min-h-[78px] p-3 flex flex-col items-center justify-center gap-2 text-xs"><I size={22}/><span>{t.label}</span></Button>})}</div>
    {category==='media'&&<div className="mt-4 space-y-2">{project?.assets.map(a=><Button key={a.id} className="w-full p-2 rounded-xl bg-black/20 border border-white/10 flex gap-2 text-right" onClick={()=>{const c=clips.find(x=>x.assetId===a.id);if(c)window.dispatchEvent(new CustomEvent('vireon-select',{detail:c.id}))}}><div className="w-20 h-12 rounded-lg overflow-hidden shrink-0"><Thumb asset={a}/></div><div className="min-w-0"><div className="text-xs truncate">{a.name}</div><div className="text-[10px] text-white/35 mt-1">{fmt(a.duration)}</div></div></Button>)}</div>}
  </section>;
}

function Inspector({active,tab,setTab,onUpdate,onCommand}:{active:Clip;tab:InspectorTab;setTab:(t:InspectorTab)=>void;onUpdate:(p:Partial<Clip>)=>void;onCommand:(s:string)=>void}){
  const tabs:InspectorTab[]=['basic','transform','color','audio','ai'];
  return <section className="vireon-panel min-h-0 rounded-2xl overflow-hidden flex flex-col">
    <div className="px-3 pt-3 flex items-center justify-between"><div><div className="font-semibold">{active.name}</div><div className="text-[10px] text-white/35">المفتش • Inspector</div></div><MoreHorizontal size={17} className="text-white/35"/></div>
    <div className="flex gap-1 px-2 py-3 border-b border-white/10 overflow-x-auto">{tabs.map(t=><Button key={t} onClick={()=>setTab(t)} className={`px-3 py-2 rounded-lg text-[11px] whitespace-nowrap ${tab===t?'bg-violet-500/15 text-violet-300':'text-white/45'}`}>{t==='basic'?'أساسي':t==='transform'?'تحويل':t==='color'?'لون':t==='audio'?'صوت':'AI'}</Button>)}</div>
    <div className="p-3 overflow-y-auto flex-1">
      {tab==='basic'&&<div className="space-y-3"><div className="grid grid-cols-2 gap-2"><Button className="vireon-btn p-3 text-xs" onClick={()=>onCommand('قسّم عند الموضع الحالي')}><Scissors size={16}/>قص</Button><Button className="vireon-btn p-3 text-xs" onClick={()=>onCommand('كرر المقطع')}><Copy size={16}/>تكرار</Button><Button className="vireon-btn p-3 text-xs" onClick={()=>onCommand('احذف المقطع')}><Trash2 size={16}/>حذف</Button><Button className="vireon-btn p-3 text-xs" onClick={()=>onCommand('دوّر المقطع 90 درجة')}><RotateCcw size={16}/>دوران</Button></div><Field label="السرعة" value={`${Math.round((active.speed||1)*100)}%`}><input type="range" min="25" max="400" value={(active.speed||1)*100} onChange={e=>onUpdate({speed:Number(e.target.value)/100})}/></Field><Field label="الشفافية" value={`${Math.round((active.opacity??1)*100)}%`}><input type="range" min="0" max="100" value={(active.opacity??1)*100} onChange={e=>onUpdate({opacity:Number(e.target.value)/100})}/></Field></div>}
      {tab==='transform'&&<div className="space-y-3"><div className="grid grid-cols-2 gap-2"><Button className="vireon-btn p-3 text-xs" onClick={()=>onCommand('دوّر المقطع 90 درجة')}>90°</Button><Button className="vireon-btn p-3 text-xs" onClick={()=>onCommand('دوّر المقطع 180 درجة')}>180°</Button><Button className="vireon-btn p-3 text-xs" onClick={()=>onCommand('اقلب المقطع أفقيًا')}>قلب أفقي</Button><Button className="vireon-btn p-3 text-xs" onClick={()=>onCommand('اقلب المقطع رأسيًا')}>قلب رأسي</Button></div></div>}
      {tab==='color'&&<div className="space-y-4">{(['brightness','contrast','saturation'] as const).map(k=>{const raw=active[k]??(k==='brightness'?0:1);const pct=k==='brightness'?Math.round(raw*100):Math.round(raw*100);return <Field key={k} label={k==='brightness'?'الإضاءة':k==='contrast'?'التباين':'التشبع'} value={`${pct}%`}><input className="w-full" type="range" min={k==='brightness'?-100:0} max={k==='brightness'?100:300} value={pct} onChange={e=>onUpdate({[k]:Number(e.target.value)/100} as Partial<Clip>)}/></Field>})}<Button className="vireon-btn w-full p-3 text-xs" onClick={()=>onCommand('افتح ضبط HSL')}>HSL متقدم</Button></div>}
      {tab==='audio'&&<div className="space-y-4"><Field label="مستوى الصوت" value={`${Math.round((active.volume??1)*100)}%`}><input className="w-full" type="range" min="0" max="400" value={(active.volume??1)*100} onChange={e=>onUpdate({volume:Number(e.target.value)/100})}/></Field><Button className="vireon-btn w-full p-3 text-xs" onClick={()=>onUpdate({volume:0})}><VolumeX size={16}/>كتم</Button><div className="vireon-btn p-3"><div className="text-xs mb-2">مؤثرات صوتية</div><div className="flex items-end gap-1 h-12">{Array.from({length:28}).map((_,i)=><span key={i} className="flex-1 rounded-full bg-violet-500/40" style={{height:`${20+((i*17)%70)}%`}}/>)}</div></div></div>}
      {tab==='ai'&&<div className="space-y-2"><Button className="vireon-btn w-full p-3 text-xs" onClick={()=>onCommand('حلّل المقطع واقترح تحسينات')}>تحليل المقطع</Button><Button className="vireon-btn w-full p-3 text-xs" onClick={()=>onCommand('طبّق تحسينًا احترافيًا')}><Wand2 size={16}/>تحسين تلقائي</Button><Button className="vireon-btn w-full p-3 text-xs" onClick={()=>onCommand('أنشئ ترجمة لهذا المقطع')}><Captions size={16}/>إنشاء ترجمة</Button></div>}
    </div>
  </section>;
}

function Field({label,value,children}:{label:string;value:string;children:React.ReactNode}){return <div><div className="flex items-center justify-between text-[11px] text-white/55 mb-2"><span>{label}</span><span>{value}</span></div>{children}</div>}

function timelineToEngine(project:Project){
  return {tracks:project.timeline.tracks as any,currentTime:project.timeline.currentTime,duration:project.timeline.duration,isPlaying:false,playbackRate:1,loopEnabled:false,markers:(project.timeline.markers||[]) as any,snaps:[]} as any;
}

function ProfessionalTimeline({project,onChange,onSelect}:{project:Project;onChange:(p:Project)=>void;onSelect:(id:string)=>void}){
  const [zoom,setZoom]=useState(1);
  const [ripple,setRipple]=useState(true);
  const [snapping,setSnapping]=useState(true);
  const [drag,setDrag]=useState<{id:string;trackId:string;mode:'move'|'left'|'right';x:number;start:number;end:number}|null>(null);
  const trackLabelW=150; const px=Math.max(42,46*zoom); const width=Math.max(800,project.timeline.duration*px+trackLabelW+120);
  const viewport=useRef<HTMLDivElement>(null);
  const currentTime=project.timeline.currentTime;
  const engine=useMemo(()=>timelineToEngine(project),[project]);

  useEffect(()=>{
    const move=(e:PointerEvent)=>{
      if(!drag)return;
      const delta=(e.clientX-drag.x)/px;
      const next=structuredClone(project) as Project;
      if(drag.mode==='move'){
        const start=Math.max(0,drag.start+delta);
        const s=snapping?snapTime(start,engine,0.12,drag.id):start;
        moveClip(engine,drag.id,drag.trackId,s,{ripple,snap:false});
        next.timeline.tracks=engine.tracks;
      }else{
        rippleTrim(engine,drag.id,drag.mode==='left'?'start':'end',drag.mode==='left'?drag.start+delta:drag.end+delta,ripple);
        next.timeline.tracks=engine.tracks;
      }
      next.timeline.duration=Math.max(0,engine.duration);
      onChange(next);
    };
    const up=()=>setDrag(null);
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
    return()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};
  },[drag,px,ripple,snapping,engine,onChange]);

  const remove=(trackId:string,clipId:string)=>{const next=structuredClone(project) as Project;const s=timelineToEngine(next);rippleDelete(s,trackId,clipId);next.timeline.tracks=s.tracks;next.timeline.duration=s.duration;onChange(next)};
  const rulerClick=(e:React.PointerEvent<HTMLDivElement>)=>{const r=e.currentTarget.getBoundingClientRect();const t=Math.max(0,(e.clientX-r.left-trackLabelW)/px);const next=structuredClone(project) as Project;next.timeline.currentTime=Math.min(project.timeline.duration,t);onChange(next)};

  return <section className="vireon-timeline rounded-2xl overflow-hidden border border-white/[.07] bg-[#0b0d12] flex flex-col">
    <div className="h-12 border-b border-white/[.07] flex items-center gap-2 px-2 shrink-0"><Button className="vireon-icon" onClick={()=>{const next=structuredClone(project) as Project;next.timeline.tracks.push({id:crypto.randomUUID(),name:`مسار ${next.timeline.tracks.length+1}`,type:'video',clips:[],visible:true,muted:false,locked:false});onChange(next)}}><Plus size={17}/></Button><Button className={`vireon-toggle ${snapping?'active':''}`} onClick={()=>setSnapping(v=>!v)}>Snap</Button><Button className={`vireon-toggle ${ripple?'active':''}`} onClick={()=>setRipple(v=>!v)}>Ripple</Button><span className="text-[10px] text-white/30">{fmt(currentTime)} / {fmt(project.timeline.duration)}</span><div className="mr-auto flex items-center gap-1"><Button className="vireon-icon" onClick={()=>setZoom(z=>Math.max(.5,z-.25))}><ZoomOut size={15}/></Button><span className="text-[10px] text-white/35 w-8 text-center">{Math.round(zoom*100)}%</span><Button className="vireon-icon" onClick={()=>setZoom(z=>Math.min(5,z+.25))}><ZoomIn size={15}/></Button></div></div>
    <div ref={viewport} className="flex-1 min-h-0 overflow-auto select-none" onWheel={e=>{if(e.ctrlKey){e.preventDefault();setZoom(z=>Math.max(.5,Math.min(5,z+(e.deltaY>0?-.1:.1)))}}><div style={{width,minWidth:'100%'}}>
      <div className="h-8 sticky top-0 z-40 bg-[#0a0c11]/98 border-b border-white/10 relative" onPointerDown={rulerClick}><div className="absolute right-0 w-[150px] px-2 pt-2 text-[10px] text-white/30">الوقت</div>{Array.from({length:Math.ceil(project.timeline.duration)+1}).map((_,i)=><span key={i} className="absolute top-2 text-[9px] text-white/30" style={{left:trackLabelW+i*px}}>{fmt(i).slice(0,5)}</span>)}</div>
      <div className="relative" style={{backgroundImage:'linear-gradient(to right,rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,.03) 1px,transparent 1px)',backgroundSize:`${px}px 64px`}}>
        <div className="absolute top-0 bottom-0 w-px bg-violet-400 z-50 pointer-events-none" style={{left:trackLabelW+currentTime*px}}><div className="w-3 h-3 rounded-full bg-violet-400 -translate-x-1/2"/></div>
        {project.timeline.tracks.map(track=><div key={track.id} className="h-16 border-b border-white/[.05] flex">
          <div className="sticky right-0 z-30 w-[150px] shrink-0 bg-[#0b0d12]/98 border-l border-white/10 px-2 flex items-center gap-1.5">
            <Button onClick={()=>{const n=structuredClone(project) as Project;track.visible=track.visible===false;onChange(n)}}>{track.visible===false?<EyeOff size={13}/>:<Eye size={13}/>}</Button>
            <div className="min-w-0"><div className="text-[10px] truncate">{track.name}</div><div className="text-[9px] text-white/30">{track.type}</div></div>
            <div className="mr-auto flex gap-1"><Button onClick={()=>{const n=structuredClone(project) as Project;track.muted=!track.muted;onChange(n)}}>{track.muted?<VolumeX size={13}/>:<Volume2 size={13}/>}</Button><Button onClick={()=>{const n=structuredClone(project) as Project;track.locked=!track.locked;onChange(n)}}>{track.locked?<Lock size={13}/>:<GripVertical size={13}/>}</Button></div>
          </div>
          <div className="relative flex-1" onPointerDown={e=>{if((e.target as HTMLElement).closest('[data-clip]'))return;const r=e.currentTarget.getBoundingClientRect();const next=structuredClone(project) as Project;next.timeline.currentTime=Math.max(0,Math.min(project.timeline.duration,(e.clientX-r.left)/px));onChange(next)}}>
            {track.clips.map(clip=>{const sel=clip.id===project.__selected;return <div key={clip.id} data-clip className={`absolute top-2 h-12 rounded-[10px] overflow-hidden border ${sel?'border-violet-400 ring-2 ring-violet-500/20':'border-white/10'} ${track.locked?'opacity-45':''}`} style={{left:clip.startTime*px,width:Math.max(30,(clip.endTime-clip.startTime)*px),touchAction:'none'}} onPointerDown={e=>{e.stopPropagation();if(track.locked)return;onSelect(clip.id);setDrag({id:clip.id,trackId:track.id,mode:'move',x:e.clientX,start:clip.startTime,end:clip.endTime})}} onDoubleClick={()=>remove(track.id,clip.id)}>
              <div className="absolute inset-0"><Thumb asset={project.assets.find(a=>a.id===clip.assetId)}/></div><div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"/><div className="absolute left-2 right-2 bottom-1 text-[9px] truncate">{clip.text||clip.name}</div>
              {sel&&!track.locked&&<><div className="absolute left-0 top-0 bottom-0 w-3 bg-violet-300/70 cursor-ew-resize" onPointerDown={e=>{e.stopPropagation();setDrag({id:clip.id,trackId:track.id,mode:'left',x:e.clientX,start:clip.trimStart,end:clip.trimEnd})}}/><div className="absolute right-0 top-0 bottom-0 w-3 bg-violet-300/70 cursor-ew-resize" onPointerDown={e=>{e.stopPropagation();setDrag({id:clip.id,trackId:track.id,mode:'right',x:e.clientX,start:clip.trimStart,end:clip.trimEnd})}}/></>}
            </div>})}
          </div>
        </div>)}
      </div></div>
    </div>
  </section>;
}

// Project type intentionally allows an internal UI-only selected id without polluting the persisted model.
type UIProject=Project & {__selected?:string};

export function VireonReferenceWorkspace({projectId}:{projectId:string}){
  const [project,setProject]=useState<UIProject|null>(null);
  const [selected,setSelected]=useState<string|null>(null);
  const [category,setCategory]=useState<Category>('media');
  const [toolOpen,setToolOpen]=useState(true);
  const [tab,setTab]=useState<InspectorTab>('audio');
  const [playing,setPlaying]=useState(false);
  const [assistant,setAssistant]=useState('');
  const [messages,setMessages]=useState<Array<{role:'user'|'assistant';text:string}>>([]);
  const [status,setStatus]=useState('جاري التجهيز…');
  const mediaInput=useRef<HTMLInputElement>(null);
  const videoRef=useRef<HTMLVideoElement>(null);

  useEffect(()=>{const f=(e:Event)=>setSelected(String((e as CustomEvent).detail));window.addEventListener('vireon-select',f);return()=>window.removeEventListener('vireon-select',f)},[]);
  useEffect(()=>{(async()=>{try{let id=projectId;if(id==='new'){const r=await fetch(api('/api/projects'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'مشروع Vireon جديد'})});if(!r.ok)throw Error('تعذر إنشاء المشروع');id=(await r.json()).id;history.replaceState({},'',`/project/${id}`)}const r=await fetch(api(`/api/projects/${id}`));if(!r.ok)throw Error('تعذر تحميل المشروع');const d=await r.json();setProject(d);const first=d.timeline?.tracks?.flatMap((t:Track)=>t.clips||[]).find((c:Clip)=>c.assetId);if(first)setSelected(first.id);setStatus('جاهز')}catch(e){setStatus(e instanceof Error?e.message:'تعذر التحميل')}})()},[projectId]);
  useEffect(()=>{if(!playing||!project)return;const id=window.setInterval(()=>setProject(p=>{if(!p)return p;const n=structuredClone(p) as UIProject;const dur=Math.max(.01,n.timeline.duration);n.timeline.currentTime+=.04;if(n.timeline.currentTime>=dur){n.timeline.currentTime=0;setPlaying(false)}return n}),40);return()=>window.clearInterval(id)},[playing,project?.timeline.duration]);
  useEffect(()=>{const v=videoRef.current;if(!v||!project)return;const clips=project.timeline.tracks.flatMap(t=>t.clips);const active=clips.find(c=>c.id===selected)||clips.find(c=>project.timeline.currentTime>=c.startTime&&project.timeline.currentTime<c.endTime);const asset=project.assets.find(a=>a.id===active?.assetId);if(!active||!asset?.mime.startsWith('video/'))return;const local=Math.max(0,(active.trimStart||0)+project.timeline.currentTime-active.startTime);try{if(Math.abs(v.currentTime-local)>.12)v.currentTime=Math.min(Number.isFinite(v.duration)?v.duration:local,local);v.playbackRate=active.speed||1;if(playing)void v.play();else v.pause()}catch{}},[project,selected,playing]);

  const clips=project?.timeline.tracks.flatMap(t=>t.clips||[])||[];
  const active=clips.find(c=>c.id===selected)||clips.find(c=>project&&project.timeline.currentTime>=c.startTime&&project.timeline.currentTime<c.endTime)||clips[0];
  const activeAsset=project?.assets.find(a=>a.id===active?.assetId);

  const save=(next:UIProject)=>{setProject(next);setStatus('تم الحفظ محليًا…');void fetch(api(`/api/projects/${next.id}/timeline`),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({timeline:next.timeline})}).then(r=>setStatus(r.ok?'تم الحفظ ✓':'تم الحفظ محليًا مؤقتًا')).catch(()=>setStatus('تم الحفظ محليًا مؤقتًا'))};
  const update=(patch:Partial<Clip>)=>{if(!project||!active)return;const n=structuredClone(project) as UIProject;for(const t of n.timeline.tracks){const c=t.clips.find(x=>x.id===active.id);if(c)Object.assign(c,patch)}save(n)};
  const command=async(text:string)=>{if(!project||!text.trim())return;setMessages(v=>[...v,{role:'user',text}]);setStatus('جارٍ التنفيذ…');try{const r=await fetch(api(`/api/projects/${project.id}/ai-command`),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,clipId:active?.id,playhead:project.timeline.currentTime})});const d=await r.json();if(!r.ok)throw Error(d.error||'تعذر التنفيذ');const n=structuredClone(project) as UIProject;n.timeline=d.timeline;setProject(n);setMessages(v=>[...v,{role:'assistant',text:d.command?.message||'تم التنفيذ'}]);setStatus(d.command?.message||'تم التنفيذ')}catch(e){const m=e instanceof Error?e.message:'تعذر التنفيذ';setMessages(v=>[...v,{role:'assistant',text:m}]);setStatus(m)}};
  const onTool=(t:any)=>{if(t.open){if(t.label==='استيراد'||t.label==='إضافة صوت')mediaInput.current?.click();else{const text=prompt('النص','عنوان جديد');if(text)void command(`أضف نص: ${text}`)}return}if(t.command)void command(t.command)};
  const exportProject=()=>{if(!project)return;window.open(api(`/api/projects/${project.id}/render`),'_blank');setStatus('بدأ التصدير السحابي')};
  const undo=async()=>{if(!project)return;const r=await fetch(api(`/api/projects/${project.id}/undo`),{method:'POST'});if(r.ok){const d=await r.json();setProject(d);setSelected(null)}};
  const redo=async()=>{if(!project)return;const r=await fetch(api(`/api/projects/${project.id}/redo`),{method:'POST'});if(r.ok){const d=await r.json();setProject(d);setSelected(null)}};

  return <div dir="rtl" className="vireon-app">
    <style>{`.vireon-app{--panel:#11141c;--panel2:#0c0f15;--line:rgba(255,255,255,.08);background:#080a0f;color:white}.vireon-panel{background:linear-gradient(180deg,rgba(24,27,36,.98),rgba(14,16,23,.98));border:1px solid var(--line)}.vireon-btn{background:rgba(255,255,255,.045);border:1px solid var(--line);border-radius:13px}.vireon-icon{width:34px;height:34px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.04);border:1px solid var(--line)}.vireon-toggle{padding:7px 10px;border-radius:9px;font-size:10px;color:rgba(255,255,255,.45);background:rgba(255,255,255,.03)}.vireon-toggle.active{background:rgba(139,92,246,.15);color:#c4b5fd}.vireon-timeline input{accent-color:#8b5cf6}.vireon-app::-webkit-scrollbar,.vireon-timeline::-webkit-scrollbar{width:5px;height:5px}.vireon-app *::-webkit-scrollbar-thumb,.vireon-timeline::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:999px}@media (max-width:1180px){.vireon-desktop-inspector{display:none}.vireon-tool-panel{display:block}}@media (max-width:760px){.vireon-header .hide-mobile{display:none}.vireon-main{grid-template-columns:1fr!important}.vireon-sidebar{order:3;border-top:1px solid var(--line);border-left:0!important;width:100%!important;height:78px!important}.vireon-sidebar-inner{flex-direction:row!important;overflow-x:auto!important}.vireon-tool-panel{position:fixed!important;inset:64px 8px 88px 8px!important;width:auto!important}.vireon-bottom-tools{overflow-x:auto}.vireon-preview{min-height:47vh}.vireon-inspector-mobile{display:block!important}.vireon-side-tools{display:none!important}}`}</style>
    <input ref={mediaInput} type="file" hidden accept="video/*,audio/*,image/*" multiple onChange={async e=>{if(!project||!e.target.files?.length)return;for(const f of Array.from(e.target.files)){const form=new FormData();form.append('file',f);try{const r=await fetch(api(`/api/projects/${project.id}/upload`),{method:'POST',body:form});if(r.ok){const d=await r.json();setProject(d);const c=d.timeline.tracks.flatMap((t:Track)=>t.clips).find((x:Clip)=>x.name===f.name);if(c)setSelected(c.id)}}catch{}}e.currentTarget.value='';setStatus('تم الاستيراد ✓')}}/>
    <header className="vireon-header h-16 shrink-0 flex items-center justify-between px-3 sm:px-5 border-b border-white/[.07] bg-[#0a0c11]">
      <div className="flex items-center gap-3 min-w-0"><div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-700 to-fuchsia-500 flex items-center justify-center font-black text-xl">V</div><b className="text-lg">Vireon</b><div className="h-7 w-px bg-white/10 hide-mobile"/><Button className="text-sm text-white/85 truncate max-w-[34vw]" onClick={()=>setToolOpen(v=>!v)}>{project?.name||'مشروع جديد'} <ChevronDown size={14} className="inline mr-1"/></Button></div>
      <div className="flex items-center gap-2"><Button className="vireon-icon hide-mobile" onClick={()=>void undo()}><Undo2 size={17}/></Button><Button className="vireon-icon hide-mobile" onClick={()=>void redo()}><Redo2 size={17}/></Button><span className="text-[10px] text-emerald-300 hide-mobile"><Cloud size={13} className="inline mr-1"/> {status}</span><Button className="vireon-btn px-3 py-2 text-xs">1080P <ChevronDown size={13} className="inline mr-1"/></Button><Button onClick={exportProject} className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 font-semibold">تصدير</Button></div>
    </header>

    <div className="vireon-main flex-1 min-h-0 grid grid-cols-[80px_minmax(0,1fr)_320px] gap-2 p-2">
      <aside className="vireon-sidebar vireon-side-tools vireon-panel rounded-2xl overflow-hidden"><div className="vireon-sidebar-inner h-full flex flex-col items-center gap-1 p-1.5 overflow-y-auto">{(Object.entries(categories) as Array<[Category,{label:string;icon:any}]>).map(([id,m])=>{const I=m.icon;return <Button key={id} onClick={()=>{setCategory(id);setToolOpen(true)}} className={`w-[66px] rounded-xl py-2.5 text-[10px] flex flex-col items-center gap-1.5 ${category===id&&toolOpen?'bg-violet-500/15 text-violet-300':'text-white/50'}`}><I size={20}/>{m.label}</Button>})}<div className="mt-auto w-full"><Button onClick={()=>setToolOpen(false)} className="w-full rounded-xl py-2.5 text-[10px] flex flex-col items-center gap-1.5 text-white/50"><Settings2 size={20}/>الإعدادات</Button></div></div></aside>

      {toolOpen&&<div className="vireon-tool-panel"><ToolsPanel category={category} project={project} clips={clips} onTool={onTool} onClose={()=>setToolOpen(false)}/></div>}

      <main className="min-w-0 min-h-0 flex flex-col gap-2">
        <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_320px] gap-2">
          <section className="vireon-panel vireon-preview rounded-2xl overflow-hidden relative flex flex-col">
            <div className="flex-1 min-h-0 flex items-center justify-center bg-black/20 p-3"><div className="relative h-full max-h-full aspect-[9/16] rounded-2xl overflow-hidden bg-black border border-white/10 shadow-2xl">{activeAsset?.mime.startsWith('video/')?<video ref={videoRef} src={src(activeAsset)} playsInline className="h-full w-full object-contain"/>:activeAsset?.mime.startsWith('image/')?<img src={src(activeAsset)} alt="" className="h-full w-full object-contain"/>:activeAsset?.mime.startsWith('audio/')?<div className="h-full flex flex-col items-center justify-center gap-4"><Headphones size={48}/><span className="text-sm text-white/60">{activeAsset.name}</span></div>:<div className="h-full flex items-center justify-center text-sm text-white/35">استورد وسائط للبدء</div>}<div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/90 to-transparent"><div className="flex items-center justify-between text-[11px] text-white/55"><span>{fmt(project?.timeline.currentTime||0)} / {fmt(project?.timeline.duration||0)}</span><span>9:16</span></div><div className="flex items-center justify-center gap-5 mt-2"><Button onClick={()=>setProject(p=>p?{...p,timeline:{...p.timeline,currentTime:Math.max(0,p.timeline.currentTime-.04)}}:p)}><ChevronDown className="rotate-90" size={18}/></Button><Button onClick={()=>setPlaying(v=>!v)} className="w-11 h-11 rounded-full bg-violet-600 flex items-center justify-center">{playing?<Pause size={19}/>:<Play size={19} fill="currentColor"/>}</Button><Button onClick={()=>setProject(p=>p?{...p,timeline:{...p.timeline,currentTime:Math.min(p.timeline.duration,p.timeline.currentTime+.04)}}:p)}><ChevronDown className="-rotate-90" size={18}/></Button><Button><Maximize2 size={17}/></Button></div></div></div></div>
            <div className="h-12 border-t border-white/10 flex items-center gap-3 px-3 text-[10px] text-white/35"><Button className="vireon-icon" onClick={()=>void command('لقطة من الإطار الحالي')}><Camera size={15}/></Button><span>المعاينة المباشرة • GPU preview-ready</span><span className="mr-auto">{active?'Clip محدد':'لا يوجد تحديد'}</span></div>
          </section>
          <div className="vireon-desktop-inspector"><Inspector active={active||{id:'x',assetId:'',name:'لا يوجد مقطع',startTime:0,endTime:0,trimStart:0,trimEnd:0,duration:0}} tab={tab} setTab={setTab} onUpdate={update} onCommand={command}/></div>
        </div>
        <div className="vireon-bottom-tools vireon-panel rounded-2xl h-14 shrink-0 px-2 flex items-center gap-1 overflow-x-auto"><Button className="vireon-icon" onClick={()=>void command(`قسّم عند الموضع الحالي`)}><Scissors size={17}/></Button><Button className="vireon-icon" onClick={()=>void command('اضبط السرعة إلى 150%')}><Gauge size={17}/></Button><Button className="vireon-icon" onClick={()=>setCategory('transitions')}><Move3D size={17}/></Button><Button className="vireon-icon" onClick={()=>setCategory('effects')}><Sparkles size={17}/></Button><Button className="vireon-icon" onClick={()=>setCategory('adjust')}><SlidersHorizontal size={17}/></Button><Button className="vireon-icon" onClick={()=>setTab('ai')}><Bot size={17}/></Button><Button className="vireon-icon" onClick={()=>void command('أضف حركة كاميرا سينمائية')}><Move3D size={17}/></Button><Button className="vireon-icon" onClick={()=>void command('أضف طبقة تراكب')}><Layers3 size={17}/></Button><div className="mr-auto"/><div className="text-[10px] text-white/35 whitespace-nowrap">AI • Snapping • Ripple • Keyframes-ready</div></div>
        {project&&<div className="min-h-[280px] max-h-[48vh]"><ProfessionalTimeline project={{...project,__selected:selected}} onChange={save} onSelect={id=>{setSelected(id);setTab('audio')}}/></div>}
      </main>

      <aside className="vireon-inspector-mobile hidden col-span-full"><div className="vireon-panel rounded-2xl p-3"><div className="flex gap-2 overflow-x-auto mb-2"><Button className="vireon-btn px-3 py-2 text-xs" onClick={()=>setTab('audio')}><Volume2 size={14}/>الصوت</Button><Button className="vireon-btn px-3 py-2 text-xs" onClick={()=>setTab('color')}><SlidersHorizontal size={14}/>اللون</Button><Button className="vireon-btn px-3 py-2 text-xs" onClick={()=>setToolOpen(true)}><Scissors size={14}/>الأدوات</Button><Button className="vireon-btn px-3 py-2 text-xs" onClick={()=>setToolOpen(false)}><Bot size={14}/>AI</Button></div></div></aside>
    </div>

    <div className="fixed left-3 bottom-3 z-[100]"><div className="vireon-panel rounded-2xl p-3 w-[min(360px,92vw)]"><div className="flex items-center gap-2 mb-2"><Bot size={17} className="text-violet-300"/><span className="text-xs font-semibold">مساعد Vireon</span><span className="text-[10px] text-emerald-300 mr-auto">متصل</span></div><form onSubmit={e=>{e.preventDefault();if(assistant.trim()){const t=assistant.trim();setAssistant('');void command(t)}}} className="flex gap-2"><input value={assistant} onChange={e=>setAssistant(e.target.value)} placeholder="مثال: احذف أول 5 ثوانٍ…" className="flex-1 bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs"/><Button className="bg-violet-600 rounded-xl px-3"><MessageCircle size={15}/></Button></form>{messages.length>0&&<div className="mt-2 text-[10px] text-white/45 max-h-16 overflow-auto">{messages[messages.length-1]?.text}</div>}</div></div>
  </div>;
}
