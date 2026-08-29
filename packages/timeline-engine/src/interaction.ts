import type { IClip, ITrack, ITimelineState } from './index.js';

export type Rect = { x: number; y: number; width: number; height: number };
export type Point = { x: number; y: number };
export type GestureState =
  | { kind: 'idle' }
  | { kind: 'pan'; pointerId: number; start: Point; current: Point; dx: number; dy: number }
  | { kind: 'pinch'; pointerIds: [number, number]; startDistance: number; startCenter: Point; scale: number; center: Point; dx: number; dy: number };

export type EditIntent =
  | { type: 'select'; clipId?: string; additive: boolean }
  | { type: 'move'; clipIds: string[]; trackId: string; deltaTime: number }
  | { type: 'trim-start'; clipId: string; deltaTime: number }
  | { type: 'trim-end'; clipId: string; deltaTime: number }
  | { type: 'seek'; time: number }
  | { type: 'box-select'; rect: Rect; additive: boolean }
  | { type: 'zoom'; scale: number; anchorTime: number }
  | { type: 'scroll'; deltaX: number; deltaY: number };

export type ClipBounds = { clip: IClip; track: ITrack; rect: Rect };

export class SelectionEngine {
  private ids = new Set<string>();
  get selectedIds(): string[] { return [...this.ids]; }
  has(id: string): boolean { return this.ids.has(id); }
  clear(): void { this.ids.clear(); }
  set(id: string): void { this.ids.clear(); this.ids.add(id); }
  toggle(id: string): void { this.ids.has(id) ? this.ids.delete(id) : this.ids.add(id); }
  add(id: string): void { this.ids.add(id); }
  remove(id: string): void { this.ids.delete(id); }
  setMany(ids: Iterable<string>): void { this.ids = new Set(ids); }
  selectClip(id: string, additive = false): string[] { additive ? this.toggle(id) : this.set(id); return this.selectedIds; }
  boxSelect(bounds: ClipBounds[], rect: Rect, additive = false): string[] {
    if (!additive) this.clear();
    for (const b of bounds) if (intersects(b.rect, rect)) this.ids.add(b.clip.id);
    return this.selectedIds;
  }
}

export class TrackTargeting {
  private targeted = new Set<string>();
  private activeId: string | null = null;
  setActive(trackId: string | null): void { this.activeId = trackId; }
  getActive(): string | null { return this.activeId; }
  setTargeted(ids: Iterable<string>): void { this.targeted = new Set(ids); }
  toggle(trackId: string): void { this.targeted.has(trackId) ? this.targeted.delete(trackId) : this.targeted.add(trackId); }
  isTargeted(trackId: string): boolean { return this.targeted.has(trackId); }
  getTargeted(): string[] { return [...this.targeted]; }
}

export class LinkGraph {
  constructor(private readonly state: ITimelineState) {}
  linkedIds(rootId: string): string[] {
    const result = new Set<string>([rootId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const track of this.state.tracks) for (const clip of track.clips) {
        const linked = clip.linkedClipIds ?? [];
        if (result.has(clip.id) || linked.some((id) => result.has(id))) {
          for (const id of [clip.id, ...linked]) if (!result.has(id)) { result.add(id); changed = true; }
        }
      }
    }
    result.delete(rootId);
    return [...result];
  }
  allWithRoot(rootId: string): string[] { return [rootId, ...this.linkedIds(rootId)]; }
}

export class TimelineViewport {
  constructor(public zoom = 64, public scrollX = 0, public scrollY = 0) {}
  timeToX(time: number): number { return time * this.zoom - this.scrollX; }
  xToTime(x: number): number { return Math.max(0, (x + this.scrollX) / Math.max(1, this.zoom)); }
  setZoom(next: number, anchorX = 0): void {
    const anchorTime = this.xToTime(anchorX);
    this.zoom = clamp(next, 12, 900);
    this.scrollX = Math.max(0, anchorTime * this.zoom - anchorX);
  }
  zoomAt(anchorX: number, scale: number): void { this.setZoom(this.zoom * clamp(scale, .2, 5), anchorX); }
  pan(dx: number, dy: number): void { this.scrollX = Math.max(0, this.scrollX + dx); this.scrollY = Math.max(0, this.scrollY + dy); }
  ensureVisible(time: number, viewportWidth: number, padding = 48): void {
    const x = this.timeToX(time);
    if (x < padding) this.scrollX = Math.max(0, time * this.zoom - padding);
    else if (x > viewportWidth - padding) this.scrollX = Math.max(0, time * this.zoom - (viewportWidth - padding));
  }
}

