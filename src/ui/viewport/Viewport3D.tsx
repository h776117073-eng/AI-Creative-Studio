import React, { useState } from "react";
import { 
  Box, 
  Camera, 
  Sun, 
  Move, 
  RotateCw, 
  Maximize, 
  Compass, 
  Eye, 
  Layers,
  Plus,
  Trash2,
  Grid
} from "lucide-react";

interface Viewport3DProps {
  selectedMeshId: string;
  onSelectMesh: (meshId: string) => void;
}

export default function Viewport3D({
  selectedMeshId,
  onSelectMesh
}: Viewport3DProps) {
  const [transformMode, setTransformMode] = useState<"translate" | "rotate" | "scale">("translate");
  const [gridSnapping, setGridSnapping] = useState(true);
  const [cameraFOV, setCameraFOV] = useState(45);
  const [lightIntensity, setLightIntensity] = useState(1.5);
  
  // Immersive 3D scene tree objects list
  const [sceneObjects, setSceneObjects] = useState([
    { id: "obj_cam", name: "Main Cinematic Camera", type: "camera", active: true },
    { id: "obj_light", name: "Directional Sun Light", type: "light", active: true },
    { id: "obj_m1", name: "Cyberpunk_Grid_Logo (Cube)", type: "mesh", active: true },
    { id: "obj_m2", name: "Nebula_Sphere_Overlay (Sphere)", type: "mesh", active: false },
  ]);

  const handleToggleObject = (id: string) => {
    setSceneObjects(prev => prev.map(obj => obj.id === id ? { ...obj, active: !obj.active } : obj));
  };

  const handleAddMesh = () => {
    const meshName = prompt("Enter Mesh Node Name:", "Custom Torus Node");
    if (meshName) {
      setSceneObjects([
        ...sceneObjects,
        {
          id: `obj_${Date.now()}`,
          name: `${meshName} (Torus)`,
          type: "mesh",
          active: true
        }
      ]);
    }
  };

  return (
    <div className="bg-panel border border-border-light rounded-3xl p-5 flex flex-col lg:flex-row gap-5 overflow-hidden shadow-xs h-full min-h-[420px] text-left">
      
      {/* Viewport Render Screen Area */}
      <div className="flex-1 bg-black/95 rounded-2xl p-4 flex flex-col justify-between relative overflow-hidden border border-gray-800 shadow-inner">
        {/* Render View Header Controls */}
        <div className="flex justify-between items-center z-10">
          {/* Gizmo toolbars */}
          <div className="flex items-center space-x-1.5 bg-black/60 p-1.5 rounded-xl border border-white/10">
            {[
              { mode: "translate", icon: Move, title: "Translation Gizmo" },
              { mode: "rotate", icon: RotateCw, title: "Rotation Gizmo" },
              { mode: "scale", icon: Maximize, title: "Scale Gizmo" },
            ].map(tool => {
              const Icon = tool.icon;
              const isActive = transformMode === tool.mode;
              return (
                <button
                  key={tool.mode}
                  onClick={() => setTransformMode(tool.mode as any)}
                  className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                    isActive 
                      ? "bg-teal-500 text-white shadow-sm" 
                      : "text-gray-400 hover:text-white"
                  }`}
                  title={tool.title}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>

          <button
            onClick={() => setGridSnapping(!gridSnapping)}
            className={`px-2.5 py-1.5 rounded-xl border text-[10px] font-bold transition-all cursor-pointer flex items-center space-x-1 ${
              gridSnapping 
                ? "bg-teal-500/10 border-teal-500/20 text-teal-400" 
                : "bg-black/60 border-white/10 text-gray-400"
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>Grid Snapping</span>
          </button>
        </div>

        {/* 3D Wireframe / Perspective Grid simulation */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-12">
          {/* Virtual perspective grid lanes */}
          <div className="w-full h-full border border-teal-500/10 rounded-full relative rotate-x-60 scale-y-50 animate-[spin_40s_linear_infinite]">
            <div className="absolute inset-4 border border-dashed border-teal-500/5 rounded-full"></div>
            <div className="absolute inset-10 border border-dotted border-teal-500/5 rounded-full"></div>
            {/* Grid cross lines */}
            <div className="absolute left-1/2 top-0 bottom-0 w-[1px] bg-teal-500/10"></div>
            <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-teal-500/10"></div>
          </div>

          <div className="absolute text-center space-y-1 mt-10">
            <Compass className="w-10 h-10 text-teal-400/40 animate-pulse mx-auto" />
            <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest block">Blender Viewport Active</span>
            <span className="text-[9px] text-gray-600 block">Perspective: Orbit {cameraFOV}° • Samples: 128px</span>
          </div>
        </div>

        {/* HUD metric indicators */}
        <div className="flex justify-between items-end z-10">
          <div className="bg-black/60 border border-white/10 px-2 py-1 text-[9px] font-mono text-gray-400 rounded-lg">
            Axis Alignment: X, Y, Z (WCS)
          </div>

          <div className="bg-black/60 border border-white/10 p-2 text-[9px] font-mono text-gray-400 rounded-lg space-y-1">
            <div className="flex justify-between space-x-4">
              <span>FOV Field:</span>
              <span className="text-white font-bold">{cameraFOV}°</span>
            </div>
            <input 
              type="range" 
              min="20" 
              max="90" 
              value={cameraFOV} 
              onChange={(e) => setCameraFOV(Number(e.target.value))}
              className="w-20 accent-teal-500 h-0.5 bg-gray-800 rounded-full"
            />
          </div>
        </div>
      </div>

      {/* Right Scene Hierarchy list panel */}
      <div className="w-full lg:w-64 flex flex-col justify-between shrink-0 space-y-4">
        <div className="space-y-3 bg-white p-4 border border-border-light rounded-2xl flex-1 overflow-y-auto no-scrollbar">
          <div className="flex justify-between items-center border-b border-border-light pb-2">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider font-mono">Scene Hierarchy</span>
            <button 
              onClick={handleAddMesh}
              className="p-1 hover:bg-teal-50 rounded text-teal-600 cursor-pointer"
              title="Add 3D Primitive"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* List hierarchy items */}
          <div className="space-y-1.5">
            {sceneObjects.map(obj => {
              const Icon = obj.type === "camera" ? Camera : obj.type === "light" ? Sun : Box;
              const isSelected = selectedMeshId === obj.id;
              return (
                <div 
                  key={obj.id}
                  onClick={() => onSelectMesh(obj.id)}
                  className={`p-2 rounded-xl border flex items-center justify-between text-xs cursor-pointer transition-all ${
                    isSelected 
                      ? "bg-teal-50 border-teal-200 text-teal-800 font-bold" 
                      : "bg-primary-bg/20 border-border-light/60 hover:border-teal-300"
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    <Icon className={`w-3.5 h-3.5 ${isSelected ? "text-teal-600" : "text-gray-500"}`} />
                    <span className="truncate">{obj.name}</span>
                  </div>

                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggleObject(obj.id);
                    }}
                    className={`p-1 rounded ${obj.active ? "text-teal-600" : "text-gray-400"}`}
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Lighting controls cards */}
        <div className="bg-white p-4 border border-border-light rounded-2xl space-y-2.5">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider font-mono block">Sun Lighting Controls</span>
          <div className="space-y-1 text-xs text-text-dark font-semibold">
            <div className="flex justify-between text-[11px]">
              <span>Sun Intensity</span>
              <span className="font-mono">{lightIntensity} lux</span>
            </div>
            <input 
              type="range" 
              min="0.2" 
              max="5.0" 
              step="0.1"
              value={lightIntensity} 
              onChange={(e) => setLightIntensity(Number(e.target.value))}
              className="w-full accent-teal-600 h-1 bg-gray-200 rounded-full cursor-pointer"
            />
          </div>
        </div>
      </div>

    </div>
  );
}
