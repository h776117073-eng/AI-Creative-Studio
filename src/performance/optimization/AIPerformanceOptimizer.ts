import { ProfilerSystem } from "../profiling/ProfilerSystem";
import { SmartCache } from "../cache/SmartCache";
import { StreamingMediaEngine } from "../streaming/StreamingMediaEngine";

export interface OptimizerDirectives {
  renderScale: number;          // multiplier: 1.0 (Full), 0.75, 0.5 (Draft), 0.25 (Fast)
  enableProxyOverrides: boolean; // toggle proxy clips swap
  maxWorkerThreadsCount: number;// adjust thread pool size
  allowedCachePercent: number;  // cache boundary ratio
  prefetchLookaheadEnabled: boolean;
}

export class AIPerformanceOptimizer {
  private static instance: AIPerformanceOptimizer | null = null;
  private profiler: ProfilerSystem;
  private smartCache: SmartCache;
  private streamingEngine: StreamingMediaEngine;

  private currentDirectives: OptimizerDirectives = {
    renderScale: 1.0,
    enableProxyOverrides: false,
    maxWorkerThreadsCount: 4,
    allowedCachePercent: 1.0,
    prefetchLookaheadEnabled: true,
  };

  private constructor() {
    this.profiler = ProfilerSystem.getInstance();
    this.smartCache = SmartCache.getInstance();
    this.streamingEngine = StreamingMediaEngine.getInstance();
    
    this.startAdaptiveOptimizationLoop();
  }

  public static getInstance(): AIPerformanceOptimizer {
    if (!AIPerformanceOptimizer.instance) {
      AIPerformanceOptimizer.instance = new AIPerformanceOptimizer();
    }
    return AIPerformanceOptimizer.instance;
  }

  /**
   * Periodically runs analysis and updates the global optimization guidelines
   */
  private startAdaptiveOptimizationLoop(): void {
    if (typeof window !== "undefined") {
      setInterval(() => {
        this.runOptimizationPass();
      }, 8000); // Analyze every 8 seconds
    }
  }

  /**
   * Evaluates the bottleneck diagnostic reports and mutates directives on-the-fly
   */
  public runOptimizationPass(): OptimizerDirectives {
    const report = this.profiler.generateDiagnosticsReport();
    
    // Default optimized base state
    let renderScale = 1.0;
    let enableProxyOverrides = this.currentDirectives.enableProxyOverrides;
    let maxWorkerThreadsCount = this.currentDirectives.maxWorkerThreadsCount;
    let allowedCachePercent = 1.0;
    let prefetchLookaheadEnabled = true;

    // Evaluate severe lag conditions
    if (report.currentFps < 20 || report.consecutiveFrameDrops > 8) {
      // Critical load: heavily downscale rendering and prioritize low resolution proxies
      renderScale = 0.5; // Draft mode
      enableProxyOverrides = true;
      allowedCachePercent = 0.5; // shrink memory boundary
      prefetchLookaheadEnabled = false; // suspend aggressive prefetching to save bandwidth
      console.warn("[AIPerformanceOptimizer] CRITICAL system lag diagnosed. Applying emergency scaling guidelines:", { renderScale, enableProxyOverrides });
    } else if (report.currentFps < 26 || report.averageFrameRenderTimeMs > 28.0) {
      // Moderate load: light scaling downscales, leverage proxy files if present
      renderScale = 0.75;
      enableProxyOverrides = true;
      allowedCachePercent = 0.8;
    } else {
      // Ideal specs: restore native quality levels
      renderScale = 1.0;
      prefetchLookaheadEnabled = true;
    }

    this.currentDirectives = {
      renderScale,
      enableProxyOverrides,
      maxWorkerThreadsCount,
      allowedCachePercent,
      prefetchLookaheadEnabled,
    };

    // Reflect proxy directives back to the active Streaming engine
    this.streamingEngine.setProxyMode(enableProxyOverrides);

    return this.currentDirectives;
  }

  /**
   * Exposes raw optimization directives
   */
  public getDirectives(): OptimizerDirectives {
    return this.currentDirectives;
  }

  /**
   * Allows the AI system or orchestrator to force manual quality adjustments
   */
  public overrideDirectives(directives: Partial<OptimizerDirectives>): void {
    this.currentDirectives = {
      ...this.currentDirectives,
      ...directives,
    };
    
    this.streamingEngine.setProxyMode(this.currentDirectives.enableProxyOverrides);
    console.log("[AIPerformanceOptimizer] Manual AI/System directives successfully injected:", this.currentDirectives);
  }
}
