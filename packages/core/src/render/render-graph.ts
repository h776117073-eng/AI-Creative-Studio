export type RenderNodeType = 'source'|'decode'|'crop'|'transform'|'retime'|'mask'|'effect'|'color'|'composite'|'text'|'audio'|'encode';

export type RenderImplementationStatus = 'implemented'|'partial'|'unsupported';

export interface RenderNode {
  id: string;
  type: RenderNodeType;
  inputs: string[];
  params: Record<string, unknown>;
  status: RenderImplementationStatus;
}

export interface RenderGraph {
  version: 1;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  nodes: RenderNode[];
  diagnostics: string[];
}

export interface TimelineLike {
  duration?: number;
  tracks?: Array<{ type?: string; clips?: Array<Record<string, unknown>> }>;
}

const IMPLEMENTED_EFFECTS = new Set(['blur','vignette','grain','enhance','night','voice-enhance','noise-reduce']);

export function normalizeRenderGraph(input: TimelineLike, options: { width?: number; height?: number; frameRate?: number } = {}): RenderGraph {
  const width = clampInt(options.width ?? 1280, 256, 3840);
  const height = clampInt(options.height ?? 720, 144, 2160);
  const frameRate = Math.max(1, Math.min(240, Number(options.frameRate ?? 30)));
  const nodes: RenderNode[] = [];
  const diagnostics: string[] = [];
  const add = (type: RenderNodeType, params: Record<string, unknown>, status: RenderImplementationStatus, inputs: string[] = []) => {
    const node = { id: `${type}-${nodes.length + 1}`, type, inputs, params, status } satisfies RenderNode;
    nodes.push(node);
    if (status !== 'implemented') diagnostics.push(`${type}:${String(params.reason ?? status)}`);
    return node.id;
  };

  const videoTracks = (input.tracks ?? []).filter(t => t.type === 'video');
  const audioTracks = (input.tracks ?? []).filter(t => t.type === 'audio');
  let previousComposite: string | undefined;
  for (const track of videoTracks) {
    for (const clip of track.clips ?? []) {
      if (Number(clip.duration ?? 0) <= 0) continue;
      const source = add('source', { assetId: clip.assetId, name: clip.name });
      const decode = add('decode', {}, 'implemented', [source]);
      const crop = add('crop', { trimStart: Number(clip.trimStart ?? 0), trimEnd: Number(clip.trimEnd ?? clip.duration ?? 0) }, 'implemented', [decode]);
      const speed = Number(clip.speed ?? 1);
      const retime = add('retime', { speed: Math.max(0.1, Math.min(100, speed)), curve: clip.speedCurve ?? null }, clip.speedCurve ? 'partial' : 'implemented', [crop]);
      const transform = add('transform', { rotate: clip.rotate ?? 0, flipH: !!clip.flipH, flipV: !!clip.flipV, opacity: clip.opacity ?? 1 }, 'implemented', [retime]);
      const keyframes = Array.isArray(clip.keyframes) && clip.keyframes.length > 0;
      const animation = add('transform', { keyframes: keyframes ? clip.keyframes : [] }, keyframes ? 'partial' : 'implemented', [transform]);
      let tail = animation;
      for (const effect of Array.isArray(clip.effects) ? clip.effects : []) {
        const implemented = IMPLEMENTED_EFFECTS.has(String(effect));
        tail = add('effect', { effect }, implemented ? 'implemented' : 'unsupported', [tail]);
      }
      const color = add('color', { brightness: clip.brightness ?? 0, contrast: clip.contrast ?? 1, saturation: clip.saturation ?? 1, grayscale: !!clip.grayscale }, 'implemented', [tail]);
      const transition = clip.transitionIn || clip.transitionOut;
      if (transition) tail = add('composite', { transition }, transition.type === 'fade' || transition.type === 'dissolve' ? 'partial' : 'unsupported', [previousComposite ?? color, color]);
      else tail = color;
      previousComposite = add('composite', { blendMode: clip.blendMode ?? 'normal' }, 'implemented', [tail]);
    }
  }
  for (const track of audioTracks) {
    for (const clip of track.clips ?? []) {
      if (Number(clip.duration ?? 0) <= 0) continue;
      const source = add('source', { assetId: clip.assetId, name: clip.name, media: 'audio' });
      const decode = add('decode', { media: 'audio' }, 'implemented', [source]);
      add('audio', { volume: clip.volume ?? 1, speed: clip.speed ?? 1, effects: clip.effects ?? [] }, 'implemented', [decode]);
    }
  }
  const textTracks = (input.tracks ?? []).filter(t => t.type === 'text');
  for (const track of textTracks) for (const clip of track.clips ?? []) if (clip.text) add('text', { text: clip.text, startTime: clip.startTime, endTime: clip.endTime }, 'implemented');

  add('encode', { width, height, frameRate, codec: 'h264', audioCodec: 'aac' }, 'implemented', previousComposite ? [previousComposite] : []);
  return { version: 1, width, height, frameRate, duration: Math.max(0, Number(input.duration ?? 0)), nodes, diagnostics };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)));
}
