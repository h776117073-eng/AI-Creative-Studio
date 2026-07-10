import React, { useState, useEffect } from "react";
import { useApp } from "./context/AppContext";
import { isSupabaseConfigured } from "./lib/supabase";
import type { SystemStats, SavedWorkflow, PluginItem } from "./types";
import { initialWorkflows, initialPlugins } from "./mockData";

// Layout components
import Header from "./components/Layout/Header";
import Sidebar from "./components/Layout/Sidebar";
import RightPanel from "./components/Layout/RightPanel";
import StatusBar from "./components/Layout/StatusBar";

// Core views
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import NewProjectWizard from "./pages/NewProjectWizard";
import Workspace from "./pages/Workspace";
import MediaLibrary from "./pages/MediaLibrary";
import TimelinePage from "./pages/TimelinePage";

// AI and Module views
import AICommandCenter from "./pages/AICommandCenter";
import AIWorkflows from "./pages/AIWorkflows";
import AiFirstCreator from "./pages/AiFirstCreator";
import VideoEditing from "./pages/VideoEditing";
import AudioEditing from "./pages/AudioEditing";
import MotionGraphics from "./pages/MotionGraphics";
import VisualEffects from "./pages/VisualEffects";
import ColorStudio from "./pages/ColorStudio";
import SubtitleStudio from "./pages/SubtitleStudio";
import ImageStudio from "./pages/ImageStudio";
import ThreeDStudio from "./pages/ThreeDStudio";
import AnimationStudio from "./pages/AnimationStudio";
import KeyframeStudio from "./pages/KeyframeStudio";
import RenderCenter from "./pages/RenderCenter";
import RenderCenterNew from "./pages/RenderCenterNew";
import ExportCenter from "./pages/ExportCenter";
import AssetManager from "./pages/AssetManager";
import AssetManagerNew from "./pages/AssetManagerNew";
import TemplateMarketplace from "./pages/TemplateMarketplace";
import PluginCenter from "./pages/PluginCenter";

// Utility views
import Cloud from "./pages/Cloud";
import TeamWorkspace from "./pages/TeamWorkspace";
import HistoryPage from "./pages/HistoryPage";
import NotificationsPage from "./pages/NotificationsPage";
import SettingsPage from "./pages/SettingsPage";
import DeveloperMode from "./pages/DeveloperMode";

