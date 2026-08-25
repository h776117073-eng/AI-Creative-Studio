import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioLines, AudioWaveform, Captions, Check, ChevronDown, CircleHelp, Crop,
  Download, Film, FolderOpen, Gauge, Grid2X2, Image as ImageIcon, Keyboard,
  Layers3, Lightbulb, Maximize2, Mic2, Minus, MonitorPlay, Music2, Pause, Play,
  Plus, Redo2, RotateCcw, Scissors, Settings2, SlidersHorizontal, Sparkles,
  Split, Trash2, Type, Undo2, Upload, Wand2, X, Zap, Move3D, Volume2, VolumeX,
  FlipHorizontal2, FlipVertical2, Contrast, Palette, Timer, MousePointer2,
  CircleDot, Replace, Copy, Snowflake, Camera, Search, FilmIcon, Rows3,
  AlignCenter, Crosshair, MoveHorizontal, ArrowLeftRight, Square, Circle,
  CircleDashed, AudioWaveform as Wave, MessageCircle, Bot, Eye, EyeOff, Lock,
  Unlock, MoreHorizontal, ScissorsLineDashed, RefreshCcw, Save, ZoomIn, ZoomOut
} from 'lucide-react';

interface Asset { id:string; name:string; url:string; duration:number; mime?:string; pending?:boolean; local?:boolean; }
interface Clip {
  id:string; assetId:string; name:string; startTime:number; endTime:number; trimStart:number;
  trimEnd:number; duration:number; speed?:number; volume?:number; opacity?:number;
  rotate?:number; flipH?:boolean; flipV?:boolean; brightness?:number; contrast?:number;
  saturation?:number; grayscale?:boolean; fadeIn?:number; fadeOut?:number;
  effects?:string[]; animations?:string[]; keyframes?:any[];
}
interface Track { id:string; type:string; name:string; clips:Clip[]; muted?:boolean; locked?:boolean; visible?:boolean; height?:number; order?:number; }
interface Timeline { tracks:Track[]; duration:number; currentTime:number; markers?:{id:string;time:number;label:string;color?:string}[]; }
interface Project { id:string; name:string; timeline:Timeline; assets:Asset[]; historyIndex:number; historyLength:number; }

type Category = 'media'|'edit'|'audio'|'text'|'effects'|'transitions'|'speed'|'adjust'|'transform'|'animation'|'ai';
type IconComponent = React.ComponentType<{size?:number; strokeWidth?:number}>;
type Tool = { id:string; label:string; icon:IconComponent; command?:string; value?:number; min?:number; max?:number; step?:number; unit?:string; description?:string; };

const API=(import.meta.env.VITE_API_URL||'https://ai-creative-studio-api-0gl6.onrender.com').replace(/\/$/,'');
const api=(path:string)=>`${API}${path}`;

const CATEGORY_META:Record<Category,{label:string;icon:IconComponent}>= {
  media:{label:'الوسائط',icon:FolderOpen}, edit:{label:'التحرير',icon:Scissors}, audio:{label:'الصوت',icon:AudioLines},
  text:{label:'النص',icon:Type}, effects:{label:'التأثيرات',icon:Wand2}, transitions:{label:'الانتقالات',icon:ArrowLeftRight},
  speed:{label:'السرعة',icon:Gauge}, adjust:{label:'الألوان',icon:Palette}, transform:{label:'التحويل',icon:Move3D},
  animation:{label:'الحركة',icon:Zap}, ai:{label:'المساعد الذكي',icon:Bot}
};

