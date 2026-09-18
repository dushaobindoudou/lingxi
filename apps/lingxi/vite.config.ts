import { defineConfig } from "vite";
// @ts-expect-error type error without @types/node package
import process from "node:process";
// @ts-expect-error type error without @types/node package
import { fileURLToPath, URL } from "node:url";
const host = process.env.TAURI_DEV_HOST;
const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// https://vite.dev/config/
export default defineConfig(() => ({

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
    fs: {
      // the frontend imports shared logic from ../../packages/* (life engine, the
      // desktop-host contract types) which sit outside this app's own directory -
      // Vite's default fs.allow only covers the app root, so widen it to the repo.
      allow: ["../.."],
    },
  },
  build: {
    rollupOptions: {
      // three windows, three entry points: the transparent companion overlay, the tray's
      // "主界面" settings window, and the "调试台" console (see WebviewWindowBuilder in
      // src-tauri/src/lib.rs)
      input: {
        main: resolve("index.html"),
        management: resolve("management.html"),
        debug: resolve("debug.html"),
      },
    },
  },
}));
