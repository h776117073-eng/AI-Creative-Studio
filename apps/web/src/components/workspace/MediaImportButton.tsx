import React, { useRef, useState } from 'react';
import { Film, ImagePlus, Loader2, Music2, Upload, X } from 'lucide-react';

export interface VireonImportedMedia {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  file: File;
  duration?: number;
}

const API=(import.meta.env.VITE_API_URL||'https://ai-creative-studio-api-0gl6.onrender.com').replace(/\/$/,'');

async function mediaDuration(file: File): Promise<number | undefined> {
  if (!file.type.startsWith('video/') && !file.type.startsWith('audio/')) return undefined;
  return new Promise((resolve) => {
    const element = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    element.preload = 'metadata';
    element.onloadedmetadata = () => { const value = Number.isFinite(element.duration) ? element.duration : undefined; URL.revokeObjectURL(url); resolve(value); };
    element.onerror = () => { URL.revokeObjectURL(url); resolve(undefined); };
    element.src = url;
  });
}

export function MediaImportButton({ projectId }: { projectId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<VireonImportedMedia[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function importFiles(files: FileList | null) {
    if (!files?.length || busy || projectId === 'new') return;
    setBusy(true); setError('');
    const imported: VireonImportedMedia[] = [];
    try {
      for (const file of Array.from(files)) {
        const duration = await mediaDuration(file);
        const localUrl = URL.createObjectURL(file);
        const local: VireonImportedMedia = { id: crypto.randomUUID(), name: file.name, mime: file.type || 'application/octet-stream', size: file.size, url: localUrl, file, duration };
        const form = new FormData(); form.append('file', file, file.name);
        const response = await fetch(`${API}/api/projects/${projectId}/upload`, { method: 'POST', body: form });
        if (!response.ok) throw new Error(`تعذر استيراد ${file.name}`);
        imported.push(local);
      }
      setItems((current) => [...current, ...imported]);
      setOpen(true);
      window.dispatchEvent(new CustomEvent('vireon:media-imported', { detail: imported }));
      window.setTimeout(() => window.location.reload(), 250);
    } catch (e) {
      for (const item of imported) URL.revokeObjectURL(item.url);
      setError(e instanceof Error ? e.message : 'تعذر استيراد الوسائط');
    } finally { setBusy(false); }
  }

  function remove(id: string) {
    setItems((current) => {
      const item = current.find((x) => x.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return current.filter((x) => x.id !== id);
    });
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-50 flex items-start justify-center px-3 pt-3">
      <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-white/10 bg-[#0d1119]/95 p-1.5 shadow-2xl backdrop-blur-xl">
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex items-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-400 active:scale-[.98] disabled:cursor-wait disabled:opacity-70" title="استيراد الفيديو والصوت والصور">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />} {busy ? 'جاري الاستيراد…' : 'استيراد الوسائط'}
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-white/70 hover:bg-white/5 hover:text-white">
          {items.length ? `${items.length} مستورد` : 'المكتبة'}
        </button>
      </div>
      <input ref={input} hidden type="file" multiple accept="video/*,audio/*,image/*" onChange={(e) => { void importFiles(e.target.files); e.currentTarget.value = ''; }} />

      {open && (items.length > 0 || error) && (
        <div className="pointer-events-auto absolute left-3 right-3 top-16 max-h-56 overflow-auto rounded-xl border border-white/10 bg-[#0b0f16]/98 p-2 shadow-2xl backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-white/55"><span>الوسائط المستوردة</span><button type="button" onClick={() => setOpen(false)}><X size={14} /></button></div>
          {error && <div className="mb-2 rounded-lg border border-red-300/10 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-200">{error}</div>}
          <div className="grid gap-1.5 sm:grid-cols-2">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[.03] px-2 py-1.5">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/5 text-white/60">{item.mime.startsWith('video/') ? <Film size={15} /> : item.mime.startsWith('audio/') ? <Music2 size={15} /> : <ImagePlus size={15} />}</div>
                <div className="min-w-0 flex-1"><div className="truncate text-[11px] text-white/85">{item.name}</div><div className="text-[9px] text-white/40">{item.duration ? `${item.duration.toFixed(2)}s` : `${Math.round(item.size / 1024)} KB`}</div></div>
                <button type="button" onClick={() => remove(item.id)} className="rounded p-1 text-white/35 hover:bg-white/5 hover:text-white" title="إزالة"><X size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
