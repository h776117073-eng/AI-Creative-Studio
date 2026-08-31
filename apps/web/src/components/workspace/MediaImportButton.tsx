import React, { useRef, useState } from 'react';
import { Film, ImagePlus, Music2, Upload, X } from 'lucide-react';

export interface VireonImportedMedia {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  file: File;
  duration?: number;
}

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

export function MediaImportButton() {
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<VireonImportedMedia[]>([]);
  const [open, setOpen] = useState(false);

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    const imported: VireonImportedMedia[] = [];
    for (const file of Array.from(files)) {
      const duration = await mediaDuration(file);
      imported.push({ id: crypto.randomUUID(), name: file.name, mime: file.type || 'application/octet-stream', size: file.size, url: URL.createObjectURL(file), file, duration });
    }
    setItems((current) => [...current, ...imported]);
    setOpen(true);
    window.dispatchEvent(new CustomEvent('vireon:media-imported', { detail: imported }));
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
        <button type="button" onClick={() => input.current?.click()} className="flex items-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-400 active:scale-[.98]" title="استيراد الفيديو والصوت والصور">
          <Upload size={15} /> استيراد الوسائط
        </button>
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs text-white/70 hover:bg-white/5 hover:text-white">
          {items.length ? `${items.length} مستورد` : 'المكتبة'}
        </button>
      </div>
      <input ref={input} hidden type="file" multiple accept="video/*,audio/*,image/*" onChange={(e) => { void importFiles(e.target.files); e.currentTarget.value = ''; }} />

      {open && items.length > 0 && (
        <div className="pointer-events-auto absolute left-3 right-3 top-16 max-h-56 overflow-auto rounded-xl border border-white/10 bg-[#0b0f16]/98 p-2 shadow-2xl backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between px-1 text-[11px] text-white/55"><span>الوسائط المستوردة</span><button type="button" onClick={() => setOpen(false)}><X size={14} /></button></div>
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
