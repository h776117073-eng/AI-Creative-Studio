import { supabase, isSupabaseConfigured } from './supabase';
import type { Project, MediaAsset, AppNotification, HistoryItem } from '../types';
import { EventBus } from '../events/EventBus';

const eventBus = EventBus.getInstance();

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function handleError(error: unknown, context: string): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[ProjectService] ${context}:`, error);
  eventBus.publish('error:occurred', { context, message }, 'ProjectService', { async: true });
  throw error;
}

export const ProjectService = {
  async listProjects(): Promise<Project[]> {
    if (!isSupabaseConfigured) return [];
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(mapDbProject);
    } catch (e) {
      handleError(e, 'listProjects');
    }
  },

  async getProject(id: string): Promise<Project | null> {
    if (!isSupabaseConfigured) return null;
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data ? mapDbProject(data) : null;
    } catch (e) {
      handleError(e, 'getProject');
    }
  },

  async createProject(input: {
    name: string;
    type: string;
    description?: string;
    resolution?: string;
    fps?: number;
  }): Promise<Project> {
    if (!isSupabaseConfigured) {
      const project = makeLocalProject(input);
      eventBus.publish('project:created', { project }, 'ProjectService', { async: true });
      return project;
    }
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert({
          name: input.name,
          type: input.type,
          description: input.description || '',
          settings: { resolution: input.resolution || '1920x1080', fps: input.fps || 30 },
          status: 'draft',
        })
        .select()
        .single();
      if (error) throw error;
      const project = mapDbProject(data);
      eventBus.publish('project:created', { project }, 'ProjectService', { async: true });
      return project;
    } catch (e) {
      handleError(e, 'createProject');
    }
  },

  async updateProject(id: string, updates: Partial<Project>): Promise<void> {
    if (!isSupabaseConfigured) return;
    try {
      const dbUpdates: Record<string, any> = {};
      if (updates.name) dbUpdates.name = updates.name;
      if (updates.tags) dbUpdates.metadata = { tags: updates.tags };
      const { error } = await supabase.from('projects').update(dbUpdates).eq('id', id);
      if (error) throw error;
      eventBus.publish('project:updated', { id, updates }, 'ProjectService', { async: true });
    } catch (e) {
      handleError(e, 'updateProject');
    }
  },

  async deleteProject(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    try {
      const { error } = await supabase.from('projects').delete().eq('id', id);
      if (error) throw error;
      eventBus.publish('project:deleted', { id }, 'ProjectService', { async: true });
    } catch (e) {
      handleError(e, 'deleteProject');
    }
  },

  async duplicateProject(project: Project): Promise<Project> {
    if (!isSupabaseConfigured) {
      const copy = { ...project, id: generateId('proj'), name: `${project.name} (Copy)` };
      return copy;
    }
    try {
      const { data, error } = await supabase
        .from('projects')
        .insert({
          name: `${project.name} (Copy)`,
          type: 'video',
          description: '',
          settings: { resolution: project.resolution, fps: project.fps },
          status: 'draft',
        })
        .select()
        .single();
      if (error) throw error;
      const dup = mapDbProject(data);
      eventBus.publish('project:duplicated', { original: project, duplicate: dup }, 'ProjectService', { async: true });
      return dup;
    } catch (e) {
      handleError(e, 'duplicateProject');
    }
  },
};

function mapDbProject(row: any): Project {
  const settings = row.settings || {};
  const metadata = row.metadata || {};
  return {
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at || new Date().toISOString(),
    createdAt: row.created_at || new Date().toISOString(),
    thumbnail: row.thumbnail_path || '',
    aspectRatio: settings.aspectRatio || '16:9',
    resolution: settings.resolution || '1920x1080',
    fps: settings.fps || 30,
    tags: metadata.tags || [],
    pinned: metadata.pinned || false,
  };
}

function makeLocalProject(input: {
  name: string;
  type: string;
  resolution?: string;
  fps?: number;
}): Project {
  return {
    id: generateId('proj'),
    name: input.name,
    updatedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    thumbnail: '',
    aspectRatio: '16:9',
    resolution: input.resolution || '1920x1080',
    fps: input.fps || 30,
    tags: [],
    pinned: false,
  };
}
