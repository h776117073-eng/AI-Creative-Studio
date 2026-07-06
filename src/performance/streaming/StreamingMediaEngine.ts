export interface StreamSource {
  id: string;
  originalUrl: string;
  proxyUrl?: string;
  fileSize: number;
  mimeType: string;
}

export class StreamingMediaEngine {
  private static instance: StreamingMediaEngine | null = null;
  private activeStreams: Map<string, StreamSource> = new Map();
  private bufferedRanges: Map<string, Array<{ start: number; end: number }>> = new Map();
  private isUsingProxies: boolean = false;

  private constructor() {}

  public static getInstance(): StreamingMediaEngine {
    if (!StreamingMediaEngine.instance) {
      StreamingMediaEngine.instance = new StreamingMediaEngine();
    }
    return StreamingMediaEngine.instance;
  }

  public registerMediaSource(source: StreamSource): void {
    this.activeStreams.set(source.id, source);
    this.bufferedRanges.set(source.id, []);
  }

  /**
   * Sets whether the entire rendering timeline should swap to proxy files (for fast preview)
   */
  public setProxyMode(enabled: boolean): void {
    this.isUsingProxies = enabled;
    console.log(`[StreamingMediaEngine] Global Proxy Mode switched to: ${enabled ? "LOW-LATENCY PROXY" : "ORIGINAL FOOTAGE"}`);
  }

  public getProxyMode(): boolean {
    return this.isUsingProxies;
  }

  /**
   * Selects the proper active stream URL (either high-quality source or low-latency proxy)
   */
  public getActiveMediaUrl(sourceId: string): string | null {
    const stream = this.activeStreams.get(sourceId);
    if (!stream) return null;

    if (this.isUsingProxies && stream.proxyUrl) {
      return stream.proxyUrl;
    }
    return stream.originalUrl;
  }

  /**
   * Performs progressive chunked downloads via HTTP range requests
   */
  public async loadMediaChunk(
    sourceId: string,
    startByte: number,
    endByte: number
  ): Promise<ArrayBuffer | null> {
    const stream = this.activeStreams.get(sourceId);
    if (!stream) return null;

    const url = this.getActiveMediaUrl(sourceId);
    if (!url) return null;

    // Fast memory short-circuit if running on local ObjectURLs
    if (url.startsWith("blob:") || url.startsWith("data:")) {
      try {
        const res = await fetch(url);
        const fullBuf = await res.arrayBuffer();
        return fullBuf.slice(startByte, Math.min(fullBuf.byteLength, endByte));
      } catch (err) {
        console.warn(`[StreamingMediaEngine] ObjectURL fast-slice failed:`, err);
        return null;
      }
    }

    try {
      const response = await fetch(url, {
        headers: {
          Range: `bytes=${startByte}-${endByte}`,
        },
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP Range Request returned status code ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      
      // Save buffered ranges metrics
      const ranges = this.bufferedRanges.get(sourceId) || [];
      ranges.push({ start: startByte, end: startByte + buffer.byteLength });
      this.bufferedRanges.set(sourceId, ranges);

      return buffer;
    } catch (err) {
      console.error(`[StreamingMediaEngine] Failed to fetch progressive chunk range [${startByte}-${endByte}] for source ${sourceId}:`, err);
      return null;
    }
  }

  /**
   * Evaluates the percentage of file buffered in memory
   */
  public getBufferPercentage(sourceId: string): number {
    const stream = this.activeStreams.get(sourceId);
    if (!stream || stream.fileSize <= 0) return 0;

    const ranges = this.bufferedRanges.get(sourceId) || [];
    if (ranges.length === 0) return 0;

    // Calculate sum of non-overlapping loaded byte bounds
    let totalBytesLoaded = 0;
    const sortedRanges = [...ranges].sort((a, b) => a.start - b.start);

    let currentRange = sortedRanges[0];
    for (let i = 1; i < sortedRanges.length; i++) {
      const next = sortedRanges[i];
      if (next.start <= currentRange.end) {
        currentRange.end = Math.max(currentRange.end, next.end);
      } else {
        totalBytesLoaded += currentRange.end - currentRange.start;
        currentRange = next;
      }
    }
    totalBytesLoaded += currentRange.end - currentRange.start;

    return Math.min(100, Math.round((totalBytesLoaded / stream.fileSize) * 100));
  }

  public clear(): void {
    this.activeStreams.clear();
    this.bufferedRanges.clear();
  }
}
