import {
  BaseEngine,
  EngineConfigSchema,
  ProjectId,
  ProjectGraph,
  NodeId,
  EventBus,
  globalEventBus,
  EventEmitter,
  Resolution,
  FrameRate,
} from '@ai-creative-studio/core';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const ProjectEngineConfigSchema = EngineConfigSchema.extend({
  autoSaveInterval: z.number().optional().default(30000),
  maxBackups: z.number().optional().default(10),
  cloudSync: z.boolean().optional().default(false),
});

type ProjectEngineConfig = z.infer<typeof ProjectEngineConfigSchema>;

export type ProjectType =
  | 'video'
  | 'design'
  | 'motion'
  | 'audio'
  | 'presentation'
  | 'image'
  | 'brand'
  | '3d'
  | 'animation';

export interface IProjectSettings {
  resolution: Resolution;
  frameRate: FrameRate;
  duration: number;
  qualityPreset: 'draft' | 'preview' | 'final' | 'custom';
  colorProfile: 'srgb' | 'p3' | 'rec709' | 'rec2020';
  pixelAspectRatio: number;
  renderSettings: IRenderSettings;
}

export interface IRenderSettings {
  codec: 'h264' | 'h265' | 'vp9' | 'prores' | 'dnxhd';
  quality: number;
  audioCodec: 'aac' | 'opus' | 'pcm' | 'flac';
  audioQuality: number;
  pixelFormat: 'yuv420p' | 'yuv422p' | 'yuv444p' | 'rgb24';
  preset: 'ultrafast' | 'fast' | 'medium' | 'slow';
}

export interface IProjectMetadata {
  title: string;
  description?: string;
  author?: string;
  tags: string[];
  version: string;
  createdAt: number;
  updatedAt: number;
  templateId?: string;
}

export interface IScene {
  id: string;
  name: string;
  duration: number;
  layers: ILayer[];
  markers: IMarker[];
  backgroundColor?: string;
  transitions?: ITransition[];
}

export interface ILayer {
  id: string;
  name: string;
  type: 'video' | 'audio' | 'text' | 'image' | 'shape' | 'group' | 'effect';
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: string;
  transform: {
    position: { x: number; y: number };
    scale: { x: number; y: number };
    rotation: number;
    anchor: { x: number; y: number };
  };
  effects: string[];
  animations: string[];
  children?: ILayer[];
}

export interface IMarker {
  id: string;
  time: number;
  name: string;
  color: string;
}

export interface ITransition {
  type: 'cut' | 'fade' | 'dissolve' | 'wipe' | 'slide' | 'zoom';
  duration: number;
  direction?: 'left' | 'right' | 'up' | 'down';
}

export interface IFullProject {
  id: ProjectId;
  type: ProjectType;
  settings: IProjectSettings;
  metadata: IProjectMetadata;
  graph: ProjectGraph;
  scenes: IScene[];
  assets: NodeId[];
  timelineData: unknown;
  activeSceneId: string;
}

export interface IProjectBackup {
  id: string;
  projectId: ProjectId;
  timestamp: number;
  label?: string;
  size: number;
  data: unknown;
}

export interface IProjectEvents {
  'project:created': { project: IFullProject };
  'project:loaded': { project: IFullProject };
  'project:saved': { projectId: ProjectId };
  'project:closed': { projectId: ProjectId };
  'project:settings-changed': { projectId: ProjectId; settings: IProjectSettings };
  'project:scene-added': { projectId: ProjectId; scene: IScene };
  'project:scene-removed': { projectId: ProjectId; sceneId: string };
  'project:auto-save': { projectId: ProjectId };
  'project:backup-created': { backup: IProjectBackup };
}

export class ProjectEngine extends BaseEngine {
  private projects: Map<ProjectId, IFullProject> = new Map();
  private activeProjectId: ProjectId | null = null;
  private backups: Map<ProjectId, IProjectBackup[]> = new Map();
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private emitter = new EventEmitter<IProjectEvents>();
  private autoSaveInterval: number;
  private maxBackups: number;

  constructor(config: ProjectEngineConfig) {
    super(ProjectEngineConfigSchema.parse(config));
    this.autoSaveInterval = config.autoSaveInterval!;
    this.maxBackups = config.maxBackups!;
  }

