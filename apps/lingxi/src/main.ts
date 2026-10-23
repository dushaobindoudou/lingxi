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
import { createRealisticRenderer } from './realistic-renderer.ts';
import { frameDelta } from './animation-clock.ts';
import { inputProtectedRegions } from './input-avoidance.ts';
import { createRendererSwitcher, type RenderStyle } from './renderer-switcher.ts';
import { createStageFx, type BubbleAttribution } from './fx/stage-fx.ts';
import { agentLook } from './ui/icons.ts';
import { createPerformanceGate } from './fx/performance-gate.ts';
import { createPerformanceRunner } from './fx/performances.ts';
import { pickToyReaction, pickPointerReaction, pickAffectionLine } from './anim/interactions.ts';
import { createPettingSession, bellyIsExposed } from './anim/petting.ts';
import { createLifeEngine, DEFAULT_WANDER_SPEED, TOY_KINDS } from '../../../packages/life-engine/src/index.mjs';
import type { Personality } from '../../../packages/life-engine/src/index.d.mts';
import { createActivityRecorder } from '../../../packages/perception/src/index.mjs';
import type { WorkArea, FocusedInput } from '../../../packages/desktop-host-contract/index.d.ts';
import type { AIIntent } from '../../../packages/perception-contract/index.d.ts';
import { listen, emit } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

// TEMPORARY: mirrors checkpoints into the Rust process's stdout, since the real
// Tauri webview's console isn't otherwise reachable while debugging click-through.
// DEV builds only: the call sites include whole-object snapshots (the first-frame one alone
// is tens of KB of JSON), and every one of them used to run in production too - an invoke
// round-trip per checkpoint, per frame-adjacent event, in the build the user actually runs.
function dlog(message: string) {
  if (!import.meta.env.DEV) return;
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
  { kind: 'feather', name: '逗猫棒', description: '握住棍尾挑动，羽毛在另一端摆动，靠近时猫会蓄力跳扑' },
  { kind: 'laser', name: '激光笔', description: '死死钉在光标上，拍到也抓不住（这就是笑点）' },
  { kind: 'pet', name: '撸猫', description: '按住左键轻抚头部和身体，翻肚后可摸腹部' },
];

const LAUNCH_STYLE_KEY = 'lingxi.launch-style';
function readLaunchStyle(): RenderStyle {
  try { return localStorage.getItem(LAUNCH_STYLE_KEY) === 'voxel' ? 'voxel' : 'realistic'; } catch { return 'realistic'; }
}

