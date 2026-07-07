export interface SessionLog {
  timestamp: string;
  userId: string;
  actionType: "open_project" | "render_timeline" | "vfx_apply" | "export_video" | "marketplace_buy";
  projectId?: string;
  durationSeconds?: number;
}

export interface SaaSUsageStatsReport {
  activeProjectsCount: number;
  totalStorageMegabytes: number;
  accumulatedRenderSeconds: number;
  totalExportsCount: number;
  averageTimelineComplexityLevel: "low" | "medium" | "high" | "cinematic";
  revenueEarnedUsd: number;
}

export class AnalyticsSystem {
  private static instance: AnalyticsSystem | null = null;
  private sessionHistory: SessionLog[] = [];
  private accumulatedRenderSec = 0;
  private exportsCount = 0;

  private constructor() {}

  public static getInstance(): AnalyticsSystem {
    if (!AnalyticsSystem.instance) {
      AnalyticsSystem.instance = new AnalyticsSystem();
    }
    return AnalyticsSystem.instance;
  }

  /**
   * Tracks discrete user interactions on-the-fly
   */
  public logAction(
    userId: string,
    actionType: SessionLog["actionType"],
    projectId?: string,
    duration?: number
  ): void {
    const log: SessionLog = {
      timestamp: new Date().toISOString(),
      userId,
      actionType,
      projectId,
      durationSeconds: duration,
    };

    this.sessionHistory.push(log);

    if (actionType === "render_timeline" && duration) {
      this.accumulatedRenderSec += duration;
    }
    if (actionType === "export_video") {
      this.exportsCount++;
    }

    // Keep memory bounded to last 5000 telemetry entries
    if (this.sessionHistory.length > 5000) {
      this.sessionHistory.shift();
    }
  }

  /**
   * Compiles diagnostic reports for active project workspaces
   */
  public compileSaaSReport(userId: string, activeProjects: any[], storageMb: number, creatorRevenue = 0): SaaSUsageStatsReport {
    // Determine overall timeline complexity based on active audio/video track densities
    let complexity: SaaSUsageStatsReport["averageTimelineComplexityLevel"] = "low";
    if (activeProjects.length > 0) {
      const avgDuration = activeProjects.reduce((acc, p) => acc + (p.durationSec || 0), 0) / activeProjects.length;
      if (avgDuration > 600) {
        complexity = "cinematic";
      } else if (avgDuration > 120) {
        complexity = "high";
      } else if (avgDuration > 30) {
        complexity = "medium";
      }
    }

    return {
      activeProjectsCount: activeProjects.length,
      totalStorageMegabytes: Number(storageMb.toFixed(2)),
      accumulatedRenderSeconds: this.accumulatedRenderSec,
      totalExportsCount: this.exportsCount,
      averageTimelineComplexityLevel: complexity,
      revenueEarnedUsd: creatorRevenue,
    };
  }

  public getRawLogs(): SessionLog[] {
    return [...this.sessionHistory];
  }

  public clear(): void {
    this.sessionHistory = [];
    this.accumulatedRenderSec = 0;
    this.exportsCount = 0;
  }
}