export class GestureEngine {
  private pointers = new Map<number, Point>();
  private pinchStart: { distance: number; center: Point } | null = null;
  private state: GestureState = { kind: 'idle' };
  getState(): GestureState { return this.state; }
  pointerDown(pointerId: number, point: Point): GestureState {
    this.pointers.set(pointerId, point);
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchStart = { distance: distance(a, b), center: midpoint(a, b) };
      this.state = { kind: 'pinch', pointerIds: [...this.pointers.keys()] as [number, number], startDistance: this.pinchStart.distance, startCenter: this.pinchStart.center, scale: 1, center: this.pinchStart.center, dx: 0, dy: 0 };
    } else {
      this.state = { kind: 'pan', pointerId, start: point, current: point, dx: 0, dy: 0 };
    }
    return this.state;
  }
  pointerMove(pointerId: number, point: Point): GestureState {
    if (!this.pointers.has(pointerId)) return this.state;
    this.pointers.set(pointerId, point);
    if (this.pointers.size >= 2 && this.pinchStart) {
      const [a, b] = [...this.pointers.values()];
      const center = midpoint(a, b);
      this.state = { kind: 'pinch', pointerIds: [...this.pointers.keys()].slice(0, 2) as [number, number], startDistance: this.pinchStart.distance, startCenter: this.pinchStart.center, scale: distance(a, b) / Math.max(1, this.pinchStart.distance), center, dx: center.x - this.pinchStart.center.x, dy: center.y - this.pinchStart.center.y };
    } else if (this.state.kind === 'pan') {
      this.state = { ...this.state, current: point, dx: point.x - this.state.start.x, dy: point.y - this.state.start.y };
    }
    return this.state;
  }
  pointerUp(pointerId: number): GestureState {
    this.pointers.delete(pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    if (this.pointers.size === 0) this.state = { kind: 'idle' };
    else {
      const [id, point] = [...this.pointers.entries()][0];
      this.state = { kind: 'pan', pointerId: id, start: point, current: point, dx: 0, dy: 0 };
    }
    return this.state;
  }
}

export class InertialScroller {
  private vx = 0; private vy = 0; private running = false; private frame: number | null = null;
  constructor(private readonly friction = .92, private readonly threshold = .05) {}
  setVelocity(vx: number, vy: number): void { this.vx = vx; this.vy = vy; }
  stop(): void { this.running = false; if (this.frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.frame); this.frame = null; }
  start(onStep: (dx: number, dy: number) => void): void {
    this.stop(); this.running = true;
    const step = () => {
      if (!this.running) return;
      this.vx *= this.friction; this.vy *= this.friction;
      if (Math.abs(this.vx) < this.threshold && Math.abs(this.vy) < this.threshold) { this.stop(); return; }
      onStep(this.vx, this.vy);
      this.frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(step) : (setTimeout(step, 16) as unknown as number);
    };
    step();
  }
}

export function virtualizeTracks(total: number, scrollY: number, viewportHeight: number, rowHeight: number, overscan = 2): { start: number; end: number } {
  const row = Math.max(1, rowHeight);
  return { start: clampInt(Math.floor(scrollY / row) - overscan, 0, Math.max(0, total - 1)), end: clampInt(Math.ceil((scrollY + viewportHeight) / row) + overscan, 0, total) };
}

export function hitTestClip(bounds: ClipBounds[], point: Point): ClipBounds | null {
  for (let i = bounds.length - 1; i >= 0; i -= 1) if (contains(bounds[i].rect, point)) return bounds[i];
  return null;
}

export function collectSelectedClips(state: ITimelineState, selection: SelectionEngine): Array<[IClip, ITrack]> {
  const out: Array<[IClip, ITrack]> = [];
  for (const track of state.tracks) for (const clip of track.clips) if (selection.has(clip.id)) out.push([clip, track]);
  return out;
}

function contains(r: Rect, p: Point): boolean { return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height; }
function intersects(a: Rect, b: Rect): boolean { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
function midpoint(a: Point, b: Point): Point { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function clampInt(value: number, min: number, max: number): number { return Math.trunc(clamp(value, min, max)); }
