import { useState, useRef } from "react";
import { 
  FolderOpen, 
  Search, 
  FileVideo, 
  FileAudio, 
  FileImage, 
  FileText, 
  Box, 
  Upload, 
  Plus, 
  Trash2, 
  Play, 
  Eye, 
  Layers,
  ChevronRight,
  Sparkles
} from "lucide-react";
import { PageId, MediaAsset } from "../types";
import { useApp } from "../context/AppContext";

interface MediaLibraryProps {
  media: MediaAsset[];
  onNavigate: (page: PageId) => void;
  onAddMedia: (asset: MediaAsset) => void;
  onDeleteMedia: (id: string) => void;
}

export default function MediaLibrary({
  media,
  onNavigate,
  onAddMedia,
  onDeleteMedia
}: MediaLibraryProps) {
  const { commandDispatcher, addNotification, addHistory } = useApp();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<"all" | "video" | "audio" | "image" | "3d" | "document">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null);

  // Filter media based on tab and query
  const filteredMedia = media.filter(item => {
    const matchesTab = activeTab === "all" || item.type === activeTab;
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesTab && matchesSearch;
  });

  const getIconForType = (type: MediaAsset["type"]) => {
    switch (type) {
      case "video": return FileVideo;
      case "audio": return FileAudio;
      case "image": return FileImage;
      case "3d": return Box;
      default: return FileText;
    }
  };

  const getColorForType = (type: MediaAsset["type"]) => {
    switch (type) {
      case "video": return "text-blue-600 bg-blue-50 border-blue-200";
      case "audio": return "text-purple-600 bg-purple-50 border-purple-200";
      case "image": return "text-green-600 bg-green-50 border-green-200";
      case "3d": return "text-orange-600 bg-orange-50 border-orange-200";
      default: return "text-gray-600 bg-gray-50 border-gray-200";
    }
  };

  // Real file import via AssetService
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      try {
        const result = await commandDispatcher.dispatch({
          name: 'asset:import',
          payload: { file },
          priority: 70,
        });
        if (result.success && result.data) {
          onAddMedia(result.data);
          addNotification({
            title: 'Asset Imported',
            description: `${file.name} has been imported successfully.`,
            type: 'system',
          });
          addHistory({
            action: `Imported asset: ${file.name}`,
            user: 'You',
            type: 'edit',
          });
        }
      } catch (err) {
        addNotification({
          title: 'Import Failed',
          description: `Failed to import ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`,
          type: 'warning',
        });
      }
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="p-6 space-y-6 text-left h-full flex flex-col min-h-0 animate-in fade-in-50 duration-200">
      {/* Upper header */}
      <div className="flex justify-between items-center border-b border-border-light pb-4 shrink-0">
        <div>
          <span className="text-xs font-bold text-gray-500 uppercase tracking-wider font-mono">ASSET REPOSITORY</span>
          <h1 className="text-xl font-bold text-text-dark tracking-tight mt-0.5">Media Library Bins</h1>
        </div>

        <div className="flex space-x-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="video/*,audio/*,image/*,.obj,.fbx,.pdf"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button 
            onClick={handleImportClick}
            className="px-3.5 py-1.5 bg-btn-bg border border-border-light rounded-xl text-xs font-semibold hover:border-gray-400 transition-all cursor-pointer flex items-center space-x-1.5"
          >
            <Upload className="w-4 h-4 text-gray-700" />
            <span>Import Media</span>
          </button>
        </div>
      </div>

      {/* Main split: Library on left, upload and active preview on right */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 overflow-hidden min-h-0">
        {/* Left Bins & List */}
        <div className="lg:col-span-2 flex flex-col space-y-4 overflow-hidden min-h-0">
          {/* Controls bar */}
          <div className="flex flex-col sm:flex-row items-center gap-3 shrink-0">
            {/* Type tabs filter */}
            <div className="flex space-x-1 bg-panel/60 p-1 border border-border-light rounded-xl text-[11px] font-semibold">
              {[
                { id: "all", label: "All Assets" },
                { id: "video", label: "Videos" },
                { id: "audio", label: "Audio Clips" },
                { id: "image", label: "Images" },
                { id: "3d", label: "3D Meshes" },
                { id: "document", label: "Docs" }
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                    activeTab === tab.id 
                      ? "bg-btn-bg text-text-dark border border-border-light shadow-xs" 
                      : "text-gray-500 hover:text-text-dark"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative flex-1 w-full">
              <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
              <input
                type="text"
                placeholder="Search bins..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-7.5 pl-8 pr-3 bg-btn-bg border border-border-light rounded-lg text-xs text-text-dark focus:outline-none"
              />
            </div>
          </div>

          {/* Directory asset cards container */}
          <div className="flex-1 overflow-y-auto no-scrollbar space-y-2 border border-border-light/60 bg-panel/20 p-2 rounded-2xl min-h-0">
            {filteredMedia.length === 0 ? (
              <div className="py-16 text-center text-gray-400">
                <FolderOpen className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                <span className="text-xs font-bold text-text-dark block">No assets in this bin</span>
                <span className="text-[10px] text-gray-500 mt-1 block">Simulate an import or change filter parameters.</span>
              </div>
            ) : (
              filteredMedia.map((asset) => {
                const Icon = getIconForType(asset.type);
                const colorCls = getColorForType(asset.type);
                return (
                  <div 
                    key={asset.id}
                    onClick={() => setSelectedAsset(asset)}
                    className={`p-3 bg-btn-bg border rounded-xl flex items-center justify-between hover:border-gray-400 transition-colors cursor-pointer text-left ${
                      selectedAsset?.id === asset.id ? "border-text-dark shadow-xs" : "border-border-light"
                    }`}
                  >
                    <div className="flex items-center space-x-3.5 min-w-0">
                      <div className={`p-2 border rounded-lg shrink-0 ${colorCls}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-text-dark block truncate">{asset.name}</span>
                        <span className="text-[9px] text-gray-500 font-mono flex items-center space-x-1 mt-0.5">
                          <span>{asset.size}</span>
                          {asset.duration && (
                            <>
                              <span>•</span>
                              <span>{asset.duration}</span>
                            </>
                          )}
                          {asset.resolution && (
                            <>
                              <span>•</span>
                              <span>{asset.resolution}</span>
                            </>
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="text-[9px] font-mono text-gray-400 hidden sm:block">{asset.addedAt}</span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedAsset(null);
                          onDeleteMedia(asset.id);
                        }}
                        className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-red-50/50 cursor-pointer"
                        title="Delete asset"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Dock: Drag & Drop upload or file preview */}
        <div className="space-y-4 flex flex-col justify-between min-h-0">
          <div className="space-y-4 flex-1 overflow-y-auto no-scrollbar min-h-0">
            {/* Visual preview or upload zone */}
            {selectedAsset ? (
              <div className="bg-card border border-border-light p-4 rounded-2xl text-left space-y-4 animate-in fade-in duration-200">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider font-mono">FILE PROFILE PREVIEW</span>
                    <h3 className="text-xs font-bold text-text-dark mt-0.5 truncate max-w-[200px]" title={selectedAsset.name}>
                      {selectedAsset.name}
                    </h3>
                  </div>
                  <button 
                    onClick={() => setSelectedAsset(null)}
                    className="text-[10px] text-gray-400 hover:underline"
                  >
                    Clear
                  </button>
                </div>

                {/* Media preview block mockup */}
                <div className="aspect-video bg-text-dark rounded-xl flex flex-col items-center justify-center text-center p-4 relative overflow-hidden border border-gray-800">
                  <div className="absolute inset-0 bg-radial-gradient from-gray-900 via-gray-950 to-black opacity-90"></div>
                  
                  {selectedAsset.type === "video" && (
                    <div className="z-10 text-white space-y-2">
                      <FileVideo className="w-7 h-7 text-gray-400 mx-auto" />
                      <span className="text-[10px] font-mono block">Scrubbable Frame Preview</span>
                      <button className="px-2 py-1 bg-white text-black text-[10px] rounded-lg font-bold flex items-center space-x-1 mx-auto cursor-pointer">
                        <Play className="w-3 h-3 fill-black" />
                        <span>Play Raw</span>
                      </button>
                    </div>
                  )}

                  {selectedAsset.type === "audio" && (
                    <div className="z-10 text-white space-y-2 w-full px-4">
                      <FileAudio className="w-7 h-7 text-gray-400 mx-auto" />
                      <span className="text-[10px] font-mono block">Dynamic Waveform Metrics</span>
                      {/* Waveform lines visualization */}
                      <div className="flex justify-center space-x-0.5 h-6 items-center">
                        {[40, 70, 30, 90, 50, 80, 20, 60, 40].map((h, idx) => (
                          <div key={idx} className="bg-purple-400 w-1 rounded" style={{ height: `${h}%` }}></div>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedAsset.type !== "video" && selectedAsset.type !== "audio" && (
                    <div className="z-10 text-white space-y-1">
                      <Eye className="w-7 h-7 text-gray-400 mx-auto" />
                      <span className="text-[10px] font-mono block">Static Asset Preview Panel</span>
                    </div>
                  )}
                </div>

                {/* Detailed metadata */}
                <div className="p-3 bg-panel border border-border-light rounded-xl space-y-2 text-[11px] font-mono">
                  <div className="flex justify-between pb-1 border-b border-border-light/40">
                    <span className="text-gray-400">ASSET TYPE</span>
                    <span className="text-text-dark font-semibold uppercase">{selectedAsset.type}</span>
                  </div>
                  <div className="flex justify-between pb-1 border-b border-border-light/40">
                    <span className="text-gray-400">FILE SIZE</span>
                    <span className="text-text-dark font-semibold">{selectedAsset.size}</span>
                  </div>
                  {selectedAsset.duration && (
                    <div className="flex justify-between pb-1 border-b border-border-light/40">
                      <span className="text-gray-400">DURATION</span>
                      <span className="text-text-dark font-semibold">{selectedAsset.duration}</span>
                    </div>
                  )}
                  {selectedAsset.resolution && (
                    <div className="flex justify-between pb-1 border-b border-border-light/40">
                      <span className="text-gray-400">RESOLUTION</span>
                      <span className="text-text-dark font-semibold">{selectedAsset.resolution}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-400">INGEST DATE</span>
                    <span className="text-text-dark font-semibold">{selectedAsset.addedAt}</span>
                  </div>
                </div>

                <button 
                  onClick={() => onNavigate("workspace")}
                  className="w-full py-2 bg-text-dark hover:bg-opacity-90 text-white rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Insert into timeline track</span>
                </button>
              </div>
            ) : (
              /* Drag Drop area */
              <div className="bg-card border border-border-light p-4 rounded-2xl text-left space-y-3">
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">File Upload Zone</span>
                <div className="border border-dashed border-border-light hover:border-gray-400 p-8 rounded-xl text-center cursor-pointer bg-panel/10 relative transition-all">
                  <input 
                    type="file" 
                    multiple 
                    onChange={(e) => {
                      if (e.target.files) {
                        for (let i = 0; i < e.target.files.length; i++) {
                          const file = e.target.files[i];
                          onAddMedia({
                            id: "upload_" + Date.now() + "_" + i,
                            name: file.name,
                            type: file.type.includes("video") ? "video" : file.type.includes("audio") ? "audio" : file.type.includes("image") ? "image" : "document",
                            size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
                            addedAt: "Just now"
                          });
                        }
                      }
                    }}
                    className="absolute inset-0 opacity-0 cursor-pointer" 
                  />
                  <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                  <span className="text-xs font-bold text-text-dark block">Drag & Drop media here</span>
                  <span className="text-[10px] text-gray-400 mt-1 block">Or click to manually browse system files</span>
                </div>
              </div>
            )}
          </div>

          <div className="bg-purple-50/50 border border-purple-100 p-3 rounded-xl flex items-start space-x-2.5">
            <Sparkles className="w-4 h-4 text-purple-600 shrink-0 mt-0.5" />
            <div className="text-left text-[11px] leading-relaxed">
              <span className="font-bold text-purple-800 block">AI Automated Bins categorization</span>
              <span className="text-gray-600 block mt-0.5">Gemini models will auto-tag and sort your footage by character, ambient scenery depth, or speaking voice clarity.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
