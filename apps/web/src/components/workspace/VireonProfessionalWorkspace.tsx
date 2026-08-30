import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, Captions, Crop, Eye, EyeOff, FolderOpen, Hand, KeyRound, Link2, Lock,
  Magnet, MousePointer2, Music2, Pause, Play, Redo2, Scissors, Settings2,
  Sparkles, Split, Type, Undo2, Unlink, Volume2, Wand2, ZoomIn, ZoomOut,
} from 'lucide-react';
import {
  TimelineInteractionController,
  TimelineViewport,
  GestureEngine,
  InertialScroller,
  virtualizeTracks,
  ThumbnailCache,
  WaveformCache,
  thumbnailKey,
  waveformKey,
  type Point,
  type Rect,
  type IClip,
  type ITrack,
  type ITimelineState,
} from '@ai-creative-studio/timeline-engine';

const API = (import.meta.env.VITE_API_URL || 'https://ai-creative-studio-api-0gl6.onrender.com').replace(/\/$/, '');
const api = (p: string) => `${API}${p}`;
type Asset = { id: string; name: string; url: string; duration: number; mime: string; local?: boolean };
type Project = { id: string; name: string; assets: Asset[]; timeline: ITimelineState };
type Tool = 'select' | 'hand' | 'trim' | 'roll' | 'slip' | 'slide' | 'blade';
type Drag = { pointerId: number; clipId: string; trackId: string; mode: Tool; startX: number; startY: number; selectedIds: string[]; leftId?: string; rightId?: string };

const thumbs = new ThumbnailCache<string>(800);
const waves = new WaveformCache<Float32Array>(320);
let sharedAudioContext: AudioContext | null = null;
const clone = <T,>(value: T): T => structuredClone(value);
const fmt = (seconds: number) => `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}.${String(Math.floor((Math.max(0, seconds) % 1) * 10))}`;
const src = (asset?: Asset) => asset ? (asset.local ? asset.url : api(asset.url)) : '';

function defaultTimeline(): ITimelineState {
  return { tracks: [], currentTime: 0, duration: 0, isPlaying: false, playbackRate: 1, loopEnabled: false, markers: [], snaps: [] };
}
function ensureTracks(tl: ITimelineState): ITimelineState {
  if (tl.tracks.length) return clone(tl);
  const track = (type: ITrack['type'], name: string, height: number, order: number, magnetic = false): ITrack => ({ id: `vireon-track-${order}`, name, type, clips: [], muted: false, locked: false, visible: true, height, order, magnetic });
  return { ...clone(tl), tracks: [track('video', 'فيديو 1', 78, 0, true), track('video', 'فيديو 2', 78, 1), track('overlay', 'تراكب 1', 62, 2), track('text', 'نص 1', 58, 3), track('audio', 'الموسيقى', 72, 4), track('audio', 'المؤثرات', 72, 5)] };
}

async function createThumbnails(asset: Asset, times: number[], width: number): Promise<string[]> {
  if (!asset.mime.startsWith('video/')) return [];
  const out: string[] = [];
  const video = document.createElement('video');
  video.preload = 'metadata'; video.muted = true; video.playsInline = true; video.crossOrigin = 'anonymous'; video.src = src(asset);
  const cleanup = () => { video.removeAttribute('src'); video.load(); };
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('video metadata unavailable'));
    });
    for (const time of times) {
      const key = thumbnailKey(asset.id, time, width);
      const cached = thumbs.get(key);
      if (cached) { out.push(cached); continue; }
      await new Promise<void>((resolve, reject) => {
        video.onseeked = () => resolve();
        video.onerror = () => reject(new Error('video seek failed'));
        try { video.currentTime = Math.min(Math.max(0, time), Number.isFinite(video.duration) ? video.duration : time); } catch { reject(new Error('video seek failed')); }
      });
      const w = Math.max(48, Math.round(width));
      const h = Math.max(28, Math.round(w * 9 / 16));
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.drawImage(video, 0, 0, w, h);
      const data = canvas.toDataURL('image/jpeg', 0.62);
      thumbs.set(key, data, data.length); out.push(data);
    }
  } catch {
    cleanup();
    return [];
  }
  cleanup();
  return out;
}

function ThumbnailStrip({ asset, clip, width }: { asset?: Asset; clip: IClip; width: number }) {
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    if (!asset || !asset.mime.startsWith('video/')) { setItems([]); return () => { alive = false; }; }
    const count = Math.max(3, Math.min(10, Math.floor(width / 65)));
    const span = Math.max(0, clip.trimEnd - clip.trimStart);
    const times = Array.from({ length: count }, (_, i) => clip.trimStart + (count === 1 ? 0 : (span * i) / (count - 1)));
    createThumbnails(asset, times, Math.max(56, width / count)).then(result => { if (alive) setItems(result); });
    return () => { alive = false; };
  }, [asset?.id, clip.trimStart, clip.trimEnd, width]);
  if (!asset || items.length === 0) return <div className="absolute inset-0 bg-gradient-to-br from-violet-800/25 via-fuchsia-700/10 to-sky-500/10" />;
  return <div className="absolute inset-0 flex overflow-hidden">{items.map((item, index) => <img key={`${item}-${index}`} src={item} alt="" className="min-w-0 flex-1 h-full object-cover" draggable={false} />)}</div>;
}

