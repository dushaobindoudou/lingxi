// Tauri implementation of the DesktopHost contract (packages/desktop-host-contract).
// This is the ONLY file in the frontend allowed to import @tauri-apps/api directly -
// everything else (renderer, life engine, main wiring) talks to the `DesktopHost`
// interface so a future host (plain browser preview, a different native shell) is a
// drop-in replacement, per docs/05-technical-architecture.md's module boundaries.
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import type { CursorPoint, DesktopHost, WorkArea } from '../../../packages/desktop-host-contract/index.d.ts';

interface MonitorPayload {
  x: number;
  y: number;
  width: number;
  height: number;
  scale_factor: number;
}

function toWorkArea(m: MonitorPayload): WorkArea {
  return { x: m.x, y: m.y, width: m.width, height: m.height, scaleFactor: m.scale_factor };
}

export function createTauriDesktopHost(): DesktopHost {
  const win = getCurrentWindow();

  async function readWorkArea(): Promise<WorkArea> {
    const payload = await invoke<MonitorPayload>('primary_monitor_bounds');
    return toWorkArea(payload);
  }

  return {
    async ready() {
      return readWorkArea();
    },

    onWorkAreaChange(handler) {
      let cancelled = false;
      const unlistenPromise = win.onResized(async () => {
        if (cancelled) return;
        handler(await readWorkArea());
      });
      return () => {
        cancelled = true;
        void unlistenPromise.then((unlisten) => unlisten());
      };
    },

    onGlobalCursorMove(handler) {
      let cancelled = false;
      const unlistenPromise = listen<{ x: number; y: number }>('global-cursor', (event) => {
        if (cancelled) return;
        const point: CursorPoint = { x: event.payload.x, y: event.payload.y };
        handler(point);
      });
      return () => {
        cancelled = true;
        void unlistenPromise.then((unlisten) => unlisten());
      };
    },

    async setClickThrough(ignore: boolean) {
      await win.setIgnoreCursorEvents(ignore);
    },

    async beginWindowDrag() {
      await win.startDragging();
    },

    async hide() {
      await win.hide();
    },

    async show() {
      await win.show();
    },

    async quit() {
      // Single-window app: closing the only window ends the process. A multi-window
      // future host should switch this to @tauri-apps/plugin-process's exit().
      await win.close();
    },
  };
}
