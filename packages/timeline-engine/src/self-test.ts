import { TimelineEngine, type IClip, type ITimelineState } from './index.js';
import { SelectionEngine, TimelineViewport, virtualizeTracks, GestureEngine } from './interaction.js';
import { TimelineHistory } from './transactions.js';
import { thumbnailKey, waveformKey, ThumbnailCache, WaveformCache } from './caches.js';
import {
  addOrUpdateKeyframe,
  collectSnapCandidates,
  enforceMagneticTrack,
  linkedGroup,
  moveGroup,
  rippleDeleteGroup,
  rollEditAdvanced,
  setSpeedCurve,
  setTransition,
  slipEditAdvanced,
  slideEditAdvanced,
} from './advanced-editing.js';

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message);
};
const close = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) <= eps;
const clip = (id: string, start: number, end: number, sourceDuration = 10): IClip => ({
  id,
  name: id,
  startTime: start,
  endTime: end,
  trimStart: start,
  trimEnd: end,
  duration: end - start,
  speed: 1,
  opacity: 1,
  effects: [],
  animations: [],
  keyframes: [],
  metadata: { sourceDuration },
});
const state = (tracks: ITimelineState['tracks']): ITimelineState => ({
  tracks,
  currentTime: 0,
  duration: Math.max(0, ...tracks.flatMap(t => t.clips.map(c => c.endTime))),
  isPlaying: false,
  playbackRate: 1,
  loopEnabled: false,
  markers: [],
  snaps: [],
});

