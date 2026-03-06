import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      // Proxy /api/llm/* to LiteLLM (localhost:4000)
      "/api/llm": {
        target: "http://127.0.0.1:4000",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api\/llm/, ""),
      },
      // Proxy /api/sovereign/* to Sovereign Stack API (localhost:3100)
      "/api/sovereign": {
        target: "http://127.0.0.1:3100",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api\/sovereign/, "/api"),
        configure: (proxy) => {
          proxy.on("proxyReq", (_proxyReq, _req, res) => {
            // @ts-expect-error disable buffering for SSE
            res.socket?.setNoDelay(true);
          });
        },
      },
    },
  },
}));