  protected async onInitialize(): Promise<void> {
    if (this.autoSaveInterval > 0) {
      this.autoSaveTimer = setInterval(() => {
        this.autoSaveAll();
      }, this.autoSaveInterval);
    }
  }

  protected override async onDestroy(): Promise<void> {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }
    this.projects.clear();
    this.backups.clear();
  }

  createProject(
    type: ProjectType,
    name: string,
    template?: { settings?: Partial<IProjectSettings>; scenes?: Partial<IScene>[] }
  ): IFullProject {
    const projectId = uuidv4() as ProjectId;
    const sceneId = uuidv4();

    const defaultSettings: IProjectSettings = {
      resolution: template?.settings?.resolution ?? { width: 1920, height: 1080, pixelAspectRatio: 1 },
      frameRate: template?.settings?.frameRate ?? 30,
      duration: template?.settings?.duration ?? 0,
      qualityPreset: template?.settings?.qualityPreset ?? 'preview',
      colorProfile: template?.settings?.colorProfile ?? 'srgb',
      pixelAspectRatio: template?.settings?.pixelAspectRatio ?? 1,
      renderSettings: template?.settings?.renderSettings ?? {
        codec: 'h264',
        quality: 80,
        audioCodec: 'aac',
        audioQuality: 192,
        pixelFormat: 'yuv420p',
        preset: 'medium',
      },
    };

    const project: IFullProject = {
      id: projectId,
      type,
      settings: defaultSettings,
      metadata: {
        title: name,
        tags: [],
        version: '1.0.0',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      graph: new ProjectGraph(projectId),
      scenes: template?.scenes?.map((s, i) => ({
        id: uuidv4(),
        name: s.name ?? `Scene ${i + 1}`,
        duration: s.duration ?? 5,
        layers: s.layers ?? [],
        markers: s.markers ?? [],
        backgroundColor: s.backgroundColor ?? '#000000',
        transitions: s.transitions ?? [],
      })) ?? [{
        id: sceneId,
        name: 'Scene 1',
        duration: 5,
        layers: [],
        markers: [],
        backgroundColor: '#000000',
        transitions: [],
      }],
      assets: [],
      timelineData: null,
      activeSceneId: sceneId,
    };

    project.graph.addNode('project', { name, inputs: { type, settings: defaultSettings } });

    this.projects.set(projectId, project);
    this.backups.set(projectId, []);

    if (!this.activeProjectId) {
      this.activeProjectId = projectId;
    }

    this.emitter.emit('project:created', { project });
    return project;
  }

  loadProject(projectId: ProjectId, data: unknown): IFullProject {
    const parsed = JSON.parse(JSON.stringify(data)) as IFullProject;
    const graph = ProjectGraph.deserialize(parsed.graph as any);
    parsed.graph = graph;

    this.projects.set(projectId, parsed);
    this.backups.set(projectId, []);

    if (!this.activeProjectId) {
      this.activeProjectId = projectId;
    }

    this.emitter.emit('project:loaded', { project: parsed });
    return parsed;
  }

  closeProject(projectId: ProjectId): void {
    if (!this.projects.has(projectId)) return;

    this.saveProject(projectId);

    if (this.activeProjectId === projectId) {
      this.activeProjectId = Array.from(this.projects.keys()).find(id => id !== projectId) || null;
    }

    this.projects.delete(projectId);
    this.emitter.emit('project:closed', { projectId });
  }

  saveProject(projectId: ProjectId): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    project.metadata.updatedAt = Date.now();
    this.emitter.emit('project:saved', { projectId });
  }

  getProject(projectId: ProjectId): IFullProject | undefined {
    return this.projects.get(projectId);
  }

  getActiveProject(): IFullProject | undefined {
    return this.activeProjectId ? this.projects.get(this.activeProjectId) : undefined;
  }

  getActiveProjectId(): ProjectId | undefined {
    return this.activeProjectId ?? undefined;
  }

  setActiveProject(projectId: ProjectId): void {
    if (this.projects.has(projectId)) {
      this.activeProjectId = projectId;
    }
  }

  updateSettings(projectId: ProjectId, settings: Partial<IProjectSettings>): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    Object.assign(project.settings, settings);
    project.metadata.updatedAt = Date.now();

    this.emitter.emit('project:settings-changed', { projectId, settings: project.settings });
  }

  addScene(projectId: ProjectId, scene?: Partial<IScene>): IScene {
    const project = this.projects.get(projectId);
    if (!project) throw new Error('Project not found');

    const newScene: IScene = {
      id: uuidv4(),
      name: scene?.name ?? `Scene ${project.scenes.length + 1}`,
      duration: scene?.duration ?? 5,
      layers: scene?.layers ?? [],
      markers: scene?.markers ?? [],
      backgroundColor: scene?.backgroundColor ?? '#000000',
      transitions: scene?.transitions ?? [],
    };

    project.scenes.push(newScene);
    project.metadata.updatedAt = Date.now();

    this.emitter.emit('project:scene-added', { projectId, scene: newScene });
    return newScene;
  }

  removeScene(projectId: ProjectId, sceneId: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    const index = project.scenes.findIndex(s => s.id === sceneId);
    if (index === -1) return;

    project.scenes.splice(index, 1);
    project.metadata.updatedAt = Date.now();

    if (project.activeSceneId === sceneId && project.scenes.length > 0) {
      project.activeSceneId = project.scenes[0].id;
    }

    this.emitter.emit('project:scene-removed', { projectId, sceneId });
  }

  getScene(projectId: ProjectId, sceneId: string): IScene | undefined {
    const project = this.projects.get(projectId);
    if (!project) return undefined;

    return project.scenes.find(s => s.id === sceneId);
  }

  updateScene(projectId: ProjectId, sceneId: string, updates: Partial<IScene>): void {
    const project = this.projects.get(projectId);
    if (!project) return;

    const scene = project.scenes.find(s => s.id === sceneId);
    if (!scene) return;

    Object.assign(scene, updates);
    project.metadata.updatedAt = Date.now();
  }

  createBackup(projectId: ProjectId, label?: string): IProjectBackup {
    const project = this.projects.get(projectId);
    if (!project) throw new Error('Project not found');

    const backups = this.backups.get(projectId) || [];

    const backup: IProjectBackup = {
      id: uuidv4(),
      projectId,
      timestamp: Date.now(),
      label,
      size: JSON.stringify(project).length,
      data: JSON.parse(JSON.stringify(project)),
    };

    backups.push(backup);

    if (backups.length > this.maxBackups) {
      backups.shift();
    }

    this.backups.set(projectId, backups);
    this.emitter.emit('project:backup-created', { backup });

    return backup;
  }

  restoreFromBackup(projectId: ProjectId, backupId: string): void {
    const backups = this.backups.get(projectId) || [];
    const backup = backups.find(b => b.id === backupId);

    if (!backup) throw new Error('Backup not found');

    const restoredProject = backup.data as IFullProject;
    restoredProject.metadata.updatedAt = Date.now();

    const graph = ProjectGraph.deserialize(restoredProject.graph as any);
    restoredProject.graph = graph;

    this.projects.set(projectId, restoredProject);
  }

  getBackups(projectId: ProjectId): IProjectBackup[] {
    return this.backups.get(projectId) || [];
  }

  private autoSaveAll(): void {
    this.projects.forEach((project, projectId) => {
      this.saveProject(projectId);
      this.emitter.emit('project:auto-save', { projectId });
    });
  }

  serializeProject(projectId: ProjectId): string {
    const project = this.projects.get(projectId);
    if (!project) throw new Error('Project not found');

    const serialized = {
      ...project,
      graph: project.graph.serialize(),
    };

    return JSON.stringify(serialized);
  }

  getAllProjects(): IFullProject[] {
    return Array.from(this.projects.values());
  }

  on<E extends keyof IProjectEvents>(
    event: E,
    listener: (data: IProjectEvents[E]) => void
  ): this {
    this.emitter.on(event, listener as any);
    return this;
  }

  off<E extends keyof IProjectEvents>(
    event: E,
    listener: (data: IProjectEvents[E]) => void
  ): this {
    this.emitter.off(event, listener as any);
    return this;
  }

  getCapabilities(): string[] {
    return [
      'project:create',
      'project:load',
      'project:save',
      'project:close',
      'project:settings',
      'scene:create',
      'scene:delete',
      'scene:update',
      'project:backup',
      'project:restore',
    ];
  }
}
