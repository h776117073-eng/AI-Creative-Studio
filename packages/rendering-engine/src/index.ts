import {
  BaseEngine,
  EngineConfigSchema,
  EventEmitter,
  Color,
  Vec2,
  Bounds,
} from '@ai-creative-studio/core';
import { z } from 'zod';

const RenderingEngineConfigSchema = EngineConfigSchema.extend({
  useWebGL: z.boolean().optional().default(false),
  antialiasing: z.boolean().optional().default(true),
  backgroundColor: z.object({ r: z.number(), g: z.number(), b: z.number() }).optional(),
  maxTextureSize: z.number().optional().default(4096),
});

type RenderingEngineConfig = z.infer<typeof RenderingEngineConfigSchema>;

export interface IRenderTarget {
  id: string;
  type: 'canvas' | 'texture' | 'framebuffer';
  width: number;
  height: number;
  context: CanvasRenderingContext2D | WebGLRenderingContext | WebGL2RenderingContext | null;
}

export interface IRenderCommand {
  type: 'fill' | 'stroke' | 'image' | 'text' | 'clip' | 'transform' | 'filter' | 'path';
  params: Record<string, unknown>;
  order: number;
}

export interface IRenderLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  commands: IRenderCommand[];
  bounds: Bounds;
}

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export interface IRenderTargetInfo {
  width: number;
  height: number;
  pixelRatio: number;
  devicePixelRatio: number;
}

export interface IRenderContext {
  ctx: CanvasRenderingContext2D | WebGLRenderingContext | WebGL2RenderingContext;
  target: IRenderTargetInfo;
  time: number;
  frame: number;
  deltaTime: number;
}

export type RenderCallback = (context: IRenderContext) => void;

export interface IRendererEvents {
  'renderer:frame-start': { time: number; frame: number };
  'renderer:frame-end': { time: number; frame: number; renderTime: number };
  'renderer:resize': { width: number; height: number };
  'renderer:error': { error: Error };
  'renderer:webgl-context-lost': {};
  'renderer:webgl-context-restored': {};
}

