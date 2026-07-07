import React, { useState } from "react";
import { 
  Sliders, 
  Volume2, 
  Type, 
  Palette, 
  Sparkles, 
  Box, 
  Info, 
  Eye, 
  Activity,
  Compass,
  SlidersHorizontal
} from "lucide-react";

interface ContextualInspectorProps {
  selectedClipId: string | null;
  activeWorkspace: string;
  isProfessionalMode: boolean;
  colorGradeEnabled: boolean;
  onToggleColorGrade: () => void;
}

export default function ContextualInspector({
  selectedClipId,
  activeWorkspace,
  isProfessionalMode,
  colorGradeEnabled,
  onToggleColorGrade
}: ContextualInspectorProps) {
  // Localized interactive tweak states
  const [videoScale, setVideoScale] = useState(100);
  const [videoOpacity, setVideoOpacity] = useState(100);
  const [audioVolume, setAudioVolume] = useState(-3); // in dB
  const [noiseReduction, setNoiseReduction] = useState(40); // %
  const [fontFamily, setFontFamily] = useState("Space Grotesk");
  const [fontSize, setFontSize] = useState(24);
  const [fontColor, setFontColor] = useState("#FFFFFF");
  const [glitchIntensity, setGlitchIntensity] = useState(65);
  const [gradientType, setGradientType] = useState("linear");
  
  // DaVinci Resolve-style color grading states
  const [colorLift, setColorLift] = useState(0);
  const [colorGamma, setColorGamma] = useState(5);
  const [colorGain, setColorGain] = useState(0);
  const [colorContrast, setColorContrast] = useState(120);
  const [colorTemp, setColorTemp] = useState(5600); // Kelvin

  // 3D Object states (Blender-style)
  const [meshType, setMeshType] = useState<"cube" | "sphere" | "torus">("cube");
  const [objX, setObjX] = useState(0.0);
  const [objY, setObjY] = useState(1.2);
  const [objZ, setObjZ] = useState(-3.5);
  const [materialMetal, setMaterialMetal] = useState(75); // metallic %

  // Helper determining the context to display
  const getSelectedContext = () => {
    if (selectedClipId) {
      if (selectedClipId.startsWith("v")) return "video";
      if (selectedClipId.startsWith("a")) return "audio";
      if (selectedClipId.startsWith("t")) return "text";
      if (selectedClipId.startsWith("e")) return "vfx";
    }
    // Fallback to active workspace setting if no specific clip is selected
    if (activeWorkspace === "color") return "color";
    if (activeWorkspace === "audio") return "audio";
    if (activeWorkspace === "3d") return "3d";
    if (activeWorkspace === "vfx") return "vfx";
    if (activeWorkspace === "motion") return "motion";
    return "general";
  };

  const context = getSelectedContext();

  return (
    <div className="bg-panel border border-border-light rounded-3xl p-5 flex flex-col justify-between overflow-hidden shadow-xs h-full min-h-[420px] text-left">
      <div className="space-y-4 overflow-y-auto no-scrollbar flex-1 pr-1">
        {/* Header */}
        <div className="border-b border-border-light pb-3">
          <div className="flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-icon-gray" />
            <h3 className="text-xs font-bold text-text-dark uppercase tracking-wider font-mono">Properties Inspector</h3>
          </div>
          <p className="text-[10px] text-gray-500 font-medium mt-1">
            {selectedClipId 
              ? `Inspecting clip ID: ${selectedClipId}` 
              : `Inspecting Workspace: ${activeWorkspace}`}
          </p>
        </div>

        {/* 1. VIDEO INSPECTOR */}
        {context === "video" && (
          <div className="space-y-4 animate-in fade-in-50 duration-150">
            <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider font-mono block">TRANSFORM CONTROLS</span>
            
            <div className="space-y-3 bg-white p-3.5 border border-border-light rounded-xl">
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-text-dark">
                  <span>Scale / Zoom</span>
                  <span className="font-mono">{videoScale}%</span>
                </div>
                <input 
                  type="range" 
                  min="10" 
                  max="250" 
                  value={videoScale}
                  onChange={(e) => setVideoScale(Number(e.target.value))}
                  className="w-full accent-blue-600 h-1 bg-gray-200 rounded-full cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-text-dark">
                  <span>Opacity / Transparency</span>
                  <span className="font-mono">{videoOpacity}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={videoOpacity}
                  onChange={(e) => setVideoOpacity(Number(e.target.value))}
                  className="w-full accent-blue-600 h-1 bg-gray-200 rounded-full cursor-pointer"
                />
              </div>
            </div>

            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider font-mono block">CHROMA KEY REMOVAL</span>
            <button 
              onClick={() => alert("Chroma Key smart filter active. Analyzing green screen backdrops.")}
              className="w-full py-2 bg-btn-bg hover:bg-primary-bg text-text-dark border border-border-light rounded-xl text-xs font-bold transition-all cursor-pointer text-center"
            >
              Enable Smart Keyer (Auto-cut)
            </button>
          </div>
        )}

        {/* 2. AUDIO INSPECTOR */}
        {context === "audio" && (
          <div className="space-y-4 animate-in fade-in-50 duration-150">
            <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider font-mono block">AUDIO MIXER GAIN</span>
            
            <div className="space-y-3 bg-white p-3.5 border border-border-light rounded-xl">
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-text-dark">
                  <span>Output Fader</span>
                  <span className="font-mono">{audioVolume > 0 ? `+${audioVolume}` : audioVolume} dB</span>
                </div>
                <input 
                  type="range" 
                  min="-60" 
                  max="12" 
                  value={audioVolume}
                  onChange={(e) => setAudioVolume(Number(e.target.value))}
                  className="w-full accent-indigo-600 h-1 bg-gray-200 rounded-full cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-text-dark">
                  <span>Noise Reduction (De-Noise)</span>
                  <span className="font-mono">{noiseReduction}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={noiseReduction}
                  onChange={(e) => setNoiseReduction(Number(e.target.value))}
                  className="w-full accent-indigo-600 h-1 bg-gray-200 rounded-full cursor-pointer"
                />
              </div>
            </div>

            <div className="p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl space-y-1">
              <span className="text-[10px] font-bold text-indigo-700 font-mono block uppercase">SMART AUDIO COGNITION</span>
              <p className="text-[10px] text-gray-600 leading-relaxed">
                Enable auto-ducking to decrease atmospheric soundtrack volumes by -15dB automatically during voice subtitles.
              </p>
            </div>
          </div>
        )}

        {/* 3. TYPOGRAPHY / TEXT INSPECTOR */}
        {context === "text" && (
          <div className="space-y-4 animate-in fade-in-50 duration-150">
            <span className="text-[10px] font-bold text-rose-600 uppercase tracking-wider font-mono block">TYPOGRAPHY CONTROLS</span>
            
            <div className="space-y-3 bg-white p-3.5 border border-border-light rounded-xl">
              <div className="flex flex-col space-y-1.5">
                <label className="text-[10px] font-bold text-gray-500 font-sans">Font Family</label>
                <select 
                  value={fontFamily} 
                  onChange={(e) => setFontFamily(e.target.value)}
                  className="px-2.5 py-1.5 bg-btn-bg border border-border-light rounded-lg text-xs font-semibold focus:outline-none cursor-pointer"
                >
                  <option value="Space Grotesk">Space Grotesk (Tech)</option>
                  <option value="Inter">Inter (Swiss Modern)</option>
                  <option value="JetBrains Mono">JetBrains Mono (Console)</option>
                </select>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-text-dark">
                  <span>Font Size</span>
                  <span className="font-mono">{fontSize}px</span>
                </div>
                <input 
                  type="range" 
                  min="12" 
                  max="96" 
                  value={fontSize}
                  onChange={(e) => setFontSize(Number(e.target.value))}
                  className="w-full accent-rose-500 h-1 bg-gray-200 rounded-full cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[11px] font-semibold text-text-dark">Font Fill Color</span>
                <input 
                  type="color" 
                  value={fontColor} 
                  onChange={(e) => setFontColor(e.target.value)}
                  className="w-8 h-8 rounded-lg cursor-pointer border border-border-light"
                />
              </div>
            </div>

            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider font-mono block">AI AUTOTRANSLATION</span>
            <button 
              onClick={() => alert("Subtitles auto-translated into Japanese, French, and Spanish.")}
              className="w-full py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold transition-all cursor-pointer text-center"
            >
              Generate Multi-lingual Captions
            </button>
          </div>
        )}

        {/* 4. EFFECTS / VFX INSPECTOR */}
        {context === "vfx" && (
          <div className="space-y-4 animate-in fade-in-50 duration-150">
            <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider font-mono block">PARTICLE EMISSION ENGINE</span>
            
            <div className="space-y-3 bg-white p-3.5 border border-border-light rounded-xl">
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-text-dark">
                  <span>Glitch Warp Density</span>
                  <span className="font-mono">{glitchIntensity}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={glitchIntensity}
                  onChange={(e) => setGlitchIntensity(Number(e.target.value))}
                  className="w-full accent-amber-500 h-1 bg-gray-200 rounded-full cursor-pointer"
                />
              </div>

              <div className="flex flex-col space-y-1">
                <span className="text-[10px] font-bold text-gray-500">Node Compositing blending</span>
                <span className="text-xs text-text-dark font-mono font-bold bg-primary-bg px-2.5 py-1 rounded-lg border border-border-light/60">
                  Blending Mode: Screen Add (RGB)
                </span>
              </div>
            </div>

            {isProfessionalMode && (
              <div className="p-3 bg-amber-50/50 border border-amber-200 rounded-xl">
                <span className="text-[9px] font-bold text-amber-700 font-mono uppercase block">Node Graph Compositor Input</span>
                <span className="text-[10px] text-gray-500 block leading-relaxed mt-0.5">
                  Connected: Input Clip ↔ Warp Node ↔ Chroma Keyer ↔ Output
                </span>
              </div>
            )}
          </div>
        )}

        {/* 5. COLOR GRADING INSPECTOR */}
        {context === "color" && (
          <div className="space-y-4 animate-in fade-in-50 duration-150">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider font-mono">COLOR MATRIX grading</span>
              <button 
                onClick={onToggleColorGrade}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border transition-all cursor-pointer ${
                  colorGradeEnabled 
                    ? "bg-emerald-100 text-emerald-800 border-emerald-300" 
                    : "bg-gray-100 text-gray-500 border-gray-300 hover:text-text-dark"
                }`}
              >
                {colorGradeEnabled ? "LUT ACTIVE" : "LUT BYPASSED"}
              </button>
            </div>

            {/* Resolve styled wheels simulation */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="flex flex-col items-center bg-white p-2 border border-border-light rounded-xl">
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">Lift</span>
                <div className="w-10 h-10 rounded-full border-2 border-emerald-500 relative my-1.5 bg-gradient-to-tr from-slate-100 to-slate-200">
                  <div className="absolute w-2 h-2 bg-emerald-600 rounded-full cursor-pointer top-1/3 left-1/3 shadow" style={{ transform: `translate(${colorLift}px, ${colorLift}px)` }}></div>
                </div>
                <input 
                  type="range" 
                  min="-10" 
                  max="10" 
                  value={colorLift} 
                  onChange={(e) => setColorLift(Number(e.target.value))}
                  className="w-full accent-emerald-500 scale-75"
                />
              </div>

              <div className="flex flex-col items-center bg-white p-2 border border-border-light rounded-xl">
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">Gamma</span>
                <div className="w-10 h-10 rounded-full border-2 border-emerald-500 relative my-1.5 bg-gradient-to-tr from-slate-100 to-slate-200">
                  <div className="absolute w-2 h-2 bg-emerald-600 rounded-full cursor-pointer top-1/2 left-1/2 shadow" style={{ transform: `translate(${colorGamma - 5}px, ${colorGamma - 5}px)` }}></div>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="10" 
                  value={colorGamma} 
                  onChange={(e) => setColorGamma(Number(e.target.value))}
                  className="w-full accent-emerald-500 scale-75"
                />
              </div>

              <div className="flex flex-col items-center bg-white p-2 border border-border-light rounded-xl">
                <span className="text-[9px] font-bold text-gray-500 uppercase tracking-wider">Gain</span>
                <div className="w-10 h-10 rounded-full border-2 border-emerald-500 relative my-1.5 bg-gradient-to-tr from-slate-100 to-slate-200">
                  <div className="absolute w-2 h-2 bg-emerald-600 rounded-full cursor-pointer top-2/3 left-2/3 shadow" style={{ transform: `translate(${colorGain}px, ${colorGain}px)` }}></div>
                </div>
                <input 
                  type="range" 
                  min="-10" 
                  max="10" 
                  value={colorGain} 
                  onChange={(e) => setColorGain(Number(e.target.value))}
                  className="w-full accent-emerald-500 scale-75"
                />
              </div>
            </div>

            {/* Custom curves contrast levels */}
            <div className="space-y-3 bg-white p-3.5 border border-border-light rounded-xl">
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-text-dark">
                  <span>S-Curve Contrast</span>
                  <span className="font-mono">{colorContrast}</span>
                </div>
                <input 
                  type="range" 
                  min="50" 
                  max="200" 
                  value={colorContrast}
                  onChange={(e) => setColorContrast(Number(e.target.value))}
                  className="w-full accent-emerald-500 h-1 bg-gray-200 rounded-full cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-text-dark">
                  <span>Temperature (Kelvin)</span>
                  <span className="font-mono">{colorTemp}K</span>
                </div>
                <input 
                  type="range" 
                  min="2000" 
                  max="10000" 
                  step="100"
                  value={colorTemp}
                  onChange={(e) => setColorTemp(Number(e.target.value))}
                  className="w-full accent-emerald-500 h-1 bg-gray-200 rounded-full cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}

        {/* 6. 3D VIEWPORT OBJECT INSPECTOR */}
        {context === "3d" && (
          <div className="space-y-4 animate-in fade-in-50 duration-150">
            <span className="text-[10px] font-bold text-teal-600 uppercase tracking-wider font-mono block">MESH TRANSFORM MATRIX</span>
            
            <div className="space-y-3 bg-white p-3.5 border border-border-light rounded-xl">
              <div className="flex flex-col space-y-1">
                <span className="text-[10px] font-bold text-gray-500">Geometry primitive</span>
                <div className="grid grid-cols-3 gap-1 bg-primary-bg p-1 rounded-lg">
                  {["cube", "sphere", "torus"].map(type => (
                    <button
                      key={type}
                      onClick={() => setMeshType(type as any)}
                      className={`py-1 text-[10px] font-bold capitalize rounded-md cursor-pointer transition-all ${
                        meshType === type 
                          ? "bg-btn-bg text-teal-700 shadow-2xs" 
                          : "text-gray-500 hover:text-text-dark"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col space-y-1">
                  <span className="text-[9px] font-bold text-gray-500 font-mono">POS X</span>
                  <input 
                    type="number" 
                    step="0.1" 
                    value={objX} 
                    onChange={(e) => setObjX(Number(e.target.value))}
                    className="px-2 py-1 bg-primary-bg/50 border border-border-light rounded-lg text-xs font-mono font-bold focus:outline-none"
                  />
                </div>
                <div className="flex flex-col space-y-1">
                  <span className="text-[9px] font-bold text-gray-500 font-mono">POS Y</span>
                  <input 
                    type="number" 
                    step="0.1" 
                    value={objY} 
                    onChange={(e) => setObjY(Number(e.target.value))}
                    className="px-2 py-1 bg-primary-bg/50 border border-border-light rounded-lg text-xs font-mono font-bold focus:outline-none"
                  />
                </div>
                <div className="flex flex-col space-y-1">
                  <span className="text-[9px] font-bold text-gray-500 font-mono">POS Z</span>
                  <input 
                    type="number" 
                    step="0.1" 
                    value={objZ} 
                    onChange={(e) => setObjZ(Number(e.target.value))}
                    className="px-2 py-1 bg-primary-bg/50 border border-border-light rounded-lg text-xs font-mono font-bold focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] font-semibold text-text-dark">
                  <span>Metallic PBR Material</span>
                  <span className="font-mono">{materialMetal}%</span>
                </div>
                <input 
                  type="range" 
                  min="0" 
                  max="100" 
                  value={materialMetal}
                  onChange={(e) => setMaterialMetal(Number(e.target.value))}
                  className="w-full accent-teal-600 h-1 bg-gray-200 rounded-full cursor-pointer"
                />
              </div>
            </div>

            <div className="p-3 bg-teal-50 border border-teal-100 rounded-xl space-y-1">
              <span className="text-[10px] font-bold text-teal-700 block uppercase font-mono">RAY TRACING METRICS</span>
              <p className="text-[10px] text-gray-500 block leading-normal">Active Camera: PathTracing 512 samples. Ready for rasterization.</p>
            </div>
          </div>
        )}

        {/* 7. GENERAL NOTIFICATION INFO */}
        {context === "general" && (
          <div className="space-y-4 animate-in fade-in-50 duration-150 py-4 flex flex-col items-center justify-center text-center h-48">
            <Info className="w-8 h-8 text-gray-400 mb-2" />
            <span className="text-xs font-bold text-text-dark">Select a Clip to Tweak Properties</span>
            <p className="text-[10px] text-gray-500 leading-normal max-w-[180px] mx-auto mt-1">
              Selecting a timeline item automatically expands localized knobs for video, audio, text, curves, or 3D scene parameters.
            </p>
          </div>
        )}
      </div>

      {/* Render Output Presets (Beginner CapCut export templates list) */}
      <div className="pt-3 border-t border-border-light shrink-0">
        <div className="p-3 bg-white border border-border-light rounded-xl flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-[9px] font-bold text-gray-400 font-mono uppercase block">SaaS Sync State</span>
            <span className="text-[11px] font-bold text-emerald-600 flex items-center space-x-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping"></span>
              <span>Fully Cloud-Synced</span>
            </span>
          </div>

          <button 
            onClick={() => alert("Quick exported vertical social draft sequence!")}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-[11px] font-bold rounded-xl shadow-xs transition-all cursor-pointer"
          >
            CapCut Express
          </button>
        </div>
      </div>
    </div>
  );
}
