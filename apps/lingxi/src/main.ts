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
import { listen, emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

// TEMPORARY: mirrors checkpoints into the Rust process's stdout, since the real
// Tauri webview's console isn't otherwise reachable while debugging click-through.
function dlog(message: string) {
  console.log(message);
  void invoke('debug_log', { message }).catch(() => {});
}

/**
 * Gap between the cat's anchor point and the left/right screen edges, in logical pixels. Matches
 * the life engine's own default so the horizontal look is unchanged; syncMargins() derives the
 * vertical margins from what this one produces.
 */
const EDGE_MARGIN = 24;

/** Shared by the startup report and every post-reload republish, so the two cannot drift. */
const TOY_CATALOGUE = [
  { kind: 'yarn', name: '毛线球', description: '会滚、会撞墙反弹；猫追上去拍一爪又飞出去，能自己玩下去' },
  { kind: 'feather', name: '逗猫棒', description: '跟着你的鼠标走，但慢半拍——需要你来逗' },
  { kind: 'laser', name: '激光笔', description: '死死钉在光标上，拍到也抓不住（这就是笑点）' },
];

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

  /**
   * Teach the engine how much room the cat's BODY needs at each screen edge.
   *
   * The engine steers a point, and that point is the cat's FEET - so one scalar margin cannot be
   * right for all four edges. At the left edge the body sticks out sideways by half its width; at
   * the TOP the whole body sticks out upwards, because it is drawn above its own feet. A uniform
   * 24px margin therefore parks the cat against the top of the screen with all but its paws off
   * the display, which is what was reported ("太靠上边缘了").
   *
   * Two boxes come out of the same measurement, because how far the cat MAY go and how far it
   * CHOOSES to go are different questions:
   *
   *   limit  Half the body may leave the screen at any edge. Only extreme things get here - a
   *          performance charging the camera, the user dragging it, a toy that rolled into a
   *          corner - and being able to half-leave the frame is what sells those
   *          ("有时候有些操作我们需要更极致").
   *   roam   Where it puts itself when nothing is happening: whole cat on screen top and bottom,
   *          the approved 24px at the sides. This is the half that has to stay conservative,
   *          because a pet you cannot see is not a pet ("自由运动的时候，要一直能看到猫咪").
   *
   * Sideways and vertically stay deliberately different in the roam box. Letting the flank run
   * off the side costs nothing and is the look that was asked to be kept ("左右两侧只盖住一半
   * 身体我觉得是对的"). Applying that same share to the top would cost the head - the cat is
   * nearly 3x taller than wide, so it is 43px of flank but 124px of skull - and the face is the
   * entire point ("表情互动是核心").
   */
  function syncMargins() {
    const extent = renderer.screenExtent?.();
    if (!extent) return;
    const { above, below, halfWidth } = extent;
    const height = above + below;
    if (!(height > 0) || !(halfWidth > 0)) return;

    engine.setMargins({
      // Hard limit: the anchor may travel until half the body has left the screen. Sideways the
      // anchor is already centred in the body, so "half off" is the anchor sitting exactly on
      // the edge - hence 0. Vertically the anchor is at the feet, so the same rule lands
      // somewhere quite different at each end, which is the whole reason these are measured.
      left: 0,
      right: 0,
      top: above - height * 0.5,
      bottom: below - height * 0.5,
      roam: {
        left: EDGE_MARGIN,
        right: EDGE_MARGIN,
        // Large, and that is the point: the anchor has to sit a whole body-height down from the
        // top for the ears to clear it.
        top: above,
        bottom: below,
      },
    });
  }
  syncMargins();

  // Which screen edges the cat is welcome on. The engine has no idea where the menu bar, Dock or
  // taskbar are; this layer does, and it is platform-specific.
  //
  // macOS: the right edge is the emptiest strip on a desktop, the left nearly as free, the
  // bottom has the Dock, and the top is the worst by a distance - the menu bar runs the whole
  // way across it and the window controls sit at its LEFT end, which is why that corner is
  // called out separately.
  //
  // Windows is a different shape and is left here rather than in a comment elsewhere, so that
  // whoever ports it has the reasoning next to the numbers: the taskbar is usually along the
  // bottom (often with the clock and tray at bottom-right), and the window controls are at the
  // TOP RIGHT - so the bottom becomes the worst edge and the worst corner moves to top-right.
  const isWindows = navigator.userAgent.includes('Windows');
  engine.setEdgePreference(
    isWindows
      ? { right: 1.2, left: 1.6, bottom: 0.2, top: 0.6, worstCorner: { x: 1, y: 0 } }
      : { right: 1.6, left: 1.15, bottom: 0.7, top: 0.25, worstCorner: { x: 0, y: 0 } },
  );

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

  interface HostStatus {
    scale: number;
    visible: boolean;
    mode: string;
    catName: string;
    activeAgent: string;
    avoidRadius: number;
    skin: string;
    camera: string;
  }

  /**
   * Bring the renderer in line with the Rust side's authoritative settings.
   *
   * Called at startup AND periodically (see the reconcile timer below), because the tray's
   * effects reach here as broadcast events and an event is a one-shot: if the webview is not in
   * a state to process it - the compositor suspends webviews it considers not worth drawing,
   * which is the same condition the frame watchdog exists for - the click is simply lost, and
   * the user sees "sometimes the tray menu needs clicking twice". Rust already holds the truth
   * and persists it, so the robust fix is to stop depending on the delivery of any one event
   * and reconcile against that truth instead.
   */
  function applyStatus(status: HostStatus): void {
    renderer.setScale(status.scale);
    currentSkinId = status.skin;
    renderer.setSkin?.(status.skin);
    userCamera = status.camera;
    renderer.setCameraPreset?.(status.camera);
    // Both the skin (proportions) and the camera (foreshortening) change how tall the cat draws.
    syncMargins();
    engine.setAvoidRadius(status.avoidRadius);
  }

  try {
    const status = await invoke<HostStatus>('get_status');
    applyStatus(status);
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
    syncMargins();
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
  // The most recent snapshot the frame loop produced, for the reporting interval to read.
  let lastEngineSnapshot: ReturnType<typeof engine.tick> | null = null;
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
      syncMargins();
      // The bubble lives in the fx layer, which is the host's, so the renderer hands the style
      // back rather than applying it.
      fx.setBubbleStyle(renderer.customBubbleStyle ?? {});
      await invoke('report_asset_errors', { errors }).catch(() => {});
      // Re-publish the capability lists: a reload can add actions, expressions and themes, and
      // GET /capabilities is what an agent validates its ids against. Without this the bridge
      // would keep rejecting a clip the user had just successfully installed.
      void invoke('report_capabilities', {
        capabilities: {
          ...(renderer.describeCapabilities?.() ?? {}),
          performances: performances.list(),
          toys: TOY_CATALOGUE,
        },
      }).catch(() => {});
      if (errors.length) dlog(`custom assets had problems: ${errors.join(' | ')}`);
      else if (payload?.available) dlog('custom assets loaded');
    } catch (error) {
      dlog(`get_custom_assets failed (built-in assets stay in effect): ${String(error)}`);
    }
  }
  await loadCustomAssets();
  // Who the cat is currently speaking for. Applied to the NEXT bubble rather than drawn beside
  // the cat: a mark pinned to the body is a HUD with no natural moment to leave, while a bubble
  // already has one. Arrives before the `say` that follows it, because the Rust side claims the
  // stage before it applies the rest of the command.
  void listen<{ name: string; logo: string | null; color: string }>('agent-stage', (event) => {
    const { name, logo, color } = event.payload;
    fx.setBubbleAttribution(logo ? { name, logo, color } : null);
  });

  void listen('reload-custom-assets', () => {
    void loadCustomAssets().then(() => {
      renderer.setSkin?.(currentSkinId);
      // Tells the management window to rebuild its theme cards. Without it a user who adds a
      // theme and reloads is told it worked and still has nothing to click.
      void emit('custom-assets-reloaded', {});
    });
  });

  // 外观: theme ("主题"/皮肤) and viewing angle ("视角"). Both are live - the renderer
  // rebuilds/eases rather than requiring a restart - and both are persisted on the Rust side,
  // so these listeners also cover the startup restore broadcast.
  void listen<string>('set-skin', (event) => {
    currentSkinId = event.payload;
    renderer.setSkin?.(event.payload);
    syncMargins();
  });
  void listen<string>('set-camera', (event) => {
    userCamera = event.payload;
    renderer.setCameraPreset?.(event.payload);
    syncMargins();
  });

  // 调试台 / agent control surface. The companion window is the only process that owns a
  // renderer, so every "do X right now" request - whether it came from the debug console's
  // buttons or from an agent's HTTP POST - arrives here as an event and is applied the same
  // way. See src-tauri's spawn_perception_server for the HTTP half.
  void listen<{ id: string }>('play-action', (event) => {
    markInteresting();
    const ok = renderer.playAction?.(event.payload.id) ?? false;
    if (!ok) dlog(`play-action: unknown clip ${event.payload.id}`);
  });
  void listen<{ name: string; holdMs?: number }>('play-expression', (event) => {
    markInteresting();
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
    markInteresting();
    if (!performances.play(event.payload.id)) dlog(`perform: unknown performance ${event.payload.id}`);
  });
  void listen('perform-stop', () => performances.stop());

  void listen<{ kind: string }>('set-toy', (event) => {
    markInteresting();
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
    markInteresting();
    fx.say(event.payload.text, event.payload.durationMs);
  });

  // Publish what this renderer can do, once, so GET /capabilities can answer an agent
  // without round-tripping through the webview - and so the debug console builds its grids
  // from the real clip library rather than a copy of it.
  void invoke('report_capabilities', {
    capabilities: {
      ...(renderer.describeCapabilities?.() ?? {}),
      performances: performances.list(),
      toys: TOY_CATALOGUE,
    },
  }).catch((error) => dlog(`report_capabilities failed: ${String(error)}`));

  void listen<number>('set-scale', (event) => {
    markInteresting();
    renderer.setScale(event.payload);
    syncMargins();
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
  let lastPerceptionAt = 0;
  setInterval(() => {
    const now = performance.now();
    // While dormant nothing is moving, so re-sending the same snapshot twice a second is pure
    // IPC for no reader. Once every 5s is enough for an agent polling /perception to see a
    // live-but-quiet cat rather than a stale one.
    const minInterval = tier === 'dormant' ? 5000 : 0;
    if (now - lastPerceptionAt < minInterval) return;
    lastPerceptionAt = now;
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
      // The three fields a driver previously had no way to read back. `expression` is the one
      // that mattered most: it could be set but never observed, so a typo'd name and a correct
      // one produced identical, successful-looking responses.
      expression: renderer.currentExpression?.name ?? null,
      expressionHeld: renderer.currentExpression?.held ?? false,
      heading: lastEngineSnapshot?.heading ?? null,
      intent: lastEngineSnapshot?.intent ?? null,
      // Non-null only if the engine has had to repair its own state. A driver seeing this move
      // knows something fed the cat a value it could not represent - previously that showed up
      // as `{"x":null,"y":null}`, indistinguishable from a missing field.
      recoveredAt: lastEngineSnapshot?.recoveredAt ?? null,
      toy: engine.toy ? { kind: engine.toy.kind, position: engine.toy.position } : null,
      catName,
      activeAgent,
      activity: engineRecorder.summary(now),
      growth: engineRecorder.growth(),
      /** What the app is currently spending. See the power governor. */
      power: tier,
    };
    void invoke('report_perception', { snapshot }).catch(() => {});
  }, 500);

  let lastFrameAt: number | null = null;
  let loggedFirstFrame = false;
  let frameErrorCount = 0;
  /** When requestAnimationFrame last ran, regardless of whether we drew. See the governor. */
  let lastRafAt = 0;
  let wasHit = false;
  let heldForAction: string | null = null;
  function frame(now: number) {
    // Recorded before any early return: this timestamp is the evidence that the compositor is
    // still drawing us, which is what separates 'idle' from 'dormant'.
    lastRafAt = performance.now();
    if (tier === 'dormant') setTier('active'); // the compositor came back
    const interval = FRAME_INTERVAL[tier];
    if (interval === 0 || lastRafAt - lastRenderAt >= interval) {
      lastRenderAt = lastRafAt;
      step(now);
    }
    requestAnimationFrame(frame);
  }

  function step(now: number) {
    try {
      const deltaSeconds = lastFrameAt == null ? 0 : Math.min(0.1, (now - lastFrameAt) / 1000);
      lastFrameAt = now;

      // Drag position updates now come from the native mousemove listener above (faster,
      // no relay round-trip) - nothing to do here for dragging specifically.
      const snapshot = engine.tick(now, cursor);
      // Kept for the reporting interval below. It must NOT call tick() itself: that would
      // advance the simulation a second time, off the animation clock, and every distance the
      // gait integrates would be wrong.
      lastEngineSnapshot = snapshot;
      renderer.render(snapshot, deltaSeconds, cursor);

      // Whenever a clip starts, pin the cat in place for as long as it runs. The renderer owns
      // the clip library and the director's scheduling; the engine owns whether the cat is
      // allowed to walk. This is the one line that connects them, and without it a scheduled
      // action is routinely cut off a second in by the wander timer - which in 'auto' mode,
      // where idle windows are short, meant actions almost never actually played.
      // Keep any speech bubble parked over the cat's head while it moves. Guarded on
      // `speaking` so the projection cost is only paid when there is actually a bubble.
      // --- pointer affection: noticing you, and being stroked ---------------------------
      // `pointer.byUser` is the engine's verdict on who closed the distance. Gating on it is
      // what makes the affection mean something: the cat purrs because you reached for it, not
      // because it happened to wander onto a cursor you had parked and forgotten about
      // ("鼠标主动放到他身上的时候应该是亲近"). The same flag stops it fleeing, so the two
      // halves of the reaction finally agree with each other.
      if (cursor && wasHit && snapshot.pointer?.byUser && !isMouseDown && !isChargingToy) {
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
  // Settings reconcile. A tray click reaches this webview as a broadcast event, and an event is
  // a one-shot: if it is not processed the change is lost, and the user has to click again -
  // reported as "有时候托盘菜单需要点击两次才能有效果". Rust holds the authoritative,
  // persisted state, so rather than trying to make one-shot delivery perfect, the renderer
  // checks it periodically and applies anything it missed. On a timer rather than rAF for the
  // same reason as the watchdog below: timers keep running when the compositor stops drawing.
  const RECONCILE_INTERVAL_MS = 1500;
  let lastStatusJson = '';
  let lastReconcileAt = 0;
  setInterval(() => {
    const now = performance.now();
    if (tier === 'dormant' && now - lastReconcileAt < 10_000) return;
    lastReconcileAt = now;
    void invoke<HostStatus>('get_status')
      .then((status) => {
        // Compare before applying: setSkin rebuilds the rig and repaints both atlases, so
        // calling it every 1.5s because nothing changed would be genuinely expensive.
        const json = JSON.stringify([status.scale, status.skin, status.camera, status.avoidRadius]);
        if (json === lastStatusJson) return;
        const missed = lastStatusJson !== '';
        lastStatusJson = json;
        applyStatus(status);
        if (missed) dlog(`reconciled settings the event path missed: ${json}`);
      })
      .catch(() => {});
  }, RECONCILE_INTERVAL_MS);

  // --- power governor -----------------------------------------------------------------------
  //
  // A desktop pet is running every hour the machine is, so its idle cost IS its cost. Before
  // this, the app woke roughly 137 times a second forever: 60Hz cursor polling in Rust, 60fps
  // rendering, plus four timers - and it kept doing all of it with the lid shut.
  //
  // The watchdog below used to make that WORSE on purpose. It existed so the simulation would
  // not freeze when the compositor stopped calling requestAnimationFrame, and it did that by
  // driving the simulation from a timer instead. But rAF stopping is the compositor telling us
  // nobody can see this window, and the right response to "nobody is looking" is not to keep
  // animating from a different clock - it is to stop, and catch up when someone looks again.
  //
  // Three tiers, each justified by something the app can actually observe:
  //
  //   active   rAF is being called and the user is around. Full rate.
  //   idle     rAF is being called but nothing has happened for a while. The cat still breathes
  //            and blinks, so rendering cannot stop - but it can halve. A cat breathing at 20fps
  //            is indistinguishable from one breathing at 60fps, and it is two thirds less GPU.
  //   dormant  rAF has stopped: screen off, locked, another window covering us, or the pet
  //            hidden from the tray. Nothing is drawn at all, and Rust slows its polling too.
  //
  // The gait survives all of this because it is DISTANCE-driven rather than clock-driven: a
  // longer frame advances the stride by exactly the ground it covered, so a lower frame rate
  // changes how smooth it looks and not what it does.
  type PowerTier = 'active' | 'idle' | 'dormant';
  let tier: PowerTier = 'active';
  /** Frame interval per tier, ms. 0 = draw on every rAF callback. */
  const FRAME_INTERVAL: Record<PowerTier, number> = { active: 0, idle: 1000 / 30, dormant: Infinity };
  /** No interaction and nothing happening for this long drops to `idle`. */
  const IDLE_AFTER_MS = 45_000;
  /** rAF quiet for this long means the compositor has stopped drawing us. */
  const DORMANT_AFTER_MS = 1_000;
  let lastInterestingAt = performance.now();
  let lastRenderAt = 0;

  /** Anything that means the user is present, or the cat is mid-something worth seeing. */
  function markInteresting() {
    lastInterestingAt = performance.now();
    if (tier !== 'active') setTier('active');
  }

  function setTier(next: PowerTier) {
    if (next === tier) return;
    const previous = tier;
    tier = next;
    dlog(`power: ${previous} -> ${next}`);
    // Rust slows its own polling to match - the 60Hz cursor thread is the single most expensive
    // thing in the app when nothing is happening, and it is pure waste while nobody can see.
    void invoke('set_power_tier', { tier: next }).catch(() => {});
    if (next === 'active') {
      // Coming back: re-anchor the clock so the first frame after a long sleep is a normal
      // frame and not a multi-hour delta. The engine clamps it anyway, but the fx layer and
      // the camera ease read it too.
      lastFrameAt = null;
    }
  }

  const WATCHDOG_INTERVAL_MS = 250;
  setInterval(() => {
    const now = performance.now();
    const rafQuietFor = now - lastRafAt;
    if (rafQuietFor >= DORMANT_AFTER_MS) {
      // Nobody is compositing this window. Do not draw, and do not simulate - there is nothing
      // to be accurate FOR, and the cat picks up wherever it was the moment anyone looks again.
      setTier('dormant');
      return;
    }
    // Dropping the frame rate is only free while nothing is actually MOVING. A stationary cat
    // breathing and blinking at 30fps is indistinguishable from one at 60; a walking cat is not,
    // and "don't reduce the experience" has to mean something. So the idle tier needs both: the
    // user away from the mouse AND the cat with nothing on screen to smooth.
    const catIsStill =
      lastEngineSnapshot != null
      && (lastEngineSnapshot.state === 'idle' || lastEngineSnapshot.state === 'dragged')
      && !renderer.playingAction
      && lastEngineSnapshot.toy == null;
    if (tier === 'active' && catIsStill && now - lastInterestingAt > IDLE_AFTER_MS) setTier('idle');
    if (tier === 'idle' && !catIsStill) setTier('active');
  }, WATCHDOG_INTERVAL_MS);

  // A direct signal, when the platform gives us one. rAF stalling is the general case (it covers
  // the screen turning off and another window covering us), but visibilitychange is immediate and
  // unambiguous, so use it when it fires rather than waiting out the stall threshold.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) setTier('dormant');
    else markInteresting();
  });

  dlog('starting frame loop');
  lastRafAt = performance.now();
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
