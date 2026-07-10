// vite.config.ts
import { defineConfig } from "file:///home/project/node_modules/vite/dist/node/index.js";
import react from "file:///home/project/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "path";
var __vite_injected_original_dirname = "/home/project/apps/web";
var vite_config_default = defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src"),
      "@ai-creative-studio/core": path.resolve(__vite_injected_original_dirname, "../../packages/core/src"),
      "@ai-creative-studio/creative-engine": path.resolve(__vite_injected_original_dirname, "../../packages/creative-engine/src"),
      "@ai-creative-studio/timeline-engine": path.resolve(__vite_injected_original_dirname, "../../packages/timeline-engine/src"),
      "@ai-creative-studio/rendering-engine": path.resolve(__vite_injected_original_dirname, "../../packages/rendering-engine/src"),
      "@ai-creative-studio/animation-engine": path.resolve(__vite_injected_original_dirname, "../../packages/animation-engine/src"),
      "@ai-creative-studio/asset-engine": path.resolve(__vite_injected_original_dirname, "../../packages/asset-engine/src"),
      "@ai-creative-studio/project-engine": path.resolve(__vite_injected_original_dirname, "../../packages/project-engine/src"),
      "@ai-creative-studio/command-engine": path.resolve(__vite_injected_original_dirname, "../../packages/command-engine/src"),
      "@ai-creative-studio/ai-engine": path.resolve(__vite_injected_original_dirname, "../../packages/ai-engine/src"),
      "@ai-creative-studio/state-engine": path.resolve(__vite_injected_original_dirname, "../../packages/state-engine/src"),
      "@ai-creative-studio/plugin-engine": path.resolve(__vite_injected_original_dirname, "../../packages/plugin-engine/src")
    }
  },
  server: {
    port: 3e3,
    host: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9wcm9qZWN0L2FwcHMvd2ViXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS9wcm9qZWN0L2FwcHMvd2ViL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3Byb2plY3QvYXBwcy93ZWIvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCldLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4vc3JjJyksXG4gICAgICAnQGFpLWNyZWF0aXZlLXN0dWRpby9jb3JlJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3BhY2thZ2VzL2NvcmUvc3JjJyksXG4gICAgICAnQGFpLWNyZWF0aXZlLXN0dWRpby9jcmVhdGl2ZS1lbmdpbmUnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vcGFja2FnZXMvY3JlYXRpdmUtZW5naW5lL3NyYycpLFxuICAgICAgJ0BhaS1jcmVhdGl2ZS1zdHVkaW8vdGltZWxpbmUtZW5naW5lJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3BhY2thZ2VzL3RpbWVsaW5lLWVuZ2luZS9zcmMnKSxcbiAgICAgICdAYWktY3JlYXRpdmUtc3R1ZGlvL3JlbmRlcmluZy1lbmdpbmUnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vcGFja2FnZXMvcmVuZGVyaW5nLWVuZ2luZS9zcmMnKSxcbiAgICAgICdAYWktY3JlYXRpdmUtc3R1ZGlvL2FuaW1hdGlvbi1lbmdpbmUnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4vLi4vcGFja2FnZXMvYW5pbWF0aW9uLWVuZ2luZS9zcmMnKSxcbiAgICAgICdAYWktY3JlYXRpdmUtc3R1ZGlvL2Fzc2V0LWVuZ2luZSc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9wYWNrYWdlcy9hc3NldC1lbmdpbmUvc3JjJyksXG4gICAgICAnQGFpLWNyZWF0aXZlLXN0dWRpby9wcm9qZWN0LWVuZ2luZSc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9wYWNrYWdlcy9wcm9qZWN0LWVuZ2luZS9zcmMnKSxcbiAgICAgICdAYWktY3JlYXRpdmUtc3R1ZGlvL2NvbW1hbmQtZW5naW5lJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3BhY2thZ2VzL2NvbW1hbmQtZW5naW5lL3NyYycpLFxuICAgICAgJ0BhaS1jcmVhdGl2ZS1zdHVkaW8vYWktZW5naW5lJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3BhY2thZ2VzL2FpLWVuZ2luZS9zcmMnKSxcbiAgICAgICdAYWktY3JlYXRpdmUtc3R1ZGlvL3N0YXRlLWVuZ2luZSc6IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi9wYWNrYWdlcy9zdGF0ZS1lbmdpbmUvc3JjJyksXG4gICAgICAnQGFpLWNyZWF0aXZlLXN0dWRpby9wbHVnaW4tZW5naW5lJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uLy4uL3BhY2thZ2VzL3BsdWdpbi1lbmdpbmUvc3JjJyksXG4gICAgfSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgcG9ydDogMzAwMCxcbiAgICBob3N0OiB0cnVlLFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQW9QLFNBQVMsb0JBQW9CO0FBQ2pSLE9BQU8sV0FBVztBQUNsQixPQUFPLFVBQVU7QUFGakIsSUFBTSxtQ0FBbUM7QUFJekMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLE1BQU0sQ0FBQztBQUFBLEVBQ2pCLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssS0FBSyxRQUFRLGtDQUFXLE9BQU87QUFBQSxNQUNwQyw0QkFBNEIsS0FBSyxRQUFRLGtDQUFXLHlCQUF5QjtBQUFBLE1BQzdFLHVDQUF1QyxLQUFLLFFBQVEsa0NBQVcsb0NBQW9DO0FBQUEsTUFDbkcsdUNBQXVDLEtBQUssUUFBUSxrQ0FBVyxvQ0FBb0M7QUFBQSxNQUNuRyx3Q0FBd0MsS0FBSyxRQUFRLGtDQUFXLHFDQUFxQztBQUFBLE1BQ3JHLHdDQUF3QyxLQUFLLFFBQVEsa0NBQVcscUNBQXFDO0FBQUEsTUFDckcsb0NBQW9DLEtBQUssUUFBUSxrQ0FBVyxpQ0FBaUM7QUFBQSxNQUM3RixzQ0FBc0MsS0FBSyxRQUFRLGtDQUFXLG1DQUFtQztBQUFBLE1BQ2pHLHNDQUFzQyxLQUFLLFFBQVEsa0NBQVcsbUNBQW1DO0FBQUEsTUFDakcsaUNBQWlDLEtBQUssUUFBUSxrQ0FBVyw4QkFBOEI7QUFBQSxNQUN2RixvQ0FBb0MsS0FBSyxRQUFRLGtDQUFXLGlDQUFpQztBQUFBLE1BQzdGLHFDQUFxQyxLQUFLLFFBQVEsa0NBQVcsa0NBQWtDO0FBQUEsSUFDakc7QUFBQSxFQUNGO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsRUFDUjtBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
