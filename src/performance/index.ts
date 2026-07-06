import { GPUProfiler } from "./gpu/GPUProfiler";
import { MemoryManager } from "./memory/MemoryManager";
import { WorkerPool } from "./workers/WorkerPool";
import { SmartCache } from "./cache/SmartCache";
import { StreamingMediaEngine } from "./streaming/StreamingMediaEngine";
import { ProfilerSystem } from "./profiling/ProfilerSystem";
import { AIPerformanceOptimizer } from "./optimization/AIPerformanceOptimizer";

export { GPUProfiler, MemoryManager, WorkerPool, SmartCache, StreamingMediaEngine, ProfilerSystem, AIPerformanceOptimizer };

// Define a unified Performance System API
export class CreativePerformanceSuite {
  private static isInitialized = false;

  public static initialize(): void {
    if (this.isInitialized) return;

    console.log("🚀 [CreativePerformanceSuite] Initializing High-Performance Creative Engine System Layers...");
    
    // Initialize singletons in dependency order
    const memory = MemoryManager.getInstance();
    const gpu = GPUProfiler.getInstance();
    const workers = WorkerPool.getInstance();
    const cache = SmartCache.getInstance();
    const streaming = StreamingMediaEngine.getInstance();
    const profiler = ProfilerSystem.getInstance();
    const optimizer = AIPerformanceOptimizer.getInstance();

    this.isInitialized = true;
    console.log("✅ [CreativePerformanceSuite] System Layers active. WebGL context provisioned, background thread workers online.");
  }

  public static shutdown(): void {
    if (!this.isInitialized) return;

    console.log("Shutting down CreativePerformanceSuite...");
    WorkerPool.getInstance().shutdown();
    GPUProfiler.getInstance().disposeContext();
    SmartCache.getInstance().clear();
    StreamingMediaEngine.getInstance().clear();
    MemoryManager.getInstance().purgeAllAllocations();
    
    this.isInitialized = false;
  }
}
