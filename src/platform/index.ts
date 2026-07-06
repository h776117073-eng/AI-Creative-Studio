import { DeviceCapabilities } from "./device/DeviceCapabilities";
import { EdgeAIEngine } from "./edge-ai/EdgeAIEngine";
import { CloudAIBridge } from "./cloud-ai/CloudAIBridge";
import { AIRouter } from "./edge-ai/AIRouter";
import { FinOpsTracker } from "./finops/FinOpsTracker";
import { TemplateEngine } from "./templates/TemplateEngine";
import { SecurityVault } from "./security/SecurityVault";
import { PrivacyManager } from "./privacy/PrivacyManager";
import { ProfessionalExporter } from "./export/ProfessionalExporter";

export {
  DeviceCapabilities,
  EdgeAIEngine,
  CloudAIBridge,
  AIRouter,
  FinOpsTracker,
  TemplateEngine,
  SecurityVault,
  PrivacyManager,
  ProfessionalExporter,
};

export class CommercialSuite {
  private static isActivated = false;

  public static initialize(): void {
    if (this.isActivated) return;

    console.log("💎 [CommercialSuite] Activating Commercial AI Platform Foundations...");

    // Bootstraps singletons in structural initialization order
    DeviceCapabilities.getInstance();
    EdgeAIEngine.getInstance();
    CloudAIBridge.getInstance();
    AIRouter.getInstance();
    FinOpsTracker.getInstance();
    TemplateEngine.getInstance();
    SecurityVault.getInstance();
    PrivacyManager.getInstance();
    ProfessionalExporter.getInstance();

    this.isActivated = true;
    console.log("💎 [CommercialSuite] Commercial-ready architectures successfully online (Edge AI, FinOps, Privacy, Professional LOG workflows, and Smart Templates active).");
  }

  public static shutdown(): void {
    if (!this.isActivated) return;

    console.log("[CommercialSuite] Powering down commercial pipelines...");
    EdgeAIEngine.getInstance().unloadAllModels();
    CloudAIBridge.getInstance().clearHistory();
    FinOpsTracker.getInstance().clearAllCosts();

    this.isActivated = false;
  }
}
