import { MemoryManager } from "../memory/MemoryManager";

export interface CacheEntry<T = any> {
  key: string;
  value: T;
  sizeBytes: number;
  category: "frame" | "render" | "effect" | "audio" | "ai";
  lastAccessed: number;
}

export class SmartCache {
  private static instance: SmartCache | null = null;
  private cacheStore: Map<string, CacheEntry> = new Map();
  private maxCacheSizeEntries = 2000;
  private maxCacheSizeBytes = 600 * 1024 * 1024; // 600 MB default target
  private currentCacheSizeBytes = 0;
  private memoryManager: MemoryManager;

  // Profiling stats
  private hitCount = 0;
  private missCount = 0;

  private constructor() {
    this.memoryManager = MemoryManager.getInstance();
    
    // Connect to MemoryManager's warning stream
    this.memoryManager.addPressureListener((level) => {
      if (level === "critical") {
        this.evictToPercent(0.3); // Evict 70% of cache immediately under critical limits
      } else if (level === "warning") {
        this.evictToPercent(0.6); // Evict 40% of cache
      }
    });
  }

  public static getInstance(): SmartCache {
    if (!SmartCache.instance) {
      SmartCache.instance = new SmartCache();
    }
    return SmartCache.instance;
  }

  /**
   * Puts an asset in the cache, managing LRU limits and memory markers
   */
  public put<T = any>(
    key: string,
    value: T,
    category: CacheEntry["category"],
    estimatedBytes = 100 * 1024 // default 100KB if unspecified
  ): void {
    // If the entry already exists, subtract its size first
    const existing = this.cacheStore.get(key);
    if (existing) {
      this.currentCacheSizeBytes -= existing.sizeBytes;
      this.memoryManager.untrackAssetAllocation(key);
    }

    // Ensure we don't violate limits before inserting
    this.enforceCacheLimits(estimatedBytes);

    const entry: CacheEntry<T> = {
      key,
      value,
      sizeBytes: estimatedBytes,
      category,
      lastAccessed: Date.now(),
    };

    this.cacheStore.set(key, entry);
    this.currentCacheSizeBytes += estimatedBytes;
    
    // Notify general memory manager of allocation
    this.memoryManager.trackAssetAllocation(key, estimatedBytes, `cache_${category}`);
  }

  /**
   * Retrieves an item from cache, updating its last accessed timestamp
   */
  public get<T = any>(key: string): T | null {
    const entry = this.cacheStore.get(key) as CacheEntry<T> | undefined;
    if (!entry) {
      this.missCount++;
      return null;
    }

    this.hitCount++;
    entry.lastAccessed = Date.now();
    return entry.value;
  }

  public has(key: string): boolean {
    return this.cacheStore.has(key);
  }

  public delete(key: string): void {
    const entry = this.cacheStore.get(key);
    if (entry) {
      this.currentCacheSizeBytes -= entry.sizeBytes;
      this.memoryManager.untrackAssetAllocation(key);
      this.cacheStore.delete(key);
    }
  }

  private enforceCacheLimits(incomingBytes: number): void {
    while (
      (this.currentCacheSizeBytes + incomingBytes > this.maxCacheSizeBytes ||
        this.cacheStore.size >= this.maxCacheSizeEntries) &&
      this.cacheStore.size > 0
    ) {
      this.evictOldest();
    }
  }

  private evictOldest(): void {
    let oldestEntry: CacheEntry | null = null;
    let oldestTime = Infinity;

    this.cacheStore.forEach((entry) => {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestEntry = entry;
      }
    });

    if (oldestEntry) {
      this.delete((oldestEntry as CacheEntry).key);
    }
  }

  private evictToPercent(targetPercent: number): void {
    const targetBytes = this.maxCacheSizeBytes * targetPercent;
    console.warn(`[SmartCache] Evicting cached items to reach ${targetPercent * 100}% of limit (${Math.round(targetBytes / (1024 * 1024))} MB)...`);

    while (this.currentCacheSizeBytes > targetBytes && this.cacheStore.size > 0) {
      this.evictOldest();
    }
  }

  /**
   * Triggers predictive lookahead frames fetching based on playhead context
   */
  public runPredictiveLookahead(
    currentFrame: number,
    direction: "forward" | "backward",
    timelineClipsCount: number,
    fetchCallback: (frame: number) => Promise<any>
  ): void {
    if (timelineClipsCount === 0) return;

    const lookaheadSteps = 8; // Predict 8 frames ahead
    for (let i = 1; i <= lookaheadSteps; i++) {
      const targetFrame = direction === "forward" ? currentFrame + i : currentFrame - i;
      if (targetFrame < 0) continue;

      const cacheKey = `frame_${targetFrame}`;
      if (!this.has(cacheKey)) {
        // Perform non-blocking pre-fetch
        fetchCallback(targetFrame).catch((err) => {
          // Silent catch to prevent lookahead crashes
          console.debug(`[SmartCache] Lookahead prefetch missed for frame #${targetFrame}:`, err);
        });
      }
    }
  }

  public getCacheMetrics(): {
    hitRatio: number;
    hits: number;
    misses: number;
    totalSizeMb: number;
    entriesCount: number;
  } {
    const total = this.hitCount + this.missCount;
    const ratio = total > 0 ? (this.hitCount / total) * 100 : 100;
    
    return {
      hitRatio: Math.round(ratio * 10) / 10,
      hits: this.hitCount,
      misses: this.missCount,
      totalSizeMb: Math.round((this.currentCacheSizeBytes / (1024 * 1024)) * 10) / 10,
      entriesCount: this.cacheStore.size,
    };
  }

  public clear(): void {
    this.cacheStore.forEach((entry) => {
      this.memoryManager.untrackAssetAllocation(entry.key);
    });
    this.cacheStore.clear();
    this.currentCacheSizeBytes = 0;
    this.hitCount = 0;
    this.missCount = 0;
    console.log("[SmartCache] Frame and Render store successfully cleared.");
  }
}