async function extractWaveform(asset: Asset, bins: number): Promise<Float32Array> {
  const key = waveformKey(asset.id, 0, bins);
  const cached = waves.get(key);
  if (cached) return cached;
  const response = await fetch(src(asset), { mode: 'cors' });
  if (!response.ok) throw new Error('audio download failed');
  const buffer = await response.arrayBuffer();
  sharedAudioContext ??= new AudioContext();
  const decoded = await sharedAudioContext.decodeAudioData(buffer.slice(0));
  const result = new Float32Array(bins);
  const length = decoded.length;
  const channels = decoded.numberOfChannels;
  for (let bin = 0; bin < bins; bin += 1) {
    const start = Math.floor((bin / bins) * length);
    const end = Math.max(start + 1, Math.floor(((bin + 1) / bins) * length));
    const stride = Math.max(1, Math.floor((end - start) / 48));
    let peak = 0;
    for (let index = start; index < end; index += stride) {
      for (let channel = 0; channel < channels; channel += 1) peak = Math.max(peak, Math.abs(decoded.getChannelData(channel)[index] || 0));
    }
    result[bin] = peak;
  }
  waves.set(key, result, result.byteLength);
  return result;
}

function Waveform({ asset, clip, width }: { asset?: Asset; clip: IClip; width: number }) {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => {
    let alive = true;
    if (!asset || (!asset.mime.startsWith('audio/') && !asset.mime.startsWith('video/'))) { setPeaks(null); return () => { alive = false; }; }
    extractWaveform(asset, Math.max(48, Math.min(180, Math.round(width / 4)))).then(result => { if (alive) setPeaks(result); }).catch(() => { if (alive) setPeaks(null); });
    return () => { alive = false; };
  }, [asset?.id, width]);
  if (!peaks) return <div className="absolute inset-0 flex items-center justify-center text-[9px] text-white/20">Waveform</div>;
  const startRatio = asset?.duration ? Math.max(0, Math.min(1, clip.trimStart / asset.duration)) : 0;
  const endRatio = asset?.duration ? Math.max(startRatio, Math.min(1, clip.trimEnd / asset.duration)) : 1;
  const start = Math.floor(startRatio * peaks.length), end = Math.max(start + 1, Math.floor(endRatio * peaks.length));
  return <div className="absolute inset-0 flex items-center gap-px px-2 pointer-events-none">{Array.from(peaks.slice(start, end)).map((value, i) => <span key={i} className="w-[2px] rounded-full bg-emerald-300/55" style={{ height: `${Math.max(6, Math.round(value * 82))}%` }} />)}</div>;
}

function TimelineClip({ clip, track, asset, selected, pps, onSelect, onContext }: { clip: IClip; track: ITrack; asset?: Asset; selected: boolean; pps: number; onSelect: (e: React.PointerEvent) => void; onContext: () => void }) {
  const width = Math.max(30, clip.duration * pps);
  const speedCurve = (clip.metadata?.speedCurve as Array<{ time: number; speed: number }> | undefined) ?? [];
  const keyframes = clip.keyframes ?? [];
  const localKeyframeTime = (time: number) => time >= clip.startTime - 0.001 && time <= clip.endTime + 0.001 ? time - clip.startTime : time;
  return <div
    className={`absolute top-1 bottom-1 rounded-lg overflow-hidden border ${selected ? 'border-violet-300 ring-1 ring-violet-300/35' : 'border-white/10'} bg-white/[.035] shadow-sm`}
    style={{ width, left: clip.startTime * pps }}
    onPointerDown={onSelect}
    onContextMenu={e => { e.preventDefault(); onContext(); }}
  >
    {track.type === 'audio' ? <Waveform asset={asset} clip={clip} width={width} /> : <ThumbnailStrip asset={asset} clip={clip} width={width} />}
    <div className="absolute inset-x-0 top-0 h-5 bg-black/35 px-2 flex items-center text-[9px] truncate">{clip.name}</div>
    {clip.transitionIn && <div className="absolute left-0 top-0 bottom-0 w-7 bg-cyan-300/12 border-r border-cyan-200/55"><span className="absolute bottom-1 left-1 text-[8px] text-cyan-100/80">IN</span></div>}
    {clip.transitionOut && <div className="absolute right-0 top-0 bottom-0 w-7 bg-cyan-300/12 border-l border-cyan-200/55"><span className="absolute bottom-1 right-1 text-[8px] text-cyan-100/80">OUT</span></div>}
    {speedCurve.length > 0 && <svg className="absolute left-0 right-0 bottom-3 h-6 pointer-events-none" viewBox="0 0 100 20" preserveAspectRatio="none"><polyline fill="none" stroke="currentColor" className="text-amber-300/80" strokeWidth="1.2" points={speedCurve.map(point => `${(Math.max(0, Math.min(clip.duration, point.time)) / Math.max(.001, clip.duration)) * 100},${20 - (Math.max(.05, Math.min(16, point.speed)) / 16) * 18}`).join(' ')} /></svg>}
    <div className="absolute inset-x-0 bottom-0 h-3 bg-black/45 border-t border-white/5">{keyframes.map(kf => { const time = localKeyframeTime(kf.time); const left = Math.max(0, Math.min(1, time / Math.max(.001, clip.duration))) * 100; return <span key={kf.id} className="absolute -translate-x-1/2 top-0.5 w-2 h-2 rotate-45 bg-violet-200" style={{ left: `${left}%` }} title={kf.property} />; })}</div>
  </div>;
}

