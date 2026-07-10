import { useState, useEffect, useRef, useCallback } from "react";
import { File, FolderPlus, Search, Grid2x2 as Grid, List, Download, Trash2, Plus, Image as ImageIcon, Video, Music, Maximize2, Sparkles, Tag, FolderOpen, Star, Clock, HardDrive, ListFilter as Filter, RefreshCw, Eye } from "lucide-react";
import { MediaAsset, PageId } from "../types";
import { AssetEngine, Asset3D } from "../scene/assets/AssetEngine";
import { useApp } from "../context/AppContext";

interface AssetManagerNewProps {
  mediaLibrary: MediaAsset[];
  onUploadMedia: (file: MediaAsset) => void;
  onDeleteMedia: (id: string) => void;
  onNavigate?: (page: PageId) => void;
}

interface AIAssetTag {
  id: string;
  name: string;
  confidence: number;
  category: "content" | "style" | "color" | "subject" | "technical" | "usage";
  isVerified: boolean;
}

function generateAITags(assetName: string, assetType: string): AIAssetTag[] {
  const tags: AIAssetTag[] = [];

  const keywords: Record<string, AIAssetTag[]> = {
    drone: [
      { id: "tag_1", name: "aerial", confidence: 0.95, category: "content", isVerified: false },
      { id: "tag_2", name: "landscape", confidence: 0.87, category: "subject", isVerified: false },
      { id: "tag_3", name: "cinematic", confidence: 0.92, category: "style", isVerified: false },
    ],
    nebula: [
      { id: "tag_1", name: "space", confidence: 0.98, category: "subject", isVerified: false },
      { id: "tag_2", name: "sci-fi", confidence: 0.91, category: "style", isVerified: false },
      { id: "tag_3", name: "purple", confidence: 0.85, category: "color", isVerified: false },
    ],
    vocal: [
      { id: "tag_1", name: "voice", confidence: 0.96, category: "content", isVerified: false },
      { id: "tag_2", name: "dialogue", confidence: 0.88, category: "usage", isVerified: false },
    ],
    music: [
      { id: "tag_1", name: "soundtrack", confidence: 0.94, category: "usage", isVerified: false },
      { id: "tag_2", name: "background", confidence: 0.82, category: "usage", isVerified: false },
    ],
    portrait: [
      { id: "tag_1", name: "person", confidence: 0.97, category: "subject", isVerified: false },
      { id: "tag_2", name: "face", confidence: 0.94, category: "content", isVerified: false },
      { id: "tag_3", name: "indoor", confidence: 0.76, category: "content", isVerified: false },
    ],
    city: [
      { id: "tag_1", name: "urban", confidence: 0.93, category: "style", isVerified: false },
      { id: "tag_2", name: "building", confidence: 0.89, category: "subject", isVerified: false },
      { id: "tag_3", name: "night", confidence: 0.71, category: "content", isVerified: false },
    ],
  };

  const lowerName = assetName.toLowerCase();
  for (const [keyword, keywordTags] of Object.entries(keywords)) {
    if (lowerName.includes(keyword)) {
      tags.push(...keywordTags);
    }
  }

  if (assetType === "video") {
    tags.push({ id: `tag_v_${Date.now()}`, name: "footage", confidence: 0.99, category: "technical", isVerified: false });
  } else if (assetType === "audio") {
    tags.push({ id: `tag_a_${Date.now()}`, name: "audio-only", confidence: 0.99, category: "technical", isVerified: false });
  } else if (assetType === "image") {
    tags.push({ id: `tag_i_${Date.now()}`, name: "static-image", confidence: 0.99, category: "technical", isVerified: false });
  }

  if (tags.length === 0) {
    tags.push(
      { id: "tag_default_1", name: "media", confidence: 0.5, category: "content", isVerified: false },
      { id: "tag_default_2", name: "imported", confidence: 0.5, category: "technical", isVerified: false }
    );
  }

  return tags;
}

interface AssetWithTags extends MediaAsset {
  aiTags: AIAssetTag[];
  folderId: string | null;
  isFavorite: boolean;
  lastAccessed: number;
  metadata: Record<string, any>;
}

