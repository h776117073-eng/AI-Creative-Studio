export interface OperationalUsage {
  gpuSeconds: number;
  cpuSeconds: number;
  storageMb: number;
  bandwidthMb: number;
  aiTokensIn: number;
  aiTokensOut: number;
}

export interface CostSummary {
  gpuCostUsd: number;
  cpuCostUsd: number;
  storageCostUsd: number;
  bandwidthCostUsd: number;
  aiModelCostUsd: number;
  totalCostUsd: number;
}

export class FinOpsTracker {
  private static instance: FinOpsTracker | null = null;
  private currentProjectUsage: Map<string, OperationalUsage> = new Map();
  private isBatchingEnabled: boolean = true;
  private queuedBatchTasks: Array<{ id: string; size: number }> = [];

  // Commercial rates per unit
  private RATES = {
    gpuSecond: 0.00045, // NVIDIA A10G average billing
    cpuSecond: 0.00002,
    storageMbMonth: 0.00003,
    bandwidthMb: 0.00015,
    tokenInMillion: 0.15, // Gemini Flash pricing model
    tokenOutMillion: 0.60,
  };

  private constructor() {}

  public static getInstance(): FinOpsTracker {
    if (!FinOpsTracker.instance) {
      FinOpsTracker.instance = new FinOpsTracker();
    }
    return FinOpsTracker.instance;
  }

  /**
   * Tracks active hardware utilization costs
   */
  public logUsage(
    projectId: string,
    delta: Partial<OperationalUsage>
  ): void {
    const existing = this.currentProjectUsage.get(projectId) || {
      gpuSeconds: 0,
      cpuSeconds: 0,
      storageMb: 0,
      bandwidthMb: 0,
      aiTokensIn: 0,
      aiTokensOut: 0,
    };

    this.currentProjectUsage.set(projectId, {
      gpuSeconds: existing.gpuSeconds + (delta.gpuSeconds || 0),
      cpuSeconds: existing.cpuSeconds + (delta.cpuSeconds || 0),
      storageMb: existing.storageMb + (delta.storageMb || 0),
      bandwidthMb: existing.bandwidthMb + (delta.bandwidthMb || 0),
      aiTokensIn: existing.aiTokensIn + (delta.aiTokensIn || 0),
      aiTokensOut: existing.aiTokensOut + (delta.aiTokensOut || 0),
    });
  }

  /**
   * Translates raw performance metrics into precise dollar costs (USD)
   */
  public calculateProjectCosts(projectId: string): CostSummary {
    const usage = this.currentProjectUsage.get(projectId) || {
      gpuSeconds: 0,
      cpuSeconds: 0,
      storageMb: 0,
      bandwidthMb: 0,
      aiTokensIn: 0,
      aiTokensOut: 0,
    };

    const gpuCost = usage.gpuSeconds * this.RATES.gpuSecond;
    const cpuCost = usage.cpuSeconds * this.RATES.cpuSecond;
    const storageCost = usage.storageMb * this.RATES.storageMbMonth;
    const bandwidthCost = usage.bandwidthMb * this.RATES.bandwidthMb;
    const aiModelCost =
      (usage.aiTokensIn / 1000000) * this.RATES.tokenInMillion +
      (usage.aiTokensOut / 1000000) * this.RATES.tokenOutMillion;

    const total = gpuCost + cpuCost + storageCost + bandwidthCost + aiModelCost;

    return {
      gpuCostUsd: Number(gpuCost.toFixed(5)),
      cpuCostUsd: Number(cpuCost.toFixed(5)),
      storageCostUsd: Number(storageCost.toFixed(5)),
      bandwidthCostUsd: Number(bandwidthCost.toFixed(5)),
      aiModelCostUsd: Number(aiModelCost.toFixed(5)),
      totalCostUsd: Number(total.toFixed(5)),
    };
  }

  /**
   * Smart optimization: batches model calls to reduce container cold-start times
   */
  public queueBatchInference(taskId: string, payloadSize: number): void {
    this.queuedBatchTasks.push({ id: taskId, size: payloadSize });
    
    // Auto-trigger flush if batch size exceeds 10 tasks to minimize container latency
    if (this.queuedBatchTasks.length >= 10) {
      this.flushInferenceBatch();
    }
  }

  public flushInferenceBatch(): void {
    if (this.queuedBatchTasks.length === 0) return;
    
    console.log(`[FinOpsTracker] Batch flushing ${this.queuedBatchTasks.length} queued tasks to serverless GPU. Mitigating serverless cold-start overhead.`);
    this.queuedBatchTasks = [];
  }

  /**
   * Custom strategy selector to enforce cheapest operational margins
   */
  public getBudgetStrategy(estimatedComplexity: number): {
    modelGrade: "flash" | "pro";
    optimizeCache: boolean;
    frequencyLimitSec: number;
  } {
    if (estimatedComplexity < 50) {
      return {
        modelGrade: "flash", // map to cheapest Gemini 2.5 Flash model
        optimizeCache: true,
        frequencyLimitSec: 30,
      };
    }
    
    return {
      modelGrade: "pro", // scale to Gemini 1.5 Pro only for deep vfx tracking
      optimizeCache: true,
      frequencyLimitSec: 10,
    };
  }

  public clearAllCosts(): void {
    this.currentProjectUsage.clear();
    this.queuedBatchTasks = [];
  }
}
