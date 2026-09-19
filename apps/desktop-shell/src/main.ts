// Animation Director (docs/05-technical-architecture.md): the only module that knows
// about both the DesktopHost and the LifeEngine/Renderer. It converts host events into
// life-engine inputs, and life-engine snapshots into renderer calls. Swap any one of
// the three without touching the other two.
//
// It also owns the perception recorder wiring (packages/perception): DOM/host events in,
// an ActivitySummary out, pushed to Rust periodically so a local AI driver can poll it -
// see packages/perception-contract and docs/16-desktop-shell-prototype.md.
import './styles.css';
import { createTauriDesktopHost } from './desktop-host.ts';
import { createThreeRenderer } from './renderer.ts';
import { createLifeEngine } from '../../../packages/life-engine/src/index.mjs';
import { createActivityRecorder } from '../../../packages/perception/src/index.mjs';
import type { WorkArea } from '../../../packages/desktop-host-contract/index.d.ts';
import type { AIIntent } from '../../../packages/perception-contract/index.d.ts';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

// TEMPORARY: mirrors checkpoints into the Rust process's stdout, since the real
// Tauri webview's console isn't otherwise reachable while debugging click-through.
function dlog(message: string) {
  console.log(message);
  void invoke('debug_log', { message }).catch(() => {});
}

