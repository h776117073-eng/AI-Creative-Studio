export type AssetType = "video" | "image" | "audio" | "font" | "preset" | "3D";

export interface SaaSAsset {
  id: string;
  projectId: string;
  name: string;
  type: AssetType;
  fileSizeBytes: number;
  url: string;
  durationSec?: number;
  uploadedAt: string;
  isSynced: boolean;
}

export interface SaaSProject {
  id: string;
  teamId?: string;
  ownerId: string;
  title: string;
  durationSec: number;
  aspectRatio: "16:9" | "9:16" | "1:1";
  lastSavedAt: string;
  createdAt: string;
  cloudStorageMb: number;
  isArchived: boolean;
}

export class CloudProjectSystem {
  private static instance: CloudProjectSystem | null = null;
  private projects: Map<string, SaaSProject> = new Map();
  private projectAssets: Map<string, SaaSAsset[]> = new Map(); // Key is projectId
  private projectBackupCache: Map<string, Array<{ timestamp: number; payload: string }>> = new Map();

  private constructor() {
    this.seedDemoProjects();
  }

  public static getInstance(): CloudProjectSystem {
    if (!CloudProjectSystem.instance) {
      CloudProjectSystem.instance = new CloudProjectSystem();
    }
    return CloudProjectSystem.instance;
  }

  private seedDemoProjects(): void {
    const demoProject: SaaSProject = {
      id: "proj_nebula_ad_01",
      teamId: "team_demo_202",
      ownerId: "usr_demo_101",
      title: "Nebula Cyberpunk Promo 2026",
      durationSec: 15.0,
      aspectRatio: "9:16",
      lastSavedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      cloudStorageMb: 245.8,
      isArchived: false,
    };

    const assets: SaaSAsset[] = [
      { id: "ast_clip_1", projectId: "proj_nebula_ad_01", name: "neon_streaks_vertical.mp4", type: "video", fileSizeBytes: 125 * 1024 * 1024, url: "https://creative-studio-assets/clip1.mp4", durationSec: 15.0, uploadedAt: new Date().toISOString(), isSynced: true },
      { id: "ast_audio_1", projectId: "proj_nebula_ad_01", name: "synthwave_beat_120bpm.wav", type: "audio", fileSizeBytes: 45 * 1024 * 1024, url: "https://creative-studio-assets/synth.wav", durationSec: 30.0, uploadedAt: new Date().toISOString(), isSynced: true },
      { id: "ast_font_1", projectId: "proj_nebula_ad_01", name: "SpaceGrotesk-Bold.ttf", type: "font", fileSizeBytes: 1.2 * 1024 * 1024, url: "https://creative-studio-assets/space.ttf", uploadedAt: new Date().toISOString(), isSynced: true },
    ];

    this.projects.set(demoProject.id, demoProject);
    this.projectAssets.set(demoProject.id, assets);
  }

  public createProject(title: string, ownerId: string, aspectRatio: SaaSProject["aspectRatio"], teamId?: string): SaaSProject {
    const projectId = `proj_${Date.now()}`;
    const newProject: SaaSProject = {
      id: projectId,
      teamId,
      ownerId,
      title,
      durationSec: 10.0,
      aspectRatio,
      lastSavedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      cloudStorageMb: 0.0,
      isArchived: false,
    };

    this.projects.set(projectId, newProject);
    this.projectAssets.set(projectId, []);
    return newProject;
  }

  public getProject(projectId: string): SaaSProject | null {
    return this.projects.get(projectId) || null;
  }

  public getProjects(ownerId: string, teamId?: string): SaaSProject[] {
    return Array.from(this.projects.values()).filter(p => {
      if (teamId && p.teamId === teamId) return true;
      return p.ownerId === ownerId && !p.isArchived;
    });
  }

  /**
   * Save-point state captures for safety and offline-rollback recovery
   */
  public saveProjectStateSnapshot(projectId: string, serializedTimelineState: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    project.lastSavedAt = new Date().toISOString();
    this.projects.set(projectId, project);

    const backups = this.projectBackupCache.get(projectId) || [];
    backups.push({
      timestamp: Date.now(),
      payload: serializedTimelineState,
    });

    // Constrain backup revisions lists to the most recent 12 states to save space
    if (backups.length > 12) {
      backups.shift();
    }

    this.projectBackupCache.set(projectId, backups);
  }

  public getBackupVersions(projectId: string): Array<{ timestamp: number; payload: string }> {
    return this.projectBackupCache.get(projectId) || [];
  }

  /**
   * Register high-bit depth media assets inside active project cloud maps
   */
  public registerAsset(
    projectId: string,
    name: string,
    type: AssetType,
    sizeBytes: number,
    url: string,
    durationSec?: number
  ): SaaSAsset {
    const assets = this.projectAssets.get(projectId) || [];
    const asset: SaaSAsset = {
      id: `ast_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      projectId,
      name,
      type,
      fileSizeBytes: sizeBytes,
      url,
      durationSec,
      uploadedAt: new Date().toISOString(),
      isSynced: true,
    };

    assets.push(asset);
    this.projectAssets.set(projectId, assets);

    // Increment overall project storage usage stats
    const project = this.projects.get(projectId);
    if (project) {
      project.cloudStorageMb = Number((project.cloudStorageMb + sizeBytes / (1024 * 1024)).toFixed(2));
      this.projects.set(projectId, project);
    }

    return asset;
  }

  public deleteAsset(projectId: string, assetId: string): boolean {
    const assets = this.projectAssets.get(projectId) || [];
    const index = assets.findIndex(a => a.id === assetId);
    if (index > -1) {
      const deletedSize = assets[index].fileSizeBytes;
      assets.splice(index, 1);
      this.projectAssets.set(projectId, assets);

      const project = this.projects.get(projectId);
      if (project) {
        project.cloudStorageMb = Math.max(0, Number((project.cloudStorageMb - deletedSize / (1024 * 1024)).toFixed(2)));
        this.projects.set(projectId, project);
      }
      return true;
    }
    return false;
  }

  public getAssets(projectId: string): SaaSAsset[] {
    return this.projectAssets.get(projectId) || [];
  }

  public clearAll(): void {
    this.projects.clear();
    this.projectAssets.clear();
    this.projectBackupCache.clear();
  }
}
