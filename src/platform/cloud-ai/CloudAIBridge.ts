export interface CloudAIJob {
  id: string;
  type: "4K_RENDER" | "SCENE_DEPTH_AI" | "TEXT_TO_VIDEO" | "AUTO_SUBTITLES";
  status: "queued" | "processing" | "completed" | "failed";
  progressPercent: number;
  priority: "standard" | "premium" | "enterprise";
  gpuAllocationType: "NVIDIA_T4" | "NVIDIA_A10G" | "NVIDIA_H100";
  estimatedTimeSec: number;
  costEstimateUsd: number;
  errorMessage?: string;
  resultUrl?: string;
}

export class CloudAIBridge {
  private static instance: CloudAIBridge | null = null;
  private activeJobs: Map<string, CloudAIJob> = new Map();
  private maxActiveJobs = 5;
  private autoScalingInstancesCount = 1;

  private constructor() {
    this.startProgressSimulationLoop();
  }

  public static getInstance(): CloudAIBridge {
    if (!CloudAIBridge.instance) {
      CloudAIBridge.instance = new CloudAIBridge();
    }
    return CloudAIBridge.instance;
  }

  private startProgressSimulationLoop(): void {
    if (typeof window !== "undefined") {
      setInterval(() => {
        this.activeJobs.forEach((job, id) => {
          if (job.status === "queued") {
            job.status = "processing";
            this.activeJobs.set(id, job);
          } else if (job.status === "processing") {
            const step = 100 / (job.estimatedTimeSec || 10);
            job.progressPercent = Math.min(100, job.progressPercent + step);
            
            if (job.progressPercent >= 100) {
              job.status = "completed";
              job.resultUrl = `https://storage.googleapis.com/render-cloud-outputs/out_${job.id}.mp4`;
            }
            this.activeJobs.set(id, job);
          }
        });
      }, 1000);
    }
  }

  /**
   * Dispatches a complex ML task to Cloud GPU runners
   */
  public async submitCloudJob(
    type: CloudAIJob["type"],
    priority: CloudAIJob["priority"] = "standard",
    payloadSizeMb = 15
  ): Promise<CloudAIJob> {
    const jobId = `cloud_job_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    
    // Choose serverless GPU tier depending on user privilege priority
    let gpuAllocationType: CloudAIJob["gpuAllocationType"] = "NVIDIA_T4";
    let estimatedTimeSec = 15;
    let costEstimateUsd = 0.05;

    if (priority === "enterprise") {
      gpuAllocationType = "NVIDIA_H100";
      estimatedTimeSec = 4;
      costEstimateUsd = 0.25;
    } else if (priority === "premium" || payloadSizeMb > 150) {
      gpuAllocationType = "NVIDIA_A10G";
      estimatedTimeSec = 8;
      costEstimateUsd = 0.12;
    }

    // Dynamic cost scaling based on task types
    if (type === "4K_RENDER") {
      costEstimateUsd *= 3.5;
      estimatedTimeSec *= 2.5;
    }

    const job: CloudAIJob = {
      id: jobId,
      type,
      status: "queued",
      progressPercent: 0,
      priority,
      gpuAllocationType,
      estimatedTimeSec,
      costEstimateUsd,
    };

    this.activeJobs.set(jobId, job);
    this.adjustScalingTiers();

    return job;
  }

  private adjustScalingTiers(): void {
    const processingJobs = Array.from(this.activeJobs.values()).filter(j => j.status === "processing").length;
    // Autoscale worker containers dynamically: 1 container per 3 concurrent processing jobs
    this.autoScalingInstancesCount = Math.max(1, Math.min(10, Math.ceil(processingJobs / 3)));
  }

  public getJob(jobId: string): CloudAIJob | null {
    return this.activeJobs.get(jobId) || null;
  }

  public getActiveJobs(): CloudAIJob[] {
    return Array.from(this.activeJobs.values());
  }

  public cancelJob(jobId: string): boolean {
    const job = this.activeJobs.get(jobId);
    if (job && (job.status === "queued" || job.status === "processing")) {
      job.status = "failed";
      job.errorMessage = "Job canceled by user.";
      this.activeJobs.set(jobId, job);
      return true;
    }
    return false;
  }

  public getScalingTelemetry(): { activeWorkers: number; queuedJobs: number; avgLatencySec: number } {
    const queued = Array.from(this.activeJobs.values()).filter(j => j.status === "queued").length;
    return {
      activeWorkers: this.autoScalingInstancesCount,
      queuedJobs: queued,
      avgLatencySec: 6.5,
    };
  }

  public clearHistory(): void {
    this.activeJobs.clear();
    this.autoScalingInstancesCount = 1;
  }
}
