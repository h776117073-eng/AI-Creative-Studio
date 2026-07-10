import React, { useState, useEffect } from "react";
import { 
  Search, 
  Sparkles, 
  Bell, 
  Cloud, 
  Cpu, 
  Settings as SettingsIcon, 
  HelpCircle, 
  Terminal, 
  Maximize2,
  ChevronRight,
  Database
} from "lucide-react";
import { PageId, SystemStats } from "../../types";
import { useApp } from "../../context/AppContext";

interface HeaderProps {
  currentProjectName: string;
  onNavigate: (page: PageId) => void;
  activePage: PageId;
  stats: SystemStats;
  onToggleRightPanel: () => void;
  isRightPanelOpen: boolean;
}

export default function Header({
  currentProjectName,
  onNavigate,
  activePage,
  stats,
  onToggleRightPanel,
  isRightPanelOpen
}: HeaderProps) {
  const { commandDispatcher, addNotification, notifications } = useApp();
  const [searchQuery, setSearchQuery] = useState("");
  const [showRecentSearch, setShowRecentSearch] = useState(false);
  const [aiCommand, setAiCommand] = useState("");
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showNotificationDropdown, setShowNotificationDropdown] = useState(false);

  const recentSearches = [
    "Retro LUT correction",
    "Nebula video keyframes",
    "Smart compressor",
    "Speech to text"
  ];

  const handleAiCommandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiCommand.trim()) return;

    setIsAiLoading(true);
    setAiResult(null);

    try {
      const result = await commandDispatcher.dispatch({
        name: 'ai:execute',
        payload: { query: aiCommand },
        priority: 90,
      });

      if (result.success && result.data) {
        const { interpretation, result: aiResultText } = result.data;
        setAiResult(interpretation);

        const commandLower = aiCommand.toLowerCase();
        if (commandLower.includes("color") || commandLower.includes("grade") || commandLower.includes("lut")) {
          setTimeout(() => onNavigate("color-studio"), 1500);
        } else if (commandLower.includes("subtitle") || commandLower.includes("transcribe") || commandLower.includes("caption")) {
          setTimeout(() => onNavigate("subtitle-studio"), 1500);
        } else if (commandLower.includes("render") || commandLower.includes("export")) {
          setTimeout(() => onNavigate("render-center"), 1500);
        } else if (commandLower.includes("audio") || commandLower.includes("noise") || commandLower.includes("voice")) {
          setTimeout(() => onNavigate("audio-editing"), 1500);
        }

        setTimeout(() => {
          setAiResult(null);
          setAiCommand("");
        }, 2500);
      } else {
        setAiResult(result.error || "AI command failed.");
      }
    } catch (err) {
      setAiResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <header className="h-14 bg-panel border-b border-border-light px-4 flex items-center justify-between select-none shrink-0 z-30">
      {/* Left side: Project Logo & Name */}
      <div className="flex items-center space-x-3 min-w-[240px]">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-text-dark text-white font-bold text-sm tracking-tighter">
          CS
        </div>
        <div>
          <span className="font-bold text-sm text-text-dark tracking-tight">AI Creative Studio</span>
          <div className="flex items-center space-x-1 text-[10px] text-gray-500 font-mono">
            <span>{currentProjectName || "No Project Loaded"}</span>
            <span className="w-1 h-1 rounded-full bg-green-500"></span>
          </div>
        </div>
      </div>

      {/* Middle section: Global Search & AI Command Bar */}
      <div className="flex-1 max-w-2xl mx-8 flex items-center space-x-2">
        {/* Global Search */}
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-400">
            <Search className="w-4 h-4" />
          </div>
          <input
            type="text"
            placeholder="Search assets, tools, help..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setShowRecentSearch(true)}
            onBlur={() => setTimeout(() => setShowRecentSearch(false), 200)}
            className="w-full h-9 pl-9 pr-4 bg-btn-bg border border-border-light rounded-lg text-xs text-text-dark placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400 transition-all font-sans"
          />

          {/* Recent Search Dropdown */}
          {showRecentSearch && (
            <div className="absolute left-0 right-0 top-10 bg-btn-bg border border-border-light rounded-lg shadow-lg p-2 z-50 animate-in fade-in-50 duration-150">
              <span className="text-[10px] font-semibold text-gray-400 px-2 block mb-1 uppercase tracking-wider">
                Recent Searches
              </span>
              {recentSearches.map((term, idx) => (
                <button
                  key={idx}
                  onClick={() => setSearchQuery(term)}
                  className="w-full text-left px-2 py-1.5 hover:bg-panel text-xs text-text-dark rounded-md flex items-center space-x-2"
                >
                  <Search className="w-3 h-3 text-gray-400" />
                  <span>{term}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* AI Command Bar */}
        <form onSubmit={handleAiCommandSubmit} className="relative flex-1">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-400">
            <Sparkles className="w-3.5 h-3.5 text-gray-500" />
          </div>
          <input
            type="text"
            placeholder="AI Command (e.g., 'auto grade video')"
            value={aiCommand}
            onChange={(e) => setAiCommand(e.target.value)}
            className="w-full h-9 pl-9 pr-12 bg-btn-bg border border-border-light rounded-lg text-xs text-text-dark placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400 transition-all font-mono"
          />
          <div className="absolute inset-y-0 right-1.5 flex items-center">
            <button
              type="submit"
              disabled={isAiLoading || !aiCommand}
              className="px-2 py-1 bg-text-dark text-white rounded text-[9px] font-mono hover:bg-opacity-90 disabled:opacity-30 transition-all cursor-pointer"
            >
              {isAiLoading ? "..." : "RUN"}
            </button>
          </div>

          {/* AI command result banner overlay */}
          {aiResult && (
            <div className="absolute left-0 right-0 top-10 bg-text-dark text-white text-xs font-mono p-3 rounded-lg shadow-xl z-50 flex items-start space-x-2 border border-gray-700">
              <Terminal className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="text-gray-400 text-[10px] block mb-0.5 uppercase tracking-wide">SYSTEM COGNITION</span>
                <span>{aiResult}</span>
              </div>
            </div>
          )}
        </form>
      </div>

      {/* Right section: System statuses, Notifications, Profile */}
      <div className="flex items-center space-x-3">
        {/* Status badges */}
        <div className="hidden lg:flex items-center space-x-2 border-r border-border-light pr-3">
          {/* Cloud Sync */}
          <button 
            onClick={() => onNavigate("cloud")}
            title="Cloud Sync Active"
            className="flex items-center space-x-1 px-1.5 py-1 rounded hover:bg-btn-bg transition-colors cursor-pointer text-gray-600"
          >
            <Cloud className="w-3.5 h-3.5 text-green-600" />
            <span className="text-[10px] font-mono">Sync</span>
          </button>

          {/* GPU badge */}
          <button 
            onClick={() => onNavigate("settings")}
            title={`GPU: ${stats.gpuName} at ${stats.gpuUsage}%`}
            className="flex items-center space-x-1 px-1.5 py-1 rounded hover:bg-btn-bg transition-colors cursor-pointer text-gray-600"
          >
            <Cpu className="w-3.5 h-3.5" />
            <span className="text-[10px] font-mono">{stats.gpuUsage}%</span>
          </button>

          {/* AI Copilot Badge */}
          <div 
            title="AI Engine Core Status"
            className="flex items-center space-x-1 px-1.5 py-1 rounded bg-btn-bg text-[10px] font-mono border border-border-light text-gray-600"
          >
            <Sparkles className="w-3 h-3 text-purple-600" />
            <span className="capitalize">{stats.aiStatus}</span>
          </div>
        </div>

        {/* Navigation Action Icons */}
        <div className="flex items-center space-x-1">
          {/* Notifications Trigger */}
          <div className="relative">
            <button
              onClick={() => setShowNotificationDropdown(!showNotificationDropdown)}
              className="p-1.5 hover:bg-btn-bg rounded-lg transition-colors cursor-pointer text-gray-700"
            >
              <Bell className="w-4 h-4" />
              {notifications.filter(n => !n.read).length > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
              )}
            </button>

            {/* Notifications quick menu */}
            {showNotificationDropdown && (
              <div className="absolute right-0 top-10 w-80 bg-btn-bg border border-border-light rounded-lg shadow-xl p-3 z-50 animate-in slide-in-from-top-2 duration-150 text-left">
                <div className="flex items-center justify-between mb-2 pb-1 border-b border-border-light">
                  <span className="text-xs font-bold text-text-dark">Notifications</span>
                  <button 
                    onClick={() => {
                      onNavigate("notifications");
                      setShowNotificationDropdown(false);
                    }} 
                    className="text-[10px] text-gray-500 hover:underline"
                  >
                    View All
                  </button>
                </div>
                <div className="space-y-2">
                  {notifications.length === 0 ? (
                    <div className="text-center py-4 text-gray-400 text-[11px]">No notifications</div>
                  ) : (
                    notifications.slice(0, 5).map((notif) => (
                      <div key={notif.id} className="p-1.5 rounded bg-panel text-[11px]">
                        <span className="font-semibold text-text-dark block">{notif.title}</span>
                        <span className="text-gray-500">{notif.description}</span>
                        <span className="text-[9px] text-gray-400 block mt-1 font-mono">{notif.timestamp}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Developer Mode */}
          <button
            onClick={() => onNavigate("developer-mode")}
            id="btn_developer_mode_toggle"
            className={`p-1.5 hover:bg-btn-bg rounded-lg transition-colors cursor-pointer text-gray-700 ${activePage === "developer-mode" ? "bg-btn-bg border border-border-light text-purple-600" : ""}`}
            title="Open Developer Console"
          >
            <Terminal className="w-4 h-4" />
          </button>

          {/* Quick Settings */}
          <button
            onClick={() => onNavigate("settings")}
            className={`p-1.5 hover:bg-btn-bg rounded-lg transition-colors cursor-pointer text-gray-700 ${activePage === "settings" ? "bg-btn-bg border border-border-light" : ""}`}
            title="Studio Settings"
          >
            <SettingsIcon className="w-4 h-4" />
          </button>

          {/* Right Panel Toggle Button */}
          <button
            onClick={onToggleRightPanel}
            className={`p-1.5 hover:bg-btn-bg rounded-lg transition-colors cursor-pointer text-gray-700 hidden md:block ${isRightPanelOpen ? "bg-btn-bg border border-border-light" : ""}`}
            title="Toggle Context Inspector"
          >
            <Maximize2 className="w-4 h-4 rotate-45" />
          </button>
        </div>

        {/* User avatar and profile card click */}
        <div 
          onClick={() => onNavigate("settings")} 
          className="flex items-center space-x-2 pl-2 border-l border-border-light cursor-pointer group"
        >
          <div className="w-7 h-7 rounded-full bg-gray-300 overflow-hidden border border-border-light group-hover:border-gray-500 transition-all flex items-center justify-center text-[10px] font-bold text-gray-700">
            JD
          </div>
          <div className="hidden xl:block text-left">
            <span className="text-xs font-semibold text-text-dark block group-hover:underline">John Doe</span>
            <span className="text-[9px] text-gray-400 block">Pro Member</span>
          </div>
        </div>
      </div>
    </header>
  );
}