export default function App() {
  const {
    activePage,
    navigate,
    currentProject,
    setCurrentProject,
    projects,
    mediaLibrary,
    notifications,
    projectHistory,
    renderQueue,
    addNotification,
    addHistory,
    addRenderJob,
    setRenderQueue,
    loading,
    error,
    clearError,
    eventBus,
    commandDispatcher,
  } = useApp();

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [workflows, setWorkflows] = useState<SavedWorkflow[]>(initialWorkflows);
  const [plugins, setPlugins] = useState<PluginItem[]>(initialPlugins);

  const [stats] = useState<SystemStats>({
    gpuUsage: 34,
    gpuTemp: 62,
    gpuName: "NVIDIA RTX 6000 Ada",
    ramUsage: 12.4,
    ramMax: 64,
    cpuUsage: 18,
    cpuTemp: 45,
    cloudSync: isSupabaseConfigured ? "synced" : "error",
    aiStatus: "ready",
  });

  // Keyboard shortcut for Developer Mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        navigate("developer-mode");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate]);

  // Background render queue progress simulation
  useEffect(() => {
    if (renderQueue.length === 0) return;
    const interval = setInterval(() => {
      // Progress is handled inside RenderCenterNew via its own state
    }, 4000);
    return () => clearInterval(interval);
  }, [renderQueue.length]);

  const handleSelectProject = (proj: typeof currentProject) => {
    if (!proj) return;
    setCurrentProject(proj);
    navigate("workspace");
    addHistory({
      action: `Opened project: ${proj.name}`,
      user: "You",
      type: "ui",
    });
    eventBus.publish("project:open", { projectId: proj.id, name: proj.name }, "App", { async: true });
  };

  const handleCreateProject = (newProj: typeof currentProject) => {
    if (!newProj) return;
    setCurrentProject(newProj);
    navigate("workspace");
    addHistory({
      action: `Created project: ${newProj.name}`,
      user: "You",
      type: "ui",
    });
  };

  const handleUploadMedia = (asset: typeof mediaLibrary[number]) => {
    addHistory({
      action: `Imported asset: ${asset.name}`,
      user: "You",
      type: "edit",
    });
    eventBus.publish("media:import", { asset }, "App", { async: true });
  };

  const handleDeleteMedia = (id: string) => {
    eventBus.publish("media:deleted", { id }, "App", { async: true });
  };

  const handleMarkNotificationRead = (id: string) => {
    commandDispatcher.dispatch({
      name: 'notification:markRead',
      payload: { id },
      priority: 50,
    });
  };

  const handleClearNotifications = () => {
    commandDispatcher.dispatch({
      name: 'notification:clearAll',
      payload: {},
      priority: 50,
    });
  };

  const handleRevertHistory = (actionDesc: string) => {
    addHistory({
      action: `Reverted to checkpoint: ${actionDesc}`,
      user: "You",
      type: "ui",
    });
    eventBus.publish("undo:performed", { description: actionDesc }, "App", { async: true });
  };

  const handleDuplicateProject = (proj: typeof currentProject) => {
    if (!proj) return;
    commandDispatcher.dispatch({
      name: 'project:duplicate',
      payload: { project: proj },
      priority: 70,
    });
    addHistory({
      action: `Duplicated project: ${proj.name}`, user: "You", type: "ui" });
  };

  const handleTogglePinProject = (id: string) => {
    const project = projects.find(p => p.id === id);
    if (project) {
      commandDispatcher.dispatch({
        name: 'project:togglePin',
        payload: { project },
        priority: 60,
      });
    }
  };

  const handleExportRenderJob = (job: { name: string; format: string; resolution: string }) => {
    const fullJob = {
      id: `render_${Date.now()}`,
      projectName: job.name,
      format: job.format,
      resolution: job.resolution,
      fps: 24,
      progress: 0,
      status: "queued" as const,
      priority: "high" as const,
      elapsed: "00m 00s",
    };
    addRenderJob(fullJob);
    addNotification({
      title: "Export Started",
      description: `${job.name} export queued as ${job.format}.`,
      type: "rendering",
    });
    eventBus.publish("export:started", { job: fullJob }, "App", { async: true });
  };

  const renderActiveScreen = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
            <span className="text-gray-500 text-sm">Loading workspace...</span>
          </div>
        </div>
      );
    }

    switch (activePage) {
      case "dashboard":
        return (
          <Dashboard
            projects={projects}
            onSelectProject={handleSelectProject}
            onNavigate={navigate}
          />
        );
      case "projects":
        return (
          <Projects
            projects={projects}
            onSelectProject={handleSelectProject}
            onNavigate={navigate}
            onDeleteProject={(id) => {
              commandDispatcher.dispatch({
                name: 'project:delete',
                payload: { id },
                priority: 80,
              });
            }}
            onDuplicateProject={handleDuplicateProject}
            onTogglePinProject={handleTogglePinProject}
          />
        );
      case "new-project":
        return (
          <NewProjectWizard
            onCreateProject={handleCreateProject}
            onNavigate={navigate}
          />
        );
      case "workspace":
        return (
          <Workspace
            onNavigate={navigate}
            projectName={currentProject?.name || "Untitled"}
          />
        );
      case "media":
        return (
          <MediaLibrary
            media={mediaLibrary}
            onNavigate={navigate}
            onAddMedia={handleUploadMedia}
            onDeleteMedia={handleDeleteMedia}
          />
        );
      case "timeline":
        return (
          <TimelinePage
            onNavigate={navigate}
            projectName={currentProject?.name || "Untitled"}
          />
        );
      case "ai-command-center":
        return <AICommandCenter onNavigate={navigate} />;
      case "ai-workflows":
        return (
          <AIWorkflows
            workflows={workflows}
            onToggleFavorite={(id) => setWorkflows(prev => prev.map(w => w.id === id ? { ...w, isFavorite: !w.isFavorite } : w))}
            onRunWorkflow={(name) => {
              addNotification({ title: 'Workflow Started', description: `Running workflow: ${name}`, type: 'system' });
            }}
            onAddWorkflow={(flow) => setWorkflows(prev => [flow, ...prev])}
          />
        );
      case "ai-creation":
        return <AiFirstCreator onNavigate={navigate} />;
      case "video-editing":
        return <VideoEditing onNavigate={navigate} />;
      case "audio-editing":
        return <AudioEditing onNavigate={navigate} />;
      case "motion-graphics":
        return <MotionGraphics onNavigate={navigate} />;
      case "vfx":
        return <VisualEffects onNavigate={navigate} />;
      case "color-studio":
        return <ColorStudio onNavigate={navigate} />;
      case "subtitle-studio":
        return <SubtitleStudio onNavigate={navigate} />;
      case "image-studio":
        return <ImageStudio onNavigate={navigate} />;
      case "3d-studio":
        return <ThreeDStudio onNavigate={navigate} />;
      case "animation-studio":
        return <AnimationStudio onNavigate={navigate} />;
      case "keyframe-studio":
        return <KeyframeStudio onNavigate={navigate} />;
      case "render-center":
        return (
          <RenderCenterNew
            onNavigate={navigate}
            renderQueue={renderQueue}
            setRenderQueue={setRenderQueue}
          />
        );
      case "export-center":
        return (
          <ExportCenter
            onNavigate={navigate}
            onAddRenderJob={handleExportRenderJob}
          />
        );
      case "asset-manager":
        return (
          <AssetManagerNew
            mediaLibrary={mediaLibrary}
            onUploadMedia={handleUploadMedia}
            onDeleteMedia={handleDeleteMedia}
            onNavigate={navigate}
          />
        );
      case "template-marketplace":
        return <TemplateMarketplace />;
      case "plugin-center":
        return (
          <PluginCenter
            pluginsList={plugins}
            onTogglePlugin={(id) => setPlugins(prev => prev.map(p => p.id === id ? { ...p, isEnabled: !p.isEnabled, installed: true } : p))}
          />
        );
      case "cloud":
        return <Cloud />;
      case "team-workspace":
        return <TeamWorkspace />;
      case "history":
        return (
          <HistoryPage
            projectHistory={projectHistory}
            onRevertHistory={handleRevertHistory}
          />
        );
      case "notifications":
        return (
          <NotificationsPage
            notifications={notifications}
            onMarkRead={handleMarkNotificationRead}
            onClearAll={handleClearNotifications}
          />
        );
      case "settings":
        return <SettingsPage />;
      case "developer-mode":
        return <DeveloperMode />;
      default:
        return (
          <div className="p-8 text-center text-gray-500 font-semibold font-mono">
            Module loading under secure development...
          </div>
        );
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-background overflow-hidden font-sans select-none">
      {error && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-red-100 border-b border-red-300 px-4 py-2 flex items-center justify-between">
          <span className="text-red-800 text-sm font-medium">{error}</span>
          <button onClick={clearError} className="text-red-600 hover:text-red-800 text-sm">
            Dismiss
          </button>
        </div>
      )}

      <Header
        currentProjectName={currentProject?.name || "No Project Loaded"}
        onNavigate={navigate}
        activePage={activePage}
        stats={stats}
        onToggleRightPanel={() => setIsRightPanelOpen(!isRightPanelOpen)}
        isRightPanelOpen={isRightPanelOpen}
      />

      <div className="flex-1 flex min-h-0 relative">
        <Sidebar
          activePage={activePage}
          onNavigate={navigate}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        />

        <main className="flex-1 min-w-0 bg-panel border-r border-border-light flex flex-col overflow-y-auto no-scrollbar relative">
          {renderActiveScreen()}
        </main>

        {isRightPanelOpen && (
          <RightPanel
            activePage={activePage}
            projectName={currentProject?.name || "Untitled"}
          />
        )}
      </div>

      <StatusBar
        stats={stats}
        currentProjectName={currentProject?.name || "No Project"}
        onNavigate={navigate}
        renderQueue={renderQueue}
      />
    </div>
  );
}
