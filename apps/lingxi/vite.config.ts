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
    // Loopback, but IPv4 loopback specifically - NOT Vite's `false`/"localhost" default.
    //
    // `localhost` is resolved, and on a machine whose resolver returns ::1 first that binds
    // [::1]:1420 and nothing else. Everything that reaches the dev server by name still works
    // (Tauri's devUrl, a browser opening /probe-gait.html) because those fall back across
    // addresses - but anything naming 127.0.0.1 gets connection-refused with no second address
    // to try, and an HTTP proxy in the environment (http_proxy pointing at a local Clash-style
    // listener is the common case) connects over IPv4 and answers 502 for the dev server while
    // every other local port works.
    //
    // Binding 127.0.0.1 is strictly wider: a name still resolves to ::1 first, fails, and falls
    // back to this - so `localhost:1420` keeps working - while the literal 127.0.0.1 now works
    // too. `true`/0.0.0.0 would also fix it but puts the dev server on the LAN, which is not a
    // trade a desktop pet's build needs to make. TAURI_DEV_HOST still overrides for the
    // real-device case, which is the one time reaching it from off-machine is the point.
    host: host || '127.0.0.1',
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
