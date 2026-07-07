import { UserManager } from "./users/UserManager";
import { SubscriptionManager } from "./subscriptions/SubscriptionManager";
import { CollaborationEngine } from "./collaboration/CollaborationEngine";
import { CloudProjectSystem } from "./storage/CloudProjectSystem";
import { MarketplacePlatform } from "./marketplace/MarketplacePlatform";
import { AnalyticsSystem } from "./analytics/AnalyticsSystem";
import { NotificationSystem } from "./notifications/NotificationSystem";

export {
  UserManager,
  SubscriptionManager,
  CollaborationEngine,
  CloudProjectSystem,
  MarketplacePlatform,
  AnalyticsSystem,
  NotificationSystem,
};

export class SaaSSuite {
  private static isActivated = false;

  /**
   * Initializes all SaaS components and activates demo seed pools
   */
  public static initialize(): void {
    if (this.isActivated) return;

    console.log("💼 [SaaSSuite] Activating SaaS Infrastructure layers...");

    // Instantiates singletons sequentially
    UserManager.getInstance();
    SubscriptionManager.getInstance();
    CollaborationEngine.getInstance();
    CloudProjectSystem.getInstance();
    MarketplacePlatform.getInstance();
    AnalyticsSystem.getInstance();
    NotificationSystem.getInstance();

    this.isActivated = true;
    console.log("💼 [SaaSSuite] Creative SaaS platform and Global Creator Economy active. (Free/Creator/Professional multi-tier metering system ready).");
  }

  /**
   * Drops current mock databases from tab memory
   */
  public static shutdown(): void {
    if (!this.isActivated) return;

    console.log("[SaaSSuite] Shutting down and cleaning memory structures...");
    CollaborationEngine.getInstance().clear();
    CloudProjectSystem.getInstance().clearAll();
    MarketplacePlatform.getInstance().clearAll();
    AnalyticsSystem.getInstance().clear();
    NotificationSystem.getInstance().clearAll();

    this.isActivated = false;
  }
}
