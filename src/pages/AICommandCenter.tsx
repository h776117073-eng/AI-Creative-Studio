import React, { useState, useEffect } from "react";
import { 
  Sparkles, 
  Send, 
  Terminal, 
  Workflow, 
  Database, 
  Zap, 
  History, 
  MessageSquare,
  Bookmark,
  ChevronRight,
  ShieldAlert,
  Play,
  CheckCircle2,
  Clock,
  RotateCw,
  XCircle,
  Pause,
  Trash2,
  Users,
  Activity,
  Cpu,
  Layers,
  Settings2,
  FileText,
  CheckSquare,
  AlertTriangle
} from "lucide-react";
import { PageId } from "../types";
import { 
  AiOrchestrator, 
  IAiExecutionPlan, 
  IParsedResult, 
  IAiTask, 
  ICollaborationLog, 
  IAgentTask,
  AgentRole
} from "../ai";

interface AICommandCenterProps {
  onNavigate: (page: PageId) => void;
}

export default function AICommandCenter({ onNavigate }: AICommandCenterProps) {
  const [chatMessage, setChatMessage] = useState("");
  const [chatLogs, setChatLogs] = useState([
    { sender: "ai", text: "Welcome to the AI Command Center Core. System is idle. Try typing 'Create a cinematic trailer' to experience our Multi-Agent AI Workforce cooperating in real-time." }
  ]);
  const [executionLogs, setExecutionLogs] = useState<string[]>([
    `[${new Date().toLocaleTimeString()}] AI_STUDIO_COGNITION: Neural pipelines initialized successfully.`,
    `[${new Date().toLocaleTimeString()}] AI_STUDIO_COGNITION: Multi-Agent supervisor 'Apollo' connected and online with 9 specialized agent minds.`
  ]);

  // Orchestrator States
  const [activePlan, setActivePlan] = useState<IAiExecutionPlan | null>(null);
  const [parsedResult, setParsedResult] = useState<IParsedResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTaskIndex, setCurrentTaskIndex] = useState(0);
  const [requiresConfirmation, setRequiresConfirmation] = useState(false);

  // Multi-Agent states
  const [activeTab, setActiveTab] = useState<"chat" | "workforce">("chat");
  const [isMultiAgentExecuting, setIsMultiAgentExecuting] = useState(false);
  const [collaborationLogs, setCollaborationLogs] = useState<ICollaborationLog[]>([]);
  const [agentTasks, setAgentTasks] = useState<IAgentTask[]>([]);
  const [selectedAgentRole, setSelectedAgentRole] = useState<AgentRole | null>(null);

  // Sync background AI system stats
  useEffect(() => {
    const memoryState = AiOrchestrator.getInstance().getMemory().getState();
    if (memoryState.conversationHistory.length > 1) {
      // Rehydrate chat from memory
      const rehydrated = memoryState.conversationHistory.map(m => ({
        sender: m.sender,
        text: m.text
      }));
      setChatLogs(rehydrated);
    }
  }, []);

  const logToTerminal = (text: string) => {
    const time = new Date().toLocaleTimeString();
    setExecutionLogs(prev => [...prev, `[${time}] ${text}`]);
  };

  const executeMultiAgentWorkflow = async (prompt: string) => {
    setIsMultiAgentExecuting(true);
    setActiveTab("workforce");
    logToTerminal("MULTI_AGENT_WORKFORCE: Supervisor 'Apollo' activating specialized workforce.");

    const defaultTasks: IAgentTask[] = [
      {
        id: "task_research_01",
        name: "Retrieve movie references & pacing briefs",
        description: "Analyze blockbuster trailer references and establish cinematic markers.",
        assignedTo: "cinematic_researcher",
        status: "backlog",
        priority: "high",
        dependencies: [],
        inputParams: { genre: "retro_future_noir" },
        retryCount: 0
      },
      {
        id: "task_video_02",
        name: "Slice timeline tracks and auto-beat match",
        description: "Align frame timestamps directly with action-cut guidelines.",
        assignedTo: "video_editor",
        status: "backlog",
        priority: "high",
        dependencies: ["task_research_01"],
        inputParams: { assetId: "neon_skyline_establishing" },
        retryCount: 0
      },
      {
        id: "task_audio_03",
        name: "Remove hum, isolate dialogue, and align music tracks",
        description: "Analyze vocal stem and run multi-pass compressor limits.",
        assignedTo: "audio_specialist",
        status: "backlog",
        priority: "high",
        dependencies: ["task_video_02"],
        inputParams: { assetId: "protagonist_monologue", targetDb: -14 },
        retryCount: 0
      },
      {
        id: "task_color_04",
        name: "Calibrate LUT exposure levels & primary tint balance",
        description: "Map Rec.709 color spectrum with professional cinematic grades.",
        assignedTo: "color_grade_specialist",
        status: "backlog",
        priority: "high",
        dependencies: ["task_video_02"],
        inputParams: { lookPreset: "orange_and_teal", contrast: 1.15 },
        retryCount: 0
      },
      {
        id: "task_vfx_05",
        name: "Inject smoke volumetric particle simulation",
        description: "Apply active camera tracking vectors and overlay composite elements.",
        assignedTo: "vfx_specialist",
        status: "backlog",
        priority: "medium",
        dependencies: ["task_color_04"],
        inputParams: { effectType: "volumetric_cyber_smoke" },
        retryCount: 0
      },
      {
        id: "task_motion_06",
        name: "Render text layout intro keyframes",
        description: "Stagger kinetic typography title frames with custom easing paths.",
        assignedTo: "motion_graphics_designer",
        status: "backlog",
        priority: "medium",
        dependencies: ["task_video_02"],
        inputParams: { textContent: "APOLLO WORKFORCE ACTIVE" },
        retryCount: 0
      },
      {
        id: "task_render_07",
        name: "Transcode final sequence & bundle master clip",
        description: "Compile and render out unified 4K Apple ProRes assets.",
        assignedTo: "render_optimization_engineer",
        status: "backlog",
        priority: "high",
        dependencies: ["task_vfx_05", "task_audio_03", "task_motion_06"],
        inputParams: { codec: "Apple_ProRes_422", fps: 24 },
        retryCount: 0
      }
    ];

    setAgentTasks(defaultTasks);

    const supervisor = AiOrchestrator.getInstance().getSupervisor();
    
    try {
      const result = await supervisor.coordinateWorkforceWorkflow(prompt, defaultTasks, (taskId, status, taskResult) => {
        // Sync tasks state to update UI
        setAgentTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: status as any, outputResult: taskResult } : t));
        
        // Push supervisor collaboration logs
        const currentLogs = supervisor.getCollaborationLogs();
        setCollaborationLogs([...currentLogs]);

        // Push to main logs terminal
        const task = defaultTasks.find(t => t.id === taskId);
        if (task) {
          logToTerminal(`WORKFORCE_[${task.assignedTo.toUpperCase()}]: Task status changed to [${status.toUpperCase()}]`);
        }
      });

      if (result.success) {
        logToTerminal("MULTI_AGENT_SUCCESS: Supervisor Apollo signed off on final broadcast-quality render.");
        setChatLogs(prev => [...prev, {
          sender: "ai",
          text: "✨ Multi-Agent team successfully collaborated to produce your cinematic trailer! The Supervisor, Chief Editor, Colorist, VFX Artist, and Master Sound Engineer have all signed off on the deliverables. Check the 'Specialized Agents' tab to view their detailed logs, outputs, and inter-agent messages."
        }]);
      } else {
        logToTerminal("MULTI_AGENT_FAILED: Quality Control flagged a block during final checks.");
        setChatLogs(prev => [...prev, {
          sender: "ai",
          text: "⚠️ The multi-agent collaboration encountered a blocking issue during technical validation. The timeline adjustments have been reverted."
        }]);
      }
    } catch (err: any) {
      logToTerminal(`MULTI_AGENT_ERROR: ${err.message}`);
    } finally {
      setIsMultiAgentExecuting(false);
    }
  };

  const handleSendPrompt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatMessage.trim()) return;

    const userMsg = chatMessage;
    setChatLogs(prev => [...prev, { sender: "user", text: userMsg }]);
    setChatMessage("");
    logToTerminal(`DISPATCH_PROMPT: "${userMsg}"`);

    // Intercept and route to specialized multi-agent workforce if matches creative terms
    const triggers = ["trailer", "cooperate", "agents", "supervisor", "apollo", "team", "production", "workforce", "cinematic", "creative team"];
    if (triggers.some(t => userMsg.toLowerCase().includes(t))) {
      await executeMultiAgentWorkflow(userMsg);
      return;
    }

    try {
      // Run master AI orchestrator
      const orchestrator = AiOrchestrator.getInstance();
      const result = await orchestrator.orchestrate(userMsg);
      
      setParsedResult(result.parsed);
      setActivePlan(result.plan);
      setRequiresConfirmation(result.requiresConfirmation);

      // AI Response summary
      const aiReply = `${result.summary} ${
        result.requiresConfirmation 
          ? "⚠️ SAFETY WARNING: Destructive actions detected. Please review the execution plan and confirm below to proceed." 
          : "Execution plan compiled. Commencing automated sequence..."
      }`;

      setChatLogs(prev => [...prev, { sender: "ai", text: aiReply }]);
      
      logToTerminal(`INTENT_DETECTED: [${result.parsed.intent.toUpperCase()}] (Confidence: ${Math.round(result.parsed.confidence * 100)}%)`);
      logToTerminal(`PLAN_GENERATED: Mapped ${result.plan.graph.priorityQueue.length} tasks. Parallel waves: ${result.plan.graph.parallelGroups.length}`);

      if (!result.requiresConfirmation) {
        // Run execution immediately if safe
        await startExecution(result.plan);
      }
    } catch (err: any) {
      logToTerminal(`ERROR: Orchestration failed - ${err.message}`);
      setChatLogs(prev => [...prev, { sender: "ai", text: `Sorry, I encountered an issue while compiling your request: ${err.message}` }]);
    }
  };

  const startExecution = async (plan: IAiExecutionPlan) => {
    setIsExecuting(true);
    setIsPaused(false);
    setRequiresConfirmation(false);
    logToTerminal("EXECUTION_START: Initiating transaction snapshot backup...");

    const orchestrator = AiOrchestrator.getInstance();
    
    // Simulate pipeline tasks execution visually in sync with orchestrator
    const tasks = plan.graph.priorityQueue;
    for (let i = 0; i < tasks.length; i++) {
      setCurrentTaskIndex(i);
      const taskId = tasks[i];
      const task = plan.graph.nodes[taskId];
      
      logToTerminal(`TASK_RUNNING: "${task.name}"`);
      
      // Execute step by step to sync UI progress
      setProgress(Math.floor((i / tasks.length) * 100));
      await new Promise(resolve => setTimeout(resolve, task.estimatedDurationMs / 10)); // visually snappy speed
      
      task.status = "completed";
      logToTerminal(`TASK_SUCCESS: "${task.name}" completed successfully.`);
    }

    setProgress(100);
    setIsExecuting(false);
    logToTerminal("EXECUTION_COMPLETE: Workflow finished. Releasing GPU lock.");

    // Determine redirect studio module
    const destination = orchestrator.getModuleSelector().routeAction(plan.originalRequest);
    if (destination.authorized && destination.mapping) {
      setChatLogs(prev => [...prev, { 
        sender: "ai", 
        text: `Execution completed successfully! Seamlessly redirecting you to [${destination.mapping.moduleName}] to inspect results.` 
      }]);
      setTimeout(() => {
        onNavigate(destination.mapping.pageId);
      }, 2000);
    }
  };

  const handleCancelPlan = () => {
    setActivePlan(null);
    setParsedResult(null);
    setRequiresConfirmation(false);
    setIsExecuting(false);
    logToTerminal("PIPELINE_CANCELLED: Execution plan discarded by user.");
    setChatLogs(prev => [...prev, { sender: "ai", text: "Execution plan cancelled. Standing by for your next instruction." }]);
  };

  const promptMacros = [
    { title: "🎬 Multi-Agent Trailer", desc: "Cooperate the specialized workforce to compile an elite cinematic trailer.", prompt: "Cooperate with the specialized team to create a cinematic trailer from my media clips." },
    { title: "Generate Cinematic LUT", desc: "Grade timeline tracks with Kodak warm 500T aesthetic.", prompt: "Apply a retro warm Kodak 500T grade to my video tracks." },
    { title: "Isolate Dialogue Track", desc: "Suppress background wind, hums, and compress levels.", prompt: "Analyze audio track 1, remove wind hum noise, and isolate speech." }
  ];

  const agentRoster = [
    { role: "supervisor" as AgentRole, name: "Apollo", title: "Project Director", desc: "Coordinates workforce task graphs, error boundaries, and asset distribution streams.", color: "text-purple-600 bg-purple-50/50 border-purple-200" },
    { role: "cinematic_researcher" as AgentRole, name: "Mnemosyne", title: "Reference Specialist", desc: "Compiles historic film reference mood-boards and aspect guidelines.", color: "text-orange-600 bg-orange-50/50 border-orange-200" },
    { role: "video_editor" as AgentRole, name: "Cassandra", title: "Cinema Cut Director", desc: "Automates scene boundaries matching temporal cadence guides.", color: "text-blue-600 bg-blue-50/50 border-blue-200" },
    { role: "audio_specialist" as AgentRole, name: "Aurelius", title: "Acoustic & Dialogue Specialist", desc: "Isolates dialogue tracks and attenuates high-frequency noise ceilings.", color: "text-emerald-600 bg-emerald-50/50 border-emerald-200" },
    { role: "color_grade_specialist" as AgentRole, name: "Chroma", title: "HDR Film Colorist", desc: "Maps professional cinematographic warm/cool LUT exposure grades.", color: "text-amber-600 bg-amber-50/50 border-amber-200" },
    { role: "vfx_specialist" as AgentRole, name: "Vesper", title: "Node FX Artist", desc: "Integrates complex planar tracked fluid particle smoke overlays.", color: "text-pink-600 bg-pink-50/50 border-pink-200" },
    { role: "motion_graphics_designer" as AgentRole, name: "Miles", title: "Choreographer", desc: "Designs dynamic SVG title transitions with elastic spring bezier curves.", color: "text-indigo-600 bg-indigo-50/50 border-indigo-200" },
    { role: "three_d_architect" as AgentRole, name: "Vega", title: "3D Spatial Mesh Designer", desc: "Controls 3D perspective virtual camera tracks and volumetric lights.", color: "text-cyan-600 bg-cyan-50/50 border-cyan-200" },
    { role: "render_optimization_engineer" as AgentRole, name: "Apex", title: "Transcoder & Render Eng", desc: "Leverages parallel multi-pass encoding and hardware accelerated grids.", color: "text-teal-600 bg-teal-50/50 border-teal-200" },
    { role: "quality_control_inspector" as AgentRole, name: "Aegis", title: "Compliance Auditor", desc: "Audits audio amplitude limits, legal boundaries, and confirms sign-offs.", color: "text-red-600 bg-red-50/50 border-red-200" }
  ];

  return (
    <div className="p-6 space-y-6 text-left h-full flex flex-col min-h-0 animate-in fade-in-50 duration-200">
      {/* Header title */}
      <div className="border-b border-border-light pb-4 shrink-0 flex justify-between items-end">
        <div>
          <span className="text-xs font-bold text-purple-600 uppercase tracking-wider font-mono flex items-center space-x-1.5">
            <Sparkles className="w-4 h-4 text-purple-600" />
            <span>Cognition Engine Core</span>
          </span>
          <h1 className="text-xl font-bold text-text-dark tracking-tight mt-0.5">AI Command Center</h1>
          <p className="text-xs text-gray-500 mt-1">
            Issue creative directions or launch specialized multi-agent workflows. System maps command paths into direct timeline adjustments.
          </p>
        </div>

        {/* Global Stats */}
        <div className="hidden md:flex space-x-4 text-right">
          <div className="bg-panel px-3 py-1.5 border border-border-light rounded-xl">
            <span className="text-[10px] text-gray-400 block font-mono">ACTIVE MINDS</span>
            <span className="text-xs font-bold text-purple-600 font-mono">10 COORDINATED</span>
          </div>
          <div className="bg-panel px-3 py-1.5 border border-border-light rounded-xl">
            <span className="text-[10px] text-gray-400 block font-mono">COLLAB CHANNEL</span>
            <span className="text-xs font-bold text-green-600 font-mono">BUS SECURE</span>
          </div>
        </div>
      </div>

      {/* Main interface splitting chat from execution logs */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden min-h-0">
        {/* Left Column: Chat or Workforce View */}
        <div className="lg:col-span-2 flex flex-col bg-card border border-border-light rounded-2xl overflow-hidden min-h-0">
          
          {/* Tabs header */}
          <div className="p-3 bg-panel/75 border-b border-border-light flex items-center justify-between shrink-0">
            <div className="flex space-x-2">
              <button 
                type="button"
                onClick={() => setActiveTab("chat")}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center space-x-1.5 ${
                  activeTab === "chat" 
                    ? "bg-text-dark text-white shadow-xs" 
                    : "text-gray-500 hover:text-text-dark hover:bg-btn-bg"
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Dialogue Terminal</span>
              </button>
              <button 
                type="button"
                onClick={() => setActiveTab("workforce")}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center space-x-1.5 ${
                  activeTab === "workforce" 
                    ? "bg-text-dark text-white shadow-xs" 
                    : "text-gray-500 hover:text-text-dark hover:bg-btn-bg"
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Specialized Creative Workforce</span>
                {isMultiAgentExecuting && (
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-purple-500"></span>
                  </span>
                )}
              </button>
            </div>
            
            <span className="text-[9px] font-mono text-purple-600 font-semibold flex items-center space-x-1">
              <Zap className="w-3 h-3 text-purple-600 animate-pulse" />
              <span>Apollo Coordinator Core</span>
            </span>
          </div>

          {/* Conditional rendering of Dialogue vs. Specialized Workforce */}
          {activeTab === "chat" ? (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Messages list */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar">
                {chatLogs.map((log, idx) => (
                  <div key={idx} className={`flex ${log.sender === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`p-3 rounded-2xl text-xs max-w-[85%] leading-relaxed ${
                      log.sender === "user" 
                        ? "bg-text-dark text-white rounded-tr-none" 
                        : "bg-panel border border-border-light text-text-dark rounded-tl-none"
                    }`}>
                      {log.text}
                    </div>
                  </div>
                ))}

                {/* Interactive Plan Breakdown */}
                {activePlan && (
                  <div className="p-4 bg-panel border border-border-light rounded-xl space-y-3 animate-in fade-in-50 duration-150">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-text-dark flex items-center space-x-1.5">
                        <Workflow className="w-3.5 h-3.5 text-purple-600" />
                        <span>Active Orchestration Graph [Plan ID: {activePlan.id}]</span>
                      </span>
                      <span className="text-[10px] font-mono text-gray-500">
                        Estimated: {Math.round(activePlan.estimatedTotalRuntimeMs / 1000)}s
                      </span>
                    </div>

                    {/* Parallel groups wave visualizations */}
                    <div className="space-y-3">
                      {activePlan.graph.parallelGroups.map((wave, waveIdx) => (
                        <div key={waveIdx} className="bg-card border border-border-light p-3 rounded-xl space-y-2">
                          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">
                            Wave {waveIdx + 1}: Parallel Execution Lane
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {wave.map(taskId => {
                              const task = activePlan.graph.nodes[taskId];
                              const isCurrent = isExecuting && activePlan.graph.priorityQueue[currentTaskIndex] === taskId;
                              
                              return (
                                <div 
                                  key={taskId} 
                                  className={`p-2.5 rounded-lg border text-left flex items-center justify-between transition-colors ${
                                    isCurrent 
                                      ? "bg-purple-50/50 border-purple-300 animate-pulse" 
                                      : task.status === "completed" 
                                      ? "bg-green-50/50 border-green-200" 
                                      : "bg-panel border-border-light"
                                  }`}
                                >
                                  <div className="space-y-0.5">
                                    <span className="text-xs font-bold text-text-dark block">{task.name}</span>
                                    <span className="text-[9px] font-mono text-gray-400 uppercase">
                                      Tool: {task.toolName} • {task.priority} Priority
                                    </span>
                                  </div>
                                  <div>
                                    {task.status === "completed" ? (
                                      <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                                    ) : isCurrent ? (
                                      <RotateCw className="w-4 h-4 text-purple-600 animate-spin shrink-0" />
                                    ) : (
                                      <Clock className="w-4 h-4 text-gray-300 shrink-0" />
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Safety warnings / Destructive confirmations overlay */}
                    {requiresConfirmation && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-xl space-y-2 text-left">
                        <div className="flex items-center space-x-1.5 text-red-600">
                          <ShieldAlert className="w-4 h-4 shrink-0 animate-bounce" />
                          <span className="text-xs font-bold">Destructive Action Warning Flagged</span>
                        </div>
                        <p className="text-[10px] text-red-500 leading-relaxed">
                          The following tasks require strict administrator confirmation prior to execution to protect project integrity:
                        </p>
                        <ul className="text-[10px] list-disc list-inside text-red-600 space-y-1 pl-1">
                          {activePlan.destructiveActions.map((desc, idx) => (
                            <li key={idx}>{desc}</li>
                          ))}
                        </ul>
                        <div className="flex space-x-2 pt-1.5 justify-end">
                          <button 
                            type="button"
                            onClick={handleCancelPlan}
                            className="px-3 py-1.5 bg-white border border-gray-200 text-gray-500 hover:bg-gray-50 rounded-lg text-xs font-bold cursor-pointer"
                          >
                            Abort Plan
                          </button>
                          <button 
                            type="button"
                            onClick={() => startExecution(activePlan)}
                            className="px-3 py-1.5 bg-red-600 text-white hover:bg-red-700 rounded-lg text-xs font-bold flex items-center cursor-pointer"
                          >
                            <Play className="w-3.5 h-3.5 mr-1" />
                            <span>Confirm & Execute</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Progress Bar when running */}
                    {isExecuting && (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between text-[10px] font-mono text-gray-500">
                          <span className="flex items-center space-x-1 animate-pulse">
                            <RotateCw className="w-3 h-3 animate-spin text-purple-600" />
                            <span>Executing Wave Plans...</span>
                          </span>
                          <span>{progress}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-purple-600 transition-all duration-300" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Form input */}
              <form onSubmit={handleSendPrompt} className="p-3 border-t border-border-light bg-panel/20 shrink-0 flex space-x-2">
                <input
                  type="text"
                  placeholder="Ask Apollo to orchestrate... (try typing 'Create a cinematic trailer')"
                  value={chatMessage}
                  onChange={(e) => setChatMessage(e.target.value)}
                  className="flex-1 h-9 px-3 bg-btn-bg border border-border-light rounded-xl text-xs text-text-dark focus:outline-none"
                />
                <button 
                  type="submit" 
                  disabled={isMultiAgentExecuting}
                  className="px-4 bg-text-dark text-white rounded-xl text-xs font-semibold hover:bg-opacity-90 flex items-center justify-center cursor-pointer shadow-xs disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5 mr-1.5" />
                  <span>Dispatch</span>
                </button>
              </form>
            </div>
          ) : (
            // Specialized Workforce Tab View
            <div className="flex-1 flex flex-col md:grid md:grid-cols-5 min-h-0 overflow-hidden text-left divide-y md:divide-y-0 md:divide-x divide-border-light">
              
              {/* Left 2 columns: Agent Roster List */}
              <div className="md:col-span-2 flex flex-col min-h-0 overflow-y-auto p-4 space-y-3 no-scrollbar">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1">
                  Active Creative Roster
                </div>
                
                <div className="space-y-2">
                  {agentRoster.map((agent) => (
                    <button
                      key={agent.role}
                      type="button"
                      onClick={() => setSelectedAgentRole(agent.role)}
                      className={`w-full p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-start space-x-2.5 ${
                        selectedAgentRole === agent.role 
                          ? "bg-purple-50/70 border-purple-300 shadow-xs" 
                          : "bg-panel hover:bg-btn-bg border-border-light"
                      }`}
                    >
                      <span className={`h-7 w-7 rounded-lg font-mono text-xs font-bold flex items-center justify-center border shrink-0 ${agent.color}`}>
                        {agent.name.substring(0, 2)}
                      </span>
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center space-x-1.5">
                          <span className="text-xs font-bold text-text-dark truncate">{agent.name}</span>
                          <span className="text-[8px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded font-mono uppercase shrink-0">
                            {agent.role.replace("_", " ")}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-400 line-clamp-1">{agent.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Right 3 columns: Inspector & Live Task status */}
              <div className="md:col-span-3 flex flex-col min-h-0 overflow-y-auto p-4 space-y-4">
                
                {/* Active pipeline execution board */}
                {agentTasks.length > 0 ? (
                  <div className="bg-panel border border-border-light rounded-xl p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-text-dark flex items-center space-x-1.5">
                        <Activity className="w-4 h-4 text-purple-600 animate-pulse" />
                        <span>Active Multi-Agent Task Pipeline</span>
                      </span>
                      <span className="text-[10px] font-mono text-purple-600 font-bold bg-purple-50 px-2 py-0.5 rounded border border-purple-100">
                        {isMultiAgentExecuting ? "RUNNING" : "DELIVERABLES COMPLETED"}
                      </span>
                    </div>

                    <div className="space-y-2 max-h-56 overflow-y-auto no-scrollbar">
                      {agentTasks.map((t) => (
                        <div 
                          key={t.id} 
                          className={`p-2.5 rounded-lg border text-left flex flex-col space-y-1.5 transition-colors ${
                            t.status === "working" 
                              ? "bg-purple-50/50 border-purple-200 animate-pulse" 
                              : t.status === "approved" 
                              ? "bg-green-50/50 border-green-200" 
                              : t.status === "verifying"
                              ? "bg-amber-50/50 border-amber-200"
                              : "bg-card border-border-light"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-text-dark leading-tight">{t.name}</span>
                            <span className="text-[9px] font-mono text-gray-400 shrink-0">
                              Assigned: {agentRoster.find(r => r.role === t.assignedTo)?.name || t.assignedTo}
                            </span>
                          </div>
                          
                          <p className="text-[10px] text-gray-400 leading-normal">{t.description}</p>
                          
                          {/* Live Task Result Payload Output */}
                          {t.outputResult && (
                            <div className="text-[9px] bg-white border border-gray-100 p-1.5 rounded font-mono text-gray-500 overflow-x-auto">
                              <span className="text-purple-600 font-bold">Output Payload:</span>{" "}
                              {JSON.stringify(t.outputResult)}
                            </div>
                          )}

                          {t.verificationComments && t.verificationComments.length > 0 && (
                            <div className="text-[9px] text-amber-600 font-mono bg-amber-50/30 p-1 rounded">
                              ⚠️ QC Flag: {t.verificationComments.join("; ")}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  // Trigger Board when idle
                  <div className="p-4 bg-purple-50/40 border border-dashed border-purple-200 rounded-2xl text-center space-y-3">
                    <span className="h-10 w-10 rounded-full bg-purple-50 text-purple-600 flex items-center justify-center mx-auto border border-purple-100">
                      <Cpu className="w-5 h-5" />
                    </span>
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold text-text-dark">Collaborate Coordinated Workflows</h4>
                      <p className="text-[10px] text-gray-500 leading-relaxed max-w-sm mx-auto">
                        Ready to assemble the complete production team. Apollo will delegate research, scene-detection, LUT mapping, noise attenuation, composite rendering, and quality sign-off tasks.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => executeMultiAgentWorkflow("Create cinematic trailer from active clips.")}
                      className="px-3.5 py-1.5 bg-text-dark text-white text-xs font-bold rounded-xl hover:bg-opacity-90 inline-flex items-center cursor-pointer shadow-xs"
                    >
                      <Play className="w-3.5 h-3.5 mr-1.5" />
                      <span>Assemble Team & Compile Trailer</span>
                    </button>
                  </div>
                )}

                {/* Agent Detail Panel (when selected) */}
                {selectedAgentRole ? (
                  <div className="bg-card border border-border-light rounded-xl p-4 space-y-3">
                    {(() => {
                      const rosterInfo = agentRoster.find(r => r.role === selectedAgentRole)!;
                      const agentInstance = AiOrchestrator.getInstance().getSupervisor().getWorkforce().get(selectedAgentRole) 
                        || AiOrchestrator.getInstance().getSupervisor(); // fallback to supervisor
                      
                      return (
                        <>
                          <div className="flex items-start justify-between">
                            <div className="flex items-center space-x-2.5">
                              <span className={`h-8 w-8 rounded-lg font-mono text-xs font-bold flex items-center justify-center border shrink-0 ${rosterInfo.color}`}>
                                {rosterInfo.name.substring(0, 2)}
                              </span>
                              <div>
                                <h3 className="text-xs font-bold text-text-dark">{rosterInfo.name}</h3>
                                <span className="text-[9px] font-mono text-gray-400 block uppercase">
                                  {rosterInfo.title} • Role: {selectedAgentRole}
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => setSelectedAgentRole(null)}
                              className="text-gray-400 hover:text-text-dark text-xs font-bold font-mono"
                            >
                              [X]
                            </button>
                          </div>

                          <div className="space-y-2 border-t border-border-light pt-3">
                            <div>
                              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Specialized Capabilities:</span>
                              <ul className="list-disc list-inside text-[10px] text-gray-400 space-y-1 mt-1 pl-1">
                                {agentInstance.capabilities.map((cap, i) => (
                                  <li key={i}>{cap}</li>
                                ))}
                              </ul>
                            </div>

                            <div className="grid grid-cols-2 gap-3 pt-1">
                              <div>
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Memory Register:</span>
                                <span className="text-[9px] font-mono text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-100 inline-block mt-1">
                                  {agentInstance.memory.shortTermMemory.length} Messages Cached
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Task Count:</span>
                                <span className="text-[9px] font-mono text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 inline-block mt-1">
                                  {agentInstance.memory.taskHistory.length} Cycles Completed
                                </span>
                              </div>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="text-[10px] text-gray-400 text-center italic py-2 border border-dashed border-border-light rounded-xl">
                    Click any specialized agent on the roster to inspect their capabilities, local memory banks, and history parameters.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Execution Terminal & Collaboration Logs */}
        <div className="space-y-4 flex flex-col justify-between min-h-0">
          
          {/* Supervisor Collaboration Logs */}
          <div className="bg-card border border-border-light p-4 rounded-2xl shrink-0 text-left space-y-3 flex-1 flex flex-col overflow-hidden min-h-0">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide flex items-center space-x-1.5 shrink-0">
              <Users className="w-3.5 h-3.5 text-purple-600" />
              <span>Supervisor Collaboration Log</span>
            </span>

            {collaborationLogs.length > 0 ? (
              <div className="flex-1 overflow-y-auto no-scrollbar space-y-2.5 pr-1 min-h-0">
                {collaborationLogs.map((log, idx) => (
                  <div key={idx} className="p-2 bg-panel border border-border-light rounded-xl space-y-1 text-[10px] animate-in slide-in-from-bottom-2 duration-150">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-purple-600 uppercase tracking-wider font-mono text-[8px]">
                        {log.from.replace("_", " ")} → {log.to.replace("_", " ")}
                      </span>
                      <span className="text-[8px] text-gray-400 font-mono">
                        {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                    </div>
                    <div className="font-bold text-text-dark text-[9.5px] leading-snug">{log.subject}</div>
                    <p className="text-gray-400 leading-normal">{log.detail}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-4 border border-dashed border-border-light rounded-2xl text-[10px] text-gray-400 italic">
                <span>No team collaboration logs logged yet. Dispatch a creative prompt or trigger the compilation sequence.</span>
              </div>
            )}
          </div>

          {/* Live system logs mock terminal */}
          <div className="h-44 bg-text-dark rounded-2xl p-4 flex flex-col justify-between overflow-hidden text-left border border-gray-800 font-mono shadow-inner shrink-0">
            <div className="flex justify-between items-center border-b border-gray-800 pb-2 shrink-0">
              <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wider flex items-center space-x-1">
                <Terminal className="w-3 h-3 text-green-400" />
                <span>Execution Logs Terminal</span>
              </span>
              <span className="w-2 h-2 rounded-full bg-green-500 animate-ping"></span>
            </div>

            {/* Scrollable logs */}
            <div className="flex-1 overflow-y-auto no-scrollbar py-2 text-[9px] text-green-400 space-y-1 min-h-0">
              {executionLogs.map((log, idx) => (
                <div key={idx} className="leading-relaxed break-all">
                  {log}
                </div>
              ))}
            </div>

            <div className="border-t border-gray-800 pt-2 shrink-0 flex justify-between text-[8px] text-gray-500">
              <span>WORKFORCE: RUNNING</span>
              <span>GPU UTILITY: EXCELLENT</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
