export interface WorkerTask<T = any> {
  id: string;
  type: string;
  payload: any;
  priority: "low" | "medium" | "high";
  resolve: (value: T) => void;
  reject: (reason: any) => void;
}

export class WorkerPool {
  private static instance: WorkerPool | null = null;
  private maxWorkers: number = 4;
  private workers: Worker[] = [];
  private idleWorkers: Worker[] = [];
  private taskQueue: WorkerTask[] = [];
  private activeTasks: Map<Worker, WorkerTask> = new Map();
  private workerBlobUrl: string | null = null;

  private constructor() {
    if (typeof navigator !== "undefined") {
      this.maxWorkers = Math.max(2, Math.min(8, navigator.hardwareConcurrency || 4));
    }
    this.initializeWorkerBlob();
    this.provisionWorkers();
  }

  public static getInstance(): WorkerPool {
    if (!WorkerPool.instance) {
      WorkerPool.instance = new WorkerPool();
    }
    return WorkerPool.instance;
  }

  /**
   * Constructs the inline Web Worker source code as a dynamic compiled string.
   * This is full production-grade code running inside a sandboxed Web Worker.
   */
  private initializeWorkerBlob(): void {
    if (typeof window === "undefined" || typeof Blob === "undefined" || typeof URL === "undefined") {
      return;
    }

    const workerCode = `
      self.onmessage = function(e) {
        const { taskId, type, payload } = e.data;
        
        try {
          let result;
          if (type === "COLOR_GRADE") {
            result = applyColorGrade(payload.pixels, payload.brightness, payload.contrast, payload.saturation);
          } else if (type === "PIXEL_CONVOLVE") {
            result = applyConvolveFilter(payload.pixels, payload.width, payload.height, payload.kernel);
          } else {
            // General calculation fallback
            result = payload;
          }
          
          self.postMessage({ taskId, success: true, result }, [result.buffer].filter(Boolean));
        } catch (err) {
          self.postMessage({ taskId, success: false, error: err.message });
        }
      };

      function applyColorGrade(pixels, brightness, contrast, saturation) {
        // High-performance direct linear manipulation of Uint8ClampedArray
        const len = pixels.length;
        const out = new Uint8ClampedArray(len);
        
        // Pre-compute lookup variables
        const b = (brightness || 0) * 255;
        const c = contrast !== undefined ? contrast : 1.0;
        const s = saturation !== undefined ? saturation : 1.0;
        
        for (let i = 0; i < len; i += 4) {
          let r = pixels[i];
          let g = pixels[i+1];
          let b_pixel = pixels[i+2];
          
          // Apply brightness
          r += b;
          g += b;
          b_pixel += b;
          
          // Apply contrast
          r = (r - 128) * c + 128;
          g = (g - 128) * c + 128;
          b_pixel = (b_pixel - 128) * c + 128;
          
          // Apply saturation (Luminance based Rec.709 constants)
          const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b_pixel;
          r = gray + (r - gray) * s;
          g = gray + (g - gray) * s;
          b_pixel = gray + (b_pixel - gray) * s;
          
          // Fast clamps
          out[i] = r < 0 ? 0 : r > 255 ? 255 : r;
          out[i+1] = g < 0 ? 0 : g > 255 ? 255 : g;
          out[i+2] = b_pixel < 0 ? 0 : b_pixel > 255 ? 255 : b_pixel;
          out[i+3] = pixels[i+3]; // Preserve alpha
        }
        return out;
      }

      function applyConvolveFilter(pixels, w, h, kernel) {
        const side = Math.round(Math.sqrt(kernel.length));
        const halfSide = Math.floor(side / 2);
        const out = new Uint8ClampedArray(pixels.length);
        
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const dstIdx = (y * w + x) * 4;
            let rAccum = 0, gAccum = 0, bAccum = 0;
            
            for (let cy = 0; cy < side; cy++) {
              for (let cx = 0; cx < side; cx++) {
                const scy = Math.min(h - 1, Math.max(0, y + cy - halfSide));
                const scx = Math.min(w - 1, Math.max(0, x + cx - halfSide));
                const srcIdx = (scy * w + scx) * 4;
                const wt = kernel[cy * side + cx];
                
                rAccum += pixels[srcIdx] * wt;
                gAccum += pixels[srcIdx + 1] * wt;
                bAccum += pixels[srcIdx + 2] * wt;
              }
            }
            
            out[dstIdx] = rAccum < 0 ? 0 : rAccum > 255 ? 255 : rAccum;
            out[dstIdx+1] = gAccum < 0 ? 0 : gAccum > 255 ? 255 : gAccum;
            out[dstIdx+2] = bAccum < 0 ? 0 : bAccum > 255 ? 255 : bAccum;
            out[dstIdx+3] = pixels[dstIdx+3];
          }
        }
        return out;
      }
    `;

    const blob = new Blob([workerCode], { type: "text/javascript" });
    this.workerBlobUrl = URL.createObjectURL(blob);
  }

