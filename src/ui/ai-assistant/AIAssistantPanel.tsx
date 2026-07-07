import React, { useState } from "react";
import { 
  Sparkles, 
  Send, 
  Mic, 
  History, 
  Check, 
  Play, 
  Cpu, 
  Activity, 
  Settings,
  Workflow,
  Plus,
  RefreshCw
} from "lucide-react";

interface AIAssistantPanelProps {
  onTriggerAutoCut: () => void;
  onTriggerAutoSub: () => void;
  onTriggerAutoColor: () => void;
  onSendMessage: (msg: string) => void;
}

export default function AIAssistantPanel({
  onTriggerAutoCut,
  onTriggerAutoSub,
  onTriggerAutoColor,
  onSendMessage
}: AIAssistantPanelProps) {
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<Array<{ sender: "user" | "copilot"; text: string; time: string }>>([
    { sender: "copilot", text: "Greetings Creator! I am your Antigravity Creative Assistant. What would you like to build? (e.g., 'Slice this video based on the synth beat drops', 'Remove the background noise and auto-transcribe subtitles')", time: "16:54" }
  ]);
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [executionSteps, setExecutionSteps] = useState<Array<{ id: number; label: string; status: "idle" | "running" | "completed" }>>([
    { id: 1, label: "Audio Frequency Spectrum analysis", status: "completed" },
    { id: 2, label: "Scene Shift Histogram matching", status: "completed" },
    { id: 3, label: "Subtitles Waveform alignment", status: "idle" },
    { id: 4, label: "SMPTE Metadata injection", status: "idle" }
  ]);

  const handleSend = () => {
    if (!chatInput.trim()) return;
    
    const userMsg = chatInput.trim();
    const updated = [
      ...chatHistory,
      { sender: "user" as const, text: userMsg, time: "Just now" }
    ];
    setChatHistory(updated);
    setChatInput("");
    onSendMessage(userMsg);

    // Simulate smart agent planning and executing
    setTimeout(() => {
      let reply = "Copy that! I am loading the neural layers to compute that task.";
      if (userMsg.toLowerCase().includes("cut") || userMsg.toLowerCase().includes("split")) {
        reply = "Executing Auto-Cut! I have scanned the audio frequency spectrum and placed timeline split markers at peak amplitude thresholds.";
        onTriggerAutoCut();
      } else if (userMsg.toLowerCase().includes("color") || userMsg.toLowerCase().includes("grading")) {
        reply = "Executing Color Grading! Applied S-Curve contrast algorithms and temperature matrices to match Hollywood Rec.709 spaces.";
        onTriggerAutoColor();
      } else if (userMsg.toLowerCase().includes("subtitle") || userMsg.toLowerCase().includes("text")) {
        reply = "Generated subtitles! Standardized the transcript overlays matching voice decibel ranges.";
        onTriggerAutoSub();
      }

      setChatHistory(prev => [
        ...prev,
        { sender: "copilot" as const, text: reply, time: "Just now" }
      ]);
    }, 1000);
  };

  const handleVoiceCommand = () => {
    setIsVoiceListening(true);
    setTimeout(() => {
      setIsVoiceListening(false);
      setChatInput("Apply cyberpunk grading curves and auto-split");
      alert("Voice command analyzed successfully: 'Apply cyberpunk grading curves and auto-split'");
    }, 1500);
  };

  return (
    <div className="bg-panel border border-border-light rounded-3xl p-5 flex flex-col justify-between overflow-hidden shadow-xs h-full min-h-[420px] text-left">
      <div className="space-y-4 overflow-y-auto no-scrollbar flex-1 pr-1">
        {/* Header */}
        <div className="border-b border-border-light pb-3 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-purple-600 animate-pulse" />
            <h3 className="text-xs font-bold text-text-dark uppercase tracking-wider font-mono">Creative Assistant AI</h3>
          </div>
          <span className="text-[9px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">
            ANTIGRAVITY CORE
          </span>
        </div>

        {/* Dynamic Workflow Execution Nodes Graph */}
        <div className="bg-white border border-border-light rounded-2xl p-4">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider font-mono flex items-center space-x-1.5 mb-2">
            <Workflow className="w-3.5 h-3.5 text-purple-500" />
            <span>AI Processing Node Flow</span>
          </span>

          <div className="flex items-center justify-around text-center py-2 relative">
            {/* Connection lines */}
            <div className="absolute left-[15%] right-[15%] top-1/2 -translate-y-2 h-[2px] bg-dashed bg-gradient-to-r from-purple-400 to-indigo-400 pointer-events-none"></div>
            
            {[
              { label: "Prompt", active: true, done: true },
              { label: "Audio-Match", active: true, done: true },
              { label: "Scene-Warp", active: true, done: false },
              { label: "Pro-Export", active: false, done: false }
            ].map((node, i) => (
              <div key={i} className="flex flex-col items-center z-10 relative">
                <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold font-mono transition-all ${
                  node.done 
                    ? "bg-purple-600 border-purple-600 text-white shadow" 
                    : node.active 
                      ? "bg-purple-100 border-purple-400 text-purple-700 animate-pulse" 
                      : "bg-gray-100 border-gray-300 text-gray-400"
                }`}>
                  {i + 1}
                </div>
                <span className="text-[9px] font-bold font-mono text-text-dark mt-1.5">{node.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Canva/CapCut-style Automated Action Suggestions */}
        <div className="space-y-2">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide font-mono block">One-Click Auto Utilities</span>
          <div className="grid grid-cols-3 gap-2">
            <button 
              onClick={onTriggerAutoCut}
              className="px-2 py-2 bg-purple-50 hover:bg-purple-100 border border-purple-200 hover:border-purple-300 rounded-xl text-[10px] font-bold text-purple-700 transition-colors text-center cursor-pointer flex flex-col items-center justify-center space-y-1"
            >
              <Cpu className="w-4 h-4 text-purple-600" />
              <span>Smart Cut</span>
            </button>

            <button 
              onClick={onTriggerAutoSub}
              className="px-2 py-2 bg-purple-50 hover:bg-purple-100 border border-purple-200 hover:border-purple-300 rounded-xl text-[10px] font-bold text-purple-700 transition-colors text-center cursor-pointer flex flex-col items-center justify-center space-y-1"
            >
              <Mic className="w-4 h-4 text-purple-600" />
              <span>Auto Subs</span>
            </button>

            <button 
              onClick={onTriggerAutoColor}
              className="px-2 py-2 bg-purple-50 hover:bg-purple-100 border border-purple-200 hover:border-purple-300 rounded-xl text-[10px] font-bold text-purple-700 transition-colors text-center cursor-pointer flex flex-col items-center justify-center space-y-1"
            >
              <Sparkles className="w-4 h-4 text-purple-600" />
              <span>Grading Match</span>
            </button>
          </div>
        </div>

        {/* Chat Stream Panel */}
        <div className="space-y-2 pt-2">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide font-mono block">Dialogue Stream</span>
          <div className="bg-white border border-border-light rounded-2xl p-3 h-36 overflow-y-auto no-scrollbar space-y-2.5">
            {chatHistory.map((msg, i) => (
              <div 
                key={i} 
                className={`flex flex-col space-y-1 max-w-[85%] ${msg.sender === "user" ? "ml-auto text-right" : "text-left"}`}
              >
                <div className={`p-2 rounded-xl text-xs font-semibold ${
                  msg.sender === "user" 
                    ? "bg-purple-600 text-white rounded-tr-none" 
                    : "bg-primary-bg/80 text-text-dark rounded-tl-none border border-border-light/40"
                }`}>
                  {msg.text}
                </div>
                <span className="text-[8px] font-mono text-gray-400">{msg.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Input box */}
      <div className="pt-3 border-t border-border-light shrink-0">
        <div className="flex items-center space-x-2">
          {/* Voice Command Simulation Button */}
          <button 
            onClick={handleVoiceCommand}
            className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
              isVoiceListening 
                ? "bg-red-500 border-transparent text-white animate-pulse" 
                : "bg-btn-bg border-border-light text-gray-500 hover:text-text-dark"
            }`}
            title="Simulate Voice Command"
          >
            <Mic className="w-4 h-4" />
          </button>

          <input 
            type="text" 
            placeholder="Type creative command or prompt..." 
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            className="flex-1 px-3 py-2.5 bg-white border border-border-light rounded-xl text-xs font-semibold focus:outline-none"
          />

          <button 
            onClick={handleSend}
            className="p-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-xl shadow-xs transition-all cursor-pointer"
            title="Send command"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