async function main() {
  // A rejected `void listen(...)` / `void invoke(...)` used to be an unhandled rejection:
  // invisible in release windows, and in dev a console error attributed to nothing. One
  // handler catches them all and puts them where every other startup/diagnostic line is read.
  // `listen()` from the Tauri API resolves to a disposer, and its promise is the thing that
  // rejects when the event name is wrong or the bridge is gone - the ~20 `void listen` sites
  // across the windows all share this safety net rather than each growing a .catch.
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason instanceof Error ? `${event.reason.name}: ${event.reason.message}` : String(event.reason);
    console.warn('[lingxi-desktop] unhandled rejection:', reason);
    // Handled here means logged, not escalated; the app keeps running and the specific
    // feature simply stays at whatever state its failed setup left it in.
    event.preventDefault();
  });
  dlog('main() start');
  const host = createTauriDesktopHost();
  // Fitted: the canvas follows the cat instead of covering the screen - see the renderer.
  // 风格: one facade for the life of the window; the voxel or the realistic cat behind it (renderer-switcher.ts).
  // The window opens on the style it closed on (the realistic cat unless the user picked the voxel one), so the voxel
  // cat no longer flashes up first while Rust's settings are on their way.
  const launchStyle: RenderStyle = readLaunchStyle();
  const firstRealistic: { ready?: Promise<void> } = {};
  const renderer = createRendererSwitcher({
    voxel: () => createThreeRenderer({ fitCanvasToCat: true }),
    realistic: () => {
      const trace = (message: string) => void invoke('debug_log', { message: `[realcat] ${message}` }).catch(() => {});
      const url = `${import.meta.env.BASE_URL}characters/lingxi-realistic/current/cat.glb`;
      trace(`creating, asset ${url}`);
      const next = createRealisticRenderer({ assetUrl: url, fitCanvasToCat: true, shells: 32 });
      next.ready.then(() => trace('model ready'), (error) => trace(`model failed: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`));
      firstRealistic.ready ??= next.ready;
      return next;
    },
  }, launchStyle);
  // opened on the realistic cat and its model will not load: fall back to the voxel cat rather than an empty window
  if (launchStyle === 'realistic') firstRealistic.ready?.catch(() => { if (renderer.activeStyle === 'realistic') void renderer.switchStyle('voxel'); });
  function applyRenderStyle(style: string | undefined): void {
    const wanted: RenderStyle = style === 'voxel' ? 'voxel' : 'realistic';
    try { localStorage.setItem(LAUNCH_STYLE_KEY, wanted); } catch { /* only costs the voxel user a flash of the realistic cat */ }
    void invoke('debug_log', { message: `[realcat] style requested ${style} -> ${wanted}, active ${renderer.activeStyle}` }).catch(() => {});
    if (wanted === renderer.requestedStyle) return;
    void renderer.switchStyle(wanted).then((result) => {
      // Not dlog (dev only): a style that fails to load in the shipped app must leave a trace.
      void invoke('debug_log', { message: `render style ${wanted}: ${JSON.stringify(result)}` }).catch(() => {});
      // the two cats draw different heights, and the margins follow what is drawn
      if (result.applied) { syncMargins(); publishCapabilities(); }
    });
  }
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
    toyInteraction: renderer.toyInteraction,
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
  let inputAvoidanceEnabled = true;
  let autoEffectsEnabled = false;
  let syncAutoEffects: ((enabled: boolean) => void) | null = null;

  interface HostStatus {
    scale: number;
    visible: boolean;
    mode: string;
    catName: string;
    activeAgent: string;
    avoidRadius: number;
    skin: string;
    camera: string;
    renderStyle?: string;
    inputAvoidance?: boolean;
    autoEffects?: { enabled: boolean };
    /** The five sliders from 主界面. The engine reads these - see applyStatus. */
    personalityTraits?: Partial<Personality>;
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
    applyRenderStyle(status.renderStyle);
    inputAvoidanceEnabled = status.inputAvoidance !== false;
    autoEffectsEnabled = status.autoEffects?.enabled === true;
    syncAutoEffects?.(autoEffectsEnabled);
    // Both the skin (proportions) and the camera (foreshortening) change how tall the cat draws.
    syncMargins();
    engine.setAvoidRadius(status.avoidRadius);
    // Reconciled here rather than only on the broadcast, for the same reason as everything
    // else in this function: an event can be dropped while the webview is suspended, and the
    // Rust side is the one that persists the truth.
    if (status.personalityTraits) engine.setPersonality(status.personalityTraits);
    // catName/activeAgent ride the same argument: they also arrive as one-shot events
    // (set-cat-identity / set-active-agent), a dropped event left the perception snapshot
    // attributing the cat's state to a stale name for a whole reconcile period.
    catName = status.catName;
    activeAgent = status.activeAgent;
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
  // The five trait sliders. These used to be persisted and broadcast and nothing more - the
  // management window said so in as many words ("行为引擎本身还没有消费它们"). The engine now
  // reads them: they move how long the cat rests, how fast it walks, how hard it chases a toy,
  // and how sleepy it has to be before it lies down.
  void listen<Partial<Personality>>('set-personality-traits', (event) => {
    engine.setPersonality(event.payload);
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
  let focusedInput: FocusedInput | null = null;
  let focusedInputSeenAt = -Infinity;
  host.onFocusedInputChange?.(input => {
    focusedInput = input;
    focusedInputSeenAt = performance.now();
  });
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
  /** Previous frame's sleep flag, so waking can be detected as a transition rather than a state. */
  let wasAsleep = false;
  let hoverSince = 0;
  let strokeDistance = 0;
  let lastHoverSample: { x: number; y: number } | null = null;
  let pointerReactionUntil = 0;
  // A hand moving over the realistic cat's coat without pet mode: it leans into the hand until this time (see below)
  let hoverStrokeUntil = 0;
  let lastAffectionLine: string | null = null;
  let toyReactionUntil = 0;
  const petting = createPettingSession();
  let lastPettingPointerAt = -Infinity;
  let bellyDurationMs = 0;
  let lastPettingRegion: string | null = null;

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
    // A delivered DOM event is newer than the asynchronous native cursor relay.
    if (!(petting.pressed && performance.now() - lastPettingPointerAt < 180)) {
      cursor = withinBounds ? next : null;
    }
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

  /** Set once createPerformanceRunner has run; read optionally before that. See publishCapabilities. */
  let performanceRunner: { list: () => unknown[] } | null = null;

  // 自定义资源: the user's own actions / expressions / themes, if they have written any. Loaded
  // before the first status apply, so a custom theme is already available when the persisted
  // theme id is restored. Errors are pushed to Rust so the management window can show them -
  // silently ignoring a file someone hand-edited is the worst possible behaviour here.
  /** Tell Rust what this renderer can do. Safe to call before `performances` exists. */
  function publishCapabilities() {
    void invoke('report_capabilities', {
      capabilities: {
        ...(renderer.describeCapabilities?.() ?? {}),
        performances: performanceRunner?.list() ?? [],
        toys: TOY_CATALOGUE,
      },
    }).catch((error) => dlog(`report_capabilities failed: ${String(error)}`));
  }

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
      // Republished through the same helper the startup path uses. It used to inline
      // `performances.list()` here, and `performances` is declared 50 lines further down - so on
      // the FIRST call, which happens during startup, this threw a temporal-dead-zone
      // ReferenceError that loadCustomAssets' own catch swallowed. The visible symptom was that
      // none of the user's custom assets loaded at all, reported only as one line in a log.
      publishCapabilities();
      if (errors.length) dlog(`custom assets had problems: ${errors.join(' | ')}`);
      else if (payload?.available) dlog('custom assets loaded');
    } catch (error) {
      dlog(`get_custom_assets failed (built-in assets stay in effect): ${String(error)}`);
    }
  }
  await loadCustomAssets();
  // The applyStatus above ran while SKINS was still builtin-only (custom themes load here),
  // so a persisted custom skin silently no-op'd and the cat first painted in the default
  // theme until the periodic reconcile happened to re-apply status. Re-apply now that the
  // merge is done - a no-op when the id is unchanged, a mount when it is not.
  renderer.setSkin?.(currentSkinId);
  syncMargins();
  // Performances may speak later; direct speech carries the source in its own event.
  type SpeechSource = {
    agent: string; name: string; label?: string | null;
    badge: string; logo: string | null; color: string;
  };
  function bubbleSource(source: SpeechSource): BubbleAttribution {
    const { agent, name, label, badge, logo, color } = source;
    const look = agentLook({ id: agent, name, badge, logo, color });
    return {
      name: label || look.name,
      title: label ? `${look.name} · ${label}` : look.name,
      badge: look.badge,
      logo: null,
      markUrl: look.src ?? undefined,
      color: look.chip,
    };
  }
  void listen<SpeechSource>('agent-stage', (event) => {
    fx.setBubbleAttribution(bubbleSource(event.payload));
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
  void listen<boolean>('input-avoidance-enabled', event => { inputAvoidanceEnabled = event.payload; });
  void listen<string>('set-render-style', (event) => applyRenderStyle(event.payload));
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

  // Agent activity (a task event from any integration) is household news: while work keeps
  // happening, a sleeping cat gets up - and a settled one stays up - instead of napping
  // through the user's working day. Every event pulses, terminal states included: a
  // completion is news too, and the engine's rolling window is what turns the last event into
  // a gentle wind-down rather than an abrupt switch-off. This is deliberately NOT gated on
  // whether the event earned a spoken reaction - silent progress still means someone is
  // working; waking is not narrating (see src-tauri's react_to_task_event).
  // Not markInteresting(): a busy agent sends a task event every few seconds for as long as it
  // works, which held the renderer at full rate all day for a cat sitting still. If the pulse gets
  // the cat moving, the frame loop goes back to full rate the moment it does (see step), and any
  // visible reaction arrives as its own play-*/say event, which does count.
  void listen<{ busy: boolean }>('agent-activity', () => {
    engine.activityPulse(performance.now());
  });

  // 特效编排 + 玩具. Both are "do something right now" surfaces, driven identically from the
  // debug console, the tray, the management window and an agent's HTTP POST.
  // Assigned to the forward declaration above so publishCapabilities can reach it once it
  // exists, and read as optional before then rather than throwing.
  const performances = createPerformanceRunner({
    engine,
    renderer,
    fx,
    viewport: () => logicalSize(workArea),
    petPosition: () => engine.position,
    restoreCamera: () => renderer.setCameraPreset?.(userCamera),
    now: () => performance.now(),
  });

  const performanceGate = createPerformanceGate(performances, () => {
    petting.setEnabled(false);
    engine.setPetting(false);
    markInteresting();
  }, () => !petting.enabled && !engine.toy && engine.state !== 'dragged');
  syncAutoEffects = enabled => performanceGate.setEnabled(enabled);
  syncAutoEffects(autoEffectsEnabled);
  void listen<boolean>('auto-effects-enabled', event => {
    autoEffectsEnabled = event.payload;
    performanceGate.setEnabled(event.payload);
  });
  void listen<{ id: string; automatic?: boolean }>('perform', event => {
    performanceGate.play(event.payload.id, event.payload.automatic !== false);
  });
  void listen('perform-stop', () => performances.stop());

  // The cat's own surprises: every so often, while it is idle or strolling and nobody is playing with it, it picks one
  // of its set pieces on its own. Only with 自动特效 on, and through the same shared cooldown as an agent's surprise
  // (claim_auto_effect, which also logs it). The little toot is the everyday one; the big ones (zoomies, a kiss rush,
  // a tantrum, peeing or pooping at you) come round less often - every set piece is a surprise, not only the toot
  // ("原来的特效都是小惊喜"; the potty ones had never been seen, "拉屎和尿尿为啥没看到过").
  const MISCHIEF = {
    firstMin: [3, 6],
    everyMin: [8, 18],
    weights: { 'little-toot': 4, zoomies: 2, 'kiss-rush': 2, 'angry-claw': 1, 'pee-at-you': 1, 'poop-at-you': 1 },
  } as const;
  const minutes = ([lo, hi]: readonly [number, number]) => (lo + Math.random() * (hi - lo)) * 60_000;
  const pickMischief = () => {
    const entries = Object.entries(MISCHIEF.weights);
    let roll = Math.random() * entries.reduce((sum, [, w]) => sum + w, 0);
    for (const [id, w] of entries) if ((roll -= w) < 0) return id;
    return entries[0][0];
  };
  let nextMischiefAt = Date.now() + minutes(MISCHIEF.firstMin);
  setInterval(() => {
    if (!autoEffectsEnabled || Date.now() < nextMischiefAt) return;
    if ((engine.state !== 'idle' && engine.state !== 'wander') || engine.toy || performances.active || petting.enabled) return;
    nextMischiefAt = Date.now() + minutes(MISCHIEF.everyMin);
    const id = pickMischief();
    void invoke<boolean>('claim_auto_effect', { id }).then((ok) => { if (ok) performanceGate.play(id, true); }).catch(() => {});
  }, 20_000);

  void listen<{ kind: string }>('set-toy', (event) => {
    markInteresting();
    if (event.payload.kind === 'pet' || event.payload.kind === 'petting') {
      performances.stop();
      engine.clearIntent();
      engine.setToy('pet');
      engine.setPetting(true);
      petting.setEnabled(true);
      lastPettingRegion = null;
      fx.say('按住左键，轻轻摸摸我～', 2600);
      return;
    }
    // Validated here rather than trusted: this event can originate from an agent's HTTP POST,
    // and the engine treats an unknown kind as a no-op, which would look like a silent failure.
    const kind = event.payload.kind as (typeof TOY_KINDS)[number];
    if (!TOY_KINDS.includes(kind)) {
      dlog(`set-toy: unknown toy ${event.payload.kind}`);
      return;
    }
    petting.setEnabled(false);
    engine.setPetting(false);
    engine.setToy(kind);
  });
  void listen('clear-toy', () => {
    petting.setEnabled(false);
    engine.setPetting(false);
    engine.clearToy();
  });
  void listen('request-play-mode', () => {
    void emit('play-mode', { kind: petting.enabled ? 'pet' : engine.toy?.kind ?? null });
  });
  void listen('petting-belly', () => {
    if (!petting.enabled) return;
    petting.release();
    if (renderer.playAction?.('belly-up')) bellyDurationMs = renderer.playingAction?.remainingMs ?? 0;
  });

  // 说话气泡: one line at a time, above the head, anchored every frame in frame() below.
  void listen<{ text: string; durationMs?: number; source?: SpeechSource }>('say', (event) => {
    markInteresting();
    // An empty text is the hush signal (the debug console's 收起 button, and anything else
    // that wants to withdraw a line); fx.say no-ops on empty, so it is routed explicitly.
    if (!event.payload.text.trim()) fx.hush();
    else fx.say(
      event.payload.text,
      event.payload.durationMs,
      event.payload.source ? bubbleSource(event.payload.source) : null,
    );
  });

  // Publish what this renderer can do, once, so GET /capabilities can answer an agent
  // without round-tripping through the webview - and so the debug console builds its grids
  // from the real clip library rather than a copy of it.
  performanceRunner = performances;
  publishCapabilities();

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

  window.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    if (petting.enabled) {
      const point = { x: event.clientX, y: event.clientY };
      if (renderer.pettingHitTest?.(point, false) != null) {
        cursor = point;
        lastPettingPointerAt = performance.now();
        petting.press();
        isCaptured = true;
        void host.setClickThrough(false);
        markInteresting();
        engineRecorder.record({ type: 'click_on_pet', at: lastPettingPointerAt, position: point });
      }
      return;
    }
    if (!isCaptured || !cursor) return;
    // Clicking the yarn ball picks it UP and starts winding a throw, rather than grabbing the
    // cat. Whichever of the two the pointer is actually over wins - see the hit test in frame().
    if (overToy && engine.toy?.kind === 'yarn') {
      isChargingToy = engine.beginCharge(performance.now());
      if (isChargingToy) return;
    }
    isMouseDown = true;
    markInteresting();
    dragStartedAt = performance.now();
    dragMoved = false;
    engine.beginDrag(cursor);
    engineRecorder.record({ type: 'click_on_pet', at: dragStartedAt, position: cursor });
  });
  window.addEventListener('mousemove', (event) => {
    if (petting.enabled) {
      cursor = { x: event.clientX, y: event.clientY };
      lastPettingPointerAt = performance.now();
      markInteresting();
      return;
    }
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
    if (petting.enabled) return;
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
    petting.release();
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
  window.addEventListener('blur', () => petting.release());
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && petting.enabled) void emit('clear-toy');
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
  // Stopped outright while suspended (see the power governor): suspend() pushes one last snapshot
  // saying so, and the bridge serves that until the cat is back.
  const PERCEPTION_INTERVAL_MS = 500;
  let perceptionTimer: ReturnType<typeof setInterval> | null = null;
  function pushPerception() {
    const now = performance.now();
    const renderState = renderer.describeCapabilities?.() as { style?: string; gait?: unknown; textures?: unknown; animation?: { fps?: number } } | undefined;
    const snapshot = {
      observedAt: Date.now(),
      cursor,
      petPosition: engine.position,
      petState: engine.state,
      renderDiagnostics: renderState?.style === 'realistic'
        // fps and power tier: what the shipped webview actually manages, which a Chrome capture cannot tell ("游戏慢半拍")
        ? { gait: renderState.gait, textures: renderState.textures, fps: renderState.animation?.fps ?? null, tier } : null,
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
      // How far the HEAD is turned relative to the body. Separate from `heading`, which is the
      // body: the cat can be facing you squarely and still be looking off to one side.
      headYaw: renderer.headYaw ?? null,
      intent: lastEngineSnapshot?.intent ?? null,
      // True while the household-activity window opened by the last task event is still open
      // - the answer to "why is the cat up and patrolling while I work".
      agentBusy: lastEngineSnapshot?.agentBusy ?? false,
      // Non-null only if the engine has had to repair its own state. A driver seeing this move
      // knows something fed the cat a value it could not represent - previously that showed up
      // as `{"x":null,"y":null}`, indistinguishable from a missing field.
      recoveredAt: lastEngineSnapshot?.recoveredAt ?? null,
      toy: engine.toy ? { kind: engine.toy.kind, position: engine.toy.position } : null,
      catName,
      activeAgent,
      activity: engineRecorder.summary(now),
      growth: engineRecorder.growth(),
      /**
       * Why the cat is behaving the way it is: energy, sleepiness, the hour's weight, and the
       * threshold this particular personality has to cross to lie down.
       *
       * This is the field that makes the life system answerable from outside. "Why is it so
       * slow today" and "why has it been curled up for twenty minutes" were questions nothing
       * - not the debug console, not an agent, not the 首页 card - had any way to answer,
       * because the only thing published was which state the cat was in, and every slow day
       * looks like `idle` from there.
       */
      vitals: lastEngineSnapshot?.vitals ?? null,
      /** The traits actually in force in the engine, which is not the same as the ones saved. */
      personality: lastEngineSnapshot?.personality ?? null,
      /** What the app is currently spending. See the power governor. */
      power: tier,
    };
    void invoke('report_perception', { snapshot }).catch(() => {});
  }

  let lastFrameAt: number | null = null;
  let loggedFirstFrame = false;
  let frameErrorCount = 0;
  /** When requestAnimationFrame last ran, regardless of whether we drew. See the governor. */
  let lastRafAt = 0;
  let wasHit = false;
  let heldForAction: string | null = null;
  /** The pending requestAnimationFrame, or 0. Cancelled outright while suspended. */
  let rafHandle = 0;
  /** Below the display's rate, the gap before the next rAF is waited out on this timer. */
  let frameTimer: ReturnType<typeof setTimeout> | null = null;
  function frame(now: number) {
    rafHandle = 0;
    // Recorded before any early return: this timestamp is the evidence that the compositor is
    // still drawing us, which is what separates 'idle' from 'stalled'.
    lastRafAt = performance.now();
    // Suspended: let the loop die here. resume() is what starts it again.
    if (tier === 'dormant') return;
    // The compositor came back.
    if (tier === 'stalled') setTier('active');
    const interval = frameInterval();
    // A few ms of slack: rAF timestamps jitter, and a strict comparison turned 30fps into 20.
    if (interval === 0 || lastRafAt - lastRenderAt >= interval - 4) {
      lastRenderAt = lastRafAt;
      step(now);
    }
    scheduleFrame();
  }

  /**
   * Ask for the next frame. At full rate that is simply the next rAF. Below it, most of the gap
   * is waited out on a timer FIRST and the rAF requested only for the frame that will actually be
   * drawn: a pending rAF keeps WebKit running its rendering update on every vsync even when the
   * callback then does nothing, so asking for one per display frame and skipping half of them was
   * paying for 60fps to draw 30.
   */
  function scheduleFrame() {
    if (rafHandle || frameTimer || tier === 'dormant') return;
    const interval = frameInterval();
    // Wake up roughly half a display frame before the frame is due, then let rAF align it to vsync.
    const wait = interval > 0 && Number.isFinite(interval) ? interval - 10 - (performance.now() - lastRenderAt) : 0;
    if (wait > 0) {
      frameTimer = setTimeout(() => {
        frameTimer = null;
        if (tier !== 'dormant') rafHandle = requestAnimationFrame(frame);
      }, wait);
    } else {
      rafHandle = requestAnimationFrame(frame);
    }
  }

  function step(now: number) {
    try {
      const deltaSeconds = frameDelta(lastFrameAt, now, renderer.activeStyle);
      lastFrameAt = now;

      // Drag position updates now come from the native mousemove listener above (faster,
      // no relay round-trip) - nothing to do here for dragging specifically.
      // The engine's radial fallback is useful in headless tests, but the live cat has an
      // actual silhouette. Use that for touch so approaching from below cannot trigger early.
      const pointerOnPet = cursor ? petting.enabled
        ? renderer.pettingHitTest?.(cursor, false) != null
        : renderer.hitTest(cursor, true) : false;
      // the realistic cat's legs set its pace (a small one strolls, it does not skate); the voxel cat's legs follow any
      const pace = renderer.locomotionPace?.();
      engine.setPace(pace ? Math.min(1, pace / DEFAULT_WANDER_SPEED) : 1);
      const input = inputAvoidanceEnabled && now - focusedInputSeenAt < 2000 ? focusedInput : null;
      engine.setProtectedRegions(inputProtectedRegions(input, workArea,
        renderer.screenExtent?.() ?? { above: 120, below: 20, halfWidth: 80 }));
      engine.setNaturalWander(renderer.activeStyle === 'realistic');
      engine.setSprintPace(renderer.sprintPace?.() ?? null);
      const snapshot = engine.tick(now, cursor, pointerOnPet);
      const yieldingToInput = snapshot.inputAvoidance.overlapping;
      if (yieldingToInput) performances.stop();
      // Clear the text immediately while the cat quietly walks out. With no free spot
      // (a full-window editor without caret bounds), wait invisibly until focus changes.
      document.documentElement.style.opacity = yieldingToInput ? '0' : '1';
      if (yieldingToInput || !pointerOnPet) petting.release();
      // Kept for the reporting interval below. It must NOT call tick() itself: that would
      // advance the simulation a second time, off the animation clock, and every distance the
      // gait integrates would be wrong.
      lastEngineSnapshot = snapshot;
      // Back to full rate the frame something starts moving, not at the watchdog's next look:
      // a walk that starts at 30fps reads as a stutter.
      if (tier === 'idle' && !catIsStill()) setTier('active');
      const exposedBelly = bellyIsExposed(renderer.playingAction, bellyDurationMs);
      const touched = petting.enabled && petting.pressed && cursor && !yieldingToInput
        ? renderer.pettingHitTest?.(cursor, exposedBelly) ?? null : null;
      const strokedInPassing = now < hoverStrokeUntil && wasHit && !isMouseDown;
      renderer.render({ ...snapshot, pettingContact: (touched != null && touched !== 'belly') || strokedInPassing }, deltaSeconds, cursor);
      const affection = petting.tick(cursor, touched, now);
      if (affection) {
        // Keep the belly pose while stroking it; do not interrupt the roll with a standing clip.
        if (affection.clip && renderer.playingAction?.id !== 'belly-up') renderer.playAction?.(affection.clip);
        renderer.playExpression?.(affection.expression, 2000);
        if (affection.region !== lastPettingRegion) {
          fx.say({ head: '呼噜…再摸摸头～', body: '顺毛好舒服…', belly: '轻一点点，喵～' }[affection.region], 2000);
          lastPettingRegion = affection.region;
        }
        const head = renderer.headScreenPoint?.();
        if (head) fx.hearts(head.x, head.y, 3);
      }
      document.documentElement.style.cursor = petting.enabled && pointerOnPet
        ? petting.pressed ? 'grabbing' : 'grab' : '';
      fx.petHand(!yieldingToInput && snapshot.toy?.kind === 'pet' ? cursor : null);

      // --- sleep, made visible ----------------------------------------------------------
      //
      // The engine decides the cat is asleep; this is what that looks like. Without these
      // lines `state === 'sleep'` is a cat standing perfectly still doing nothing, which is
      // indistinguishable from the frozen-in-a-state bug the engine goes to some length to
      // make impossible - the worst possible way for a new state to present itself.
      //
      // `curled-sleep` is 6s and does not loop, so it is re-started whenever it ends. That is
      // also what keeps the nap intact: the idle director does not schedule anything while an
      // action is playing, so a continuously-playing clip is how the cat stays asleep instead
      // of being interrupted by a yawn or a grooming clip every few seconds.
      if (snapshot.state === 'sleep') {
        if (!renderer.playingAction) renderer.playAction?.('curled-sleep');
      } else if (wasAsleep && !petting.enabled) {
        // Waking up is a beat of its own. A cat that snaps from curled to walking looks
        // teleported; one that stretches first reads as having just got up.
        renderer.playAction?.('stretch-front');
      }
      wasAsleep = snapshot.state === 'sleep';

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
      if (!yieldingToInput && !petting.enabled && !snapshot.toy && cursor && wasHit && snapshot.pointer?.byUser && !isMouseDown && !isChargingToy) {
        if (hoverSince === 0) {
          hoverSince = now;
          strokeDistance = 0;
          lastHoverSample = cursor;
        }
        const moved = lastHoverSample ? Math.hypot(cursor.x - lastHoverSample.x, cursor.y - lastHoverSample.y) : 0;
        strokeDistance += moved;
        lastHoverSample = cursor;
        // the lean lasts only while the hand keeps moving: a parked pointer is not a stroke
        if (moved > 0.5 && now < hoverStrokeUntil) hoverStrokeUntil = now + 900;
        if (now >= pointerReactionUntil) {
          const reaction = pickPointerReaction({
            hovering: true,
            hoverMs: now - hoverSince,
            strokeDistance,
          });
          if (reaction?.kind === 'stroke' && renderer.activeStyle === 'realistic' && moved > 0.5) {
            // A hand moving back and forth over the coat: the coat already parts under it, and the cat leans into it,
            // eyes half shut - before, only the fur moved and the cat itself did nothing ("现在摸猫他没有动作了")
            hoverStrokeUntil = now + 900;
            renderer.playExpression?.(reaction.expression, 1800);
            pointerReactionUntil = now + 250;
          } else if (reaction?.kind === 'notice') {
            // Ordinary attention can acknowledge an approaching pointer. Stroking is handled only by the explicit
            // pressed, anatomically checked petting session above.
            const movingHand = renderer.activeStyle === 'realistic' && strokeDistance > 24;
            if (!movingHand) {
              renderer.playAction?.(reaction.clip);
              renderer.playExpression?.(reaction.expression, 1800);
            }
            pointerReactionUntil = now + (movingHand ? 350 : 2600);
          }
        }
      } else {
        hoverSince = 0;
        strokeDistance = 0;
        lastHoverSample = null;
      }

      // --- toy play: stalk, spring, rear up ---------------------------------------------
      const toyNow = snapshot.toy;
      if (toyNow && snapshot.state === 'play_toy' && now >= toyReactionUntil && !performances.active) {
        const reaction = pickToyReaction({
          kind: toyNow.kind,
          distance: Math.hypot((snapshot.target ?? toyNow.position).x - snapshot.position.x,
            (snapshot.target ?? toyNow.position).y - snapshot.position.y),
          toySpeed: Math.hypot(toyNow.velocity.x, toyNow.velocity.y),
          held: toyNow.held,
          playingClip: renderer.playingAction?.id,
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
        if (!playing.legFree) engine.hold(playing.remainingMs, now, true);
      } else if (!playing) {
        heldForAction = null;
      }
      if (!loggedFirstFrame) {
        loggedFirstFrame = true;
        dlog(`first frame rendered, snapshot=${JSON.stringify(snapshot)}`);
      }

      if (cursor) {
        const hit = petting.enabled ? pointerOnPet : renderer.hitTest(cursor);
        if (hit !== wasHit) {
          wasHit = hit;
          engineRecorder.record({ type: hit ? 'cursor_entered_pet' : 'cursor_left_pet', at: now });
        }
        // The yarn ball needs a grab region of its own, and the window has to stop being
        // click-through over it as well - otherwise the mousedown that picks the ball up never
        // reaches this webview at all.
        const toy = snapshot.toy;
        overToy = toy?.kind === 'yarn' && Math.hypot(toy.position.x - cursor.x, toy.position.y - cursor.y) < TOY_GRAB_RADIUS_PX;
        const shouldCapture = !yieldingToInput && (hit || overToy || isMouseDown || isChargingToy || petting.pressed);
        if (shouldCapture !== isCaptured) {
          isCaptured = shouldCapture;
          void host.setClickThrough(!isCaptured);
        }
      } else {
        // The cursor left the window entirely (the poller reports null). Without this branch
        // the latched state froze: if it vanished while ON the cat, `wasHit` stayed true and
        // the next entry never produced a "left" event; and a capture held when the pointer
        // disappeared kept the window un-click-through until the pointer came back - an
        // invisible region of the desktop eating clicks.
        if (wasHit) {
          wasHit = false;
          engineRecorder.record({ type: 'cursor_left_pet', at: now });
        }
        overToy = false;
        if (isCaptured && !isMouseDown && !isChargingToy) {
          isCaptured = false;
          void host.setClickThrough(true);
        }
      }
    } catch (error) {
      frameErrorCount += 1;
      if (frameErrorCount <= 3) {
        dlog(`frame() error #${frameErrorCount}: ${error instanceof Error ? `${error.name}: ${error.message}\n${error.stack}` : String(error)}`);
      }
    }
  }

  // Settings reconcile. A tray click reaches this webview as a broadcast event, and an event is
  // a one-shot: if it is not processed the change is lost, and the user has to click again -
  // reported as "有时候托盘菜单需要点击两次才能有效果". Rust holds the authoritative,
  // persisted state, so rather than trying to make one-shot delivery perfect, the renderer
  // checks it periodically and applies anything it missed. On a timer rather than rAF for the
  // same reason as the watchdog below: timers keep running when the compositor stops drawing.
  //
  // While suspended it is the ONE timer left running, and slowly: its job then is to notice a
  // wake-up whose event was missed (status.present / status.visible), so the cat can never stay
  // frozen just because one event did not arrive.
  const RECONCILE_INTERVAL_MS = 1500;
  const SUSPENDED_RECONCILE_INTERVAL_MS = 30_000;
  let lastStatusJson = '';
  let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleReconcile(delay = tier === 'dormant' ? SUSPENDED_RECONCILE_INTERVAL_MS : RECONCILE_INTERVAL_MS) {
    if (reconcileTimer) clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(reconcile, delay);
  }
  function reconcile() {
    reconcileTimer = null;
    void invoke<HostStatus & { present?: boolean }>('get_status')
      .then((status) => {
        // The Rust side is the truth for both of these; the events are only the fast path.
        suspendedBy.user = !status.visible;
        if (typeof status.present === 'boolean') suspendedBy.system = !status.present;
        updateSuspension();
        // Compare before applying: setSkin rebuilds the rig and repaints both atlases, so
        // calling it every 1.5s because nothing changed would be genuinely expensive.
        const json = JSON.stringify([status.scale, status.skin, status.camera, status.avoidRadius, status.renderStyle, status.inputAvoidance]);
        if (json === lastStatusJson) return;
        const missed = lastStatusJson !== '';
        lastStatusJson = json;
        applyStatus(status);
        if (missed) dlog(`reconciled settings the event path missed: ${json}`);
      })
      .catch(() => {})
      .finally(() => {
        if (!reconcileTimer) scheduleReconcile();
      });
  }

  // --- power governor -----------------------------------------------------------------------
  //
  // A desktop pet runs every hour the machine does, so its idle cost IS its cost. The app used to
  // wake about 137 times a second forever - 60Hz cursor polling in Rust, 60fps rendering, four
  // timers - and kept it up with the lid shut.
  //
  // THE MISTAKE THE FIRST VERSION MADE, because it matters for anyone changing this:
  //
  // It treated "requestAnimationFrame has stopped" as "nobody can see this window", stopped
  // simulating, and waited for rAF to come back. That reasoning is sound for an ordinary window
  // and WRONG for this one. The companion is a transparent, click-through, always-on-top overlay,
  // and macOS deprioritises compositing it while the user can still see it perfectly well. The
  // result was a cat frozen at the centre of the screen, forever, in plain sight - which is the
  // exact failure the original watchdog existed to prevent, removed on a theory that did not hold.
  //
  // So rAF stalling is no longer evidence of anything except that we cannot DRAW. The simulation
  // keeps running off a timer when that happens. Dormancy requires someone to actually say so:
  // the user hiding the cat, the page being hidden, or the OS saying nobody can see the screen
  // (display asleep, locked, screen saver, machine going to sleep - see lib.rs's
  // watch_system_presence). Dormant is OFF, not slow: no rAF, no watchdog, no perception pushes,
  // and the Rust threads park too - one 30s reconcile is all that is left.
  type PowerTier = 'active' | 'idle' | 'stalled' | 'dormant';
  let tier: PowerTier = 'active';
  /** Frame interval per tier, ms. 0 = draw on every rAF callback. */
  const FRAME_INTERVAL: Record<PowerTier, number> = {
    active: 0,
    idle: 1000 / 30,
    // Not being composited, so smoothness is not a thing that exists right now - but the cat has
    // to keep living, or it is standing still in the middle of someone's screen.
    stalled: 100,
    dormant: Infinity,
  };
  /** A sleeping cat breathes slowly and barely moves; 20fps of that is indistinguishable from 30. */
  const SLEEPING_FRAME_INTERVAL = 1000 / 20;
  function frameInterval(): number {
    if (tier === 'idle' && lastEngineSnapshot?.state === 'sleep') return SLEEPING_FRAME_INTERVAL;
    return FRAME_INTERVAL[tier];
  }
  /**
   * No interaction and nothing happening for this long drops to `idle`. It was 45s when getting
   * back to full rate waited on the watchdog; now the first frame that moves does it (see step),
   * so all a short delay risks is a resting cat breathing at 30fps - which is the point.
   */
  const IDLE_AFTER_MS = 10_000;
  /** rAF quiet for this long means the compositor has stopped drawing us - NOT that we are hidden. */
  const STALLED_AFTER_MS = 1_000;
  let lastInterestingAt = performance.now();
  let lastRenderAt = 0;
  /**
   * Each reason the cat is suspended. Any one is enough; all must clear to resume.
   *
   * `page` starts false rather than at document.hidden, deliberately: only a visibilitychange is
   * taken as the page being hidden, as it always was. This overlay is exactly the kind of window
   * WebKit misjudges (see above), and a misjudgement at startup would freeze the cat for good.
   */
  const suspendedBy = { user: false, page: false, system: false };

  /** Anything that means the user is present, or the cat is mid-something worth seeing. */
  function markInteresting() {
    lastInterestingAt = performance.now();
    if (tier !== 'active' && tier !== 'dormant') setTier('active');
  }

  /**
   * Whether dropping the frame rate is free right now. Only while nothing is MOVING: a
   * stationary cat breathing at 30fps is indistinguishable from one at 60; a walking cat is not.
   */
  function catIsStill(): boolean {
    const snapshot = lastEngineSnapshot;
    if (snapshot == null || snapshot.toy != null) return false;
    // A sleeping cat is the stillest it ever gets - exactly the case the idle tier exists for. It
    // is checked before playingAction because a nap IS a playing clip: curled-sleep is restarted
    // whenever it ends (see step), so requiring no clip kept every nap at 60fps from start to end.
    if (snapshot.state === 'sleep') return true;
    // Not 'dragged': being carried around under the pointer is the opposite of still.
    return snapshot.state === 'idle' && !renderer.playingAction;
  }

  function setTier(next: PowerTier) {
    if (next === tier) return;
    const previous = tier;
    tier = next;
    dlog(`power: ${previous} -> ${next}`);
    // Rust slows its own polling to match. 'stalled' is reported as idle rather than dormant: we
    // still want cursor events at a usable rate, because the user is very likely looking at the cat.
    const reported = next === 'stalled' ? 'idle' : next;
    void invoke('set_power_tier', { tier: reported }).catch(() => {});
    if (next === 'active' || next === 'stalled') {
      // Re-anchor the clock so the first frame after a quiet spell is a normal frame rather than
      // a multi-second delta. The engine clamps it anyway, but the fx layer reads it too.
      lastFrameAt = null;
    }
    // A timer-gated frame may be pending for up to a slow frame's worth; at full rate the next
    // frame should be the next vsync.
    if (next === 'active' && frameTimer) {
      clearTimeout(frameTimer);
      frameTimer = null;
      scheduleFrame();
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
  //
  // It looks twice a second while frames are flowing - all it has to notice then is a 1s stall
  // or 45s of stillness - and ten times a second only while it is the one driving the cat.
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  function watchdog() {
    watchdogTimer = null;
    if (tier === 'dormant') return;
    const now = performance.now();
    if (now - lastRafAt >= STALLED_AFTER_MS) {
      // Cannot draw. Keep the simulation alive from this timer so the cat is not frozen on screen
      // and is in the right place the moment the compositor takes an interest again.
      if (tier !== 'stalled') setTier('stalled');
      step(performance.now());
    } else if (tier === 'active' && catIsStill() && now - lastInterestingAt > IDLE_AFTER_MS) {
      setTier('idle');
    }
    watchdogTimer = setTimeout(watchdog, tier === 'stalled' ? 100 : 500);
  }

  function suspend() {
    setTier('dormant');
    if (rafHandle) cancelAnimationFrame(rafHandle);
    rafHandle = 0;
    for (const timer of [frameTimer, watchdogTimer]) if (timer) clearTimeout(timer);
    frameTimer = watchdogTimer = null;
    if (perceptionTimer) clearInterval(perceptionTimer);
    perceptionTimer = null;
    // One last, accurate snapshot - the bridge serves it until the cat is back.
    pushPerception();
    scheduleReconcile();
  }

  function resume() {
    // Not markInteresting(): that refuses to leave 'dormant', which is the point of it elsewhere.
    lastInterestingAt = performance.now();
    setTier('active');
    lastRafAt = performance.now(); // a fresh grace period before the watchdog may call it a stall
    startTimers();
    scheduleFrame();
    // Anything changed while we were away (a tray click, a theme) is picked up now, not in 30s.
    scheduleReconcile(0);
  }

  function updateSuspension() {
    const suspended = suspendedBy.user || suspendedBy.page || suspendedBy.system;
    if (suspended && tier !== 'dormant') suspend();
    else if (!suspended && tier === 'dormant') resume();
  }

  function startTimers() {
    if (!watchdogTimer) watchdogTimer = setTimeout(watchdog, 500);
    if (!perceptionTimer) perceptionTimer = setInterval(pushPerception, PERCEPTION_INTERVAL_MS);
  }

  // The page being hidden is one way the platform says nobody can see it.
  document.addEventListener('visibilitychange', () => {
    suspendedBy.page = document.hidden;
    updateSuspension();
  });
  // The user hiding the cat from the tray is another. Event name taken from lib.rs's set_visible -
  // an invented one would have produced a listener that never fires and a saving that never
  // happens, with nothing to show it was broken.
  void listen<boolean>('companion-visibility', (event) => {
    suspendedBy.user = !event.payload;
    updateSuspension();
  });
  // And the OS saying nobody can see the SCREEN: display asleep, locked, screen saver, the machine
  // going to sleep, another user at the console. The cat is still "visible" by every measure the
  // page itself has, so without this it rendered on, at the watchdog's 10fps, all night.
  void listen<{ present: boolean }>('system-presence', (event) => {
    suspendedBy.system = !event.payload.present;
    updateSuspension();
  });

  dlog('starting frame loop');
  lastRafAt = performance.now();
  startTimers();
  scheduleReconcile();
  scheduleFrame();
  updateSuspension();
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