async function main() {
  dlog('main() start');
  const host = createTauriDesktopHost();
  const renderer = createThreeRenderer();
  const engineRecorder = createActivityRecorder();
  const stage = document.getElementById('stage');
  if (!stage) throw new Error('index.html must contain #stage');
  renderer.mount(stage);
  dlog('renderer mounted');

  let workArea: WorkArea = await host.ready();
  dlog(`workArea ready: ${JSON.stringify(workArea)}`);
  const engine = createLifeEngine({
    bounds: logicalSize(workArea),
    position: { x: logicalSize(workArea).width / 2, y: logicalSize(workArea).height / 2 },
  });
  renderer.resize(logicalSize(workArea).width, logicalSize(workArea).height);
  dlog(`resized to ${JSON.stringify(logicalSize(workArea))}`);

  // Pull the Rust-side current state once at startup instead of relying only on
  // broadcast events: persisted settings are restored (and the tray's checkmarks
  // set) during Rust setup, before this webview exists, so those events are lost.
  // get_status is the authoritative read - it keeps size/mode in sync with what
  // the tray shows even when the app just restored last session's choices.
  // Identity/agent selection ("首页"/"Agent 接入" in the management window): purely
  // descriptive for now (not yet read by rendering or behavior), surfaced here only so
  // the perception snapshot below can expose them to an external AI driver.
  let catName = '灵犀';
  let activeAgent = 'none';

  try {
    const status = await invoke<{
      scale: number;
      visible: boolean;
      mode: 'auto' | 'play';
      catName: string;
      activeAgent: string;
      avoidRadius: number;
    }>('get_status');
    renderer.setScale(status.scale);
    engine.setInteractionMode(status.mode);
    engine.setAvoidRadius(status.avoidRadius);
    catName = status.catName;
    activeAgent = status.activeAgent;
    dlog(`initial status applied: ${JSON.stringify(status)}`);
  } catch (error) {
    dlog(`get_status failed at startup (defaults stay in effect): ${String(error)}`);
  }

  void listen<{ name: string; personality: string }>('set-cat-identity', (event) => {
    catName = event.payload.name;
  });
  void listen<string>('set-active-agent', (event) => {
    activeAgent = event.payload;
  });
  // "性格行为" behavior preset (安静/均衡/活泼) - see life-engine's setAvoidRadius doc
  // comment and src-tauri's avoid_radius_for_preset for why this is the one trait-adjacent
  // control that changes live behavior instead of only persisting a label.
  void listen<{ preset: string; avoidRadius: number }>('set-behavior-preset', (event) => {
    engine.setAvoidRadius(event.payload.avoidRadius);
  });

  function logicalSize(area: WorkArea) {
    return { width: area.width / area.scaleFactor, height: area.height / area.scaleFactor };
  }

  function toLogicalCursor(physicalScreenX: number, physicalScreenY: number) {
    return {
      x: (physicalScreenX - workArea.x) / workArea.scaleFactor,
      y: (physicalScreenY - workArea.y) / workArea.scaleFactor,
    };
  }

  host.onWorkAreaChange((next) => {
    workArea = next;
    engine.setBounds(logicalSize(next));
    renderer.resize(logicalSize(next).width, logicalSize(next).height);
  });

  let cursor: { x: number; y: number } | null = null;
  let isCaptured = false; // mirrors the host's click-through state, to avoid redundant IPC calls
  let isMouseDown = false;
  let dragStartedAt = 0;
  let dragMoved = false;

  // Generous slack around the work area, not a hard clip - covers edge rounding/DPI jitter
  // without accepting a genuinely bogus reading (a second monitor's coordinates, computed
  // wrong today since spawn_cursor_poller's y-flip only accounts for the primary screen -
  // known limitation, see docs/16). Feeding such a value straight to the engine as a real
  // cursor position used to make 'play' mode chase it and 'auto' mode react to it; treating
  // it as "unknown" (null) instead means both modes just fall back to their no-cursor
  // behavior, same as if the cursor had never been reported at all.
  const CURSOR_OUT_OF_BOUNDS_SLACK_PX = 200;

  host.onGlobalCursorMove((point) => {
    const next = toLogicalCursor(point.x, point.y);
    const size = logicalSize(workArea);
    const withinBounds =
      next.x >= -CURSOR_OUT_OF_BOUNDS_SLACK_PX &&
      next.x <= size.width + CURSOR_OUT_OF_BOUNDS_SLACK_PX &&
      next.y >= -CURSOR_OUT_OF_BOUNDS_SLACK_PX &&
      next.y <= size.height + CURSOR_OUT_OF_BOUNDS_SLACK_PX;
    cursor = withinBounds ? next : null;
  });

  void listen<boolean>('accessibility-permission', (event) => {
    if (!event.payload) {
      console.warn(
        '[lingxi-desktop] Accessibility permission not granted. Cursor tracking and dragging ' +
          'both work without it now (NSEvent.mouseLocation needs no entitlement) - this only ' +
          'affects a future global click/keystroke listener that does not exist yet.',
      );
    }
  });

  void listen<number>('set-scale', (event) => {
    renderer.setScale(event.payload);
    engineRecorder.record({ type: 'scale_changed', at: performance.now(), scale: event.payload });
  });

  // Tray/management-window toggle for "auto" vs "play" ("逗猫模式") - see
  // LifeEngine.setInteractionMode and src-tauri/src/lib.rs's TrayState::apply_mode.
  void listen<'auto' | 'play'>('set-interaction-mode', (event) => {
    engine.setInteractionMode(event.payload);
  });

  // Tray/management "重置位置" - a recovery action for "it wandered somewhere I can't
  // find it" (mostly relevant to 'auto' mode's avoidance behavior).
  void listen('reset-position', () => {
    engine.resetPosition();
  });

  // The one channel an external AI driver can use to nudge the pet - see
  // packages/perception-contract's AIIntent, LifeEngine.suggestMoveTo and
  // LifeEngine.setInteractionMode. Arrives via the Rust-side local HTTP bridge's
  // POST /intent (src-tauri/src/lib.rs). targetPoint and mode are independent - either,
  // both, or neither (an empty intent) may be present.
  void listen<AIIntent>('ai-intent', (event) => {
    dlog(`ai-intent received: ${JSON.stringify(event.payload)}`);
    const { targetPoint, holdMs, mode } = event.payload;
    if (targetPoint) engine.suggestMoveTo(targetPoint, performance.now(), holdMs);
    if (mode) engine.setInteractionMode(mode);
  });

  window.addEventListener('mousedown', () => {
    if (!isCaptured || !cursor) return;
    isMouseDown = true;
    dragStartedAt = performance.now();
    dragMoved = false;
    engine.beginDrag(cursor);
    engineRecorder.record({ type: 'click_on_pet', at: dragStartedAt, position: cursor });
  });
  window.addEventListener('mousemove', (event) => {
    if (!isMouseDown) return;
    dragMoved = true;
    // Use the native DOM event's own coordinates, not the relayed `cursor` var, for the
    // actual drag tracking. `cursor` comes from Rust's NSEvent poll -> Tauri event ->
    // webview relay, a real round-trip with IPC/serialization overhead on every step; the
    // window already stops being click-through the moment a drag starts (see the
    // `shouldCapture = hit || isMouseDown` logic in frame()), so real native mousemove
    // events reach this listener directly, as fast as the browser delivers them, no relay
    // needed. The window covers the full work area at its own origin, so clientX/clientY
    // are already in the same logical, work-area-relative space life-engine expects - no
    // conversion required. This is what was making drag specifically (not follow, which
    // never needed to feel perfectly glued to the cursor) feel behind/unresponsive
    // (reported as "拖动不太好使").
    engine.updateDrag({ x: event.clientX, y: event.clientY });
  });
  window.addEventListener('mouseup', () => {
    if (!isMouseDown) return;
    isMouseDown = false;
    const now = performance.now();
    engine.endDrag(now);
    if (dragMoved && cursor) {
      engineRecorder.record({ type: 'drag_start', at: dragStartedAt, position: cursor });
      engineRecorder.record({ type: 'drag_end', at: now, position: cursor, durationMs: now - dragStartedAt });
    }
  });

  const canvas = stage.querySelector('canvas');
  dlog(
    `canvas check: exists=${!!canvas} size=${canvas ? `${canvas.width}x${canvas.height}` : 'n/a'} ` +
      `styleSize=${canvas ? `${canvas.style.width}x${canvas.style.height}` : 'n/a'} ` +
      `webgl2=${!!canvas?.getContext('webgl2')} bodyBg=${getComputedStyle(document.body).backgroundColor} ` +
      `devicePixelRatio=${window.devicePixelRatio}`,
  );

  // Push a perception snapshot to Rust every couple of seconds so a local AI driver polling
  // the HTTP bridge sees reasonably fresh data without every frame paying an IPC cost.
  setInterval(() => {
    const now = performance.now();
    const snapshot = {
      observedAt: Date.now(),
      cursor,
      petPosition: engine.position,
      petState: engine.state,
      mode: engine.mode,
      catName,
      activeAgent,
      activity: engineRecorder.summary(now),
      growth: engineRecorder.growth(),
    };
    void invoke('report_perception', { snapshot }).catch(() => {});
  }, 2000);

  let lastFrameAt: number | null = null;
  let loggedFirstFrame = false;
  let frameErrorCount = 0;
  let wasHit = false;
  function frame(now: number) {
    try {
      const deltaSeconds = lastFrameAt == null ? 0 : Math.min(0.1, (now - lastFrameAt) / 1000);
      lastFrameAt = now;

      // Drag position updates now come from the native mousemove listener above (faster,
      // no relay round-trip) - nothing to do here for dragging specifically.
      const snapshot = engine.tick(now, cursor);
      renderer.render(snapshot, deltaSeconds, cursor);
      if (!loggedFirstFrame) {
        loggedFirstFrame = true;
        dlog(`first frame rendered, snapshot=${JSON.stringify(snapshot)}`);
      }

      if (cursor) {
        const hit = renderer.hitTest(cursor);
        if (hit !== wasHit) {
          wasHit = hit;
          engineRecorder.record({ type: hit ? 'cursor_entered_pet' : 'cursor_left_pet', at: now });
        }
        const shouldCapture = hit || isMouseDown;
        if (shouldCapture !== isCaptured) {
          isCaptured = shouldCapture;
          void host.setClickThrough(!isCaptured);
        }
      }
    } catch (error) {
      frameErrorCount += 1;
      if (frameErrorCount <= 3) {
        dlog(`frame() error #${frameErrorCount}: ${error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : String(error)}`);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((error) => {
  console.error('[lingxi-desktop] fatal startup error', error);
});