const TOOLS:Record<Category,Tool[]>= {
  media:[
    {id:'import',label:'استيراد',icon:Upload,description:'استيراد فوري مع معاينة محلية'},
    {id:'replace',label:'استبدال',icon:Replace}, {id:'duplicate',label:'تكرار',icon:Copy,command:'كرر المقطع'},
    {id:'freeze',label:'تجميد',icon:Snowflake,command:'جمّد الإطار'}, {id:'snapshot',label:'لقطة',icon:Camera}
  ],
  edit:[
    {id:'split',label:'تقسيم',icon:Split,command:'قسّم المقطع نصفين'},
    {id:'trim-start',label:'قص البداية',icon:ScissorsLineDashed,command:'قص أول 2 ثانية',value:2,min:0,max:60,step:.1,unit:'ث'},
    {id:'trim-end',label:'قص النهاية',icon:ScissorsLineDashed,command:'قص آخر 2 ثانية',value:2,min:0,max:60,step:.1,unit:'ث'},
    {id:'delete',label:'حذف',icon:Trash2,command:'احذف المقطع'}, {id:'ripple',label:'حذف متتابع',icon:Layers3,command:'حذف متتابع'},
    {id:'move',label:'تحريك',icon:MoveHorizontal,value:0,min:0,max:600,step:.01,unit:'ث'},
    {id:'mark-in',label:'دخول',icon:Crosshair}, {id:'mark-out',label:'خروج',icon:Crosshair}
  ],
  audio:[
    {id:'volume',label:'الصوت',icon:Volume2,value:100,min:0,max:400,step:1,unit:'%'},
    {id:'mute',label:'كتم',icon:VolumeX,command:'اكتم الصوت'},
    {id:'fade-in',label:'Fade In',icon:AudioWaveform,command:'تلاشي الصوت في البداية'},
    {id:'fade-out',label:'Fade Out',icon:AudioWaveform,command:'تلاشي الصوت في النهاية'},
    {id:'enhance',label:'تحسين',icon:Sparkles,command:'حسّن الصوت'}, {id:'noise',label:'الضوضاء',icon:Wave,command:'أزل ضوضاء الصوت'},
    {id:'ducking',label:'Ducking',icon:Mic2,command:'اخفض الموسيقى تحت الكلام'}, {id:'detach',label:'فصل',icon:AudioWaveform,command:'افصل الصوت عن الفيديو'}
  ],
  text:[
    {id:'title',label:'عنوان',icon:Type,command:'أضف عنوانًا'}, {id:'subtitle',label:'ترجمة',icon:Captions,command:'أضف ترجمة'},
    {id:'caption',label:'شرح',icon:MessageCircle,command:'أضف شرحًا'}, {id:'font',label:'الخط',icon:Type},
    {id:'style',label:'النمط',icon:SlidersHorizontal}, {id:'position',label:'الموضع',icon:AlignCenter},
    {id:'outline',label:'الحدود',icon:Square}, {id:'shadow',label:'الظل',icon:Circle}
  ],
  effects:[
    {id:'blur',label:'تمويه',icon:CircleDashed,command:'طبّق تمويه'}, {id:'sharpen',label:'حدة',icon:Zap,command:'زد حدة الفيديو'},
    {id:'vignette',label:'Vignette',icon:CircleDot,command:'طبّق Vignette'}, {id:'cinematic',label:'سينمائي',icon:FilmIcon,command:'طبّق تأثير سينمائي'},
    {id:'bw',label:'أبيض وأسود',icon:Contrast,command:'حوّل لأبيض وأسود'}, {id:'chroma',label:'Chroma',icon:Circle,command:'افتح Chroma Key'},
    {id:'glitch',label:'Glitch',icon:Zap,command:'طبّق Glitch'}, {id:'grain',label:'Film Grain',icon:ImageIcon,command:'أضف Film Grain'}
  ],
  transitions:[
    {id:'fade',label:'Fade',icon:CircleDashed,command:'أضف انتقال Fade'}, {id:'dissolve',label:'Dissolve',icon:Layers3,command:'أضف انتقال Dissolve'},
    {id:'slide',label:'Slide',icon:ArrowLeftRight,command:'أضف انتقال Slide'}, {id:'zoom',label:'Zoom',icon:ZoomIn,command:'أضف انتقال Zoom'},
    {id:'wipe',label:'Wipe',icon:MoveHorizontal,command:'أضف انتقال Wipe'}, {id:'duration',label:'المدة',icon:Timer,value:1,min:.1,max:10,step:.1,unit:'ث'}
  ],
  speed:[
    {id:'slow',label:'50%',icon:Gauge,command:'سرّع المقطع إلى 50%'}, {id:'fast',label:'200%',icon:Gauge,command:'سرّع المقطع إلى 200%'},
    {id:'normal',label:'100%',icon:Gauge,command:'اجعل السرعة 100%'}, {id:'curve',label:'منحنى',icon:SlidersHorizontal},
    {id:'reverse',label:'عكس',icon:RefreshCcw,command:'اعكس المقطع'}, {id:'ramp',label:'تدرج',icon:Zap}
  ],
  adjust:[
    {id:'brightness',label:'السطوع',icon:Lightbulb,value:0,min:-100,max:100,step:1,unit:'%'},
    {id:'contrast',label:'التباين',icon:Contrast,value:100,min:10,max:400,step:1,unit:'%'},
    {id:'saturation',label:'التشبع',icon:Palette,value:100,min:0,max:400,step:1,unit:'%'},
    {id:'temperature',label:'الحرارة',icon:CircleDot,value:0,min:-100,max:100,step:1,unit:'%'},
    {id:'tint',label:'الصبغة',icon:Circle,value:0,min:-100,max:100,step:1,unit:'%'},
    {id:'highlights',label:'الإضاءات',icon:MonitorPlay,value:0,min:-100,max:100,step:1,unit:'%'},
    {id:'shadows',label:'الظلال',icon:Eye,value:0,min:-100,max:100,step:1,unit:'%'},
    {id:'reset',label:'إعادة',icon:RefreshCcw,command:'أعد ضبط الألوان'}
  ],
  transform:[
    {id:'crop',label:'قص الإطار',icon:Crop,command:'افتح Crop'}, {id:'rotate',label:'تدوير',icon:RotateCcw,value:0,min:-180,max:180,step:1,unit:'°'},
    {id:'flip-h',label:'قلب أفقي',icon:FlipHorizontal2,command:'اقلب أفقيًا'}, {id:'flip-v',label:'قلب رأسي',icon:FlipVertical2,command:'اقلب رأسيًا'},
    {id:'fit',label:'ملاءمة',icon:Maximize2,command:'ملاءمة داخل الإطار'}, {id:'fill',label:'ملء',icon:Square,command:'ملء الإطار'},
    {id:'ratio',label:'الأبعاد',icon:Grid2X2}, {id:'background',label:'الخلفية',icon:ImageIcon}
  ],
  animation:[
    {id:'in',label:'دخول',icon:Play,command:'أضف حركة دخول'}, {id:'out',label:'خروج',icon:Pause,command:'أضف حركة خروج'},
    {id:'combo',label:'مركبة',icon:Zap,command:'أضف حركة مركبة'}, {id:'keyframe',label:'Keyframe',icon:CircleDot,command:'أضف Keyframe'},
    {id:'pan',label:'Pan',icon:Move3D,command:'أضف حركة Pan'}, {id:'kenburns',label:'Ken Burns',icon:Maximize2,command:'أضف Ken Burns'}
  ],
  ai:[
    {id:'captions',label:'ترجمة تلقائية',icon:Captions,command:'أنشئ ترجمة تلقائية'}, {id:'silence',label:'حذف الصمت',icon:Scissors,command:'احذف فترات الصمت'},
    {id:'highlight',label:'أهم اللقطات',icon:Sparkles,command:'استخرج أهم اللقطات'}, {id:'beats',label:'مزامنة الإيقاع',icon:Music2,command:'زامن القطع مع الإيقاع'},
    {id:'smart-cut',label:'قص ذكي',icon:Scissors,command:'طبّق قصًا ذكيًا'}, {id:'remove-bg',label:'إزالة الخلفية',icon:ImageIcon,command:'أزل خلفية الشخص'},
    {id:'enhance',label:'تحسين',icon:Wand2,command:'حسّن جودة الفيديو'}
  ]
};

