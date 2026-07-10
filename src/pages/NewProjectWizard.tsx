import React, { useState } from "react";
import { 
  Milestone, 
  Settings, 
  Layers, 
  Upload, 
  Sparkles, 
  FileVideo, 
  Check, 
  ChevronRight, 
  ArrowLeft 
} from "lucide-react";
import { PageId, Project } from "../types";
import { useApp } from "../context/AppContext";

interface NewProjectWizardProps {
  onNavigate: (page: PageId) => void;
  onCreateProject: (proj: Partial<Project>) => void;
}

export default function NewProjectWizard({ onNavigate, onCreateProject }: NewProjectWizardProps) {
  const { commandDispatcher } = useApp();
  const [name, setName] = useState("My Unnamed Studio Project");
  const [aspect, setAspect] = useState("16:9");
  const [resolution, setResolution] = useState("3840x2160 (4K)");
  const [fps, setFps] = useState(24);
  const [audioFreq, setAudioFreq] = useState("48kHz");
  const [aiPreset, setAiPreset] = useState("standard");
  const [filesSelected, setFilesSelected] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  // Resolution options based on Aspect Ratio
  const getResolutionsForAspect = (aspectRatio: string) => {
    if (aspectRatio === "9:16") {
      return ["1080x1920 (Vertical HD)", "2160x3840 (Vertical 4K)"];
    } else if (aspectRatio === "1:1") {
      return ["1080x1080 (Square HD)", "2160x2160 (Square 4K)"];
    }
    return ["3840x2160 (4K Cinema)", "1920x1080 (1080p HD)", "2560x1440 (2K widescreen)"];
  };

  const handleAspectChange = (aspectVal: string) => {
    setAspect(aspectVal);
    const resOptions = getResolutionsForAspect(aspectVal);
    setResolution(resOptions[0]);
  };

  const handleFileUploadSim = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const names: string[] = [];
      for (let i = 0; i < e.target.files.length; i++) {
        names.push(e.target.files[i].name);
      }
      setFilesSelected(prev => [...prev, ...names]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);

    try {
      const result = await commandDispatcher.dispatch({
        name: 'project:create',
        payload: {
          name,
          type: 'video',
          resolution,
          fps,
        },
        priority: 90,
      });

      if (result.success && result.data) {
        onCreateProject(result.data);
        onNavigate("workspace");
      } else {
        console.error('Failed to create project:', result.error);
      }
    } catch (e) {
      console.error('Project creation error:', e);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6 text-left animate-in fade-in-50 duration-200">
      {/* Back to dashboard */}
      <button 
        onClick={() => onNavigate("dashboard")}
        className="flex items-center space-x-1.5 text-xs font-semibold text-gray-500 hover:text-text-dark cursor-pointer"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        <span>Back to Dashboard</span>
      </button>

      {/* Header section */}
      <div>
        <span className="text-xs font-bold text-gray-500 uppercase tracking-wider font-mono">WIZARD ENGINES</span>
        <h1 className="text-xl font-bold text-text-dark tracking-tight mt-0.5">Project Initialization Wizard</h1>
        <p className="text-xs text-gray-500 mt-1">Configure canvas aspect ratio, resolution thresholds, audio pipelines, and AI preset models before starting your workflow.</p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Form controls */}
        <div className="md:col-span-2 space-y-5 bg-card border border-border-light p-5 rounded-2xl">
          <span className="text-[10px] font-bold text-gray-500 block uppercase tracking-wider">Canvas & Specs Parameters</span>

          {/* Project Name */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-text-dark">Project Title</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-9 px-3 bg-panel border border-border-light rounded-xl text-xs text-text-dark focus:outline-none"
              required
            />
          </div>

          {/* Aspect Ratio Cards */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-text-dark block">Aspect Ratio Layout</label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { val: "16:9", label: "Widescreen 16:9", desc: "YouTube, Film, TV" },
                { val: "9:16", label: "Vertical 9:16", desc: "TikTok, Reels, Shorts" },
                { val: "1:1", label: "Square 1:1", desc: "Instagram, Slate Ads" }
              ].map((asp) => (
                <button
                  type="button"
                  key={asp.val}
                  onClick={() => handleAspectChange(asp.val)}
                  className={`p-3 border rounded-xl text-left transition-all cursor-pointer ${
                    aspect === asp.val 
                      ? "border-text-dark bg-panel shadow-xs" 
                      : "border-border-light bg-btn-bg hover:border-gray-400"
                  }`}
                >
                  <span className="text-xs font-bold text-text-dark block">{asp.label}</span>
                  <span className="text-[9px] text-gray-400 block mt-1">{asp.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Resolution & FPS splits */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-text-dark">Resolution Profile</label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="w-full h-9 px-2 bg-panel border border-border-light rounded-xl text-xs text-text-dark focus:outline-none"
              >
                {getResolutionsForAspect(aspect).map((res, rIdx) => (
                  <option key={rIdx} value={res}>{res}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-text-dark">Timeline Frame Rate (FPS)</label>
              <select
                value={fps}
                onChange={(e) => setFps(Number(e.target.value))}
                className="w-full h-9 px-2 bg-panel border border-border-light rounded-xl text-xs text-text-dark focus:outline-none"
              >
                <option value={24}>23.976 fps (Cinematic standard)</option>
                <option value={30}>29.97 / 30 fps (Broadcast, Web)</option>
                <option value={60}>59.94 / 60 fps (Gaming, Ultra Fluid)</option>
              </select>
            </div>
          </div>

          {/* Audio sampling setup */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-text-dark">Audio Sample Rate Pipeline</label>
            <div className="flex space-x-3">
              {["48kHz", "44.1kHz", "96kHz (High-Res)"].map((freq) => (
                <button
                  type="button"
                  key={freq}
                  onClick={() => setAudioFreq(freq)}
                  className={`px-3 py-1.5 text-xs rounded-lg border cursor-pointer transition-all ${
                    audioFreq === freq 
                      ? "bg-text-dark text-white border-transparent" 
                      : "bg-btn-bg border-border-light text-text-dark hover:border-gray-400"
                  }`}
                >
                  {freq}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right side controls: AI Preset Models & File Ingestion */}
        <div className="space-y-5 flex flex-col justify-between">
          <div className="space-y-5">
            {/* AI Preset selection */}
            <div className="bg-card border border-border-light p-4 rounded-2xl space-y-3">
              <span className="text-[10px] font-bold text-purple-600 flex items-center space-x-1 uppercase tracking-wide font-mono">
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI Automated Presets</span>
              </span>

              <div className="space-y-2">
                {[
                  { id: "standard", title: "Standard Canvas Only", desc: "No pre-compiled neural effects layers." },
                  { id: "dialogue", title: "Dialogue Optimization", desc: "Launches auto-subtitle engine and voice denoise." },
                  { id: "grading", title: "Color Match Grading", desc: "Balances ambient light to cinematic LUT curve automatically." }
                ].map((pre) => (
                  <button
                    type="button"
                    key={pre.id}
                    onClick={() => setAiPreset(pre.id)}
                    className={`w-full p-2.5 border text-left rounded-xl transition-all cursor-pointer flex items-start space-x-2 ${
                      aiPreset === pre.id 
                        ? "bg-purple-50/50 border-purple-300" 
                        : "bg-btn-bg border-border-light hover:border-gray-300"
                    }`}
                  >
                    <div className={`mt-0.5 w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                      aiPreset === pre.id ? "bg-purple-600 border-transparent text-white" : "border-gray-300"
                    }`}>
                      {aiPreset === pre.id && <Check className="w-2.5 h-2.5" />}
                    </div>
                    <div>
                      <span className="text-xs font-bold text-text-dark block leading-none">{pre.title}</span>
                      <span className="text-[9px] text-gray-500 block mt-1 leading-normal">{pre.desc}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Media Ingestion Area */}
            <div className="bg-card border border-border-light p-4 rounded-2xl space-y-3">
              <span className="text-[10px] font-bold text-gray-500 block uppercase tracking-wide">Media Ingestion</span>
              
              {/* Fake drop area */}
              <div className="border border-dashed border-border-light hover:border-gray-400 p-4 rounded-xl text-center cursor-pointer relative bg-panel/30">
                <input 
                  type="file" 
                  multiple 
                  onChange={handleFileUploadSim}
                  className="absolute inset-0 opacity-0 cursor-pointer" 
                />
                <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1.5" />
                <span className="text-xs font-bold text-text-dark block">Drop clips or media files</span>
                <span className="text-[9px] text-gray-400 block mt-0.5">MP4, WAV, MP3, PNG, FBX up to 4GB</span>
              </div>

              {filesSelected.length > 0 && (
                <div className="space-y-1.5 text-xs text-text-dark max-h-24 overflow-y-auto no-scrollbar font-mono bg-panel/60 p-2 rounded-lg border border-border-light">
                  {filesSelected.map((fName, fIdx) => (
                    <div key={fIdx} className="flex items-center space-x-1 text-[10px] text-gray-600 truncate">
                      <FileVideo className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                      <span className="truncate">{fName}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Launch Action */}
          <button
            type="submit"
            disabled={isCreating}
            className="w-full py-3 bg-text-dark hover:bg-opacity-90 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-2 cursor-pointer shadow-md transition-all"
          >
            {isCreating ? (
              <span>Initializing Studio Pipelines...</span>
            ) : (
              <>
                <span>Generate Project Space</span>
                <ChevronRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
