export interface CacheEntry<T> { value: T; touched: number; size: number; }

export class LRUCache<K, V> {
  private map = new Map<K, CacheEntry<V>>();
  private totalSize = 0;
  constructor(private readonly maxEntries = 500, private readonly maxSize = Number.POSITIVE_INFINITY) {}

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    entry.touched = Date.now();
    this.map.delete(key); this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V, size = 1): void {
    const existing = this.map.get(key);
    if (existing) this.totalSize -= existing.size;
    this.map.delete(key);
    const entry: CacheEntry<V> = { value, touched: Date.now(), size: Math.max(1, size) };
    this.map.set(key, entry); this.totalSize += entry.size;
    this.evict();
  }

  has(key: K): boolean { return this.map.has(key); }
  delete(key: K): boolean { const e = this.map.get(key); if (!e) return false; this.totalSize -= e.size; return this.map.delete(key); }
  clear(): void { this.map.clear(); this.totalSize = 0; }
  get size(): number { return this.map.size; }
  get bytes(): number { return this.totalSize; }

  private evict(): void {
    while (this.map.size > this.maxEntries || this.totalSize > this.maxSize) {
      const first = this.map.keys().next().value as K | undefined;
      if (first === undefined) break;
      this.delete(first);
    }
  }
}

export type ThumbnailKey = `${string}:${number}:${number}`;
export type WaveformKey = `${string}:${number}:${number}`;

export class ThumbnailCache<T = string> extends LRUCache<ThumbnailKey, T> {
  constructor(maxEntries = 800) { super(maxEntries); }
}

export class WaveformCache<T = Float32Array> extends LRUCache<WaveformKey, T> {
  constructor(maxEntries = 300) { super(maxEntries); }
}

export function thumbnailKey(assetId: string, time: number, width: number): ThumbnailKey {
  return `${assetId}:${Math.round(time * 1000)}:${Math.round(width)}`;
}

export function waveformKey(assetId: string, start: number, end: number): WaveformKey {
  return `${assetId}:${Math.round(start * 1000)}:${Math.round(end * 1000)}`;
}
