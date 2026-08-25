import React, { useEffect, useMemo, useRef, useState } from 'react';

interface Asset { id:string; name:string; url:string; duration:number; }
interface Clip { id:string; assetId:string; name:string; startTime:number; endTime:number; trimStart:number; trimEnd:number; duration:number; }
interface Track { id:string; type:string; name:string; clips:Clip[]; }
interface Timeline { tracks:Track[]; duration:number; currentTime:number; }
interface Project { id:string; name:string; timeline:Timeline; assets:Asset[]; historyIndex:number; historyLength:number; }

const API = (import.meta.env.VITE_API_URL || 'https://ai-creative-studio-api-0gl6.onrender.com').replace(/\/$/, '');
const api = (path:string) => `${API}${path}`;

type Tool = 'split'|'delete'|'trim-start'|'trim-end'|'move';

export function MvpEditor({ projectId }: { projectId:string }) {
  const [project,setProject]=useState<Project|null>(null);
  const [status,setStatus]=useState('جاري تجهيز المحرر…');
  const [command,setCommand]=useState('');
  const [selectedClip,setSelectedClip]=useState<string|null>(null);
  const [playing,setPlaying]=useState(false);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [helpOpen,setHelpOpen]=useState(false);
  const [tool,setTool]=useState<Tool>('split');
  const [toolValue,setToolValue]=useState('2');
  const videoRef=useRef<HTMLVideoElement|null>(null);
  const inputRef=useRef<HTMLInputElement|null>(null);

  const videoTrack=useMemo(()=>project?.timeline.tracks.find(t=>t.type==='video'),[project]);
  const clips=videoTrack?.clips||[];
  const selected=clips.find(c=>c.id===selectedClip)||clips[0];
  const selectedAsset=project?.assets.find(a=>a.id===selected?.assetId);

  useEffect(()=>{
    (async()=>{
      try{
        let id=projectId;
        if(id==='new'){
          const created=await fetch(api('/api/projects'),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'مشروع فيديو جديد'})});
          if(!created.ok) throw new Error('create');
          id=(await created.json()).id;
          window.history.replaceState({},'',`/project/${id}`);
        }
        const r=await fetch(api(`/api/projects/${id}`));
        if(!r.ok) throw new Error('project');
        setProject(await r.json());
        setStatus('جاهز');
      }catch{setStatus('تعذر الاتصال بالخادم');}
    })();
  },[projectId]);

  useEffect(()=>{
    if(selectedAsset&&videoRef.current){
      const desired=api(selectedAsset.url);
      if(videoRef.current.src!==desired) videoRef.current.src=desired;
    }
  },[selectedAsset]);

  async function refresh(){
    if(!project) return;
    const r=await fetch(api(`/api/projects/${project.id}`));
    if(r.ok) setProject(await r.json());
  }

  async function upload(files:FileList|null){
    if(!files?.length||!project) return;
    setStatus('جاري استيراد الفيديو…');
    for(const file of Array.from(files)){
      const form=new FormData(); form.append('file',file);
      const r=await fetch(api(`/api/projects/${project.id}/upload`),{method:'POST',body:form});
      if(!r.ok){setStatus('فشل استيراد الفيديو');return;}
      setProject(await r.json());
    }
    setStatus('تم الاستيراد');
  }

  async function commandRequest(text:string){
    if(!project||!text.trim()) return;
    setStatus('جاري التنفيذ…');
    try{
      const r=await fetch(api(`/api/projects/${project.id}/ai-command`),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text,clipId:selected?.id})});
      const d=await r.json();
      if(!r.ok){setStatus(d?.error||'فشل تنفيذ الأمر');return;}
      setProject(p=>p?{...p,timeline:d.timeline}:p);
      setStatus(d.command?.message||'تم تنفيذ الأمر');
      setCommand('');
    }catch{setStatus('تعذر تنفيذ الأمر');}
  }

  async function applyTool(){
    if(!selected) { setStatus('اختر مقطعًا أولًا'); return; }
    const n=Number(toolValue.replace(',','.'));
    if(tool!=='delete' && (!Number.isFinite(n)||n<0)) { setStatus('أدخل قيمة صحيحة'); return; }
    const text=tool==='split'?`قسّم عند ${n}`:tool==='delete'?'احذف المقطع':tool==='trim-start'?`قص أول ${n} ثانية`:tool==='trim-end'?`قص آخر ${n} ثانية`:`حرّك إلى ${n}`;
    setCommand(text);
    await commandRequest(text);
  }

  async function history(action:'undo'|'redo'){
    if(!project) return;
    setStatus(action==='undo'?'جاري التراجع…':'جاري الإعادة…');
    const r=await fetch(api(`/api/projects/${project.id}/${action}`),{method:'POST'});
    if(r.ok){setProject(await r.json());setStatus(action==='undo'?'تم التراجع':'تمت الإعادة');}
    else setStatus('تعذر تنفيذ العملية');
  }

  async function render(){
    if(!project||!selected){setStatus('أضف فيديو أولًا');return;}
    setStatus('جاري تصدير MP4…');
    const r=await fetch(api(`/api/projects/${project.id}/render`),{method:'POST'});
    if(!r.ok){setStatus('فشل التصدير');return;}
    const blob=await r.blob();
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a'); a.href=url; a.download='ai-creative-studio.mp4'; a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    setStatus('تم التصدير بنجاح');
  }

  function selectClip(c:Clip){
    setSelectedClip(c.id);
    const asset=project?.assets.find(a=>a.id===c.assetId);
    if(asset&&videoRef.current) videoRef.current.src=api(asset.url);
  }

  const toolLabel:{[K in Tool]:string}={split:'تقسيم',delete:'حذف','trim-start':'قص البداية','trim-end':'قص النهاية',move:'تحريك'};

  return <div className="h-full w-full flex flex-col bg-[#0b0d12] text-white">
    <header className="h-14 shrink-0 px-3 border-b border-white/10 bg-[#11151d] flex items-center gap-2">
      <div className="font-semibold text-sm mr-2">AI Creative Studio</div>
      <button className="btn btn-primary" onClick={()=>inputRef.current?.click()}>استيراد</button>
      <input ref={inputRef} type="file" accept="video/*,audio/*" multiple className="hidden" onChange={e=>upload(e.target.files)}/>
      <button className="btn" onClick={()=>history('undo')} disabled={!project||project.historyIndex<=0}>تراجع</button>
      <button className="btn" onClick={()=>history('redo')} disabled={!project||project.historyIndex>=project.historyLength-1}>إعادة</button>
      <div className="flex-1"/>
      <span className="text-xs text-white/50 hidden sm:block">{status}</span>
      <button className="btn" onClick={()=>setHelpOpen(true)}>مساعدة</button>
      <button className="btn" onClick={()=>setSettingsOpen(true)}>الإعدادات</button>
      <button className="btn btn-primary" onClick={render}>تصدير</button>
    </header>

    <main className="flex-1 min-h-0 p-3 flex flex-col gap-3 overflow-hidden">
      <section className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1.7fr_.8fr] gap-3">
        <div className="min-h-0 flex flex-col gap-3">
          <div className="flex-1 min-h-[260px] rounded-xl border border-white/10 bg-black overflow-hidden flex items-center justify-center">
            {selectedAsset ? <video ref={videoRef} controls className="w-full h-full object-contain" onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)}/> : <div className="text-center text-white/40"><div className="text-4xl mb-2">▶</div><div>استورد فيديو للبدء</div></div>}
          </div>

          <div className="rounded-xl border border-white/10 bg-[#11151d] p-3 shrink-0">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {(Object.keys(toolLabel) as Tool[]).map(t=><button key={t} className={`btn text-sm ${tool===t?'btn-primary':''}`} onClick={()=>setTool(t)}>{toolLabel[t]}</button>)}
              {tool!=='delete' && <input value={toolValue} onChange={e=>setToolValue(e.target.value)} inputMode="decimal" className="w-24 bg-[#0b0d12] border border-white/10 rounded-lg px-3 py-2 text-sm" aria-label="قيمة العملية بالثواني"/>}
              <button className="btn btn-primary" onClick={applyTool}>تطبيق</button>
            </div>
            <div className="text-xs text-white/40">الأدوات تعمل على المقطع المحدد. قيمة القص/التحريك بالثواني.</div>
          </div>

          <div className="rounded-xl border border-white/10 bg-[#11151d] overflow-hidden">
            <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between"><span className="font-semibold text-sm">Timeline</span><span className="text-xs text-white/40">{(project?.timeline.duration||0).toFixed(2)}s</span></div>
            <div className="p-3 space-y-2 max-h-[26vh] overflow-auto">
              {(project?.timeline.tracks||[]).map(track=><div key={track.id}><div className="text-xs text-white/40 mb-1">{track.name}</div><div className="relative h-12 rounded-lg bg-[#090c11] border border-white/10">
                {track.clips.map(c=>{const total=Math.max(project?.timeline.duration||1,0.01); const left=100*c.startTime/total; const width=100*c.duration/total; return <button key={c.id} onClick={()=>selectClip(c)} title={c.name} className={`absolute top-1 h-10 rounded-lg px-2 text-left text-xs overflow-hidden bg-primary-600/70 ${selected?.id===c.id?'ring-2 ring-white':'border border-white/10'}`} style={{left:`${left}%`,width:`${Math.max(5,width)}%`}}>{c.name}</button>;})}
              </div></div>)}
              {clips.length===0&&<div className="text-center text-sm text-white/30 py-3">لا توجد مقاطع بعد</div>}
            </div>
          </div>
        </div>

        <aside className="rounded-xl border border-white/10 bg-[#11151d] p-3 flex flex-col min-h-0">
          <div className="font-semibold mb-1">المساعد</div>
          <div className="text-xs text-white/40 mb-3">اكتب الأمر بالعربية أو الإنجليزية وسأطبقه على المقطع المحدد.</div>
          <div className="space-y-2 overflow-auto">
            <button className="w-full text-right rounded-lg border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm hover:bg-white/5" onClick={()=>setCommand('قص أول 2 ثانية')}>قص أول 2 ثانية</button>
            <button className="w-full text-right rounded-lg border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm hover:bg-white/5" onClick={()=>setCommand('قص آخر 2 ثانية')}>قص آخر 2 ثانية</button>
            <button className="w-full text-right rounded-lg border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm hover:bg-white/5" onClick={()=>setCommand('قسّم المقطع نصفين')}>قسّم المقطع نصفين</button>
            <button className="w-full text-right rounded-lg border border-white/10 bg-[#0b0d12] px-3 py-2 text-sm hover:bg-white/5" onClick={()=>setCommand('انقل المقطع إلى 3')}>انقل المقطع إلى 3 ثوانٍ</button>
          </div>
          <div className="mt-auto pt-3">
            <div className="flex gap-2">
              <input value={command} onChange={e=>setCommand(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')commandRequest(command)}} placeholder="مثال: احذف المقطع" className="flex-1 min-w-0 bg-[#0b0d12] border border-white/10 rounded-lg px-3 py-2 text-sm"/>
              <button className="btn btn-primary" onClick={()=>commandRequest(command)}>نفّذ</button>
            </div>
            <div className="mt-2 text-[11px] text-white/30">المقاطع: {clips.length} • {playing?'تشغيل':'متوقف'}</div>
          </div>
        </aside>
      </section>
    </main>

    {helpOpen&&<div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"><div className="w-full max-w-lg rounded-2xl bg-[#11151d] border border-white/10 p-5">
      <div className="flex items-center justify-between mb-4"><h2 className="font-semibold">مساعدة سريعة</h2><button className="btn" onClick={()=>setHelpOpen(false)}>إغلاق</button></div>
      <div className="space-y-3 text-sm text-white/70">
        <div><b className="text-white">قص البداية:</b> «قص أول 3 ثواني»</div>
        <div><b className="text-white">قص النهاية:</b> «قص آخر 2 ثانية»</div>
        <div><b className="text-white">تقسيم:</b> «قسّم عند 5» أو «قسّم المقطع نصفين»</div>
        <div><b className="text-white">تحريك:</b> «انقل المقطع إلى 3»</div>
        <div><b className="text-white">حذف:</b> «احذف المقطع»</div>
      </div>
    </div></div>}

    {settingsOpen&&<div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"><div className="w-full max-w-lg rounded-2xl bg-[#11151d] border border-white/10 p-5">
      <div className="flex items-center justify-between mb-4"><h2 className="font-semibold">الإعدادات</h2><button className="btn" onClick={()=>setSettingsOpen(false)}>إغلاق</button></div>
      <div className="space-y-3 text-sm">
        <div className="rounded-lg bg-[#0b0d12] border border-white/10 p-3"><div className="text-white/50 text-xs mb-1">الخادم</div><div>Render API</div></div>
        <div className="rounded-lg bg-[#0b0d12] border border-white/10 p-3"><div className="text-white/50 text-xs mb-1">المساعد</div><div>يعمل محليًا دون مفتاح API، ويستخدم OpenAI عند توفر المفتاح.</div></div>
        <div className="rounded-lg bg-[#0b0d12] border border-white/10 p-3"><div className="text-white/50 text-xs mb-1">التصدير</div><div>MP4 / H.264 عبر FFmpeg</div></div>
      </div>
    </div></div>}
  </div>;
}
