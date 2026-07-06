export interface DeviceSpecs {
  cpuCores: number;
  estimatedMemoryGb: number;
  gpuRenderer: string;
  gpuVendor: string;
  hasWebGPU: boolean;
  hasWebGL2: boolean;
  networkType: "wifi" | "cellular" | "ethernet" | "unknown";
  networkDownlinkMb: number;
  batteryLevel: number;
  isBatteryCharging: boolean;
  isThermalThrottled: boolean;
}

export class DeviceCapabilities {
  private static instance: DeviceCapabilities | null = null;
  private specs: DeviceSpecs | null = null;

  private constructor() {
    this.detectHardware();
  }

  public static getInstance(): DeviceCapabilities {
    if (!DeviceCapabilities.instance) {
      DeviceCapabilities.instance = new DeviceCapabilities();
    }
    return DeviceCapabilities.instance;
  }

  private detectHardware(): void {
    let cpuCores = 4;
    let estimatedMemoryGb = 8;
    let gpuRenderer = "Unknown GPU";
    let gpuVendor = "Unknown Vendor";
    let hasWebGPU = false;
    let hasWebGL2 = false;
    let networkType: DeviceSpecs["networkType"] = "unknown";
    let networkDownlinkMb = 10;
    let batteryLevel = 1.0;
    let isBatteryCharging = true;

    // Detect CPU Cores
    if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
      cpuCores = navigator.hardwareConcurrency;
    }

    // Detect Device Memory (Chrome-only, safe fallback elsewhere)
    const nav = typeof navigator !== "undefined" ? (navigator as any) : null;
    if (nav && nav.deviceMemory) {
      estimatedMemoryGb = nav.deviceMemory;
    }

    // Detect GPU vendor and renderer using WebGL unmasked extensions
    if (typeof document !== "undefined") {
      try {
        const canvas = document.createElement("canvas");
        const gl = (canvas.getContext("webgl2") || canvas.getContext("webgl")) as WebGLRenderingContext | null;
        if (gl) {
          hasWebGL2 = canvas.getContext("webgl2") !== null;
          const ext = gl.getExtension("WEBGL_debug_renderer_info");
          if (ext) {
            gpuRenderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || gpuRenderer;
            gpuVendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) || gpuVendor;
          }
        }
      } catch (e) {
        console.warn("[DeviceCapabilities] GPU hardware info lookup failed:", e);
      }
    }

    // Check WebGPU availability
    if (nav && nav.gpu) {
      hasWebGPU = true;
    }

    // Detect Network Profile
    if (nav && nav.connection) {
      const conn = nav.connection;
      networkDownlinkMb = conn.downlink || networkDownlinkMb;
      const type = conn.type || conn.effectiveType || "";
      if (type.includes("wifi")) networkType = "wifi";
      else if (type.includes("cellular") || type.includes("2g") || type.includes("3g") || type.includes("4g")) networkType = "cellular";
      else if (type.includes("ethernet")) networkType = "ethernet";
    }

    this.specs = {
      cpuCores,
      estimatedMemoryGb,
      gpuRenderer,
      gpuVendor,
      hasWebGPU,
      hasWebGL2,
      networkType,
      networkDownlinkMb,
      batteryLevel,
      isBatteryCharging,
      isThermalThrottled: false, // Updated dynamically via performance sampling
    };

    this.bindBatteryAPI();
  }

  private async bindBatteryAPI(): Promise<void> {
    const nav = typeof navigator !== "undefined" ? (navigator as any) : null;
    if (nav && nav.getBattery && this.specs) {
      try {
        const battery = await nav.getBattery();
        this.specs.batteryLevel = battery.level;
        this.specs.isBatteryCharging = battery.charging;

        battery.addEventListener("levelchange", () => {
          if (this.specs) this.specs.batteryLevel = battery.level;
        });

        battery.addEventListener("chargingchange", () => {
          if (this.specs) this.specs.isBatteryCharging = battery.charging;
        });
      } catch (e) {
        console.debug("[DeviceCapabilities] Battery API is not available on this platform.");
      }
    }
  }

  /**
   * Evaluates thermal metrics based on recent CPU response latency.
   */
  public evaluateThermalState(recentLatencyMs: number): void {
    if (!this.specs) return;
    // If render frames consistently take longer than 45ms, trigger throttle warnings
    this.specs.isThermalThrottled = recentLatencyMs > 45.0;
  }

  public getSpecs(): DeviceSpecs {
    if (!this.specs) {
      this.detectHardware();
    }
    return this.specs!;
  }
}
