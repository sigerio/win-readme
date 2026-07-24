import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust error messages during build
  clearScreen: false,
  // 2. Tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // watch: {
    //   ignored: ["**/src-tauri/**"],
    // },
  },
  // 3. to make use of `TAURI_DEBUG` and other env variables
  // https://tauri.studio/v1/api/config#buildconfig.envprefix
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Tauri supports es2021
    target: process.env.TAURI_PLATFORM == "windows" ? "chrome105" : "es2021",
    // don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? "oxc" : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },
}));
