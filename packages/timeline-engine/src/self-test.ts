import { TimelineEngine } from './index.js';
import { SelectionEngine, TimelineViewport, virtualizeTracks, GestureEngine } from './interaction.js';
import { TimelineHistory } from './transactions.js';
import { thumbnailKey, waveformKey, ThumbnailCache, WaveformCache } from './caches.js';

export async function runTimelineSelfTest(): Promise<void> {
  const engine = new TimelineEngine({ id: 'self-test', name: 'Timeline Self Test', frameRate: 30, maxTracks: 99, snappingTolerance: 0.05 });
  await engine.initialize();
  const video = engine.addTrack('video', 'Video 1', { magnetic: true });
  const overlay = engine.addTrack('overlay', 'Overlay 1');
  if (!video || !overlay) throw new Error('track creation failed');
  const a = engine.addClip(video.id, { name: 'A', startTime: 0, duration: 2 });
  const b = engine.addClip(video.id, { name: 'B', startTime: 2, duration: 2 });
  if (!a || !b) throw new Error('clip creation failed');
  if (!engine.moveClip(b.id, overlay.id, 1, { snap: true })) throw new Error('move failed');
  const split = engine.splitClip(a.id, 1);
  if (!split || split.length !== 2) throw new Error('split failed');

  const selection = new SelectionEngine();
  selection.selectClip(a.id);
  selection.selectClip(b.id, true);
  if (selection.selectedIds.length !== 2) throw new Error('multi-selection failed');
  selection.clear();

  const viewport = new TimelineViewport(56);
  const before = viewport.xToTime(56);
  viewport.setZoom(112, 56);
  const after = viewport.xToTime(56);
  if (Math.abs(before - after) > 1e-6) throw new Error('anchored zoom failed');

  const gestures = new GestureEngine();
  gestures.pointerDown(1, { x: 0, y: 0 });
  gestures.pointerDown(2, { x: 100, y: 0 });
  const pinch = gestures.pointerMove(2, { x: 200, y: 0 });
  if (pinch.kind !== 'pinch' || pinch.scale <= 1) throw new Error('pinch gesture failed');
  gestures.pointerUp(1); gestures.pointerUp(2);

  const range = virtualizeTracks(1000, 720, 480, 72, 3);
  if (range.start >= range.end || range.start < 0 || range.end > 1000) throw new Error('virtualization failed');

  const history = new TimelineHistory(10);
  const s1 = engine.getState();
  const s2 = engine.getState(); s2.currentTime = 1;
  history.commit('seek', s1, s2);
  if (!history.canUndo || !history.undo(s2)) throw new Error('undo failed');
  if (!history.canRedo || !history.redo(s1)) throw new Error('redo failed');

  const tc = new ThumbnailCache<string>(4);
  tc.set(thumbnailKey('a', 0, 64), 'x');
  if (!tc.get(thumbnailKey('a', 0, 64))) throw new Error('thumbnail cache failed');
  const wc = new WaveformCache<Float32Array>(4);
  wc.set(waveformKey('a', 0, 2), new Float32Array([1]));
  if (!wc.get(waveformKey('a', 0, 2))) throw new Error('waveform cache failed');

  const perfStart = Date.now();
  const perfSelection = new SelectionEngine();
  for (let i = 0; i < 5000; i += 1) perfSelection.add(`clip-${i}`);
  for (let i = 0; i < 5000; i += 17) perfSelection.remove(`clip-${i}`);
  for (let i = 0; i < 10000; i += 1) virtualizeTracks(5000, (i % 500) * 72, 500, 72, 4);
  const perfMs = Date.now() - perfStart;
  if (perfMs > 2500) throw new Error(`timeline interaction performance smoke test too slow: ${perfMs}ms`);
  console.log(`timeline interaction performance smoke: PASS (${perfMs}ms)`);

  await engine.destroy();
}

if (import.meta.url.endsWith('/self-test.ts')) {
  runTimelineSelfTest().then(() => console.log('timeline self-test: PASS')).catch((error) => { console.error(error); process.exitCode = 1; });
}
