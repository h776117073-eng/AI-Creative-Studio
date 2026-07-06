import { GPUEngine } from "../../gpu/GPUEngine";

export interface GPUPerformanceMetrics {
  gpuName: string;
  vendor: string;
  supportsWebGPU: boolean;
  supportsWebGL2: boolean;
  maxTextureSize: number;
  vramTotalMb: number;
  vramAllocatedMb: number;
  vramUsagePercentage: number;
  activeGPUCount: number;
  hardwareAccelerationEnabled: boolean;
}

export class GPUProfiler {
  private static instance: GPUProfiler | null = null;
  private gpuEngine: GPUEngine;
  private webglContext: WebGL2RenderingContext | null = null;
  private canvasElement: HTMLCanvasElement | null = null;

  private constructor() {
    this.gpuEngine = GPUEngine.getInstance();
    this.initializeContext();
  }

  public static getInstance(): GPUProfiler {
    if (!GPUProfiler.instance) {
      GPUProfiler.instance = new GPUProfiler();
    }
    return GPUProfiler.instance;
  }

  private initializeContext(): void {
    if (typeof document !== "undefined") {
      this.canvasElement = document.createElement("canvas");
      const gl = this.canvasElement.getContext("webgl2") || this.canvasElement.getContext("webgl");
      if (gl) {
        this.webglContext = gl as WebGL2RenderingContext;
      }
    }
  }

  /**
   * Performs actual hardware & capability profiling.
   */
  public getMetrics(): GPUPerformanceMetrics {
    const caps = this.gpuEngine.getCapabilities();
    const secondaries = this.gpuEngine.getSecondaryGPUs();

    return {
      gpuName: caps.name,
      vendor: caps.vendor,
      supportsWebGPU: caps.supportsWebGPU,
      supportsWebGL2: caps.supportsWebGL2,
      maxTextureSize: caps.maxTextureDimension2D,
      vramTotalMb: caps.vramTotalMb,
      vramAllocatedMb: caps.vramAllocatedMb,
      vramUsagePercentage: this.gpuEngine.getVRAMUsagePercentage(),
      activeGPUCount: 1 + secondaries.length,
      hardwareAccelerationEnabled: caps.hardwareAccelerationEnabled,
    };
  }

  /**
   * Dynamically evaluates if a texture of given dimensions is safe to load on GPU
   */
  public isTextureSafe(width: number, height: number, bytesPerPixel = 4): boolean {
    const metrics = this.getMetrics();
    if (width > metrics.maxTextureSize || height > metrics.maxTextureSize) {
      return false;
    }

    const estimatedSizeMb = (width * height * bytesPerPixel) / (1024 * 1024);
    const availableVram = metrics.vramTotalMb - metrics.vramAllocatedMb;
    
    // Safety buffer: keep 15% VRAM free for operating system/display compositing
    return estimatedSizeMb < availableVram * 0.85;
  }

  /**
   * Releases any WebGL context resources
   */
  public disposeContext(): void {
    if (this.webglContext) {
      const ext = this.webglContext.getExtension("WEBGL_lose_context");
      if (ext) {
        ext.loseContext();
      }
      this.webglContext = null;
    }
    if (this.canvasElement) {
      this.canvasElement.width = 0;
      this.canvasElement.height = 0;
      this.canvasElement = null;
    }
  }
}
