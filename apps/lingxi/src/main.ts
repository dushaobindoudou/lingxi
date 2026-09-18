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
import { createStageFx } from './fx/stage-fx.ts';
import { createPerformanceRunner } from './fx/performances.ts';
import { pickToyReaction, pickPointerReaction, pickAffectionLine } from './anim/interactions.ts';
import { createLifeEngine, TOY_KINDS } from '../../../packages/life-engine/src/index.mjs';
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
  // Effects layer goes on AFTER the renderer, so it sits above the canvas. Both are
  // pointer-events:none - hit-testing is done in world space by frame() below, never by the DOM.
  const fx = createStageFx();
  fx.mount(stage);
  dlog('renderer + fx layer mounted');

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
  // The user's own chosen camera angle. Performances borrow the camera and must put it back,
  // so the value they restore to has to be tracked here rather than read back off the renderer.
  let userCamera = 'game';
  let currentSkinId = 'honey-mittens';

  try {
    const status = await invoke<{
      scale: number;
      visible: boolean;
      mode: string;
      catName: string;
      activeAgent: string;
      avoidRadius: number;
      skin: string;
      camera: string;
    }>('get_status');
    renderer.setScale(status.scale);
    currentSkinId = status.skin;
    renderer.setSkin?.(status.skin);
    userCamera = status.camera;
    renderer.setCameraPreset?.(status.camera);
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
  // Yarn-ball wind-up state. Separate from the cat-drag state above: they are different
  // gestures on different objects that happen to share a mouse button.
  let isChargingToy = false;
  let overToy = false;
  let lastAimSample: { x: number; y: number } | null = null;
  let aim: { x: number; y: number } | null = null;
  // Pointer affection state. `strokeDistance` is pointer TRAVEL over the cat, not time spent
  // there - a hand moving back and forth is a stroke, a parked mouse is not.
  let hoverSince = 0;
  let strokeDistance = 0;
  let lastHoverSample: { x: number; y: number } | null = null;
  let pointerReactionUntil = 0;
  let lastAffectionLine: string | null = null;
  let toyReactionUntil = 0;

  // Generous slack around the work area, not a hard clip - covers edge rounding/DPI jitter
  // without accepting a genuinely bogus reading (a second monitor's coordinates, computed
  // wrong today since spawn_cursor_poller's y-flip only accounts for the primary screen -
  // known limitation, see docs/16). Feeding such a value straight to the engine as a real
  // cursor position used to make 'play' mode chase it and 'auto' mode react to it; treating
  // it as "unknown" (null) instead means both modes just fall back to their no-cursor
  // behavior, same as if the cursor had never been reported at all.
  const CURSOR_OUT_OF_BOUNDS_SLACK_PX = 200;

  /** How close the pointer has to get to the yarn ball to pick it up. Generous on purpose -
   *  the ball is small on screen and this is a game, not a precision test. */
  const TOY_GRAB_RADIUS_PX = 46;

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

  // 自定义资源: the user's own actions / expressions / themes, if they have written any. Loaded
  // before the first status apply, so a custom theme is already available when the persisted
  // theme id is restored. Errors are pushed to Rust so the management window can show them -
  // silently ignoring a file someone hand-edited is the worst possible behaviour here.
  async function loadCustomAssets() {
    try {
      const payload = await invoke<Record<string, unknown>>('get_custom_assets');
      const errors = renderer.applyCustomAssets?.(payload) ?? [];
      await invoke('report_asset_errors', { errors }).catch(() => {});
      if (errors.length) dlog(`custom assets had problems: ${errors.join(' | ')}`);
      else if (payload?.available) dlog('custom assets loaded');
    } catch (error) {
      dlog(`get_custom_assets failed (built-in assets stay in effect): ${String(error)}`);
    }
  }
  await loadCustomAssets();
  void listen('reload-custom-assets', () => {
    void loadCustomAssets().then(() => {
      renderer.setSkin?.(currentSkinId);
    });
  });

  // 外观: theme ("主题"/皮肤) and viewing angle ("视角"). Both are live - the renderer
  // rebuilds/eases rather than requiring a restart - and both are persisted on the Rust side,
  // so these listeners also cover the startup restore broadcast.
  void listen<string>('set-skin', (event) => {
    currentSkinId = event.payload;
    renderer.setSkin?.(event.payload);
  });
  void listen<string>('set-camera', (event) => {
    userCamera = event.payload;
    renderer.setCameraPreset?.(event.payload);
  });

  // 调试台 / agent control surface. The companion window is the only process that owns a
  // renderer, so every "do X right now" request - whether it came from the debug console's
  // buttons or from an agent's HTTP POST - arrives here as an event and is applied the same
  // way. See src-tauri's spawn_perception_server for the HTTP half.
  void listen<{ id: string }>('play-action', (event) => {
    const ok = renderer.playAction?.(event.payload.id) ?? false;
    if (!ok) dlog(`play-action: unknown clip ${event.payload.id}`);
  });
  void listen<{ name: string; holdMs?: number }>('play-expression', (event) => {
    const ok = renderer.playExpression?.(event.payload.name, event.payload.holdMs) ?? false;
    if (!ok) dlog(`play-expression: unknown expression ${event.payload.name}`);
  });

  // 特效编排 + 玩具. Both are "do something right now" surfaces, driven identically from the
  // debug console, the tray, the management window and an agent's HTTP POST.
  const performances = createPerformanceRunner({
    engine,
    renderer,
    fx,
    viewport: () => logicalSize(workArea),
    petPosition: () => engine.position,
    restoreCamera: () => renderer.setCameraPreset?.(userCamera),
    now: () => performance.now(),
  });

  void listen<{ id: string }>('perform', (event) => {
    if (!performances.play(event.payload.id)) dlog(`perform: unknown performance ${event.payload.id}`);
  });
  void listen('perform-stop', () => performances.stop());

  void listen<{ kind: string }>('set-toy', (event) => {
    // Validated here rather than trusted: this event can originate from an agent's HTTP POST,
    // and the engine treats an unknown kind as a no-op, which would look like a silent failure.
    const kind = event.payload.kind as (typeof TOY_KINDS)[number];
    if (!TOY_KINDS.includes(kind)) {
      dlog(`set-toy: unknown toy ${event.payload.kind}`);
      return;
    }
    engine.setToy(kind);
  });
  void listen('clear-toy', () => engine.clearToy());

  // 说话气泡: one line at a time, above the head, anchored every frame in frame() below.
  void listen<{ text: string; durationMs?: number }>('say', (event) => {
    fx.say(event.payload.text, event.payload.durationMs);
  });

  // Publish what this renderer can do, once, so GET /capabilities can answer an agent
  // without round-tripping through the webview - and so the debug console builds its grids
  // from the real clip library rather than a copy of it.
  void invoke('report_capabilities', {
    capabilities: {
      ...(renderer.describeCapabilities?.() ?? {}),
      performances: performances.list(),
      toys: [
        { kind: 'yarn', name: '毛线球', description: '会滚、会撞墙反弹；猫追上去拍一爪又飞出去，能自己玩下去' },
        { kind: 'feather', name: '逗猫棒', description: '跟着你的鼠标走，但慢半拍——需要你来逗' },
        { kind: 'laser', name: '激光笔', description: '死死钉在光标上，拍到也抓不住（这就是笑点）' },
      ],
    },
  }).catch((error) => dlog(`report_capabilities failed: ${String(error)}`));

  void listen<number>('set-scale', (event) => {
    renderer.setScale(event.payload);
    engineRecorder.record({ type: 'scale_changed', at: performance.now(), scale: event.payload });
  });


  // Tray/management "重置位置" - a recovery action for "it wandered somewhere I can't
  // find it" (mostly relevant to 'auto' mode's avoidance behavior).
  void listen('reset-position', () => {
    engine.resetPosition();
  });

  // The one channel an external AI driver can use to nudge the pet - see
  // packages/perception-contract's AIIntent and LifeEngine.suggestMoveTo. Arrives via the
  // Rust-side local HTTP bridge's POST /intent (src-tauri/src/lib.rs). An intent's `mode` field
  // is accepted and ignored - there is only one mode now (see the life engine's
  // INTERACTION_MODES) - rather than rejected, so an agent written against the older build
  // still gets its movement suggestion honoured.
  void listen<AIIntent>('ai-intent', (event) => {
    dlog(`ai-intent received: ${JSON.stringify(event.payload)}`);
    const { targetPoint, holdMs } = event.payload;
    if (targetPoint) engine.suggestMoveTo(targetPoint, performance.now(), holdMs);
  });

  window.addEventListener('mousedown', () => {
    if (!isCaptured || !cursor) return;
    // Clicking the yarn ball picks it UP and starts winding a throw, rather than grabbing the
    // cat. Whichever of the two the pointer is actually over wins - see the hit test in frame().
    if (overToy && engine.toy?.kind === 'yarn') {
      isChargingToy = engine.beginCharge(performance.now());
      if (isChargingToy) return;
    }
    isMouseDown = true;
    dragStartedAt = performance.now();
    dragMoved = false;
    engine.beginDrag(cursor);
    engineRecorder.record({ type: 'click_on_pet', at: dragStartedAt, position: cursor });
  });
  window.addEventListener('mousemove', (event) => {
    // Aim comes from the pointer's recent travel, so a flick throws the ball the way you
    // flicked it. Sampled here rather than from the relayed cursor for the same latency reason
    // the drag path documents below.
    if (isChargingToy) {
      const at = { x: event.clientX, y: event.clientY };
      if (lastAimSample) {
        aim = { x: at.x - lastAimSample.x, y: at.y - lastAimSample.y };
      }
      lastAimSample = at;
      return;
    }
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
  // Double-click is the deliberate "hello" gesture: a head bump, a burst of hearts and a
  // short line. Distinct from a click-drag (pick the cat up) and from hovering (it notices
  // you), so all three gestures mean different things instead of competing.
  window.addEventListener('dblclick', () => {
    if (!isCaptured || !wasHit) return;
    renderer.playAction?.('head-bump');
    renderer.playExpression?.('撒娇', 2600);
    const head = renderer.headScreenPoint?.();
    if (head) fx.hearts(head.x, head.y, 7);
    lastAffectionLine = pickAffectionLine(lastAffectionLine);
    fx.say(lastAffectionLine, 2200);
    engineRecorder.record({ type: 'click_on_pet', at: performance.now(), position: cursor ?? { x: 0, y: 0 } });
  });

  window.addEventListener('mouseup', () => {
    if (isChargingToy) {
      engine.releaseCharge(performance.now(), aim);
      isChargingToy = false;
      lastAimSample = null;
      aim = null;
      return;
    }
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

  // Push a perception snapshot to Rust twice a second. Not every frame - that would be 60 IPC
  // calls a second for data nobody reads that fast - but the old two-second interval was too
  // coarse to even observe a short action clip through, let alone react to one.
  setInterval(() => {
    const now = performance.now();
    const snapshot = {
      observedAt: Date.now(),
      cursor,
      petPosition: engine.position,
      petState: engine.state,
      mode: engine.mode,
      // What the cat is doing right now, beyond where it is: which clip is playing and what it
      // is playing with. Both are things an agent (or the debug console, or a person watching
      // the 首页 card) genuinely wants to know and previously had no way to see.
      action: renderer.playingAction?.id ?? null,
      toy: engine.toy ? { kind: engine.toy.kind, position: engine.toy.position } : null,
      catName,
      activeAgent,
      activity: engineRecorder.summary(now),
      growth: engineRecorder.growth(),
    };
    void invoke('report_perception', { snapshot }).catch(() => {});
  }, 500);

  let lastFrameAt: number | null = null;
  let loggedFirstFrame = false;
  let frameErrorCount = 0;
  let lastStepAt = 0;
  let warnedAboutStalledRaf = false;
  let wasHit = false;
  let heldForAction: string | null = null;
  function frame(now: number) {
    step(now);
    requestAnimationFrame(frame);
  }

  function step(now: number) {
    lastStepAt = performance.now();
    try {
      const deltaSeconds = lastFrameAt == null ? 0 : Math.min(0.1, (now - lastFrameAt) / 1000);
      lastFrameAt = now;

      // Drag position updates now come from the native mousemove listener above (faster,
      // no relay round-trip) - nothing to do here for dragging specifically.
      const snapshot = engine.tick(now, cursor);
      renderer.render(snapshot, deltaSeconds, cursor);

      // Whenever a clip starts, pin the cat in place for as long as it runs. The renderer owns
      // the clip library and the director's scheduling; the engine owns whether the cat is
      // allowed to walk. This is the one line that connects them, and without it a scheduled
      // action is routinely cut off a second in by the wander timer - which in 'auto' mode,
      // where idle windows are short, meant actions almost never actually played.
      // Keep any speech bubble parked over the cat's head while it moves. Guarded on
      // `speaking` so the projection cost is only paid when there is actually a bubble.
      // --- pointer affection: noticing you, and being stroked ---------------------------
      if (cursor && wasHit && !isMouseDown && !isChargingToy) {
        if (hoverSince === 0) {
          hoverSince = now;
          strokeDistance = 0;
          lastHoverSample = cursor;
        }
        if (lastHoverSample) {
          strokeDistance += Math.hypot(cursor.x - lastHoverSample.x, cursor.y - lastHoverSample.y);
        }
        lastHoverSample = cursor;
        if (now >= pointerReactionUntil) {
          const reaction = pickPointerReaction({
            hovering: true,
            hoverMs: now - hoverSince,
            strokeDistance,
          });
          if (reaction) {
            renderer.playAction?.(reaction.clip);
            renderer.playExpression?.(reaction.expression, reaction.kind === 'stroke' ? 4200 : 1800);
            if (reaction.kind === 'stroke') {
              const head = renderer.headScreenPoint?.();
              if (head) fx.hearts(head.x, head.y, 3);
              strokeDistance = 0; // start earning the next purr
              pointerReactionUntil = now + 4200;
            } else {
              pointerReactionUntil = now + 2600;
            }
          }
        }
      } else {
        hoverSince = 0;
        strokeDistance = 0;
        lastHoverSample = null;
      }

      // --- toy play: stalk, spring, rear up ---------------------------------------------
      const toyNow = snapshot.toy;
      if (toyNow && snapshot.state === 'play_toy' && now >= toyReactionUntil && !renderer.playingAction) {
        const reaction = pickToyReaction({
          kind: toyNow.kind,
          distance: Math.hypot(toyNow.position.x - snapshot.position.x, toyNow.position.y - snapshot.position.y),
          toySpeed: Math.hypot(toyNow.velocity.x, toyNow.velocity.y),
          held: toyNow.held,
        });
        if (reaction) {
          renderer.playAction?.(reaction.clip);
          toyReactionUntil = now + reaction.cooldownMs;
        }
      }

      // Anything that follows the cat - tracked speed lines, a speech bubble - is re-anchored
      // here, once a frame, from the cat's real screen position.
      fx.anchorEffects(snapshot.position.x, snapshot.position.y);
      if (fx.speaking) {
        const head = renderer.headScreenPoint?.();
        if (head) fx.anchorBubble(head.x, head.y - 18);
      }

      const playing = renderer.playingAction ?? null;
      if (playing && playing.id !== heldForAction) {
        heldForAction = playing.id;
        // Only clips that need the legs pin the cat. A tail flick or a glance can happily play
        // while it keeps walking, and holding for those would make it stop for no visible reason.
        if (!playing.legFree) engine.hold(playing.remainingMs, now);
      } else if (!playing) {
        heldForAction = null;
      }
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
        // The yarn ball needs a grab region of its own, and the window has to stop being
        // click-through over it as well - otherwise the mousedown that picks the ball up never
        // reaches this webview at all.
        const toy = snapshot.toy;
        overToy = toy?.kind === 'yarn' && Math.hypot(toy.position.x - cursor.x, toy.position.y - cursor.y) < TOY_GRAB_RADIUS_PX;
        const shouldCapture = hit || overToy || isMouseDown || isChargingToy;
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
  }

  // Watchdog. requestAnimationFrame is the right driver when the window is being composited,
  // but it is entirely at the compositor's discretion: a webview that the OS considers hidden,
  // occluded or otherwise not worth drawing simply stops being called, and a pet whose whole
  // simulation lives inside rAF freezes solid until something happens to wake it. That is not
  // an acceptable failure mode for something that is supposed to be quietly alive on your
  // desktop all day, so the simulation gets a floor: if no frame has run for a while, drive it
  // from a timer instead. Rendering while nothing is composited costs nothing visible, and the
  // cat is in the right place when the window comes back.
  const WATCHDOG_INTERVAL_MS = 100;
  const STALL_THRESHOLD_MS = 400;
  setInterval(() => {
    const idleFor = performance.now() - lastStepAt;
    if (idleFor < STALL_THRESHOLD_MS) return;
    if (!warnedAboutStalledRaf) {
      warnedAboutStalledRaf = true;
      dlog(`requestAnimationFrame stalled for ${idleFor.toFixed(0)}ms - driving the simulation from a timer instead`);
    }
    step(performance.now());
  }, WATCHDOG_INTERVAL_MS);

  dlog('starting frame loop');
  lastStepAt = performance.now();
  requestAnimationFrame(frame);
}

main().catch((error) => {
  // Mirrored to the Rust process's stdout, not just the webview console: a startup rejection
  // here leaves a cat that renders one frame and then never moves, and the webview console of
  // a transparent always-on-top window is not somewhere anyone is going to look.
  console.error('[lingxi-desktop] fatal startup error', error);
  void invoke('debug_log', {
    message: `FATAL startup error: ${error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : String(error)}`,
  }).catch(() => {});
});