export class RenderingEngine extends BaseEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private usingWebGL: boolean;
  private renderers: Map<string, RenderCallback> = new Map();
  private renderQueue: IRenderCommand[] = [];
  private layers: Map<string, IRenderLayer> = new Map();
  private layerOrder: string[] = [];
  private animationFrameId: number | null = null;
  private lastFrameTime: number = 0;
  private currentFrame: number = 0;
  private isRendering: boolean = false;

  private width: number = 1920;
  private height: number = 1080;
  private pixelRatio: number = 1;

  private emitter = new EventEmitter<IRendererEvents>();

  private shaderCache: Map<string, WebGLProgram> = new Map();
  private textureCache: Map<string, WebGLTexture> = new Map();
  private bufferCache: Map<string, WebGLBuffer> = new Map();

  constructor(config: RenderingEngineConfig) {
    const parsedConfig = RenderingEngineConfigSchema.parse(config);
    super(parsedConfig);
    this.usingWebGL = parsedConfig.useWebGL!;
  }

  protected async onInitialize(): Promise<void> {
  }

  protected override async onDestroy(): Promise<void> {
    this.stopRendering();

    if (this.gl) {
      this.shaderCache.forEach(program => this.gl!.deleteProgram(program));
      this.textureCache.forEach(texture => this.gl!.deleteTexture(texture));
      this.bufferCache.forEach(buffer => this.gl!.deleteBuffer(buffer));
    }

    this.ctx = null;
    this.gl = null;
    this.canvas = null;
    this.renderers.clear();
    this.layers.clear();
  }

  setCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;

    const experimentalWebGL = this.usingWebGL && canvas.dataset.renderMode === 'webgl-experimental';
    if (experimentalWebGL) {
      const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (context) {
        this.gl = context as WebGLRenderingContext;
        this.ctx = context as WebGLRenderingContext;
        this.initWebGL();
      } else {
        console.warn('WebGL not available, falling back to 2D canvas');
        this.ctx = canvas.getContext('2d');
        this.usingWebGL = false;
      }
    } else {
      this.ctx = canvas.getContext('2d');
    }

    this.resize(canvas.width, canvas.height);
  }

  setOutputResolution(width: number, height: number): void {
    this.width = width;
    this.height = height;

    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.resize(width, height);
    }
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.pixelRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

    if (this.canvas) {
      const actualWidth = width * this.pixelRatio;
      const actualHeight = height * this.pixelRatio;

      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;

      if (this.usingWebGL && this.gl) {
        this.gl.viewport(0, 0, actualWidth, actualHeight);
      }
    }

    this.emitter.emit('renderer:resize', { width, height });
  }

  private initWebGL(): void {
    if (!this.gl) return;

    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    this.gl.enable(this.gl.DEPTH_TEST);
    this.gl.depthFunc(this.gl.LEQUAL);
  }

  registerRenderer(id: string, callback: RenderCallback): void {
    this.renderers.set(id, callback);
  }

  unregisterRenderer(id: string): void {
    this.renderers.delete(id);
  }

  addLayer(layer: IRenderLayer): void {
    this.layers.set(layer.id, layer);
    this.layerOrder.push(layer.id);
  }

  removeLayer(layerId: string): void {
    this.layers.delete(layerId);
    this.layerOrder = this.layerOrder.filter(id => id !== layerId);
  }

  getLayer(layerId: string): IRenderLayer | undefined {
    return this.layers.get(layerId);
  }

  updateLayer(layerId: string, updates: Partial<IRenderLayer>): void {
    const layer = this.layers.get(layerId);
    if (layer) {
      Object.assign(layer, updates);
    }
  }

  clearCanvas(color?: Color): void {
    if (!this.ctx) return;

    if (this.usingWebGL && this.gl) {
      const clearColor = color || { r: 0, g: 0, b: 0, a: 1 };
      this.gl.clearColor(clearColor.r, clearColor.g, clearColor.b, clearColor.a);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
    } else if (this.ctx instanceof CanvasRenderingContext2D) {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.width, this.height);
      if (color) {
        ctx.fillStyle = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a ?? 1})`;
        ctx.fillRect(0, 0, this.width, this.height);
      }
    }
  }

  startRendering(): void {
    if (this.isRendering) return;

    this.isRendering = true;
    this.lastFrameTime = performance.now();
    this.renderLoop();
  }

  stopRendering(): void {
    this.isRendering = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  render(time?: number): void {
    const frameStartTime = performance.now();
    const renderTime = time ?? 0;

    this.emit('renderer:frame-start', {
      time: renderTime,
      frame: this.currentFrame,
    });

    this.clearCanvas();

    for (const layerId of this.layerOrder) {
      const layer = this.layers.get(layerId);
      if (layer && layer.visible) {
        this.renderLayer(layer, renderTime);
      }
    }

    const context: IRenderContext = {
      ctx: this.ctx!,
      target: {
        width: this.width,
        height: this.height,
        pixelRatio: this.pixelRatio,
        devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
      },
      time: renderTime,
      frame: this.currentFrame,
      deltaTime: 0,
    };

    this.renderers.forEach(callback => callback(context));

    const frameEndTime = performance.now();
    this.emit('renderer:frame-end', {
      time: renderTime,
      frame: this.currentFrame,
      renderTime: frameEndTime - frameStartTime,
    });

    this.currentFrame++;
  }

  private renderLoop = (): void => {
    if (!this.isRendering) return;

    const now = performance.now();
    const deltaTime = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    this.render();

    this.animationFrameId = requestAnimationFrame(this.renderLoop);
  };

  private renderLayer(layer: IRenderLayer, time: number): void {
    if (!(this.ctx instanceof CanvasRenderingContext2D)) return;
    const ctx = this.ctx;

    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;

    for (const command of layer.commands) {
      this.executeCommand(ctx, command, time);
    }

    ctx.restore();
  }

  private executeCommand(
    ctx: CanvasRenderingContext2D,
    command: IRenderCommand,
    time: number
  ): void {
    switch (command.type) {
      case 'fill':
        this.executeFill(ctx, command.params);
        break;
      case 'stroke':
        this.executeStroke(ctx, command.params);
        break;
      case 'image':
        this.executeDrawImage(ctx, command.params);
        break;
      case 'text':
        this.executeDrawText(ctx, command.params);
        break;
      case 'clip':
        this.executeClip(ctx, command.params);
        break;
      case 'transform':
        this.executeTransform(ctx, command.params);
        break;
      case 'path':
        this.executePath(ctx, command.params);
        break;
      case 'filter':
        this.executeFilter(ctx, command.params);
        break;
    }
  }

  private executeFill(ctx: CanvasRenderingContext2D, params: Record<string, unknown>): void {
    const color = params.color as Color | undefined;
    if (color) {
      ctx.fillStyle = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a ?? 1})`;
    }
    ctx.fillRect(params.x as number, params.y as number, params.width as number, params.height as number);
  }

  private executeStroke(ctx: CanvasRenderingContext2D, params: Record<string, unknown>): void {
    const color = params.color as Color | undefined;
    if (color) {
      ctx.strokeStyle = `rgba(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)}, ${color.a ?? 1})`;
    }
    ctx.lineWidth = (params.lineWidth as number) ?? 1;
    ctx.strokeRect(params.x as number, params.y as number, params.width as number, params.height as number);
  }

  private executeDrawImage(ctx: CanvasRenderingContext2D, params: Record<string, unknown>): void {
    const image = params.image as CanvasImageSource;
    const x = params.x as number;
    const y = params.y as number;

    if (params.width !== undefined && params.height !== undefined) {
      ctx.drawImage(image, x, y, params.width as number, params.height as number);
    } else if (params.sx !== undefined) {
      ctx.drawImage(
        image,
        params.sx as number,
        params.sy as number,
        params.sw as number,
        params.sh as number,
        params.dx as number,
        params.dy as number,
        params.dw as number,
        params.dh as number
      );
    } else {
      ctx.drawImage(image, x, y);
    }
  }

  private executeDrawText(ctx: CanvasRenderingContext2D, params: Record<string, unknown>): void {
    ctx.font = (params.font as string) || '16px sans-serif';
    ctx.textAlign = (params.textAlign as CanvasTextAlign) || 'left';
    ctx.textBaseline = (params.textBaseline as CanvasTextBaseline) || 'top';

    if (params.fillStyle) {
      ctx.fillStyle = params.fillStyle as string;
      ctx.fillText(params.text as string, params.x as number, params.y as number);
    }
    if (params.strokeStyle) {
      ctx.strokeStyle = params.strokeStyle as string;
      ctx.strokeText(params.text as string, params.x as number, params.y as number);
    }
  }

  private executeClip(ctx: CanvasRenderingContext2D, params: Record<string, unknown>): void {
    ctx.beginPath();
    const path = params.path as { x: number; y: number }[];
    path.forEach((point, i) => {
      if (i === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.closePath();
    ctx.clip();
  }

  private executeTransform(ctx: CanvasRenderingContext2D, params: Record<string, unknown>): void {
    if (params.translate) {
      const t = params.translate as Vec2;
      ctx.translate(t.x, t.y);
    }
    if (params.scale) {
      const s = params.scale as Vec2;
      ctx.scale(s.x, s.y);
    }
    if (params.rotate !== undefined) {
      ctx.rotate(params.rotate as number);
    }
    if (params.transform) {
      const m = params.transform as [number, number, number, number, number, number];
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    }
  }

  private executePath(ctx: CanvasRenderingContext2D, params: Record<string, unknown>): void {
    const commands = params.commands as Array<{ type: string; data: unknown }>;
    ctx.beginPath();

    commands.forEach(cmd => {
      switch (cmd.type) {
        case 'moveTo':
          const move = cmd.data as Vec2;
          ctx.moveTo(move.x, move.y);
          break;
        case 'lineTo':
          const line = cmd.data as Vec2;
          ctx.lineTo(line.x, line.y);
          break;
        case 'bezierCurveTo':
          const bezier = cmd.data as { cp1: Vec2; cp2: Vec2; end: Vec2 };
          ctx.bezierCurveTo(bezier.cp1.x, bezier.cp1.y, bezier.cp2.x, bezier.cp2.y, bezier.end.x, bezier.end.y);
          break;
        case 'quadraticCurveTo':
          const quad = cmd.data as { cp: Vec2; end: Vec2 };
          ctx.quadraticCurveTo(quad.cp.x, quad.cp.y, quad.end.x, quad.end.y);
          break;
        case 'arc':
          const arc = cmd.data as { center: Vec2; radius: number; startAngle: number; endAngle: number };
          ctx.arc(arc.center.x, arc.center.y, arc.radius, arc.startAngle, arc.endAngle);
          break;
        case 'closePath':
          ctx.closePath();
          break;
      }
    });

    if (params.fill) {
      ctx.fillStyle = params.fill as string;
      ctx.fill();
    }
    if (params.stroke) {
      ctx.strokeStyle = params.stroke as string;
      ctx.stroke();
    }
  }

  private executeFilter(ctx: CanvasRenderingContext2D, params: Record<string, unknown>): void {
    if (params.filter) {
      ctx.filter = params.filter as string;
    } else {
      ctx.filter = 'none';
    }
  }

  getResolution(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  getContext(): CanvasRenderingContext2D | WebGLRenderingContext | WebGL2RenderingContext | null {
    return this.ctx;
  }

  on<E extends keyof IRendererEvents>(
    event: E,
    listener: (data: IRendererEvents[E]) => void
  ): this {
    this.emitter.on(event, listener as any);
    return this;
  }

  off<E extends keyof IRendererEvents>(
    event: E,
    listener: (data: IRendererEvents[E]) => void
  ): this {
    this.emitter.off(event, listener as any);
    return this;
  }

  private emit<E extends keyof IRendererEvents>(
    event: E,
    data: IRendererEvents[E]
  ): void {
    this.emitter.emit(event, data as any);
  }

  getCapabilities(): string[] {
    return [
      'render:canvas',
      'render:webgl',
      'render:layers',
      'render:blend-modes',
      'render:transforms',
      'render:filters',
      'render:paths',
      'render:text',
      'render:images',
      'render:animation',
    ];
  }
}