function TrackHeader({ track, target, active, onTarget, onLock, onVisible }: { track: ITrack; target: boolean; active: boolean; onTarget: () => void; onLock: () => void; onVisible: () => void }) {
  return <div className={`h-full w-[126px] shrink-0 flex items-center gap-1 px-2 border-l border-white/10 bg-[#0b0e15] ${active ? 'text-violet-200' : 'text-white/50'}`} dir="rtl">
    <button type="button" onClick={onTarget} className={`h-7 w-7 rounded-lg ${target ? 'bg-violet-500/20 text-violet-300' : 'text-white/30'}`} title="Target"> <Link2 size={14} /> </button>
    <button type="button" onClick={onLock} className={`h-7 w-7 rounded-lg ${track.locked ? 'text-amber-300 bg-amber-400/10' : 'text-white/30'}`} title="Lock"><Lock size={14} /></button>
    <button type="button" onClick={onVisible} className="h-7 w-7 rounded-lg text-white/30" title="Visibility">{track.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button>
    <span className="min-w-0 truncate text-[11px]">{track.name}</span>
  </div>;
}

export function VireonProfessionalWorkspace({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [tool, setTool] = useState<Tool>('select');
  const [panel, setPanel] = useState<'media' | 'audio' | 'text' | 'effects' | 'ai'>('media');
  const [selected, setSelected] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [activeTrack, setActiveTrack] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [scrollX, setScrollX] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [box, setBox] = useState<Rect | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [status, setStatus] = useState('جاري التحميل…');
  const [velocity, setVelocity] = useState({ x: 0, y: 0 });

  const ctl = useRef(new TimelineInteractionController({ id: `vireon-${projectId}`, name: 'Vireon Professional Timeline', frameRate: 30, maxTracks: 99, snappingTolerance: 0.033 }));
  const view = useRef(new TimelineViewport(64));
  const gesture = useRef(new GestureEngine());
  const inertial = useRef(new InertialScroller(0.91, 0.05));
  const root = useRef<HTMLDivElement>(null);
  const pointerStart = useRef<Point | null>(null);
  const lastPoint = useRef<Point | null>(null);
  const pinchBase = useRef<{ zoom: number; anchorX: number } | null>(null);
  const saveTimer = useRef<number | null>(null);

  const tracks = project?.timeline.tracks ?? [];
  const duration = Math.max(10, project?.timeline.duration ?? 10);
  const pps = Math.max(24, 56 * zoom);
  const contentWidth = 126 + duration * pps + 240;
  const rowHeights = useMemo(() => tracks.map(t => t.height), [tracks]);
  const rowTops = useMemo(() => { const result: number[] = []; let y = 0; for (const h of rowHeights) { result.push(y); y += h; } return result; }, [rowHeights]);
  const contentHeight = 38 + rowHeights.reduce((sum, h) => sum + h, 0) + 24;
  const visible = virtualizeTracks(tracks.length, scrollY, 520, 72, 4);
  const active = tracks.flatMap(t => t.clips).find(c => c.id === selected[0]);
  const activeAsset = project?.assets.find(a => a.id === active?.assetId);

  const refresh = useCallback(() => {
    const tl = ctl.current.getState();
    setProject(p => p ? { ...p, timeline: tl } : p);
    setSelected(ctl.current.selection.selectedIds);
    setCurrentTime(tl.currentTime);
  }, []);
  const saveTimeline = useCallback((tl = ctl.current.getState()) => {
    if (!project) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        const response = await fetch(api(`/api/projects/${project.id}/timeline`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ timeline: tl }) });
        setStatus(response.ok ? 'تم الحفظ ✓' : 'تم التعديل');
      } catch { setStatus('تم التعديل • الحفظ محلي مؤقت'); }
    }, 500);
  }, [project]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let id = projectId;
        if (id === 'new') {
          const response = await fetch(api('/api/projects'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'مشروع Vireon جديد' }) });
          if (!response.ok) throw new Error('تعذر إنشاء المشروع');
          id = (await response.json()).id;
          history.replaceState({}, '', `/project/${id}`);
        }
        const response = await fetch(api(`/api/projects/${id}`));
        if (!response.ok) throw new Error('تعذر تحميل المشروع');
        const data = await response.json();
        if (!alive) return;
        await ctl.current.initialize();
        const timeline = ensureTracks(data.timeline ?? defaultTimeline());
        for (const track of timeline.tracks) for (const clip of track.clips) {
          const asset = data.assets?.find((item: Asset) => item.id === clip.assetId);
          if (asset?.duration && (!clip.metadata?.sourceDuration || Number(clip.metadata.sourceDuration) < asset.duration)) clip.metadata = { ...(clip.metadata ?? {}), sourceDuration: asset.duration };
        }
        ctl.current.loadState(timeline);
        ctl.current.setTargetTracks([]);
        setProject({ ...data, timeline: ctl.current.getState() });
        setCurrentTime(timeline.currentTime);
        setStatus('جاهز');
      } catch (error) { if (alive) setStatus(error instanceof Error ? error.message : 'تعذر التحميل'); }
    })();
    return () => { alive = false; if (saveTimer.current) window.clearTimeout(saveTimer.current); inertial.current.stop(); ctl.current.engine.pause(); };
  }, [projectId]);

  useEffect(() => {
    const engine = ctl.current.engine;
    const onTime = (payload: { time: number }) => setCurrentTime(payload.time);
    engine.onTimeline('timeline:time:changed', onTime);
    return () => { engine.offTimeline('timeline:time:changed', onTime); };
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Delete' || event.key === 'Backspace') { if (selected.length) { ctl.current.beginInteraction(); ctl.current.deleteSelected(true); ctl.current.commitInteraction('حذف Ripple'); refresh(); saveTimeline(); } }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); ctl.current.undo(); refresh(); saveTimeline(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); ctl.current.redo(); refresh(); saveTimeline(); }
      if (event.key === ' ') { event.preventDefault(); setPlaying(v => { const next = !v; next ? ctl.current.engine.play() : ctl.current.engine.pause(); return next; }); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [refresh, saveTimeline, selected.length]);

  const bounds = useCallback(() => {
    const out: Array<{ clip: IClip; track: ITrack; rect: Rect }> = [];
    for (let index = 0; index < tracks.length; index += 1) {
      const track = tracks[index];
      const y = 38 + rowTops[index] - scrollY;
      for (const clip of track.clips) out.push({ clip, track, rect: { x: 126 + clip.startTime * pps - scrollX, y: y, width: Math.max(30, clip.duration * pps), height: track.height } });
    }
    return out;
  }, [tracks, rowTops, pps, scrollX, scrollY]);

  const point = (event: React.PointerEvent): Point => { const rect = root.current?.getBoundingClientRect(); return { x: event.clientX - (rect?.left ?? 0), y: event.clientY - (rect?.top ?? 0) }; };
  const trackAt = (y: number) => { for (let index = 0; index < tracks.length; index += 1) { const top = 38 + rowTops[index] - scrollY; if (y >= top && y <= top + tracks[index].height) return tracks[index]; } return null; };
  const adjacentPair = (track: ITrack, clip: IClip, side: 'left' | 'right') => {
    const sorted = [...track.clips].sort((a, b) => a.startTime - b.startTime);
    const index = sorted.findIndex(c => c.id === clip.id);
    if (side === 'right') return index >= 0 && index < sorted.length - 1 && Math.abs(sorted[index + 1].startTime - clip.endTime) < 1 / 20 ? [clip, sorted[index + 1]] as const : null;
    return index > 0 && Math.abs(clip.startTime - sorted[index - 1].endTime) < 1 / 20 ? [sorted[index - 1], clip] as const : null;
  };

  const onDown = (event: React.PointerEvent) => {
    const p = point(event); (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); pointerStart.current = p; lastPoint.current = p;
    const gestureState = gesture.current.pointerDown(event.pointerId, p);
    if (gestureState.kind === 'pinch') { pinchBase.current = { zoom, anchorX: gestureState.startCenter.x }; return; }
    if (tool === 'hand') return;
    const hit = [...bounds()].reverse().find(item => p.x >= item.rect.x && p.x <= item.rect.x + item.rect.width && p.y >= item.rect.y && p.y <= item.rect.y + item.rect.height);
    if (!hit) { if (tool === 'select') { ctl.current.selection.clear(); setSelected([]); setBox({ x: p.x, y: p.y, width: 0, height: 0 }); } return; }
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const ids = ctl.current.select(hit.clip.id, additive); setSelected(ids); setActiveTrack(hit.track.id); ctl.current.setActiveTrack(hit.track.id);
    if (tool === 'blade') return;
    if (tool === 'roll') {
      const edge = 15;
      const right = adjacentPair(hit.track, hit.clip, 'right');
      const left = adjacentPair(hit.track, hit.clip, 'left');
      if (right && Math.abs(p.x - hit.rect.x - hit.rect.width) <= edge) { ctl.current.beginInteraction(); setDrag({ pointerId: event.pointerId, clipId: hit.clip.id, trackId: hit.track.id, mode: 'roll', startX: p.x, startY: p.y, selectedIds: ids, leftId: right[0].id, rightId: right[1].id }); return; }
      if (left && Math.abs(p.x - hit.rect.x) <= edge) { ctl.current.beginInteraction(); setDrag({ pointerId: event.pointerId, clipId: hit.clip.id, trackId: hit.track.id, mode: 'roll', startX: p.x, startY: p.y, selectedIds: ids, leftId: left[0].id, rightId: left[1].id }); return; }
      return;
    }
    ctl.current.beginInteraction();
    setDrag({ pointerId: event.pointerId, clipId: hit.clip.id, trackId: hit.track.id, mode: tool === 'trim' ? 'trim' : tool, startX: p.x, startY: p.y, selectedIds: ids });
  };

  const onMove = (event: React.PointerEvent) => {
    const p = point(event); const g = gesture.current.pointerMove(event.pointerId, p);
    if (g.kind === 'pinch' && pinchBase.current) {
      const nextZoom = Math.max(0.35, Math.min(16, pinchBase.current.zoom * g.scale));
      view.current.setZoom(56 * nextZoom, pinchBase.current.anchorX); setZoom(nextZoom); setScrollX(view.current.scrollX); return;
    }
    if (tool === 'hand' && g.kind === 'pan' && lastPoint.current && !drag && root.current) {
      root.current.scrollLeft = Math.max(0, root.current.scrollLeft - (p.x - lastPoint.current.x));
      root.current.scrollTop = Math.max(0, root.current.scrollTop - (p.y - lastPoint.current.y));
      setScrollX(root.current.scrollLeft); setScrollY(root.current.scrollTop); setVelocity({ x: event.movementX, y: event.movementY }); lastPoint.current = p; return;
    }
    if (box && pointerStart.current && !drag) { setBox({ x: Math.min(pointerStart.current.x, p.x), y: Math.min(pointerStart.current.y, p.y), width: Math.abs(p.x - pointerStart.current.x), height: Math.abs(p.y - pointerStart.current.y) }); return; }
    if (!drag || drag.pointerId !== event.pointerId || !project) return;
    const dt = (p.x - drag.startX) / pps;
    if (drag.mode === 'move') {
      const target = trackAt(p.y) ?? tracks.find(t => t.id === drag.trackId); if (!target) return;
      ctl.current.preview({ type: 'move', clipIds: drag.selectedIds.length ? drag.selectedIds : [drag.clipId], trackId: target.id, deltaTime: dt });
    } else if (drag.mode === 'trim') {
      const dx = p.x - drag.startX; const clip = ctl.current.getState().tracks.flatMap(t => t.clips).find(c => c.id === drag.clipId); if (!clip) return;
      const edge = Math.abs(p.x - (126 + clip.startTime * pps - scrollX)) < 18 ? 'trim-start' : 'trim-end';
      ctl.current.preview({ type: edge, clipId: drag.clipId, deltaTime: dx / pps });
    } else if (drag.mode === 'roll' && drag.leftId && drag.rightId) ctl.current.previewRoll(drag.leftId, drag.rightId, (ctl.current.getState().tracks.flatMap(t => t.clips).find(c => c.id === drag.leftId)?.endTime ?? 0) + dt);
    else if (drag.mode === 'slip') ctl.current.previewSlip(drag.clipId, dt);
    else if (drag.mode === 'slide') ctl.current.previewSlide(drag.clipId, dt);
    setProject(pj => pj ? { ...pj, timeline: ctl.current.getState() } : pj); setVelocity({ x: event.movementX, y: event.movementY }); lastPoint.current = p;
  };

  const onUp = (event: React.PointerEvent) => {
    const gestureState = gesture.current.pointerUp(event.pointerId); if (pinchBase.current && gestureState.kind === 'idle') pinchBase.current = null;
    if (box && box.width > 6 && box.height > 6) { const ids = ctl.current.boxSelect(bounds(), box, false); setSelected(ids); }
    if (drag && project) { ctl.current.commitInteraction(drag.mode === 'move' ? 'تحريك المقاطع' : drag.mode === 'trim' ? 'تهذيب المقطع' : drag.mode === 'roll' ? 'Roll Edit' : drag.mode === 'slip' ? 'Slip Edit' : 'Slide Edit'); refresh(); saveTimeline(); }
    if (tool === 'hand' && (Math.abs(velocity.x) > 2 || Math.abs(velocity.y) > 2)) { inertial.current.setVelocity(-velocity.x, -velocity.y); inertial.current.start((dx, dy) => { if (!root.current) return; root.current.scrollLeft = Math.max(0, root.current.scrollLeft + dx); root.current.scrollTop = Math.max(0, root.current.scrollTop + dy); setScrollX(root.current.scrollLeft); setScrollY(root.current.scrollTop); }); }
    setDrag(null); setBox(null); setVelocity({ x: 0, y: 0 }); lastPoint.current = null;
  };

  const undo = () => { ctl.current.undo(); refresh(); saveTimeline(); };
  const redo = () => { ctl.current.redo(); refresh(); saveTimeline(); };
  const seek = (time: number) => { ctl.current.engine.seek(time); refresh(); };
  const del = () => { ctl.current.beginInteraction(); ctl.current.deleteSelected(true); ctl.current.commitInteraction('حذف Ripple'); refresh(); saveTimeline(); };
  const changeTrack = (id: string, patch: Partial<ITrack>) => { const next = ctl.current.getState(); next.tracks = next.tracks.map(t => t.id === id ? { ...t, ...patch } : t); ctl.current.engine.loadState(next); refresh(); saveTimeline(next); };
  const setPlay = (value: boolean) => { setPlaying(value); value ? ctl.current.engine.play() : ctl.current.engine.pause(); };
  const action = (fn: () => boolean, label: string) => { if (fn()) { setStatus(`${label} ✓`); refresh(); saveTimeline(); } };

  return <div dir="rtl" className="h-screen w-screen overflow-hidden bg-[#07090e] text-white">
    <header className="h-[60px] shrink-0 border-b border-white/10 bg-[#090b11] flex items-center gap-3 px-4">
      <div className="flex items-center gap-2 font-bold"><div className="h-9 w-9 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-500 flex items-center justify-center">V</div><span className="text-lg">Vireon</span></div>
      <span className="text-sm text-white/50 truncate max-w-[240px]">{project?.name ?? 'مشروع جديد'}</span>
      <span className="text-[11px] text-white/30">{status}</span>
      <div className="mr-auto flex gap-2"><button type="button" onClick={undo} className="h-9 w-9 rounded-xl hover:bg-white/5" title="Undo"><Undo2 size={17}/></button><button type="button" onClick={redo} className="h-9 w-9 rounded-xl hover:bg-white/5" title="Redo"><Redo2 size={17}/></button><button type="button" className="px-4 h-9 rounded-xl bg-violet-600 font-semibold">تصدير</button></div>
    </header>
    <div className="h-[calc(100vh-60px)] flex min-w-0">
      <aside className="w-[74px] shrink-0 border-l border-white/10 bg-[#0a0c12] flex flex-col items-center gap-2 py-3">
        {[[FolderOpen,'الوسائط','media'],[Type,'نص','text'],[Music2,'الصوت','audio'],[Sparkles,'تأثيرات','effects'],[Bot,'AI','ai']].map(([Icon,label,id]) => <button key={id as string} type="button" onClick={() => setPanel(id as typeof panel)} className={`w-[58px] h-[58px] rounded-2xl text-[10px] flex flex-col items-center justify-center gap-1 ${panel === id ? 'bg-violet-500/15 text-violet-300' : 'text-white/45'}`}>{React.createElement(Icon as React.ComponentType<{size?:number}>, { size: 19 })}<span>{label as string}</span></button>)}
        <button type="button" onClick={() => setTool('hand')} className={`mt-auto w-[58px] h-[58px] rounded-2xl text-[10px] flex flex-col items-center justify-center gap-1 ${tool === 'hand' ? 'bg-violet-500/15 text-violet-300' : 'text-white/45'}`}><Hand size={19}/><span>تحريك</span></button>
      </aside>
      <main className="min-w-0 flex-1 flex flex-col">
        <section className="min-h-0 flex-1 grid grid-cols-[minmax(0,1fr)_330px] gap-2 p-2">
          <div className="rounded-2xl border border-white/10 bg-[#0b0e15] flex flex-col overflow-hidden">
            <div className="flex-1 flex items-center justify-center p-4 bg-[radial-gradient(circle_at_center,rgba(124,58,237,.12),transparent_52%)]"><div className="aspect-[9/16] h-full max-h-[64vh] max-w-[44vw] rounded-[22px] overflow-hidden bg-black ring-1 ring-white/10">{activeAsset?.mime.startsWith('video/') ? <video src={src(activeAsset)} className="h-full w-full object-contain" muted playsInline controls /> : <div className="h-full flex items-center justify-center text-white/20">معاينة Vireon</div>}</div></div>
            <div className="h-14 shrink-0 border-t border-white/10 flex items-center justify-center gap-3 text-white/55"><span className="text-xs tabular-nums">{fmt(currentTime)} / {fmt(duration)}</span><button type="button" onClick={() => setPlay(!playing)} className="h-10 w-10 rounded-full bg-white/10 flex items-center justify-center">{playing ? <Pause size={16}/> : <Play size={16}/>}</button></div>
          </div>
          <section className="hidden lg:flex rounded-2xl border border-white/10 bg-[#0b0e15] overflow-hidden flex-col">
            <div className="p-4 border-b border-white/10 flex justify-between"><div><div className="font-semibold">{panel === 'media' ? 'الوسائط' : panel === 'audio' ? 'الصوت' : panel === 'text' ? 'النص' : panel === 'effects' ? 'التأثيرات' : 'أدوات AI'}</div><div className="text-[10px] text-white/30 mt-1">Vireon Inspector / Timeline Tools</div></div><Settings2 size={17} className="text-white/35"/></div>
            <div className="p-3 grid grid-cols-2 gap-2"><button type="button" className="min-h-[76px] rounded-xl border border-white/10 bg-white/[.025] text-xs text-white/60"><Scissors size={19} className="mx-auto mb-2"/>قص ذكي</button><button type="button" className="min-h-[76px] rounded-xl border border-white/10 bg-white/[.025] text-xs text-white/60"><Captions size={19} className="mx-auto mb-2"/>ترجمة</button><button type="button" className="min-h-[76px] rounded-xl border border-white/10 bg-white/[.025] text-xs text-white/60"><Wand2 size={19} className="mx-auto mb-2"/>تحسين</button><button type="button" className="min-h-[76px] rounded-xl border border-white/10 bg-white/[.025] text-xs text-white/60"><Volume2 size={19} className="mx-auto mb-2"/>الصوت</button></div>
            {active && <div className="mt-auto p-3 border-t border-white/10 space-y-2">
              <div className="text-xs text-white/55">عمليات التحرير الاحترافية</div>
              <div className="grid grid-cols-3 gap-2"><button type="button" onClick={() => setTool('roll')} className="h-8 rounded-lg border border-white/10 text-[10px]">Roll</button><button type="button" onClick={() => setTool('slip')} className="h-8 rounded-lg border border-white/10 text-[10px]">Slip</button><button type="button" onClick={() => setTool('slide')} className="h-8 rounded-lg border border-white/10 text-[10px]">Slide</button></div>
              <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => action(() => ctl.current.linkSelected(), 'تم الربط')} className="h-8 rounded-lg border border-cyan-300/20 text-[10px] text-cyan-100"><Link2 size={12} className="inline ml-1"/>Link</button><button type="button" onClick={() => action(() => ctl.current.unlinkSelected(), 'تم فك الربط')} className="h-8 rounded-lg border border-white/10 text-[10px]"><Unlink size={12} className="inline ml-1"/>Unlink</button></div>
              <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => action(() => ctl.current.addKeyframe(active.id, { time: currentTime, property: 'opacity', value: active.opacity, easing: 'ease-in-out' }), 'Keyframe')} className="h-8 rounded-lg border border-white/10 text-[10px]"><KeyRound size={12} className="inline ml-1"/>Keyframe</button><button type="button" onClick={() => action(() => ctl.current.setSpeedCurve(active.id, [{ id: 's0', time: 0, speed: 1, easing: 'linear' }, { id: 's1', time: active.duration / 2, speed: 2, easing: 'ease-in' }, { id: 's2', time: active.duration, speed: 1, easing: 'ease-out' }]), 'Speed Curve')} className="h-8 rounded-lg border border-white/10 text-[10px]">Speed Curve</button></div>
              <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => action(() => ctl.current.setTransition(active.id, 'in', 'crossfade', Math.min(0.5, active.duration / 2)), 'Transition In')} className="h-8 rounded-lg border border-white/10 text-[10px]">Transition In</button><button type="button" onClick={() => action(() => ctl.current.setTransition(active.id, 'out', 'crossfade', Math.min(0.5, active.duration / 2)), 'Transition Out')} className="h-8 rounded-lg border border-white/10 text-[10px]">Transition Out</button></div>
              <div className="text-[10px] text-white/35">السرعة الأساسية</div><input className="w-full accent-violet-500" type="range" min="25" max="400" value={(active.speed ?? 1) * 100} onChange={event => { const tl = ctl.current.getState(); const c = tl.tracks.flatMap(t => t.clips).find(item => item.id === active.id); if (!c) return; c.speed = Number(event.target.value) / 100; ctl.current.engine.loadState(tl); refresh(); saveTimeline(tl); }} />
            </div>}
          </section>
        </section>

        <section className="h-[48vh] min-h-[330px] border-t border-white/10 bg-[#080a0f] flex flex-col">
          <div className="h-12 shrink-0 border-b border-white/10 flex items-center gap-2 px-3">
            <button type="button" onClick={() => setTool('select')} className={`h-8 w-8 rounded-lg ${tool === 'select' ? 'bg-violet-500/15 text-violet-300' : 'text-white/45'}`}><MousePointer2 size={16}/></button>
            <button type="button" onClick={() => setTool('trim')} className={`h-8 w-8 rounded-lg ${tool === 'trim' ? 'bg-violet-500/15 text-violet-300' : 'text-white/45'}`}><Crop size={16}/></button>
            <button type="button" onClick={() => setTool('blade')} className={`h-8 w-8 rounded-lg ${tool === 'blade' ? 'bg-violet-500/15 text-violet-300' : 'text-white/45'}`}><Scissors size={16}/></button>
            <button type="button" onClick={() => setTool('roll')} className={`h-8 px-2 rounded-lg text-[10px] ${tool === 'roll' ? 'bg-violet-500/15 text-violet-300' : 'text-white/45'}`}>Roll</button>
            <button type="button" onClick={() => setTool('slip')} className={`h-8 px-2 rounded-lg text-[10px] ${tool === 'slip' ? 'bg-violet-500/15 text-violet-300' : 'text-white/45'}`}>Slip</button>
            <button type="button" onClick={() => setTool('slide')} className={`h-8 px-2 rounded-lg text-[10px] ${tool === 'slide' ? 'bg-violet-500/15 text-violet-300' : 'text-white/45'}`}>Slide</button>
            <span className="h-5 w-px bg-white/10"/>
            <button type="button" onClick={() => { view.current.setZoom(view.current.zoom * 1.2, 250); setZoom(view.current.zoom / 56); setScrollX(view.current.scrollX); }} className="h-8 w-8 rounded-lg text-white/45"><ZoomIn size={16}/></button>
            <button type="button" onClick={() => { view.current.setZoom(view.current.zoom / 1.2, 250); setZoom(view.current.zoom / 56); setScrollX(view.current.scrollX); }} className="h-8 w-8 rounded-lg text-white/45"><ZoomOut size={16}/></button>
            <span className="text-[11px] text-white/35">{Math.round(zoom * 100)}%</span>
            <button type="button" onClick={del} className="mr-auto h-8 px-3 rounded-lg text-[11px] text-white/55 border border-white/10">حذف Ripple</button>
            <button type="button" onClick={() => activeTrack && action(() => ctl.current.enforceMagnetic(activeTrack), 'Magnetic')} className="h-8 px-3 rounded-lg text-[11px] text-white/55 border border-white/10"><Magnet size={13} className="inline ml-1"/>Magnetic</button>
          </div>
          <div className="relative flex-1 min-h-0 overflow-hidden">
            <div ref={root} className="absolute inset-0 overflow-auto" dir="ltr" onScroll={event => { const target = event.currentTarget; setScrollX(target.scrollLeft); setScrollY(target.scrollTop); view.current.scrollX = target.scrollLeft; view.current.scrollY = target.scrollTop; }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} style={{ touchAction: 'none' }}>
              <div className="relative" style={{ width: contentWidth, height: contentHeight }}>
                <div className="sticky top-0 z-50 h-[38px] bg-[#0c0f16]/95 backdrop-blur border-b border-white/10" dir="ltr"><div className="absolute left-0 top-0 bottom-0 w-[126px] bg-[#0b0e15] border-r border-white/10"/><div className="absolute left-[126px] top-0 h-full">{Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => <button key={i} type="button" className="absolute top-0 h-full text-[9px] text-white/25" style={{ left: i * pps }} onClick={() => seek(i)}><span className="absolute top-1 -translate-x-1/2">{fmt(i)}</span><span className="absolute bottom-0 left-0 h-2 w-px bg-white/15"/></button>)}</div></div>
                <div className="absolute top-0 bottom-0 z-40 w-px bg-violet-300/90 pointer-events-none" style={{ left: 126 + currentTime * pps }} />
                {tracks.slice(visible.start, visible.end).map((track, visibleIndex) => { const index = visible.start + visibleIndex; const top = 38 + rowTops[index]; return <div key={track.id} className="absolute left-0 right-0 flex border-b border-white/[.06]" style={{ top, height: track.height }}>
                  <TrackHeader track={track} target={targets.includes(track.id)} active={activeTrack === track.id} onTarget={() => { const next = ctl.current.toggleTargetTrack(track.id); setTargets(next); }} onLock={() => changeTrack(track.id, { locked: !track.locked })} onVisible={() => changeTrack(track.id, { visible: !track.visible })}/>
                  <div className="relative flex-1" onPointerDown={() => { setActiveTrack(track.id); ctl.current.setActiveTrack(track.id); }}>
                    {track.visible && track.clips.map(clip => <TimelineClip key={clip.id} clip={clip} track={track} asset={project?.assets.find(a => a.id === clip.assetId)} selected={selected.includes(clip.id)} pps={pps} onSelect={() => {}} onContext={() => { setSelected([clip.id]); ctl.current.select(clip.id); }} />)}
                  </div>
                </div>; })}
                {box && <div className="absolute z-[60] border border-violet-300 bg-violet-500/10 pointer-events-none" style={{ left: box.x + scrollX, top: box.y + scrollY, width: box.width, height: box.height }} />}
              </div>
            </div>
          </div>
          <div className="h-12 shrink-0 border-t border-white/10 flex items-center gap-2 px-3 text-white/45"><button type="button" className="h-8 w-8 rounded-lg bg-violet-600 text-white" onClick={() => setPlay(!playing)}>{playing ? <Pause size={15}/> : <Play size={15}/>}</button><span className="text-xs">{selected.length} محدد</span><span className="text-[10px] text-white/25">Shift: متعدد • Box: تحديد نطاق • Roll/Slip/Slide • إصبعان: Pinch Zoom • Delete: Ripple</span><span className="mr-auto text-[10px] text-white/20">Frame 30fps</span></div>
        </section>
      </main>
    </div>
  </div>;
}