export async function runTimelineSelfTest(): Promise<void> {
  const engine = new TimelineEngine({ id: 'self-test', name: 'Timeline Self Test', frameRate: 30, maxTracks: 99, snappingTolerance: 0.05 });
  await engine.initialize();
  const video = engine.addTrack('video', 'Video 1', { magnetic: true });
  const overlay = engine.addTrack('overlay', 'Overlay 1');
  assert(video && overlay, 'track creation failed');
  const a = engine.addClip(video.id, { name: 'A', startTime: 0, duration: 2 });
  const b = engine.addClip(video.id, { name: 'B', startTime: 2, duration: 2 });
  assert(a && b, 'clip creation failed');
  assert(engine.moveClip(b.id, overlay.id, 1, { snap: true }), 'move failed');
  const split = engine.splitClip(a.id, 1);
  assert(split && split.length === 2, 'split failed');

  const selection = new SelectionEngine();
  selection.selectClip(a.id);
  selection.selectClip(b.id, true);
  assert(selection.selectedIds.length === 2, 'multi-selection failed');
  selection.clear();

  const viewport = new TimelineViewport(56);
  const before = viewport.xToTime(56);
  viewport.setZoom(112, 56);
  const after = viewport.xToTime(56);
  assert(close(before, after), 'anchored zoom failed');

  const gestures = new GestureEngine();
  gestures.pointerDown(1, { x: 0, y: 0 });
  gestures.pointerDown(2, { x: 100, y: 0 });
  const pinch = gestures.pointerMove(2, { x: 200, y: 0 });
  assert(pinch.kind === 'pinch' && pinch.scale > 1, 'pinch gesture failed');
  gestures.pointerUp(1); gestures.pointerUp(2);

  const range = virtualizeTracks(1000, 720, 480, 72, 3);
  assert(range.start >= 0 && range.start < range.end && range.end <= 1000, 'virtualization failed');

  const history = new TimelineHistory(10);
  const s1 = engine.getState();
  const s2 = engine.getState(); s2.currentTime = 1;
  history.commit('seek', s1, s2);
  assert(history.canUndo && !!history.undo(s2), 'undo failed');
  assert(history.canRedo && !!history.redo(s1), 'redo failed');

  const tc = new ThumbnailCache<string>(4);
  tc.set(thumbnailKey('a', 0, 64), 'x');
  assert(tc.get(thumbnailKey('a', 0, 64)) === 'x', 'thumbnail cache failed');
  const wc = new WaveformCache<Float32Array>(4);
  wc.set(waveformKey('a', 0, 2), new Float32Array([1]));
  assert(wc.get(waveformKey('a', 0, 2)) instanceof Float32Array, 'waveform cache failed');

  const mainTrack = { ...video, clips: [clip('m1', 0, 2)] };
  const linkedTrack = { ...overlay, clips: [clip('m2', 0, 2)] };
  mainTrack.clips[0].linkedClipIds = ['m2'];
  linkedTrack.clips[0].linkedClipIds = ['m1'];
  const linkedState = state([mainTrack, linkedTrack]);
  assert(linkedGroup(linkedState, ['m1']).length === 2, 'linked group failed');

  const target = { ...overlay, id: 'target', clips: [], magnetic: false };
  const movedState = state([mainTrack, linkedTrack, target]);
  const moveResult = moveGroup(movedState, ['m1'], target.id, 3, { snap: false });
  assert(moveResult.changed, 'group move failed');
  assert(movedState.tracks.find(t => t.id === target.id)?.clips.some(c => c.id === 'm1'), 'anchor clip did not move');
  assert(movedState.tracks.find(t => t.id === linkedTrack.id)?.clips.some(c => c.id === 'm2'), 'linked clip left its source track');
  assert(close(movedState.tracks.find(t => t.id === linkedTrack.id)!.clips[0].startTime, 3), 'linked clip delta not preserved');

  const rollTrack = { ...video, id: 'roll', clips: [clip('r1', 0, 2, 10), clip('r2', 2, 4, 10)] };
  const rollState = state([rollTrack]);
  assert(rollEditAdvanced(rollState, 'r1', 'r2', 2.5, 30).changed, 'roll failed');
  assert(close(rollTrack.clips[0].endTime, 2.5) && close(rollTrack.clips[1].startTime, 2.5), 'roll boundary wrong');
  assert(close(rollTrack.clips[0].trimEnd, 2.5) && close(rollTrack.clips[1].trimStart, 0.5), 'roll source windows wrong');

  const slipClip = clip('slip', 0, 2, 10);
  slipClip.trimStart = 1; slipClip.trimEnd = 3;
  assert(slipEditAdvanced(slipClip, 1, 30).changed, 'slip failed');
  assert(close(slipClip.trimStart, 2) && close(slipClip.trimEnd, 4) && close(slipClip.duration, 2), 'slip changed the clip duration');

  const slideTrack = { ...video, id: 'slide', clips: [clip('p', 0, 2, 10), clip('c', 2, 4, 10), clip('n', 4, 6, 10)] };
  const slideState = state([slideTrack]);
  assert(slideEditAdvanced(slideState, 'c', 0.5, 30).changed, 'slide failed');
  assert(close(slideTrack.clips.find(c => c.id === 'c')!.startTime, 2.5), 'slide center start wrong');
  assert(close(slideTrack.clips.find(c => c.id === 'c')!.duration, 2), 'slide changed center duration');
  assert(close(slideTrack.clips.find(c => c.id === 'p')!.endTime, 2.5), 'slide previous boundary wrong');
  assert(close(slideTrack.clips.find(c => c.id === 'n')!.startTime, 4.5), 'slide next boundary wrong');

  const transitionState = state([{ ...video, id: 'transition', clips: [clip('t', 0, 4, 10)] }]);
  assert(setTransition(transitionState, 't', 'in', 'crossfade', 99).changed, 'transition failed');
  assert(close(transitionState.tracks[0].clips[0].transitionIn?.duration ?? 0, 2), 'transition duration was not clamped');

  const speedClip = clip('speed', 0, 4, 10);
  assert(setSpeedCurve(speedClip, [
    { id: 'b', time: 2, speed: 30, easing: 'bezier' },
    { id: 'a', time: -1, speed: 0.001, easing: 'linear' },
  ]).changed, 'speed curve failed');
  const speedCurve = speedClip.metadata?.speedCurve as Array<{ time:number; speed:number }> | undefined;
  assert(speedCurve && speedCurve.length === 2 && close(speedCurve[0].time, 0) && close(speedCurve[0].speed, 0.05) && close(speedCurve[1].speed, 16), 'speed curve normalization failed');

  const keyClip = clip('key', 0, 4, 10);
  assert(addOrUpdateKeyframe(keyClip, { time: 1, property: 'opacity', value: 0.5, easing: 'ease-in' }).changed, 'keyframe failed');
  assert(keyClip.keyframes.length === 1 && keyClip.keyframes[0].property === 'opacity', 'keyframe not stored');
  assert(addOrUpdateKeyframe(keyClip, { time: 1, property: 'opacity', value: 1, easing: 'ease-out' }).changed && keyClip.keyframes.length === 1, 'keyframe upsert failed');

  const magneticTrack = { ...video, id: 'magnetic', magnetic: true, clips: [clip('g1', 2, 3, 10), clip('g2', 4, 5, 10)] };
  const magneticState = state([magneticTrack]);
  assert(enforceMagneticTrack(magneticState, magneticTrack.id).changed, 'magnetic normalization failed');
  assert(close(magneticTrack.clips[0].startTime, 2) && close(magneticTrack.clips[1].startTime, 3), 'magnetic track repacked incorrectly');

  const snapState = state([{ ...video, id: 'snap', clips: [clip('s1', 5, 6, 10)] }]);
  const near = collectSnapCandidates(snapState, 5.02, new Set(), 30, false);
  assert(near[0].source === 'clip-start' || near[0].source === 'frame', 'snap candidate ranking failed');
  assert(close(near[0].distance, 0.02, 0.02), 'snap distance wrong');

  const rippleTrack = { ...video, id: 'ripple', clips: [clip('d1', 0, 2, 10), clip('d2', 3, 5, 10), clip('d3', 5, 7, 10)] };
  const rippleState = state([rippleTrack]);
  assert(rippleDeleteGroup(rippleState, ['d1']).changed, 'ripple delete failed');
  assert(close(rippleTrack.clips.find(c => c.id === 'd2')!.startTime, 1), 'ripple delete did not close the gap');

  const perfStart = Date.now();
  const perfSelection = new SelectionEngine();
  for (let i = 0; i < 5000; i += 1) perfSelection.add(`clip-${i}`);
  for (let i = 0; i < 5000; i += 17) perfSelection.remove(`clip-${i}`);
  for (let i = 0; i < 10000; i += 1) virtualizeTracks(5000, (i % 500) * 72, 500, 72, 4);
  const perfMs = Date.now() - perfStart;
  assert(perfMs <= 2500, `timeline interaction performance smoke test too slow: ${perfMs}ms`);
  console.log(`timeline interaction performance smoke: PASS (${perfMs}ms)`);

  await engine.destroy();
}

if (import.meta.url.endsWith('/self-test.ts')) {
  runTimelineSelfTest().then(() => console.log('timeline self-test: PASS')).catch(error => { console.error(error); process.exitCode = 1; });
}
