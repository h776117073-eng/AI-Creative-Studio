import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { PageId, Project, MediaAsset, AppNotification, HistoryItem, RenderJob, SystemStats } from '../types';
import { EventBus } from '../events/EventBus';
import { CommandDispatcher } from '../commands/CommandDispatcher';
import { initializeCommandRegistry } from '../lib/commandRegistry';
import { ProjectService } from '../lib/projectService';
import { AssetService } from '../lib/assetService';
import { NotificationService, HistoryService, SettingsService, AIService } from '../lib/services';
import { isSupabaseConfigured } from '../lib/supabase';

interface AppContextValue {
  // Navigation
  activePage: PageId;
  navigate: (page: PageId) => void;
  currentProject: Project | null;
  setCurrentProject: (p: Project | null) => void;

  // Data
  projects: Project[];
  mediaLibrary: MediaAsset[];
  notifications: AppNotification[];
  projectHistory: HistoryItem[];
  renderQueue: RenderJob[];
  settings: Record<string, any>;
  loading: boolean;
  error: string | null;

  // Services
  projectService: typeof ProjectService;
  assetService: typeof AssetService;
  aiService: typeof AIService;
  notificationService: typeof NotificationService;
  historyService: typeof HistoryService;
  settingsService: typeof SettingsService;
  eventBus: EventBus;
  commandDispatcher: CommandDispatcher;

  // Actions
  refreshProjects: () => Promise<void>;
  refreshMedia: () => Promise<void>;
  addNotification: (n: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => void;
  addHistory: (h: Omit<HistoryItem, 'id' | 'timestamp'>) => void;
  addRenderJob: (job: RenderJob) => void;
  setRenderQueue: React.Dispatch<React.SetStateAction<RenderJob[]>>;
  clearError: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [activePage, setActivePage] = useState<PageId>('dashboard');
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [mediaLibrary, setMediaLibrary] = useState<MediaAsset[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [projectHistory, setProjectHistory] = useState<HistoryItem[]>([]);
  const [renderQueue, setRenderQueue] = useState<RenderJob[]>([]);
  const [settings, setSettings] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const eventBus = EventBus.getInstance();
  const commandDispatcher = CommandDispatcher.getInstance();
  const initialized = useRef(false);

  // Initialize command registry
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    initializeCommandRegistry();
  }, []);

  // Subscribe to events
  useEffect(() => {
    const subs: string[] = [];

    subs.push(eventBus.subscribe('error:occurred', (e) => {
      setError(e.payload.message || 'An error occurred');
    }));

    subs.push(eventBus.subscribe('notification:added', (e) => {
      setNotifications(prev => [e.payload.notification, ...prev].slice(0, 100));
    }));

    subs.push(eventBus.subscribe('notification:read', (e) => {
      if (e.payload.clearAll) {
        setNotifications([]);
      } else {
        setNotifications(prev => prev.map(n => n.id === e.payload.id ? { ...n, read: true } : n));
      }
    }));

    subs.push(eventBus.subscribe('history:added', (e) => {
      setProjectHistory(prev => [e.payload.item, ...prev].slice(0, 200));
    }));

    subs.push(eventBus.subscribe('project:created', () => {
      refreshProjects();
    }));

    subs.push(eventBus.subscribe('project:deleted', () => {
      refreshProjects();
    }));

    subs.push(eventBus.subscribe('project:duplicated', () => {
      refreshProjects();
    }));

    subs.push(eventBus.subscribe('asset:imported', () => {
      refreshMedia();
    }));

    subs.push(eventBus.subscribe('media:deleted', (e) => {
      setMediaLibrary(prev => prev.filter(m => m.id !== e.payload.id));
    }));

    subs.push(eventBus.subscribe('export:completed', (e) => {
      setRenderQueue(prev => prev.map(j => j.id === e.payload.id ? { ...j, status: 'completed', progress: 100 } : j));
      NotificationService.add({
        title: 'Export Complete',
        description: 'Your export has finished successfully.',
        type: 'rendering',
      });
    }));

    subs.push(eventBus.subscribe('export:failed', (e) => {
      setRenderQueue(prev => prev.map(j => j.id === e.payload.id ? { ...j, status: 'failed' } : j));
    }));

    return () => subs.forEach(s => eventBus.unsubscribe(s));
  }, []);

  // Load initial data
  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [projs, media, settingsData] = await Promise.all([
        ProjectService.listProjects(),
        AssetService.listAssets(),
        SettingsService.get(),
      ]);
      setProjects(projs);
      setMediaLibrary(media);
      setSettings(settingsData);
      if (projs.length > 0 && !currentProject) {
        setCurrentProject(projs[0]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const refreshProjects = useCallback(async () => {
    try {
      const projs = await ProjectService.listProjects();
      setProjects(projs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects');
    }
  }, []);

  const refreshMedia = useCallback(async () => {
    try {
      const media = await AssetService.listAssets();
      setMediaLibrary(media);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load media');
    }
  }, []);

  const navigate = useCallback((page: PageId) => {
    setActivePage(page);
    HistoryService.add({
      action: `Navigated to ${page}`,
      user: 'You',
      type: 'ui',
    });
    eventBus.publish('workspace:changed', { page }, 'AppContext', { async: true });
  }, [eventBus]);

  const addNotification = useCallback((n: Omit<AppNotification, 'id' | 'timestamp' | 'read'>) => {
    NotificationService.add(n);
  }, []);

  const addHistory = useCallback((h: Omit<HistoryItem, 'id' | 'timestamp'>) => {
    HistoryService.add(h);
  }, []);

  const addRenderJob = useCallback((job: RenderJob) => {
    setRenderQueue(prev => [job, ...prev]);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value: AppContextValue = {
    activePage,
    navigate,
    currentProject,
    setCurrentProject,
    projects,
    mediaLibrary,
    notifications,
    projectHistory,
    renderQueue,
    settings,
    loading,
    error,
    projectService: ProjectService,
    assetService: AssetService,
    aiService: AIService,
    notificationService: NotificationService,
    historyService: HistoryService,
    settingsService: SettingsService,
    eventBus,
    commandDispatcher,
    refreshProjects,
    refreshMedia,
    addNotification,
    addHistory,
    addRenderJob,
    setRenderQueue,
    clearError,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
