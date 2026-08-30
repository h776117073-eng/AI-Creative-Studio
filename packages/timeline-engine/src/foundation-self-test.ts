import {
  createFrameTimebase,
  createRetimeMap,
  normalizeTimelineState,
  SnapRegistry,
  transitionBudget,
  validateTimelineInvariants,
  type ITimelineState,
} from './index.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
const close = (a: number, b: number, eps = 1e-4) => Math.abs(a - b) <= eps;

const base: ITimelineState = {
  tracks: [{
    id: 'v1', name: 'Video 1', type: 'video', muted: false, locked: false, visible: true,
    height: 72, order: 0, magnetic: true,
    clips: [{
      id: 'c1', name: 'Clip 1', startTime: 0.011, endTime: 2.011, trimStart: 0.25, trimEnd: 2.25,
      duration: 2, speed: 1, opacity: 1, effects: [], animations: [], keyframes: []
    }]
  }],
  currentTime: 0.987, duration: 99, isPlaying: false, playbackRate: 1, loopEnabled: false, markers: [{ id: 'm1', time: 1.001, name: 'Marker', color: '#fff' }], snaps: []
};

export function runFoundationSelfTest(): void {
  const tb = createFrameTimebase(30);
  assert(tb.toFrame(1 / 30) === 1, 'frame conversion failed');
  assert(close(tb.quantize(1.017), tb.toSeconds(31)), 'nearest-frame quantization failed');

  const map = createRetimeMap([{ time: 0, speed: 1 }, { time: 2, speed: 3 }], 2);
  assert(close(map.sourceTimeAt(0), 0), 'retime origin failed');
  assert(close(map.sourceTimeAt(2), 4), 'retime integral failed');

  const normalized = normalizeTimelineState(base, 30);
  const invariant = validateTimelineInvariants(normalized);
  assert(invariant.valid, `normalized timeline invalid: ${invariant.errors.join('; ')}`);
  assert(normalized.currentTime === tb.toSeconds(tb.toFrame(normalized.currentTime)), 'current time is not frame aligned');
  assert(close(normalized.duration, 2), 'duration normalization unexpected');
  assert(close(normalized.tracks[0].clips[0].startTime, 0), 'clip start did not quantize to frame');

  const registry = new SnapRegistry();
  registry.addClip(normalized.tracks[0], normalized.tracks[0].clips[0]);
  registry.addMarker(normalized.markers[0]);
  registry.addFrame(tb, 1.01);
  const nearest = registry.nearest(1.01, 0.04);
  assert(nearest && nearest.type === 'marker', 'snap priority failed');

  const budget = transitionBudget(normalized.tracks[0], 'c1');
  assert(budget.maxDuration > 0, 'transition budget should be positive for a clip');

  console.log('timeline foundation self-test: PASS');
}

if (import.meta.url.endsWith('/foundation-self-test.ts')) runFoundationSelfTest();