function makeTimelineBackground(timeline?:Timeline):string { return timeline?.duration ? '' : 'لا توجد وسائط'; }
function trackColor(type:string){ return type==='video'?'#26395f':type==='audio'?'#1f4b3e':type==='text'?'#4f2d55':type==='overlay'?'#3d3a1f':'#252a34'; }

export function MvpEditor({projectId}:{projectId:string}){
  const [project,setProject]=useState<Project|null>(null);
  const [status,setStatus]=useState('جاري تجهيز المحرر…');
  const [selectedClip,setSelectedClip]=useState<string|null>(null);
  const [selectedTrack,setSelectedTrack]=useState<string|null>(null);
  const [activeCategory,setActiveCategory]=useState<Category>('media');
  const [assistantOpen,setAssistantOpen]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [helpOpen,setHelpOpen]=useState(false);
  const [propertyTool,setPropertyTool]=useState<Tool|null>(null);
  const [toolValue,setToolValue]=useState(0);
  const [zoom,setZoom]=useState(1);
  const [playhead,setPlayhead]=useState(0);
  const [playing,setPlaying]=useState(false);
  const [command,setCommand]=useState('');
  const [chat,setChat]=useState<{role:'user'|'assistant';text:string}[]>([]);
  const [interaction,setInteraction]=useState<{kind:'drag'|'scrub';id?:string;startX:number;original?:number;moved?:boolean;current?:number}|null>(null);
  const [mobilePanel,setMobilePanel]=useState(false);
  const videoRef=useRef<HTMLVideoElement|null>(null);
  const inputRef=useRef<HTMLInputElement|null>(null);
  const projectRef=useRef<Project|null>(null);
  const objectUrlsRef=useRef<string[]>([]);
  useEffect(()=>{projectRef.current=project;},[project]);

  const actualTracks=project?.timeline.tracks||[];
  const tracks=useMemo(()=>actualTracks.length?actualTracks:[{id:'empty-video',type:'video',name:'Video 1',clips:[],height:72,order:0}], [project]);
  const videoTrack=actualTracks.find(t=>t.type==='video');
  const clips=videoTrack?.clips||[];
  const selected=clips.find(c=>c.id===selectedClip)||clips[0];
  const selectedAsset=project?.assets.find(a=>a.id===selected?.assetId);
  const duration=Math.max(project?.timeline.duration||0.001,1);
  const pxPerSecond=90*zoom;
  const timelineWidth=Math.max(1200,duration*pxPerSecond+180);
  const pending=project?.assets.some(a=>a.pending);

  useEffect(()=>{
    (async()=>{
      try{
        let id=projectId;
        if(id==='new'){
          const created=await fetch(api('/api/projects'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'مشروع فيديو جديد'})});
          if(!created.ok)throw new Error('create');
          id=(await created.json()).id;
          window.history.replaceState({},'',`/project/${id}`);
        }
        const r=await fetch(api(`/api/projects/${id}`)); if(!r.ok)throw new Error('project');
        const data=await r.json(); setProject(data);
        const first=data?.timeline?.tracks?.find((t:Track)=>t.type==='video')?.clips?.[0];
        if(first){setSelectedClip(first.id);setSelectedTrack(videoTrack?.id||null);}
        setStatus('جاهز للعمل');
      }catch{setStatus('تعذر الاتصال بالخادم');}
    })();
    return ()=>{ for(const url of objectUrlsRef.current)URL.revokeObjectURL(url); objectUrlsRef.current=[]; };
  },[projectId]);

  useEffect(()=>{
    if(!selectedAsset || !videoRef.current || selectedAsset.mime && !selectedAsset.mime.startsWith('video/')) return;
    const next=api(selectedAsset.url);
    if(videoRef.current.src!==next){
      videoRef.current.src=next;
      videoRef.current.load();
    }
  },[selectedAsset?.id]);

  function seek(time:number){
    const t=Math.max(0,Math.min(duration,time));
    setPlayhead(t); if(videoRef.current&&Number.isFinite(videoRef.current.duration))videoRef.current.currentTime=Math.min(t,videoRef.current.duration);
  }
  function timeFromClient(clientX:number, element:HTMLElement){
    const rect=element.getBoundingClientRect();
    return Math.max(0,(clientX-rect.left)/pxPerSecond);
  }

  function selectClip(clip:Clip, trackId:string, e?:React.PointerEvent){
    e?.stopPropagation();
    setSelectedClip(clip.id); setSelectedTrack(trackId); setPropertyTool(null);
  }

  async function importOne(file:File){
    if(!project)return;
    const localUrl=URL.createObjectURL(file); objectUrlsRef.current.push(localUrl);
    const mime=file.type||'video/mp4';
    const media=document.createElement(mime.startsWith('audio/')?'audio':'video');
    media.preload='metadata';
    const localDuration=await new Promise<number>((resolve)=>{media.onloadedmetadata=()=>resolve(Number.isFinite(media.duration)?media.duration:0);media.onerror=()=>resolve(0);media.src=localUrl;});
    const trackType=mime.startsWith('audio/')?'audio':'video';
    const track=project.timeline.tracks.find(t=>t.type===trackType)||project.timeline.tracks.find(t=>t.type==='video');
    if(!track)return;
    const start=project.timeline.duration;
    const assetId=`local-${crypto.randomUUID()}`;
    const clipId=`local-clip-${crypto.randomUUID()}`;
    const asset:Asset={id:assetId,name:file.name,url:localUrl,duration:localDuration,mime,pending:true,local:true};
    const clip:Clip={id:clipId,assetId,name:file.name,startTime:start,endTime:start+localDuration,trimStart:0,trimEnd:localDuration,duration:localDuration,speed:1,volume:1,opacity:1,effects:[],animations:[],keyframes:[]};
    setProject(p=>p?{...p,assets:[...p.assets,asset],timeline:{...p.timeline,duration:start+localDuration,tracks:p.timeline.tracks.map(t=>t.id===track.id?{...t,clips:[...t.clips,clip]}:t)}}:p);
    setSelectedClip(clipId);setSelectedTrack(track.id);setPlayhead(start);setStatus('تم الاستيراد فورياً — جارٍ الحفظ في الخلفية');

    try{
      const form=new FormData();form.append('file',file);
      const r=await fetch(api(`/api/projects/${project.id}/upload`),{method:'POST',body:form});
      if(!r.ok)throw new Error('upload');
      const remote=await r.json();
      setProject(p=>{
        if(!p)return p;
        const remoteClip=(remote.timeline.tracks.find((t:Track)=>t.type===trackType)||remote.timeline.tracks.find((t:Track)=>t.type==='video'))?.clips?.at(-1);
        const localIndex=p.assets.findIndex(a=>a.id===assetId);
        const localClipExists=p.timeline.tracks.some(t=>t.clips.some(c=>c.id===clipId));
        if(!remoteClip || !localClipExists)return {...remote};
        const remoteAsset=remote.assets.find((a:Asset)=>a.id===remoteClip.assetId);
        const nextTracks=p.timeline.tracks.map(t=>({...t,clips:t.clips.map(c=>c.id===clipId?{...remoteClip,id:clipId,assetId:remoteAsset?.id||c.assetId,startTime:c.startTime,endTime:c.endTime,duration:c.duration}:c)}));
        const nextAssets=p.assets.map(a=>a.id===assetId&&remoteAsset?{...remoteAsset,pending:false,local:false}:a);
        return {...remote,timeline:{...remote.timeline,tracks:nextTracks},assets:nextAssets};
      });
      setStatus('تم حفظ الوسائط');
    }catch{setProject(p=>p?{...p,assets:p.assets.map(a=>a.id===assetId?{...a,pending:false}:a)}:p);setStatus('المعاينة جاهزة لكن تعذر رفع النسخة إلى الخادم');}
  }
  async function handleImport(files:FileList|null){if(!files?.length)return;for(const file of Array.from(files))await importOne(file);}

  async function commandRequest(text:string, clipIdOverride?:string){
    const clean=text.trim(); const current=projectRef.current; if(!current||!clean)return;
    const targetId=clipIdOverride||selected?.id;
    setChat(prev=>assistantOpen?[...prev,{role:'user',text:clean}]:prev); setStatus('جاري تنفيذ الأمر…');
    try{
      const r=await fetch(api(`/api/projects/${current.id}/ai-command`),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:clean,clipId:targetId})});
      const d=await r.json();
      if(!r.ok){setStatus(d?.error||'فشل التنفيذ');if(assistantOpen)setChat(prev=>[...prev,{role:'assistant',text:d?.error||'تعذر التنفيذ.'}]);return;}
      setProject(p=>p?{...p,timeline:d.timeline}:p);
      const reply=d?.command?.message||'تم تنفيذ الأمر.'; setStatus(reply); setCommand(''); if(assistantOpen)setChat(prev=>[...prev,{role:'assistant',text:reply}]);
    }catch{setStatus('تعذر الوصول إلى محرك التنفيذ');if(assistantOpen)setChat(prev=>[...prev,{role:'assistant',text:'تعذر الوصول إلى محرك التنفيذ.'}]);}
  }

  async function history(action:'undo'|'redo'){
    const current=projectRef.current;if(!current)return;setStatus(action==='undo'?'جاري التراجع…':'جاري الإعادة…');
    const r=await fetch(api(`/api/projects/${current.id}/${action}`),{method:'POST'}); if(r.ok){const data=await r.json();setProject(data);setStatus(action==='undo'?'تم التراجع':'تمت الإعادة');}else setStatus('لا توجد عملية متاحة');
  }

  async function render(){
    if(!project||pending){setStatus('انتظر حتى يكتمل حفظ الوسائط في الخلفية');return;}
    if(!clips.length){setStatus('أضف وسائط أولاً');return;}
    setStatus('جاري التصدير…');const r=await fetch(api(`/api/projects/${project.id}/render`),{method:'POST'});
    if(!r.ok){const d=await r.json().catch(()=>null);setStatus(d?.error||'فشل التصدير');return;}
    const blob=await r.blob();const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='ai-creative-studio.mp4';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setStatus('تم التصدير بنجاح');
  }

  function beginDrag(e:React.PointerEvent,clip:Clip,trackId:string){
    e.stopPropagation(); setSelectedClip(clip.id);setSelectedTrack(trackId); setInteraction({kind:'drag',id:clip.id,startX:e.clientX,original:clip.startTime,moved:false,current:clip.startTime});
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function dragMove(e:React.PointerEvent){
    if(!interaction)return;
    if(interaction.kind==='scrub'){seek(timeFromClient(e.clientX,e.currentTarget as HTMLElement));return;}
    if(interaction.kind==='drag'&&interaction.id&&interaction.original!==undefined){
      const delta=(e.clientX-interaction.startX)/pxPerSecond;const next=Math.max(0,interaction.original+delta);const moved=Math.abs(delta)>0.01;
      setInteraction({...interaction,current:next,moved});
      if(moved)setProject(p=>p?{...p,timeline:{...p.timeline,tracks:p.timeline.tracks.map(t=>t.type==='video'||t.type==='audio'?{...t,clips:t.clips.map(c=>c.id===interaction.id?{...c,startTime:next,endTime:next+c.duration}:c)}:t)}}:p);
    }
  }
  function pointerUp(e:React.PointerEvent){
    if(!interaction)return;
    const done=interaction;setInteraction(null);
    if(done.kind==='drag'&&done.id&&done.moved&&done.current!==undefined){commandRequest(`انقل المقطع إلى ${done.current.toFixed(2)}`,done.id);}
    e.stopPropagation();
  }
  function beginScrub(e:React.PointerEvent){
    if((e.target as HTMLElement).closest('[data-clip]'))return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);setInteraction({kind:'scrub',startX:e.clientX});seek(timeFromClient(e.clientX,e.currentTarget as HTMLElement));
  }

  function openTool(tool:Tool){
    if(tool.id==='import'){inputRef.current?.click();return;}
    if(tool.command && tool.id!=='trim-start'&&tool.id!=='trim-end'&&tool.id!=='move'&&tool.id!=='volume'&&tool.id!=='brightness'&&tool.id!=='contrast'&&tool.id!=='saturation'&&tool.id!=='rotate'){
      commandRequest(tool.command);return;
    }
    if(tool.value!==undefined||tool.id==='trim-start'||tool.id==='trim-end'||tool.id==='move'||tool.id==='volume'||tool.id==='brightness'||tool.id==='contrast'||tool.id==='saturation'||tool.id==='rotate'){
      setToolValue(tool.value??(tool.id==='volume'?100:tool.id==='contrast'||tool.id==='saturation'?100:tool.id==='rotate'?0:2));setPropertyTool(tool);
    } else if(tool.id==='replace'){inputRef.current?.click();}
    else setPropertyTool(tool);
  }
  async function applyProperty(){
    const t=propertyTool;if(!t)return;
    const v=Number(toolValue);
    if(!selected){setStatus('اختر مقطعًا أولًا');return;}
    const commandMap:Record<string,string>={volume:`اضبط الصوت إلى ${v}%`,brightness:`اضبط السطوع إلى ${v}%`,contrast:`اضبط التباين إلى ${v}%`,saturation:`اضبط التشبع إلى ${v}%`,rotate:`دوّر المقطع ${v} درجة`,'trim-start':`قص أول ${v} ثانية`,'trim-end':`قص آخر ${v} ثانية`,move:`انقل المقطع إلى ${v}`};
    await commandRequest(commandMap[t.id]||t.label+' '+v,selected.id);setPropertyTool(null);
  }

  const activeTools=TOOLS[activeCategory];
  const currentVideo=selectedAsset?.mime?.startsWith('video/')||(!selectedAsset?.mime&&selectedAsset?.url&&!selectedAsset.url.startsWith('blob:'));

  return <div className="h-full w-full flex flex-col bg-[#080a0f] text-white overflow-hidden select-none" dir="rtl">
    <header className="h-12 shrink-0 border-b border-white/10 bg-[#11151c] flex items-center gap-2 px-2">
      <div className="flex items-center gap-2 min-w-0"><div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center"><Film size={16}/></div><span className="font-semibold text-sm truncate">AI Creative Studio</span></div>
      <div className="w-px h-6 bg-white/10"/>
      <button className="iconButton primary" title="استيراد" onClick={()=>inputRef.current?.click()}><Upload size={17}/></button>
      <input ref={inputRef} type="file" multiple accept="video/*,audio/*,image/*" className="hidden" onChange={e=>handleImport(e.target.files)}/>
      <button className="iconButton" title="تراجع" onClick={()=>history('undo')}><Undo2 size={17}/></button>
      <button className="iconButton" title="إعادة" onClick={()=>history('redo')}><Redo2 size={17}/></button>
      <div className="flex-1"/>
      <span className="text-[11px] text-white/45 truncate max-w-[32vw]">{pending?'يحفظ الوسائط في الخلفية…':status}</span>
      <button className="iconButton" title="المساعدة" onClick={()=>setHelpOpen(true)}><CircleHelp size={17}/></button>
      <button className="iconButton" title="الإعدادات" onClick={()=>setSettingsOpen(true)}><Settings2 size={17}/></button>
      <button className="iconButton primary" title="تصدير" onClick={render}><Download size={17}/></button>
    </header>

    <main className="flex-1 min-h-0 flex flex-col">
      <section className="flex-[4] min-h-0 border-b border-white/10 bg-[#0b0d12] relative flex items-center justify-center overflow-hidden">
        <div className="w-full h-full max-w-[1500px] flex items-center justify-center p-3">
          {currentVideo ? <video ref={videoRef} className="max-h-full max-w-full object-contain rounded-xl bg-black shadow-2xl" controls={false}
            onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onTimeUpdate={e=>setPlayhead((e.currentTarget as HTMLVideoElement).currentTime)} onLoadedMetadata={e=>{const v=e.currentTarget;if(playhead>0&&playhead<v.duration)v.currentTime=playhead;}}/>:
            <div className="flex flex-col items-center gap-3 text-white/35"><MonitorPlay size={54}/><div className="text-sm">استورد فيديو للمعاينة</div></div>}
        </div>
        <div className="absolute left-3 bottom-3 flex items-center gap-2">
          <button className="iconButton bg-black/70" title={playing?'إيقاف':'تشغيل'} onClick={()=>{if(!videoRef.current)return;playing?videoRef.current.pause():videoRef.current.play();}}>{playing?<Pause size={18}/>:<Play size={18}/>}</button>
          <div className="text-[11px] font-mono bg-black/70 px-2 py-1 rounded-md">{playhead.toFixed(2)} / {duration.toFixed(2)}</div>
        </div>
        <div className="absolute right-3 bottom-3 flex items-center gap-1 bg-black/70 rounded-lg p-1">
          <button className="iconButton small" title="تصغير" onClick={()=>setZoom(z=>Math.max(.25,z-.25))}><ZoomOut size={15}/></button>
          <span className="px-2 text-[11px] font-mono">{Math.round(zoom*100)}%</span>
          <button className="iconButton small" title="تكبير" onClick={()=>setZoom(z=>Math.min(6,z+.25))}><ZoomIn size={15}/></button>
        </div>
      </section>

      <section className="flex-[4] min-h-0 bg-[#0c0f15] flex flex-col">
        <div className="h-8 shrink-0 border-b border-white/10 bg-[#11151c] flex items-center gap-1 px-2">
          <button className="iconButton small" title="تكبير الـTimeline" onClick={()=>setZoom(z=>Math.min(6,z+.25))}><Plus size={14}/></button>
          <button className="iconButton small" title="تصغير الـTimeline" onClick={()=>setZoom(z=>Math.max(.25,z-.25))}><Minus size={14}/></button>
          <button className="iconButton small" title="حفظ المشروع" onClick={()=>setStatus('آخر حالة محفوظة على الخادم')}><Save size={14}/></button>
          <div className="w-px h-4 bg-white/10 mx-1"/>
          <span className="text-[10px] text-white/45">{tracks.length} مسارات • {clips.length} مقاطع • {duration.toFixed(2)}s</span>
          <div className="flex-1"/>
          <button className="iconButton small" title="فهرس الـTimeline" onClick={()=>setMobilePanel(v=>!v)}><Rows3 size={14}/></button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto" onPointerMove={dragMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
          <div className="relative min-w-max" style={{width:timelineWidth+140}}>
            <div className="sticky top-0 z-20 h-9 bg-[#10131a] border-b border-white/10 flex">
              <div className="w-32 shrink-0 border-l border-white/10 flex items-center px-3 text-[10px] text-white/40">المسارات</div>
              <div className="relative flex-1" onPointerDown={beginScrub}>
                {Array.from({length:Math.ceil(duration)+1},(_,i)=>i).map(i=><div key={i} className="absolute top-0 bottom-0 text-[9px] text-white/35 border-l border-white/10" style={{left:i*pxPerSecond}}><span className="absolute -top-0.5 right-1">{i}s</span></div>)}
                <div className="absolute top-0 bottom-0 w-px bg-red-400 z-20" style={{left:playhead*pxPerSecond}}><div className="w-2.5 h-2.5 bg-red-400 rotate-45 -mt-1 mr-[calc(50%-5px)]"/></div>
              </div>
            </div>
            {tracks.map(track=><div key={track.id} className="h-[72px] flex border-b border-white/10" onClick={()=>setSelectedTrack(track.id)}>
              <div className="w-32 shrink-0 bg-[#11151c] border-l border-white/10 px-2 flex items-center gap-2">
                <button className="iconButton tiny" title={track.visible===false?'إظهار':'إخفاء'} onClick={e=>{e.stopPropagation();setStatus('إظهار/إخفاء المسار')}}>{track.visible===false?<EyeOff size={12}/>:<Eye size={12}/>}</button>
                <button className="iconButton tiny" title={track.locked?'فتح القفل':'قفل'} onClick={e=>{e.stopPropagation();setStatus('قفل/فتح المسار')}}>{track.locked?<Lock size={12}/>:<Unlock size={12}/>}</button>
                <span className="text-[10px] text-white/60 truncate">{track.name}</span>
              </div>
              <div className="relative flex-1 min-h-full" style={{background:`linear-gradient(to right, rgba(255,255,255,.025) 1px, transparent 1px)`,backgroundSize:`${pxPerSecond}px 100%`}} onPointerDown={beginScrub}>
                {track.clips.map(clip=>{
                  const left=clip.startTime*pxPerSecond; const width=Math.max(54,clip.duration*pxPerSecond); const active=selected?.id===clip.id;
                  return <div key={clip.id} data-clip="true" className={`absolute top-2 h-[56px] rounded-md border ${active?'border-white shadow-lg':'border-white/10'} overflow-hidden cursor-grab active:cursor-grabbing`} style={{left, width, background:trackColor(track.type)}} onPointerDown={e=>beginDrag(e,clip,track.id)} onClick={e=>selectClip(clip,track.id,e)}>
                    <div className="h-full flex flex-col justify-between p-1.5">
                      <div className="text-[9px] text-white/75 truncate flex items-center gap-1"><Film size={10}/>{clip.name}</div>
                      <div className="flex items-center gap-1 text-[8px] text-white/40"><span>{clip.duration.toFixed(2)}s</span>{clip.speed&&clip.speed!==1?<span>• {Math.round(clip.speed*100)}%</span>:null}</div>
                    </div>
                  </div>;
                })}
                {selected?.id && track.type==='video'&&<div className="absolute top-0 bottom-0 w-px bg-red-400/70 pointer-events-none" style={{left:playhead*pxPerSecond}}/>}
              </div>
            </div>)}
            {!tracks.length&&<div className="absolute inset-0 flex items-center justify-center text-white/25">{makeTimelineBackground(project?.timeline)}</div>}
          </div>
        </div>
      </section>

      <section className="flex-[1] min-h-[92px] max-h-[120px] shrink-0 border-t border-white/10 bg-[#0e1117] flex flex-col">
        {activeCategory&&<div className="flex-1 min-h-0 flex items-center gap-2 px-2 overflow-x-auto">
          {activeTools.map(tool=>{
            const I=tool.icon;return <button key={tool.id} className={`toolIcon ${propertyTool?.id===tool.id?'active':''}`} title={tool.label} aria-label={tool.label} onClick={()=>openTool(tool)}><I size={20}/></button>
          })}
        </div>}
        <div className="h-11 shrink-0 border-t border-white/10 flex items-center justify-center gap-1 px-2 overflow-x-auto">
          {(Object.keys(CATEGORY_META) as Category[]).map(cat=>{const meta=CATEGORY_META[cat];const I=meta.icon;return <button key={cat} className={`categoryIcon ${activeCategory===cat?'active':''}`} title={meta.label} aria-label={meta.label} onClick={()=>{setActiveCategory(cat);setPropertyTool(null);}}><I size={19}/></button>})}
        </div>
      </section>
    </main>

    <button className="fixed bottom-[115px] left-4 z-40 w-14 h-14 rounded-full bg-white text-black shadow-2xl flex items-center justify-center hover:scale-105 transition" title="فتح المساعد" aria-label="فتح المساعد" onClick={()=>setAssistantOpen(true)}><MessageCircle size={25}/></button>

    {propertyTool&&<div className="fixed z-50 bottom-[126px] left-1/2 -translate-x-1/2 w-[min(440px,calc(100vw-24px))] rounded-2xl border border-white/10 bg-[#151922] shadow-2xl p-4">
      <div className="flex items-center justify-between mb-3"><div className="text-sm font-semibold">{propertyTool.label}</div><button className="iconButton small" onClick={()=>setPropertyTool(null)}><X size={14}/></button></div>
      <div className="flex items-center gap-3"><input type="range" className="flex-1" min={propertyTool.min??0} max={propertyTool.max??100} step={propertyTool.step??1} value={toolValue} onChange={e=>setToolValue(Number(e.target.value))}/><div className="w-16 text-center text-xs font-mono bg-black/30 rounded-md px-2 py-1">{toolValue}{propertyTool.unit||''}</div></div>
      <div className="flex items-center justify-end gap-2 mt-4"><button className="iconButton" title="إلغاء" onClick={()=>setPropertyTool(null)}><X size={16}/></button><button className="iconButton primary" title="تطبيق" onClick={applyProperty}><Check size={16}/></button></div>
    </div>}

    {assistantOpen&&<div className="fixed inset-0 z-[70] bg-black/65 flex items-end justify-center p-3">
      <div className="w-full max-w-2xl h-[min(620px,85vh)] rounded-3xl border border-white/10 bg-[#12161e] shadow-2xl flex flex-col overflow-hidden">
        <div className="h-12 shrink-0 border-b border-white/10 flex items-center justify-between px-4"><div className="flex items-center gap-2"><Bot size={18}/><span className="font-semibold text-sm">المساعد الذكي</span></div><button className="iconButton small" onClick={()=>setAssistantOpen(false)}><X size={15}/></button></div>
        <div className="flex-1 overflow-auto p-4 space-y-3">
          {!chat.length&&<div className="text-sm text-white/45 text-center py-10">أعطني أمرًا مباشرًا، مثل: «قص أول 3 ثوانٍ»، «زد السرعة إلى 150%»، «اجعل الصوت 70%»، «قسّم المقطع نصفين».</div>}
          {chat.map((m,i)=><div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role==='user'?'mr-auto bg-white text-black':'ml-auto bg-white/7 border border-white/10'}`}>{m.text}</div>)}
        </div>
        <div className="shrink-0 border-t border-white/10 p-3 flex gap-2"><input autoFocus value={command} onChange={e=>setCommand(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')commandRequest(command)}} placeholder="اكتب أمرًا…" className="flex-1 bg-black/30 border border-white/10 rounded-xl px-3 py-2 text-sm outline-none"/><button className="iconButton primary" title="تنفيذ" onClick={()=>commandRequest(command)}><Sparkles size={17}/></button></div>
      </div>
    </div>}

    {settingsOpen&&<div className="fixed inset-0 z-[70] bg-black/65 flex items-center justify-center p-4"><div className="w-full max-w-lg rounded-2xl bg-[#151922] border border-white/10 shadow-2xl p-5">
      <div className="flex items-center justify-between mb-4"><div className="font-semibold">الإعدادات</div><button className="iconButton small" onClick={()=>setSettingsOpen(false)}><X size={15}/></button></div>
      <div className="space-y-3 text-sm"><div className="rounded-xl bg-black/20 p-3 flex items-center justify-between"><span>API</span><span className="text-white/45 truncate max-w-[65%]">{API}</span></div><div className="rounded-xl bg-black/20 p-3 flex items-center justify-between"><span>دقة المشروع</span><span className="text-white/45">تحدد من المصدر حاليًا</span></div><div className="rounded-xl bg-black/20 p-3 flex items-center justify-between"><span>التصدير</span><span className="text-white/45">MP4 • H.264 • AAC</span></div></div>
    </div></div>}

    {helpOpen&&<div className="fixed inset-0 z-[70] bg-black/65 flex items-center justify-center p-4"><div className="w-full max-w-lg rounded-2xl bg-[#151922] border border-white/10 shadow-2xl p-5">
      <div className="flex items-center justify-between mb-4"><div className="font-semibold">طريقة العمل</div><button className="iconButton small" onClick={()=>setHelpOpen(false)}><X size={15}/></button></div>
      <div className="grid grid-cols-2 gap-2 text-xs text-white/65"><div className="rounded-lg bg-black/20 p-3">النقر على المقطع = تحديد فقط.</div><div className="rounded-lg bg-black/20 p-3">السحب = نقل بعد تحريك فعلي.</div><div className="rounded-lg bg-black/20 p-3">النقر على المسطرة = تحريك الـPlayhead.</div><div className="rounded-lg bg-black/20 p-3">الاستيراد يظهر فورًا ثم يُرفع في الخلفية.</div></div>
    </div></div>}

    <style>{`.iconButton{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:9px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.035);color:white;transition:.15s}.iconButton:hover{background:rgba(255,255,255,.09)}.iconButton.primary{background:#fff;color:#111;border-color:#fff}.iconButton.small{width:28px;height:28px;border-radius:7px}.iconButton.tiny{width:22px;height:22px;border-radius:6px}.toolIcon{width:56px;height:56px;flex:none;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.025);border-radius:12px;display:flex;align-items:center;justify-content:center;color:#d7dbe6}.toolIcon:hover{background:rgba(255,255,255,.08);transform:translateY(-1px)}.toolIcon.active{background:rgba(255,255,255,.12);color:white;border-color:rgba(255,255,255,.25)}.categoryIcon{width:40px;height:40px;flex:none;border-radius:10px;display:flex;align-items:center;justify-content:center;color:#9da5b5}.categoryIcon:hover{background:rgba(255,255,255,.07);color:white}.categoryIcon.active{background:#fff;color:#0e1117}.fixed input[type=range]{accent-color:#fff}`}</style>
  </div>;
}
