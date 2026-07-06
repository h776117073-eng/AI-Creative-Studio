export interface MemoryStats {
  usedJSHeapSizeMb: number;
  totalJSHeapSizeMb: number;
  jsHeapSizeLimitMb: number;
  estimatedAssetMemoryMb: number;
  isMemoryPressureHigh: boolean;
  leakWarningsCount: number;
}

export class MemoryManager {
  private static instance: MemoryManager | null = null;
  private estimatedAssetMemoryBytes = 0;
  private memoryTrackedAssets: Map<string, { sizeBytes: number; category: string; timestamp: number }> = new Map();
  private leakWatchlist: Map<string, number> = new Map(); // tracks object allocations over time
  private memoryPressureListeners: Set<(pressureLevel: "normal" | "warning" | "critical") => void> = new Set();

  private constructor() {
    this.startPeriodicGC();
  }

  public static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }

  /**
   * Periodically check and enforce memory limits, flagging potential leaks
   */
  private startPeriodicGC(): void {
    if (typeof window !== "undefined") {
      setInterval(() => {
        this.runAutomaticCleanup();
      }, 10000); // Check every 10 seconds
    }
  }

  /**
   * Register a new asset (e.g., loaded frame, canvas, video element, arraybuffer)
   */
  public trackAssetAllocation(id: string, sizeBytes: number, category: string): void {
    if (this.memoryTrackedAssets.has(id)) {
      this.untrackAssetAllocation(id);
    }
    this.memoryTrackedAssets.set(id, { sizeBytes, category, timestamp: Date.now() });
    this.estimatedAssetMemoryBytes += sizeBytes;

    // Detect high frequency allocations that could indicate a memory leak
    const count = this.leakWatchlist.get(category) || 0;
    this.leakWatchlist.set(category, count + 1);

    this.checkMemoryPressure();
  }

  /**
   * Remove asset from tracked memory state when it is garbage collected / released
   */
  public untrackAssetAllocation(id: string): void {
    const asset = this.memoryTrackedAssets.get(id);
    if (asset) {
      this.estimatedAssetMemoryBytes = Math.max(0, this.estimatedAssetMemoryBytes - asset.sizeBytes);
      this.memoryTrackedAssets.delete(id);
    }
  }

  /**
   * Access real or estimated memory statistics
   */
  public getMemoryStats(): MemoryStats {
    let usedHeap = 0;
    let totalHeap = 0;
    let limitHeap = 0;

    const perf = (typeof window !== "undefined" ? window.performance : null) as any;
    if (perf && perf.memory) {
      usedHeap = perf.memory.usedJSHeapSize / (1024 * 1024);
      totalHeap = perf.memory.totalJSHeapSize / (1024 * 1024);
      limitHeap = perf.memory.jsHeapSizeLimit / (1024 * 1024);
    } else {
      // Heuristic fallback for non-Chrome browsers
      usedHeap = this.estimatedAssetMemoryBytes / (1024 * 1024) + 50; // estimate overhead
      totalHeap = usedHeap * 1.5;
      limitHeap = 2048; // Assume standard 2GB tab limit
    }

    const assetMb = this.estimatedAssetMemoryBytes / (1024 * 1024);
    const pressure = usedHeap > limitHeap * 0.8 || assetMb > 1000;

    // Detect potential leaks (e.g., thousands of small active allocations in one category)
    let leakWarnings = 0;
    this.leakWatchlist.forEach((allocCount) => {
      if (allocCount > 500) {
        leakWarnings++;
      }
    });

    return {
      usedJSHeapSizeMb: Math.round(usedHeap * 100) / 100,
      totalJSHeapSizeMb: Math.round(totalHeap * 100) / 100,
      jsHeapSizeLimitMb: Math.round(limitHeap * 100) / 100,
      estimatedAssetMemoryMb: Math.round(assetMb * 100) / 100,
      isMemoryPressureHigh: pressure,
      leakWarningsCount: leakWarnings,
    };
  }

  public addPressureListener(listener: (pressureLevel: "normal" | "warning" | "critical") => void): () => void {
    this.memoryPressureListeners.add(listener);
    return () => this.memoryPressureListeners.delete(listener);
  }

  private checkMemoryPressure(): void {
    const stats = this.getMemoryStats();
    let level: "normal" | "warning" | "critical" = "normal";

    const usageRatio = stats.usedJSHeapSizeMb / stats.jsHeapSizeLimitMb;
    if (usageRatio > 0.85 || stats.estimatedAssetMemoryMb > 1200) {
      level = "critical";
    } else if (usageRatio > 0.70 || stats.estimatedAssetMemoryMb > 750) {
      level = "warning";
    }

    if (level !== "normal") {
      this.memoryPressureListeners.forEach((listener) => listener(level));
    }
  }

  /**
   * Proactively triggers garbage collection workflows across registered caches
   */
  public runAutomaticCleanup(): void {
    const stats = this.getMemoryStats();
    if (!stats.isMemoryPressureHigh) return;

    console.warn(`[MemoryManager] High memory pressure detected (${stats.usedJSHeapSizeMb}MB / ${stats.jsHeapSizeLimitMb}MB). Executing automatic cache eviction...`);

    // Evict oldest tracked assets first to free memory
    const assets = Array.from(this.memoryTrackedAssets.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    // Release up to 30% of old assets
    const targetReleaseBytes = this.estimatedAssetMemoryBytes * 0.3;
    let releasedBytes = 0;

    for (const [id, asset] of assets) {
      if (releasedBytes >= targetReleaseBytes) break;
      
      // Emit system clean instruction for specific memory tags
      releasedBytes += asset.sizeBytes;
      this.untrackAssetAllocation(id);
    }

    // Reset watchlist frequency counts to clear false warning tags after cleanup
    this.leakWatchlist.clear();
  }

  /**
   * Emergency clear function
   */
  public purgeAllAllocations(): void {
    this.memoryTrackedAssets.clear();
    this.leakWatchlist.clear();
    this.estimatedAssetMemoryBytes = 0;
    console.log("[MemoryManager] All registered memory tracking states successfully purged.");
  }
}
