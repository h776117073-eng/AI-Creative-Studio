import { AccountTier } from "../users/UserManager";

export interface SubscriptionPlan {
  tier: AccountTier;
  name: string;
  monthlyPriceUsd: number;
  yearlyPriceUsd: number;
  limits: {
    storageGb: number;
    maxRenderResolution: "1080p" | "4K" | "8K" | "unlimited";
    maxGpuSecondsPerMonth: number;
    aiCreditsPerMonth: number;
    maxExportMinutes: number;
    allowCollaboration: boolean;
  };
}

export interface UsageMetrics {
  userId: string;
  storageBytesUsed: number;
  gpuSecondsConsumed: number;
  aiCreditsConsumed: number;
  exportMinutesCount: number;
  bandwidthBytesUsed: number;
}

export class SubscriptionManager {
  private static instance: SubscriptionManager | null = null;
  private plans: Map<AccountTier, SubscriptionPlan> = new Map();
  private userUsage: Map<string, UsageMetrics> = new Map();

  private constructor() {
    this.definePlans();
  }

  public static getInstance(): SubscriptionManager {
    if (!SubscriptionManager.instance) {
      SubscriptionManager.instance = new SubscriptionManager();
    }
    return SubscriptionManager.instance;
  }

  private definePlans(): void {
    this.plans.set("free", {
      tier: "free",
      name: "Starter Free",
      monthlyPriceUsd: 0,
      yearlyPriceUsd: 0,
      limits: {
        storageGb: 5,
        maxRenderResolution: "1080p",
        maxGpuSecondsPerMonth: 600, // 10 minutes free render time
        aiCreditsPerMonth: 100,
        maxExportMinutes: 10,
        allowCollaboration: false,
      },
    });

    this.plans.set("creator", {
      tier: "creator",
      name: "Creator Pro",
      monthlyPriceUsd: 15,
      yearlyPriceUsd: 144,
      limits: {
        storageGb: 100,
        maxRenderResolution: "4K",
        maxGpuSecondsPerMonth: 7200, // 2 hours
        aiCreditsPerMonth: 1500,
        maxExportMinutes: 60,
        allowCollaboration: true,
      },
    });

    this.plans.set("professional", {
      tier: "professional",
      name: "Studio Professional",
      monthlyPriceUsd: 35,
      yearlyPriceUsd: 336,
      limits: {
        storageGb: 500,
        maxRenderResolution: "8K",
        maxGpuSecondsPerMonth: 36000, // 10 hours
        aiCreditsPerMonth: 5000,
        maxExportMinutes: 240,
        allowCollaboration: true,
      },
    });

    this.plans.set("team", {
      tier: "team",
      name: "Enterprise Team",
      monthlyPriceUsd: 79,
      yearlyPriceUsd: 758,
      limits: {
        storageGb: 2048, // 2TB
        maxRenderResolution: "8K",
        maxGpuSecondsPerMonth: 180000, // 50 hours
        aiCreditsPerMonth: 20000,
        maxExportMinutes: 9999,
        allowCollaboration: true,
      },
    });

    this.plans.set("enterprise", {
      tier: "enterprise",
      name: "Custom Enterprise",
      monthlyPriceUsd: 299,
      yearlyPriceUsd: 2870,
      limits: {
        storageGb: 10240, // 10TB
        maxRenderResolution: "unlimited",
        maxGpuSecondsPerMonth: 9999999,
        aiCreditsPerMonth: 999999,
        maxExportMinutes: 999999,
        allowCollaboration: true,
      },
    });
  }

  public getPlan(tier: AccountTier): SubscriptionPlan {
    return this.plans.get(tier) || this.plans.get("free")!;
  }

  public getUsage(userId: string): UsageMetrics {
    let usage = this.userUsage.get(userId);
    if (!usage) {
      usage = {
        userId,
        storageBytesUsed: 0,
        gpuSecondsConsumed: 0,
        aiCreditsConsumed: 0,
        exportMinutesCount: 0,
        bandwidthBytesUsed: 0,
      };
      this.userUsage.set(userId, usage);
    }
    return usage;
  }

  /**
   * Tracks and increments subscription usages in real-time
   */
  public incrementUsage(
    userId: string,
    delta: Partial<Omit<UsageMetrics, "userId">>
  ): UsageMetrics {
    const existing = this.getUsage(userId);
    const updated = {
      userId,
      storageBytesUsed: existing.storageBytesUsed + (delta.storageBytesUsed || 0),
      gpuSecondsConsumed: existing.gpuSecondsConsumed + (delta.gpuSecondsConsumed || 0),
      aiCreditsConsumed: existing.aiCreditsConsumed + (delta.aiCreditsConsumed || 0),
      exportMinutesCount: existing.exportMinutesCount + (delta.exportMinutesCount || 0),
      bandwidthBytesUsed: existing.bandwidthBytesUsed + (delta.bandwidthBytesUsed || 0),
    };

    this.userUsage.set(userId, updated);
    return updated;
  }

  /**
   * Safe guard evaluating whether active subscriptions permit higher quality renders or storage allocations
   */
  public checkLimitPermitted(
    userId: string,
    tier: AccountTier,
    type: "storage" | "resolution" | "gpu" | "ai" | "export",
    requestedValue: any
  ): { permitted: boolean; reason?: string } {
    const plan = this.getPlan(tier);
    const usage = this.getUsage(userId);

    if (type === "storage") {
      const currentGb = usage.storageBytesUsed / (1024 * 1024 * 1024);
      const requestedGb = requestedValue / (1024 * 1024 * 1024);
      if (currentGb + requestedGb > plan.limits.storageGb) {
        return {
          permitted: false,
          reason: `Storage capacity exceeded. Plan limit: ${plan.limits.storageGb} GB. Current: ${currentGb.toFixed(2)} GB.`,
        };
      }
    }

    if (type === "gpu") {
      if (usage.gpuSecondsConsumed + requestedValue > plan.limits.maxGpuSecondsPerMonth) {
        return {
          permitted: false,
          reason: `Monthly GPU allocation limit reached. Upgrade to unlock supplementary high speed GPU hours.`,
        };
      }
    }

    if (type === "ai") {
      if (usage.aiCreditsConsumed + requestedValue > plan.limits.aiCreditsPerMonth) {
        return {
          permitted: false,
          reason: `AI tokens generation credits depleted (${usage.aiCreditsConsumed}/${plan.limits.aiCreditsPerMonth}).`,
        };
      }
    }

    if (type === "resolution") {
      const resolutions = { "1080p": 1, "4K": 2, "8K": 3, "unlimited": 4 };
      const planResWeight = resolutions[plan.limits.maxRenderResolution] || 1;
      const reqResWeight = resolutions[requestedValue as "1080p" | "4K" | "8K"] || 1;

      if (reqResWeight > planResWeight) {
        return {
          permitted: false,
          reason: `Your current tier limits renders to ${plan.limits.maxRenderResolution}. Upgrade to Creator or Studio to export up to 4K/8K footage.`,
        };
      }
    }

    return { permitted: true };
  }

  public clearAllUsage(): void {
    this.userUsage.clear();
  }
}
