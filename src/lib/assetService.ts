import { supabase, isSupabaseConfigured } from './supabase';
import type { MediaAsset } from '../types';
import { EventBus } from '../events/EventBus';

const eventBus = EventBus.getInstance();

function detectType(mimeType: string): MediaAsset['type'] {
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('image/')) return 'image';
  return 'document';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const AssetService = {
  async listAssets(projectId?: string): Promise<MediaAsset[]> {
    if (!isSupabaseConfigured) return [];
    try {
      let query = supabase.from('assets').select('*').order('created_at', { ascending: false });
      if (projectId) query = query.eq('project_id', projectId);
      const { data, error } = await query;
      if (error) throw error;
      return (data || []).map(mapDbAsset);
    } catch (e) {
      console.error('[AssetService] listAssets:', e);
      return [];
    }
  },

  async importAsset(file: File, projectId?: string): Promise<MediaAsset> {
    if (!isSupabaseConfigured) {
      const asset = makeLocalAsset(file);
      eventBus.publish('asset:imported', { asset }, 'AssetService', { async: true });
      return asset;
    }
    try {
      const { data, error } = await supabase
        .from('assets')
        .insert({
          name: file.name,
          type: detectType(file.type),
          mime_type: file.type,
          size: file.size,
          project_id: projectId || null,
          processed: true,
        })
        .select()
        .single();
      if (error) throw error;
      const asset = mapDbAsset(data);
      eventBus.publish('asset:imported', { asset }, 'AssetService', { async: true });
      return asset;
    } catch (e) {
      console.error('[AssetService] importAsset:', e);
      throw e;
    }
  },

  async deleteAsset(id: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    try {
      const { error } = await supabase.from('assets').delete().eq('id', id);
      if (error) throw error;
      eventBus.publish('media:deleted', { id }, 'AssetService', { async: true });
    } catch (e) {
      console.error('[AssetService] deleteAsset:', e);
      throw e;
    }
  },
};

function mapDbAsset(row: any): MediaAsset {
  return {
    id: row.id,
    name: row.name,
    type: row.type === 'document' ? 'document' : row.type,
    url: row.storage_path || undefined,
    size: formatSize(row.size || 0),
    duration: row.duration ? `${Math.floor(row.duration / 60)}:${String(Math.floor(row.duration % 60)).padStart(2, '0')}` : undefined,
    resolution: row.width && row.height ? `${row.width}x${row.height}` : undefined,
    addedAt: row.created_at || new Date().toISOString(),
    thumbnail: row.thumbnail_path || undefined,
  };
}

function makeLocalAsset(file: File): MediaAsset {
  return {
    id: `asset_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    name: file.name,
    type: detectType(file.type),
    size: formatSize(file.size),
    addedAt: new Date().toISOString(),
  };
}