export default function AssetManagerNew({
  mediaLibrary,
  onUploadMedia,
  onDeleteMedia,
  onNavigate
}: AssetManagerNewProps) {
  const { commandDispatcher } = useApp();
  const assetEngine = useRef(AssetEngine.getInstance());

  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "video" | "audio" | "image">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [assets, setAssets] = useState<AssetWithTags[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<AssetWithTags | null>(null);
  const [showInspector, setShowInspector] = useState(false);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "date" | "size" | "relevance">("date");
  const [showFavorites, setShowFavorites] = useState(false);

  const [folders, setFolders] = useState([
    { id: "folder_all", name: "All Assets", icon: FolderOpen, count: 0 },
    { id: "folder_videos", name: "Videos", icon: Video, count: 0 },
    { id: "folder_audio", name: "Audio", icon: Music, count: 0 },
    { id: "folder_images", name: "Images", icon: ImageIcon, count: 0 },
    { id: "folder_favorites", name: "Favorites", icon: Star, count: 0 },
  ]);

  useEffect(() => {
    const enhanced: AssetWithTags[] = mediaLibrary.map(asset => ({
      ...asset,
      aiTags: generateAITags(asset.name, asset.type),
      folderId: null,
      isFavorite: false,
      lastAccessed: Date.now(),
      metadata: {},
    }));
    setAssets(enhanced);

    const videoCount = enhanced.filter(a => a.type === "video").length;
    const audioCount = enhanced.filter(a => a.type === "audio").length;
    const imageCount = enhanced.filter(a => a.type === "image").length;
    const favCount = enhanced.filter(a => a.isFavorite).length;

    setFolders([
      { id: "folder_all", name: "All Assets", icon: FolderOpen, count: enhanced.length },
      { id: "folder_videos", name: "Videos", icon: Video, count: videoCount },
      { id: "folder_audio", name: "Audio", icon: Music, count: audioCount },
      { id: "folder_images", name: "Images", icon: ImageIcon, count: imageCount },
      { id: "folder_favorites", name: "Favorites", icon: Star, count: favCount },
    ]);
  }, [mediaLibrary]);

  const filteredAssets = assets.filter(asset => {
    const matchesType = filterType === "all" || asset.type === filterType;
    const matchesFavorite = !showFavorites || asset.isFavorite;
    const matchesSearch =
      searchQuery === "" ||
      asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.aiTags.some(tag => tag.name.toLowerCase().includes(searchQuery.toLowerCase()));

    return matchesType && matchesFavorite && matchesSearch;
  }).sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name);
      case "date":
        return b.lastAccessed - a.lastAccessed;
      case "size":
        return 0;
      case "relevance":
        const relevanceA = a.aiTags.reduce((sum, t) => sum + t.confidence, 0);
        const relevanceB = b.aiTags.reduce((sum, t) => sum + t.confidence, 0);
        return relevanceB - relevanceA;
      default:
        return 0;
    }
  });

  const handleUploadFile = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*,video/*,audio/*";
    input.multiple = true;

    input.onchange = async (e) => {
      const files = Array.from((e.target as HTMLInputElement).files || []);
      if (files.length === 0) return;

      setIsProcessingAI(true);

      for (const file of files) {
        try {
          const result = await commandDispatcher.dispatch({
            name: 'asset:import',
            payload: { file },
            priority: 70,
          });
          if (result.success && result.data) {
            onUploadMedia(result.data);
          }
        } catch (err) {
          console.error('Import failed:', err);
        }
      }
      setIsProcessingAI(false);
    };

    input.click();
  }, [onUploadMedia, commandDispatcher]);

  const handleToggleFavorite = useCallback((assetId: string) => {
    setAssets(prev =>
      prev.map(a => (a.id === assetId ? { ...a, isFavorite: !a.isFavorite } : a))
    );
  }, []);

  const handleVerifyTag = useCallback((assetId: string, tagId: string) => {
    setAssets(prev =>
      prev.map(a => {
        if (a.id === assetId) {
          return {
            ...a,
            aiTags: a.aiTags.map(t => (t.id === tagId ? { ...t, isVerified: true } : t)),
          };
        }
        return a;
      })
    );
  }, []);

  const handleRemoveTag = useCallback((assetId: string, tagId: string) => {
    setAssets(prev =>
      prev.map(a => {
        if (a.id === assetId) {
          return {
            ...a,
            aiTags: a.aiTags.filter(t => t.id !== tagId),
          };
        }
        return a;
      })
    );
  }, []);

  const handleAddTag = useCallback((assetId: string, tagName: string) => {
    setAssets(prev =>
      prev.map(a => {
        if (a.id === assetId) {
          return {
            ...a,
            aiTags: [
              ...a.aiTags,
              { id: `tag_manual_${Date.now()}`, name: tagName, confidence: 1, category: "content", isVerified: true }
            ],
          };
        }
        return a;
      })
    );
  }, []);

  const handleAnalyzeWithAI = useCallback(async (assetId: string) => {
    setIsProcessingAI(true);
    await new Promise(resolve => setTimeout(resolve, 2000));

    setAssets(prev =>
      prev.map(a => {
        if (a.id === assetId) {
          const additionalTags = generateAITags(a.name + "_enhanced", a.type);
          return {
            ...a,
            aiTags: [...a.aiTags, ...additionalTags],
          };
        }
        return a;
      })
    );

    setIsProcessingAI(false);
  }, []);

  return (
    <div className="h-full flex flex-col bg-surface">
      {/* Header */}
      <div className="shrink-0 bg-panel border-b border-border-light px-6 py-4">
        <div className="flex justify-between items-center">
          <div>
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wider font-mono flex items-center gap-1">
              <HardDrive className="w-3 h-3" />
              ASSET MANAGEMENT SYSTEM
            </span>
            <h1 className="text-xl font-bold tracking-tight">AI-Powered Asset Library</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleUploadFile}
              disabled={isProcessingAI}
              className="px-4 py-2 bg-text-dark text-white rounded-xl font-semibold text-xs hover:scale-105 transition-transform disabled:opacity-50 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {isProcessingAI ? "Processing..." : "Upload Asset"}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar - Folders */}
        <div className="w-56 shrink-0 bg-panel border-r border-border-light flex flex-col">
          <div className="shrink-0 p-3 border-b border-border-light">
            <span className="text-xs font-bold text-gray-500 uppercase">Library</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {folders.map(folder => (
              <button
                key={folder.id}
                onClick={() => {
                  if (folder.id === "folder_videos") setFilterType("video");
                  else if (folder.id === "folder_audio") setFilterType("audio");
                  else if (folder.id === "folder_images") setFilterType("image");
                  else if (folder.id === "folder_favorites") {
                    setShowFavorites(true);
                    setFilterType("all");
                  } else {
                    setFilterType("all");
                    setShowFavorites(false);
                  }
                }}
                className={`w-full p-2 rounded-lg text-left flex items-center justify-between hover:bg-btn-bg transition-colors ${
                  (folder.id === "folder_all" && filterType === "all" && !showFavorites) ||
                  (folder.id === "folder_videos" && filterType === "video") ||
                  (folder.id === "folder_audio" && filterType === "audio") ||
                  (folder.id === "folder_images" && filterType === "image") ||
                  (folder.id === "folder_favorites" && showFavorites)
                    ? "bg-btn-bg"
                    : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  <folder.icon className="w-4 h-4 text-gray-500" />
                  <span className="text-xs font-semibold">{folder.name}</span>
                </div>
                <span className="text-xs text-gray-400 font-mono">{folder.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Toolbar */}
          <div className="shrink-0 bg-panel/50 border-b border-border-light p-3 flex items-center gap-3">
            <div className="flex items-center gap-1 bg-white border border-border-light rounded-lg px-3 py-1.5 flex-1 max-w-md">
              <Search className="w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search assets or AI tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 text-xs bg-transparent outline-none"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="text-gray-400 hover:text-text-dark">
                  ×
                </button>
              )}
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-2 py-1 border border-border-light rounded text-xs"
            >
              <option value="date">Date</option>
              <option value="name">Name</option>
              <option value="relevance">Relevance</option>
            </select>

            <div className="flex border border-border-light rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 ${viewMode === "grid" ? "bg-white" : "bg-transparent"}`}
              >
                <Grid className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`p-1.5 ${viewMode === "list" ? "bg-white" : "bg-transparent"}`}
              >
                <List className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={() => setShowFavorites(!showFavorites)}
              className={`p-1.5 border border-border-light rounded ${showFavorites ? "bg-yellow-50 text-yellow-600" : ""}`}
              title="Show Favorites Only"
            >
              <Star className="w-4 h-4" />
            </button>
          </div>

          {/* Assets */}
          <div className="flex-1 overflow-y-auto p-4">
            {filteredAssets.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <File className="w-12 h-12 text-gray-300" />
                <span className="text-sm text-gray-500 mt-3">No assets found</span>
                <button
                  onClick={handleUploadFile}
                  className="mt-4 px-4 py-2 bg-btn-bg border border-border-light rounded-lg text-xs font-semibold"
                >
                  Upload First Asset
                </button>
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                {filteredAssets.map(asset => (
                  <div
                    key={asset.id}
                    onClick={() => {
                      setSelectedAsset(asset);
                      setShowInspector(true);
                    }}
                    className={`bg-panel border rounded-xl overflow-hidden cursor-pointer hover:border-gray-400 transition-all ${
                      selectedAsset?.id === asset.id ? "ring-2 ring-text-dark" : ""
                    }`}
                  >
                    <div className="aspect-video bg-black relative flex items-center justify-center">
                      {asset.type === "video" ? (
                        <Video className="w-8 h-8 text-gray-500" />
                      ) : asset.type === "audio" ? (
                        <Music className="w-8 h-8 text-gray-500" />
                      ) : (
                        <ImageIcon className="w-8 h-8 text-gray-500" />
                      )}

                      {asset.isFavorite && (
                        <Star className="absolute top-2 right-2 w-4 h-4 text-yellow-400 fill-yellow-400" />
                      )}
                    </div>

                    <div className="p-3">
                      <div className="text-xs font-semibold truncate">{asset.name}</div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] text-gray-500">{asset.size}</span>
                        <div className="flex gap-1">
                          {asset.aiTags.slice(0, 2).map(tag => (
                            <span
                              key={tag.id}
                              className="text-[9px] px-1 py-0.5 bg-purple-50 text-purple-600 rounded"
                            >
                              {tag.name}
                            </span>
                          ))}
                          {asset.aiTags.length > 2 && (
                            <span className="text-[9px] text-gray-400">+{asset.aiTags.length - 2}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="border border-border-light rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-panel border-b border-border-light">
                    <tr>
                      <th className="p-3 text-left font-semibold">Name</th>
                      <th className="p-3 text-left font-semibold">Type</th>
                      <th className="p-3 text-left font-semibold">Size</th>
                      <th className="p-3 text-left font-semibold">AI Tags</th>
                      <th className="p-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light/50">
                    {filteredAssets.map(asset => (
                      <tr key={asset.id} className="hover:bg-panel/50">
                        <td className="p-3 font-semibold">{asset.name}</td>
                        <td className="p-3 text-gray-500 capitalize">{asset.type}</td>
                        <td className="p-3 text-gray-500">{asset.size}</td>
                        <td className="p-3">
                          <div className="flex gap-1 flex-wrap">
                            {asset.aiTags.slice(0, 4).map(tag => (
                              <span
                                key={tag.id}
                                className={`text-[9px] px-1.5 py-0.5 rounded ${
                                  tag.isVerified
                                    ? "bg-green-50 text-green-600"
                                    : "bg-purple-50 text-purple-600"
                                }`}
                              >
                                {tag.name} {Math.round(tag.confidence * 100)}%
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => onDeleteMedia(asset.id)}
                            className="text-gray-400 hover:text-red-500"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Inspector Panel */}
        {showInspector && selectedAsset && (
          <div className="w-80 shrink-0 bg-panel border-l border-border-light flex flex-col">
            <div className="shrink-0 p-3 border-b border-border-light flex items-center justify-between">
              <span className="text-xs font-bold text-gray-500 uppercase">Asset Inspector</span>
              <button onClick={() => setShowInspector(false)} className="text-gray-400 hover:text-text-dark">
                ×
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {/* Preview */}
              <div className="bg-black rounded-lg aspect-video flex items-center justify-center">
                {selectedAsset.type === "video" ? (
                  <Video className="w-8 h-8 text-gray-500" />
                ) : selectedAsset.type === "audio" ? (
                  <Music className="w-8 h-8 text-gray-500" />
                ) : (
                  <ImageIcon className="w-8 h-8 text-gray-500" />
                )}
              </div>

              {/* Info */}
              <div>
                <div className="text-sm font-semibold">{selectedAsset.name}</div>
                <div className="text-xs text-gray-500 capitalize mt-1">{selectedAsset.type} • {selectedAsset.size}</div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button
                  onClick={() => handleToggleFavorite(selectedAsset.id)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold border border-border-light flex items-center justify-center gap-1 ${
                    selectedAsset.isFavorite ? "bg-yellow-50 text-yellow-600" : ""
                  }`}
                >
                  <Star className={`w-3 h-3 ${selectedAsset.isFavorite ? "fill-current" : ""}`} />
                  {selectedAsset.isFavorite ? "Favorited" : "Favorite"}
                </button>
                <button
                  onClick={() => handleAnalyzeWithAI(selectedAsset.id)}
                  disabled={isProcessingAI}
                  className="flex-1 py-2 rounded-lg text-xs font-semibold bg-purple-50 text-purple-600 border border-purple-100 flex items-center justify-center gap-1"
                >
                  <Sparkles className="w-3 h-3" />
                  {isProcessingAI ? "Analyzing..." : "AI Analyze"}
                </button>
              </div>

              {/* AI Tags */}
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1 mb-2">
                  <Sparkles className="w-3 h-3 text-purple-500" />
                  AI Detected Tags
                </div>
                <div className="space-y-1">
                  {selectedAsset.aiTags.map(tag => (
                    <div
                      key={tag.id}
                      className={`p-2 rounded-lg text-xs flex items-center justify-between ${
                        tag.isVerified ? "bg-green-50 border border-green-100" : "bg-purple-50 border border-purple-100"
                      }`}
                    >
                      <div>
                        <span className="font-semibold">{tag.name}</span>
                        <span className="text-gray-400 ml-1">{Math.round(tag.confidence * 100)}%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {!tag.isVerified && (
                          <button
                            onClick={() => handleVerifyTag(selectedAsset.id, tag.id)}
                            className="p-1 hover:bg-green-100 rounded text-green-600"
                            title="Verify Tag"
                          >
                            <Tag className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          onClick={() => handleRemoveTag(selectedAsset.id, tag.id)}
                          className="p-1 hover:bg-red-100 rounded text-red-500"
                          title="Remove Tag"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add custom tag */}
                <div className="mt-2 flex gap-1">
                  <input
                    type="text"
                    placeholder="Add tag..."
                    className="flex-1 px-2 py-1 border border-border-light rounded text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.target as HTMLInputElement).value.trim()) {
                        handleAddTag(selectedAsset.id, (e.target as HTMLInputElement).value.trim());
                        (e.target as HTMLInputElement).value = "";
                      }
                    }}
                  />
                  <button className="px-2 py-1 bg-btn-bg border border-border-light rounded text-xs">
                    Add
                  </button>
                </div>
              </div>

              {/* Metadata */}
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase flex items-center gap-1 mb-2">
                  <File className="w-3 h-3" />
                  Metadata
                </div>
                <div className="bg-card border border-border-light rounded-lg p-2 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Resolution</span>
                    <span>{selectedAsset.resolution || "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Duration</span>
                    <span>{selectedAsset.duration || "-"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Added</span>
                    <span>{selectedAsset.addedAt}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
