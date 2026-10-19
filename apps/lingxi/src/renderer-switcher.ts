// "风格": the voxel cat (renderer.ts) or the realistic cat (realistic-renderer.ts), switchable at runtime.
//
// The host keeps ONE object for its whole life - main.ts, the performance runner and the life engine's toyInteraction
// all hold on to it - so the switch happens behind a facade that forwards every call to whichever implementation is
// active. A plain `let renderer` would not do: those callers captured the old object when they were set up.
//
// A switch prepares the new implementation while the old one keeps drawing, brings it to the host's current size,
// scale and camera, and only swaps once its first frame rendered. A failure leaves the old cat on screen and says why;
// a request overtaken by a newer one is disposed when it lands, never applied.
import type { Renderer, RendererCapabilities } from '../../../packages/desktop-host-contract/index.d.ts';

export type RenderStyle = 'voxel' | 'realistic';
type Factory = () => Renderer & { readonly ready?: Promise<void> };
type FrameState = Parameters<Renderer['render']>[0];

export interface RendererSwitcher extends Renderer {
  readonly activeStyle: RenderStyle;
  switchStyle(style: RenderStyle): Promise<{ applied: boolean; error?: string }>;
}

export function createRendererSwitcher(factories: Record<RenderStyle, Factory>, initial: RenderStyle = 'voxel'): RendererSwitcher {
  let active: Renderer = factories[initial]();
  let activeStyle: RenderStyle = initial;
  let generation = 0;
  let container: HTMLElement | null = null;
  let size: { w: number; h: number } | null = null;
  let scale: number | null = null;
  let skin: string | null = null;
  let camera: string | null = null;
  let lastFrame: { state: FrameState; cursor: { x: number; y: number } | null } | null = null;
  let pendingStyle: RenderStyle | null = null;

  // a rebuild of the active style is under way (see Renderer.needsRebuild)
  let rebuilding = false;
  async function switchStyle(style: RenderStyle, rebuild = false): Promise<{ applied: boolean; error?: string }> {
    if (!rebuild && style === activeStyle && pendingStyle == null) return { applied: true };
    if (style === pendingStyle) return { applied: false };
    const mine = ++generation;
    pendingStyle = style === activeStyle && !rebuild ? null : style;
    if (pendingStyle == null) return { applied: true }; // asked back for what is already showing
    let next: (Renderer & { readonly ready?: Promise<void> }) | null = null;
    try {
      next = factories[style]();
      await next.ready;
      if (mine !== generation) { next.dispose(); return { applied: false }; }
      if (container) next.mount(container);
      if (size) next.resize(size.w, size.h);
      if (scale != null) next.setScale(scale);
      if (camera != null) next.setCameraPreset?.(camera);
      if (skin != null) next.setSkin?.(skin);
      if (lastFrame) next.render(lastFrame.state, 0, lastFrame.cursor);
      const old = active;
      active = next;
      activeStyle = style;
      pendingStyle = null;
      old.dispose();
      return { applied: true };
    } catch (error) {
      next?.dispose();
      if (mine === generation) pendingStyle = null;
      return { applied: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  return {
    get activeStyle() { return activeStyle; },
    switchStyle,
    get capabilities(): RendererCapabilities { return active.capabilities; },
    toyInteraction: (request) => active.toyInteraction?.(request) ?? null,
    mount(target) { container = target; active.mount(target); },
    resize(w, h) { size = { w, h }; active.resize(w, h); },
    setScale(s) { scale = s; active.setScale(s); },
    setSkin(id) { skin = id; active.setSkin?.(id); },
    applyCustomAssets: (payload) => active.applyCustomAssets?.(payload) ?? [],
    get customBubbleStyle() { return active.customBubbleStyle ?? null; },
    setCameraPreset(id) { camera = id; active.setCameraPreset?.(id); },
    setPerformanceScale: (fraction, seconds) => active.setPerformanceScale?.(fraction, seconds),
    playAction: (id) => active.playAction?.(id) ?? false,
    playExpression: (name, holdMs) => active.playExpression?.(name, holdMs) ?? false,
    get playingAction() { return active.playingAction ?? null; },
    headScreenPoint: () => active.headScreenPoint?.() ?? { x: lastFrame?.state.position.x ?? 0, y: lastFrame?.state.position.y ?? 0 },
    screenExtent: () => active.screenExtent?.() ?? { above: 120, below: 20, halfWidth: 80 },
    get currentExpression() { return active.currentExpression ?? { name: '安然', held: false }; },
    get headYaw() { return active.headYaw ?? 0; },
    probeUnproject: (x, y) => active.probeUnproject?.(x, y) ?? false,
    locomotionPace: () => active.locomotionPace?.() ?? null,
    sprintPace: () => active.sprintPace?.() ?? null,
    describeCapabilities: () => ({ style: activeStyle, ...(active.describeCapabilities?.() as object ?? {}) }),
    render(state, dt, cursor) {
      lastFrame = { state, cursor };
      active.render(state, dt, cursor);
      // the GPU lost what it held (a restarted GPU process, a reset): the same style built afresh, swapped in when ready
      if (active.needsRebuild && !rebuilding) {
        rebuilding = true;
        void switchStyle(activeStyle, true).finally(() => { rebuilding = false; });
      }
    },
    hitTest: (point, precise) => active.hitTest(point, precise),
    dispose() { generation++; active.dispose(); },
  };
}