  private provisionWorkers(): void {
    if (!this.workerBlobUrl) return;

    for (let i = 0; i < this.maxWorkers; i++) {
      try {
        const worker = new Worker(this.workerBlobUrl);
        worker.onmessage = (e) => this.handleWorkerMessage(worker, e);
        worker.onerror = (err) => this.handleWorkerError(worker, err);
        this.workers.push(worker);
        this.idleWorkers.push(worker);
      } catch (err) {
        console.error(`[WorkerPool] Failed to spawn worker thread #${i}:`, err);
      }
    }
  }

  /**
   * Submits intensive rendering work to the worker pool
   */
  public async submit<T = any>(type: string, payload: any, priority: "low" | "medium" | "high" = "medium"): Promise<T> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    
    // Transferrable support check (if transfering Uint8ClampedArray, pass target buffers)
    const transfers: any[] = [];
    if (payload?.pixels && payload.pixels.buffer) {
      transfers.push(payload.pixels.buffer);
    }

    return new Promise<T>((resolve, reject) => {
      const task: WorkerTask = {
        id: taskId,
        type,
        payload,
        priority,
        resolve,
        reject,
      };

      this.taskQueue.push(task);
      this.sortTaskQueue();
      this.dispatchNext();
    });
  }

  private sortTaskQueue(): void {
    const priorityWeights = { high: 3, medium: 2, low: 1 };
    this.taskQueue.sort((a, b) => priorityWeights[b.priority] - priorityWeights[a.priority]);
  }

  private dispatchNext(): void {
    if (this.taskQueue.length === 0 || this.idleWorkers.length === 0) {
      return;
    }

    const worker = this.idleWorkers.shift()!;
    const task = this.taskQueue.shift()!;
    this.activeTasks.set(worker, task);

    // Dynamic transfers optimization
    const transfers: ArrayBuffer[] = [];
    if (task.payload?.pixels instanceof Uint8ClampedArray) {
      // Create fresh buffer to transfer ownership cleanly
      const buf = new Uint8ClampedArray(task.payload.pixels).buffer;
      task.payload.pixels = new Uint8ClampedArray(buf);
      transfers.push(buf);
    }

    worker.postMessage(
      {
        taskId: task.id,
        type: task.type,
        payload: task.payload,
      },
      transfers
    );
  }

  private handleWorkerMessage(worker: Worker, event: MessageEvent): void {
    const { taskId, success, result, error } = event.data;
    const activeTask = this.activeTasks.get(worker);

    if (activeTask && activeTask.id === taskId) {
      this.activeTasks.delete(worker);
      this.idleWorkers.push(worker);

      if (success) {
        activeTask.resolve(result);
      } else {
        activeTask.reject(new Error(error || "Worker thread computation error"));
      }

      this.dispatchNext();
    }
  }

  private handleWorkerError(worker: Worker, error: ErrorEvent): void {
    console.error("[WorkerPool] Critical thread error inside background worker:", error);
    const activeTask = this.activeTasks.get(worker);
    if (activeTask) {
      activeTask.reject(new Error(error.message || "Background thread crashed"));
      this.activeTasks.delete(worker);
    }

    // Recover worker: terminate old and spin up a replacement
    worker.terminate();
    const idx = this.workers.indexOf(worker);
    if (idx > -1) this.workers.splice(idx, 1);
    
    const idleIdx = this.idleWorkers.indexOf(worker);
    if (idleIdx > -1) this.idleWorkers.splice(idleIdx, 1);

    if (this.workerBlobUrl) {
      const freshWorker = new Worker(this.workerBlobUrl);
      freshWorker.onmessage = (e) => this.handleWorkerMessage(freshWorker, e);
      freshWorker.onerror = (err) => this.handleWorkerError(freshWorker, err);
      this.workers.push(freshWorker);
      this.idleWorkers.push(freshWorker);
    }

    this.dispatchNext();
  }

  /**
   * Terminate all threads during system shutdown or page unload
   */
  public shutdown(): void {
    this.workers.forEach((worker) => worker.terminate());
    this.workers = [];
    this.idleWorkers = [];
    this.activeTasks.clear();
    this.taskQueue = [];
    
    if (this.workerBlobUrl) {
      URL.revokeObjectURL(this.workerBlobUrl);
      this.workerBlobUrl = null;
    }
  }
}
