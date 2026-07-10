import { supabase, isSupabaseConfigured } from './supabase';
import type { AppNotification, HistoryItem } from '../types';
import { EventBus } from '../events/EventBus';

const eventBus = EventBus.getInstance();

export const NotificationService = {
  async list(): Promise<AppNotification[]> {
    if (!isSupabaseConfigured) return [];
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []).map(mapDbNotification);
    } catch {
      return [];
    }
  },

  add(notification: Omit<AppNotification, 'id' | 'timestamp' | 'read'>): AppNotification {
    const notif: AppNotification = {
      ...notification,
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: 'Just now',
      read: false,
    };
    eventBus.publish('notification:added', { notification: notif }, 'NotificationService', { async: true });
    return notif;
  },

  markRead(id: string): void {
    eventBus.publish('notification:read', { id }, 'NotificationService', { async: true });
  },

  clearAll(): void {
    eventBus.publish('notification:read', { clearAll: true }, 'NotificationService', { async: true });
  },
};

function mapDbNotification(row: any): AppNotification {
  return {
    id: row.id,
    title: row.title || '',
    description: row.description || '',
    type: row.type || 'system',
    timestamp: row.created_at || 'Just now',
    read: row.read || false,
  };
}

export const HistoryService = {
  add(item: Omit<HistoryItem, 'id' | 'timestamp'>): HistoryItem {
    const historyItem: HistoryItem = {
      ...item,
      id: `hist_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      timestamp: 'Just now',
    };
    eventBus.publish('history:added', { item: historyItem }, 'HistoryService', { async: true });
    return historyItem;
  },
};

export const SettingsService = {
  async get(): Promise<Record<string, any>> {
    if (!isSupabaseConfigured) return defaultSettings();
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .single();
      if (error) throw error;
      return data || defaultSettings();
    } catch {
      return defaultSettings();
    }
  },

  async update(updates: Record<string, any>): Promise<void> {
    if (!isSupabaseConfigured) return;
    try {
      const { error } = await supabase.from('user_settings').update(updates).eq('user_id', (await supabase.auth.getUser()).data.user?.id);
      if (error) throw error;
      eventBus.publish('settings:updated', { updates }, 'SettingsService', { async: true });
    } catch (e) {
      console.error('[SettingsService] update:', e);
    }
  },
};

function defaultSettings() {
  return {
    theme: 'dark',
    language: 'en',
    auto_save: true,
    auto_save_interval: 30,
    default_resolution: { width: 1920, height: 1080 },
    default_frame_rate: 30,
  };
}

export const ExportService = {
  async list(): Promise<any[]> {
    if (!isSupabaseConfigured) return [];
    try {
      const { data, error } = await supabase
        .from('exports')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch {
      return [];
    }
  },

  async create(projectId: string, format: string, settings: Record<string, any>): Promise<any> {
    if (!isSupabaseConfigured) return null;
    try {
      const { data, error } = await supabase
        .from('exports')
        .insert({
          project_id: projectId,
          format,
          settings,
          status: 'pending',
          progress: 0,
        })
        .select()
        .single();
      if (error) throw error;
      eventBus.publish('export:started', { export: data }, 'ExportService', { async: true });
      return data;
    } catch (e) {
      console.error('[ExportService] create:', e);
      throw e;
    }
  },

  async updateProgress(id: string, progress: number, status: string): Promise<void> {
    if (!isSupabaseConfigured) return;
    try {
      const updates: Record<string, any> = { progress, status };
      if (status === 'completed' || status === 'failed') {
        updates.completed_at = new Date().toISOString();
      }
      const { error } = await supabase.from('exports').update(updates).eq('id', id);
      if (error) throw error;
      if (status === 'completed') {
        eventBus.publish('export:completed', { id, progress }, 'ExportService', { async: true });
      } else if (status === 'failed') {
        eventBus.publish('export:failed', { id }, 'ExportService', { async: true });
      }
    } catch (e) {
      console.error('[ExportService] updateProgress:', e);
    }
  },
};

export const AIService = {
  async executeCommand(query: string, projectId?: string): Promise<{ interpretation: string; result: string }> {
    if (!isSupabaseConfigured) {
      return { interpretation: 'Local mode', result: `Processed: ${query}` };
    }
    try {
      const { data, error } = await supabase
        .from('ai_commands')
        .insert({
          query,
          project_id: projectId || null,
          status: 'processing',
        })
        .select()
        .single();
      if (error) throw error;

      const interpretation = interpretQuery(query);
      const result = `Command "${query}" executed successfully.`;

      await supabase
        .from('ai_commands')
        .update({
          status: 'completed',
          interpretation: { analysis: interpretation },
          result: { output: result },
          completed_at: new Date().toISOString(),
        })
        .eq('id', data.id);

      eventBus.publish('ai:command_executed', { query, result, commandId: data.id }, 'AIService', { async: true });
      return { interpretation, result };
    } catch (e) {
      console.error('[AIService] executeCommand:', e);
      eventBus.publish('ai:command_failed', { query, error: String(e) }, 'AIService', { async: true });
      throw e;
    }
  },

  async listCommands(): Promise<any[]> {
    if (!isSupabaseConfigured) return [];
    try {
      const { data, error } = await supabase
        .from('ai_commands')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data || [];
    } catch {
      return [];
    }
  },
};

function interpretQuery(query: string): string {
  const lower = query.toLowerCase();
  if (lower.includes('color') || lower.includes('grade') || lower.includes('lut')) {
    return 'Color grading operation detected. Routing to Color Studio.';
  }
  if (lower.includes('subtitle') || lower.includes('caption') || lower.includes('transcribe')) {
    return 'Subtitle generation requested. Routing to Subtitle Studio.';
  }
  if (lower.includes('render') || lower.includes('export')) {
    return 'Render/export operation detected. Routing to Render Center.';
  }
  if (lower.includes('audio') || lower.includes('noise') || lower.includes('voice')) {
    return 'Audio processing requested. Routing to Audio Mastering.';
  }
  return `General AI command: "${query}". Analyzing and routing to appropriate module.`;
}
