import { Timeline, TimelineClip } from '../../core/state/timeline';

export interface FrameContext { timeline: Timeline; cursor: number; frame: number; activeClips: TimelineClip[]; }

export abstract class AbstractCreativeEngine {
  constructor(readonly id: string) {}
  async onInitialize(): Promise<void> {}
  async onTimelineUpdate(_timeline: Timeline): Promise<void> {}
  async processFrame(frameBuffer: unknown, _context: FrameContext): Promise<unknown> { return frameBuffer; }
  async onRender(_timeline: Timeline): Promise<void> {}
}

export class ThreeDEngine extends AbstractCreativeEngine { constructor() { super('three-d-engine'); } }
export class MotionGraphicsEngine extends AbstractCreativeEngine { constructor() { super('motion-graphics-engine'); } }
export class AdvancedAudioMixer extends AbstractCreativeEngine { constructor() { super('advanced-audio-mixer'); } }
export class ColorGradingEngine extends AbstractCreativeEngine { constructor() { super('color-grading-engine'); } }
