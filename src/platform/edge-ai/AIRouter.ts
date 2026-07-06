import { DeviceCapabilities, DeviceSpecs } from "../device/DeviceCapabilities";

export type AIRoutingDecision = "LOCAL_EDGE" | "CLOUD_SERVERLESS" | "HYBRID_PIPELINE";

export interface RoutingParameters {
  taskComplexity: "low" | "medium" | "high" | "extreme";
  privacyLevel: "standard" | "private_no_upload" | "enterprise_strict";
  allowCellularBilling: boolean;
  maxCostBudgetUsd?: number;
}

export interface RouterExplanation {
  decision: AIRoutingDecision;
  reason: string;
  latencyEstimateSec: number;
  costEstimateUsd: number;
}

export class AIRouter {
  private static instance: AIRouter | null = null;
  private deviceDetector: DeviceCapabilities;

  private constructor() {
    this.deviceDetector = DeviceCapabilities.getInstance();
  }

  public static getInstance(): AIRouter {
    if (!AIRouter.instance) {
      AIRouter.instance = new AIRouter();
    }
    return AIRouter.instance;
  }

  /**
   * Evaluates hardware and parameters to formulate the optimal execution vector.
   */
  public makeDecision(taskType: string, params: RoutingParameters): RouterExplanation {
    const specs = this.deviceDetector.getSpecs();
    
    // Rule 1: Strict local privacy constraint
    if (params.privacyLevel === "enterprise_strict" || params.privacyLevel === "private_no_upload") {
      return {
        decision: "LOCAL_EDGE",
        reason: "Forced Local Edge routing due to user privacy configurations (No Cloud Upload permitted).",
        latencyEstimateSec: params.taskComplexity === "extreme" ? 18.0 : 4.5,
        costEstimateUsd: 0.0,
      };
    }

    // Rule 2: Low-battery / Low-power conservation mode
    if (specs.batteryLevel < 0.22 && !specs.isBatteryCharging) {
      // Direct high-complexity tasks to Cloud to save local device batteries if network allows
      if (specs.networkType !== "cellular" || params.allowCellularBilling) {
        return {
          decision: "CLOUD_SERVERLESS",
          reason: "Diverted computation to Serverless GPU nodes to prevent thermal/battery depletion on local device (battery is critical: " + Math.round(specs.batteryLevel * 100) + "%).",
          latencyEstimateSec: 3.5,
          costEstimateUsd: 0.08,
        };
      }
    }

    // Rule 3: Network bottlenecks
    if (specs.networkType === "cellular" && !params.allowCellularBilling) {
      return {
        decision: "LOCAL_EDGE",
        reason: "Routed locally to avoid cellular billing or high-bandwidth data consumption.",
        latencyEstimateSec: params.taskComplexity === "high" ? 12.0 : 3.0,
        costEstimateUsd: 0.0,
      };
    }

    // Rule 4: Extreme complexity (e.g. heavy 3D scene reconstruction or full 4K timelines VFX baking)
    if (params.taskComplexity === "extreme") {
      return {
        decision: "CLOUD_SERVERLESS",
        reason: "Sufficient bandwidth detected. Task contains excessive parameters, requiring high-vram cloud GPU infrastructure.",
        latencyEstimateSec: 5.0,
        costEstimateUsd: 0.20,
      };
    }

    // Rule 5: Mid-tier hybrid partitioning (e.g. speech-to-text does local frame extraction, cloud processes transcription)
    if (params.taskComplexity === "high" && specs.estimatedMemoryGb >= 6 && specs.networkDownlinkMb > 20) {
      return {
        decision: "HYBRID_PIPELINE",
        reason: "Balanced configuration: Local client extracts metadata, while cloud clusters execute heavy parallel rendering pipeline.",
        latencyEstimateSec: 2.2,
        costEstimateUsd: 0.06,
      };
    }

    // Rule 6: Default fallback for low complexity
    return {
      decision: "LOCAL_EDGE",
      reason: "Local resources are fully capable. Zero external latency or transaction fees.",
      latencyEstimateSec: 1.2,
      costEstimateUsd: 0.0,
    };
  }
}
