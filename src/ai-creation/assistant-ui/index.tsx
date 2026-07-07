import React, { useState } from "react";
import { 
  Sparkles, 
  Settings2, 
  RotateCcw, 
  HelpCircle, 
  CheckCircle2, 
  FileText, 
  GitCompare, 
  DollarSign, 
  Clock, 
  ArrowRight, 
  AlertCircle,
  Undo2,
  BookmarkCheck,
  Briefcase
} from "lucide-react";
import { BrandIdentity, CreativeProjectResult } from "../types";

interface AssistantUIProps {
  activeProject: CreativeProjectResult | null;
  onApplyModification: (prompt: string) => void;
  onRevertVersion: (versionId: string) => void;
  brandIdentity: BrandIdentity;
  onUpdateBrand: (brand: BrandIdentity) => void;
}

export default function WorkspaceAssistant({
  activeProject,
  onApplyModification,
  onRevertVersion,
  brandIdentity,
  onUpdateBrand
}: AssistantUIProps) {
  const [activeTab, setActiveTab] = useState<"assistant" | "brand" | "versions">("assistant");
  const [prompt, setPrompt] = useState("");
  const [chatHistory, setChatHistory] = useState([
    { role: "assistant", text: "Welcome to the Creative Assistant. I can explain the timeline, suggest pacing refinements, or apply auto-LUT alignments. Try asking me to 'Apply a cinematic vintage film grade'." }
  ]);

  const [versions, setVersions] = useState([
    { id: "v_init", name: "Initial Assembly", timestamp: "Just now", description: "Standard automated template matching applied." },
    { id: "v_lut", name: "Orange & Teal Grade", timestamp: "1 min ago", description: "Color wheels optimized for high dynamic cinematic range." }
  ]);

  const handleSendPrompt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    const userText = prompt;
    setChatHistory(prev => [...prev, { role: "user", text: userText }]);
    setPrompt("");

    // Simulate assistant reasoning and apply modification
    setTimeout(() => {
      let reply = "";
      if (userText.toLowerCase().includes("grade") || userText.toLowerCase().includes("color")) {
        reply = "✨ Color Grade adjusted! I have applied a warm analog film LUT to the primary Video tracks and added visual contrast nodes. You can inspect the color wheels on the property panel.";
        onApplyModification("Apply analog film LUT");
      } else if (userText.toLowerCase().includes("pacing") || userText.toLowerCase().includes("cut")) {
        reply = "✂️ Pacing optimized! I analyzed the audio waveforms and trimmed 3 silent clips by -12 frames to tighten up the overall flow.";
        onApplyModification("Optimize clip pacing");
      } else {
        reply = `🎨 Applied modifications for: "${userText}". I updated the timeline track composition and refreshed the preview layout instantly. No errors detected.`;
        onApplyModification(userText);
      }

      setChatHistory(prev => [...prev, { role: "assistant", text: reply }]);
      
      // Add version
      const newVerId = `v_${Date.now()}`;
      setVersions(prev => [
        { id: newVerId, name: userText.length > 22 ? userText.substring(0, 22) + "..." : userText, timestamp: "Just now", description: `Triggered by: ${userText}` },
        ...prev
      ]);
    }, 1000);
  };

  return (
    <div className="bg-card border border-border-light rounded-2xl flex flex-col h-full text-left overflow-hidden">
      {/* Header section with tabs */}
      <div className="p-3 bg-panel/75 border-b border-border-light shrink-0">
        <div className="flex justify-between items-center mb-2.5">
          <span className="text-xs font-bold text-purple-600 font-mono flex items-center space-x-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Workspace Assistant</span>
          </span>
          <span className="text-[10px] font-mono text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
            AGENT_ONLINE
          </span>
        </div>

        <div className="flex bg-btn-bg p-0.5 rounded-lg border border-border-light/40">
          <button
            onClick={() => setActiveTab("assistant")}
            className={`flex-1 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
              activeTab === "assistant" ? "bg-white text-text-dark shadow-xs" : "text-gray-500"
            }`}
          >
            Assistant Dialogue
          </button>
          <button
            onClick={() => setActiveTab("brand")}
            className={`flex-1 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
              activeTab === "brand" ? "bg-white text-text-dark shadow-xs" : "text-gray-500"
            }`}
          >
            Brand Rules
          </button>
          <button
            onClick={() => setActiveTab("versions")}
            className={`flex-1 py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${
              activeTab === "versions" ? "bg-white text-text-dark shadow-xs" : "text-gray-500"
            }`}
          >
            Compare & Undo
          </button>
        </div>
      </div>

      {/* Main Content Areas */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4 no-scrollbar min-h-0">
        
        {activeTab === "assistant" && (
          <div className="h-full flex flex-col justify-between space-y-3">
            {/* Conversations list */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 max-h-[360px] no-scrollbar">
              {chatHistory.map((msg, index) => (
                <div key={index} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`p-2.5 rounded-xl text-xs max-w-[90%] leading-relaxed ${
                    msg.role === "user" 
                      ? "bg-text-dark text-white rounded-tr-none" 
                      : "bg-panel border border-border-light/60 text-text-dark rounded-tl-none"
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}
            </div>

            {/* Quick action helper prompt badges */}
            <div className="space-y-1.5 shrink-0">
              <span className="text-[9px] font-mono text-gray-400 font-bold uppercase">Quick Instructions:</span>
              <div className="flex flex-wrap gap-1.5">
                {[
                  "Apply vintage LUTs",
                  "Auto-cut silent gaps",
                  "Level conversational audio",
                  "Stagger overlay text fades"
                ].map((txt) => (
                  <button
                    key={txt}
                    onClick={() => {
                      setPrompt(txt);
                    }}
                    className="px-2 py-1 bg-panel border border-border-light hover:border-purple-300 rounded text-[9px] text-gray-600 hover:text-purple-600 transition-all cursor-pointer font-mono"
                  >
                    + {txt}
                  </button>
                ))}
              </div>
            </div>

            {/* Prompt input Form */}
            <form onSubmit={handleSendPrompt} className="flex space-x-1.5 shrink-0 pt-1.5">
              <input
                type="text"
                placeholder="Ask assistant to edit or adjust..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="flex-1 px-3 py-1.5 text-xs bg-panel border border-border-light rounded-lg text-text-dark focus:outline-none"
              />
              <button
                type="submit"
                className="px-3 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-lg transition-colors cursor-pointer"
              >
                Apply
              </button>
            </form>
          </div>
        )}

        {activeTab === "brand" && (
          <div className="space-y-4">
            <div className="p-3 bg-purple-50/50 border border-purple-100 rounded-xl space-y-1">
              <span className="text-xs font-bold text-purple-700 block flex items-center">
                <Briefcase className="w-3.5 h-3.5 mr-1" />
                <span>Active Brand Board</span>
              </span>
              <p className="text-[10px] text-purple-600 leading-normal">
                Brand regulations dynamically feed into AI generators to ensure fonts, templates, and text match your voice rules.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              {/* Brand Name */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Brand/Company Name</label>
                <input
                  type="text"
                  value={brandIdentity.name || ""}
                  onChange={(e) => onUpdateBrand({ ...brandIdentity, name: e.target.value })}
                  className="w-full px-2.5 py-1.5 bg-panel border border-border-light rounded-lg text-xs font-semibold focus:outline-none focus:border-purple-500"
                  placeholder="e.g. Acme Tech Labs"
                />
              </div>

              {/* Logo url mock */}
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Brand Logo Asset</label>
                <input
                  type="text"
                  value={brandIdentity.logoName || ""}
                  onChange={(e) => onUpdateBrand({ ...brandIdentity, logoName: e.target.value })}
                  className="w-full px-2.5 py-1.5 bg-panel border border-border-light rounded-lg text-xs font-semibold focus:outline-none focus:border-purple-500"
                  placeholder="e.g. acme_logo_primary.png"
                />
              </div>

              {/* Color Swatch Panel */}
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Color Palette Guidelines</label>
                <div className="grid grid-cols-4 gap-2">
                  <div>
                    <span className="text-[9px] text-gray-400 block mb-1">Primary</span>
                    <input
                      type="color"
                      value={brandIdentity.colors.primary}
                      onChange={(e) => onUpdateBrand({ ...brandIdentity, colors: { ...brandIdentity.colors, primary: e.target.value } })}
                      className="w-full h-8 bg-transparent border-0 cursor-pointer rounded-md overflow-hidden"
                    />
                  </div>
                  <div>
                    <span className="text-[9px] text-gray-400 block mb-1">Secondary</span>
                    <input
                      type="color"
                      value={brandIdentity.colors.secondary}
                      onChange={(e) => onUpdateBrand({ ...brandIdentity, colors: { ...brandIdentity.colors, secondary: e.target.value } })}
                      className="w-full h-8 bg-transparent border-0 cursor-pointer rounded-md overflow-hidden"
                    />
                  </div>
                  <div>
                    <span className="text-[9px] text-gray-400 block mb-1">Accent</span>
                    <input
                      type="color"
                      value={brandIdentity.colors.accent}
                      onChange={(e) => onUpdateBrand({ ...brandIdentity, colors: { ...brandIdentity.colors, accent: e.target.value } })}
                      className="w-full h-8 bg-transparent border-0 cursor-pointer rounded-md overflow-hidden"
                    />
                  </div>
                  <div>
                    <span className="text-[9px] text-gray-400 block mb-1">BG</span>
                    <input
                      type="color"
                      value={brandIdentity.colors.background}
                      onChange={(e) => onUpdateBrand({ ...brandIdentity, colors: { ...brandIdentity.colors, background: e.target.value } })}
                      className="w-full h-8 bg-transparent border-0 cursor-pointer rounded-md overflow-hidden"
                    />
                  </div>
                </div>
              </div>

              {/* Brand Font Family selections */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Heading Font</label>
                  <select
                    value={brandIdentity.fonts.heading}
                    onChange={(e) => onUpdateBrand({ ...brandIdentity, fonts: { ...brandIdentity.fonts, heading: e.target.value } })}
                    className="w-full px-2.5 py-1.5 bg-panel border border-border-light rounded-lg text-xs focus:outline-none"
                  >
                    <option value="Space Grotesk">Space Grotesk</option>
                    <option value="Outfit">Outfit</option>
                    <option value="Inter">Inter (Sans-Serif)</option>
                    <option value="Playfair Display">Playfair Display (Serif)</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Brand Voice</label>
                  <select
                    value={brandIdentity.brandVoice}
                    onChange={(e) => onUpdateBrand({ ...brandIdentity, brandVoice: e.target.value })}
                    className="w-full px-2.5 py-1.5 bg-panel border border-border-light rounded-lg text-xs focus:outline-none"
                  >
                    <option value="Futuristic & Bold">Futuristic & Bold</option>
                    <option value="Sleek & Professional">Sleek & Corporate</option>
                    <option value="Energetic Social">Energetic Social</option>
                    <option value="Warm & Cinematic">Warm & Editorial</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "versions" && (
          <div className="space-y-3">
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
              Active Checkpoint Timestamps
            </div>
            
            <div className="space-y-2">
              {versions.map((ver) => (
                <div key={ver.id} className="p-2.5 bg-panel border border-border-light/70 rounded-xl flex items-start justify-between">
                  <div className="space-y-0.5">
                    <span className="text-xs font-bold text-text-dark flex items-center">
                      <BookmarkCheck className="w-3.5 h-3.5 mr-1 text-purple-600" />
                      {ver.name}
                    </span>
                    <span className="text-[9px] font-mono text-gray-400 block">{ver.timestamp} • {ver.description}</span>
                  </div>
                  <button
                    onClick={() => {
                      onRevertVersion(ver.id);
                      setChatHistory(prev => [...prev, { role: "assistant", text: `🔄 Reverted workspace layout to version checkpoint: [${ver.name}].` }]);
                    }}
                    className="p-1 text-gray-500 hover:text-purple-600 hover:bg-white rounded transition-colors cursor-pointer"
                    title="Undo to this checkpoint"
                  >
                    <Undo2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="bg-purple-50 border border-purple-200/50 rounded-xl p-3 text-[10px] text-purple-600 leading-relaxed flex items-start space-x-2">
              <GitCompare className="w-4 h-4 shrink-0 text-purple-600 mt-0.5" />
              <div>
                <span className="font-bold">A/B Version Comparison</span>
                <p className="text-[9px] text-purple-500 mt-1">
                  Pressing undo restores all track composition indices, effects parameters, keyframe nodes, and color grade wheels.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Active Project cost analysis and processing time */}
      {activeProject && (
        <div className="p-3 bg-panel border-t border-border-light flex justify-between items-center text-[10px] shrink-0 font-mono">
          <div className="flex items-center space-x-1.5">
            <DollarSign className="w-3.5 h-3.5 text-green-600" />
            <span className="text-gray-500">Est. Cost:</span>
            <span className="font-bold text-green-700">{activeProject.costSummary.processingCredits} Credits</span>
          </div>

          <div className="flex items-center space-x-1.5">
            <Clock className="w-3.5 h-3.5 text-purple-600" />
            <span className="text-gray-500">Render Time:</span>
            <span className="font-bold text-purple-700">{activeProject.costSummary.processingTimeSeconds}s</span>
          </div>
        </div>
      )}
    </div>
  );
}
