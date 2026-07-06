export interface BottleneckReport {
  primaryIssue: "none" | "gpu_vram" | "cpu_overload" | "memory_leak" | "io_lag";
  explanation: string;
  suggestedAction: string;
  severity: "low" | "medium" | "high" | "critical";
}

export interface ProfilerReport {
  currentFps: number;
  averageFrameRenderTimeMs: number;
  cpuLoadEstimate: number;
  gpuVramUsageMb: number;
  heapMemoryUsageMb: number;
  consecutiveFrameDrops: number;
  totalFrameDropsRecorded: number;
  activeBottlenecks: BottleneckReport[];
  timestamp: number;
}

export class ProfilerSystem {
  private static instance: ProfilerSystem | null = null;
  private renderTimes: number[] = [];
  private fpsValues: number[] = [];
  private lastFpsTimestamp = Date.now();
  private framesCountInWindow = 0;
  private currentFps = 60.0;

  // Frame drop counting
  private consecutiveFrameDrops = 0;
  private totalFrameDropsRecorded = 0;

  private constructor() {
    this.startFpsLoop();
  }

  public static getInstance(): ProfilerSystem {
    if (!ProfilerSystem.instance) {
      ProfilerSystem.instance = new ProfilerSystem();
    }
    return ProfilerSystem.instance;
  }

  private startFpsLoop(): void {
    if (typeof window === "undefined" || typeof requestAnimationFrame === "undefined") {
      return;
    }

    const loop = () => {
      this.framesCountInWindow++;
      const now = Date.now();
      const delta = now - this.lastFpsTimestamp;

      if (delta >= 1000) {
        // Calculate instantaneous FPS over the last second
        this.currentFps = Math.min(120, Math.round((this.framesCountInWindow * 1000) / delta));
        this.fpsValues.push(this.currentFps);
        if (this.fpsValues.length > 30) this.fpsValues.shift(); // Keep 30-sec sliding window

        this.framesCountInWindow = 0;
        this.lastFpsTimestamp = now;
      }
      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  /**
   * Records the millisecond duration of a complete render pipeline pass
   */
  public recordRenderTime(durationMs: number, targetFps = 30): void {
    this.renderTimes.push(durationMs);
    if (this.renderTimes.length > 120) {
      this.renderTimes.shift(); // Keep last 120 frames sliding window
    }

    // Determine frame drop threshold
    const limitMs = 1000 / targetFps;
    if (durationMs > limitMs) {
      this.consecutiveFrameDrops++;
      this.totalFrameDropsRecorded++;
    } else {
      this.consecutiveFrameDrops = 0; // reset
    }
  }

  /**
   * Analyze metrics to locate rendering pipeline bottlenecks
   */
  public generateDiagnosticsReport(): ProfilerReport {
    // Calculate average render time in sliding window
    const avgRender = this.renderTimes.length > 0
      ? this.renderTimes.reduce((a, b) => a + b, 0) / this.renderTimes.length
      : 2.5;

    // Retrieve active memory context
    let heapUsage = 150;
    const perf = (typeof window !== "undefined" ? window.performance : null) as any;
    if (perf && perf.memory) {
      heapUsage = perf.memory.usedJSHeapSize / (1024 * 1024);
    }

    const activeBottlenecks: BottleneckReport[] = [];

    // Analyze average frame render times for CPU thread locks
    if (avgRender > 33.3) {
      activeBottlenecks.push({
        primaryIssue: "cpu_overload",
        explanation: `Average render time is ${avgRender.toFixed(1)}ms, which exceeds standard 30fps frames budgets.`,
        suggestedAction: "Reduce processing timeline width or engage Web Worker threading.",
        severity: avgRender > 50 ? "critical" : "high",
      });
    }

    // Analyze consecutive dropped frames indicating GPU lag
    if (this.consecutiveFrameDrops > 5) {
      activeBottlenecks.push({
        primaryIssue: "gpu_vram",
        explanation: `${this.consecutiveFrameDrops} consecutive frames were dropped due to rendering delay.`,
        suggestedAction: "Degrade playback rendering resolution (e.g., to 0.5x draft mode).",
        severity: "high",
      });
    }

    // Identify memory warnings
    if (heapUsage > 1200) {
      activeBottlenecks.push({
        primaryIssue: "memory_leak",
        explanation: `Active memory usage is extremely high (${Math.round(heapUsage)}MB).`,
        suggestedAction: "Run deep cache eviction and garbage collect inactive media tracks.",
        severity: heapUsage > 1600 ? "critical" : "medium",
      });
    }

    // Estimate CPU load based on frame budget consumption ratio
    const cpuLoadEst = Math.min(100, Math.round((avgRender / 33.3) * 100));

    return {
      currentFps: this.currentFps,
      averageFrameRenderTimeMs: Math.round(avgRender * 10) / 10,
      cpuLoadEstimate: cpuLoadEst,
      gpuVramUsageMb: 0, // GPUEngine manages its specific VRAM, which we export separately
      heapMemoryUsageMb: Math.round(heapUsage),
      consecutiveFrameDrops: this.consecutiveFrameDrops,
      totalFrameDropsRecorded: this.totalFrameDropsRecorded,
      activeBottlenecks,
      timestamp: Date.now(),
    };
  }

  public resetStats(): void {
    this.renderTimes = [];
    this.consecutiveFrameDrops = 0;
    this.totalFrameDropsRecorded = 0;
  }
}
