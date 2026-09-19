// Desktop Shell <-> Animation Director contract (docs/05-technical-architecture.md,
// docs/decisions/001-realtime-desktop.md). Types only, zero runtime, zero dependencies -
// implementations live per-host (e.g. apps/lingxi's Tauri-backed host) and are
// swapped in behind this interface so the renderer/life-engine never import a host SDK
// directly. A future Windows/Linux host, or a plain-browser host for local dev/preview,
// implements the same shape.

export interface WorkArea {
  /** Top-left of the usable desktop area, in OS screen pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
}

export interface CursorPoint {
  /** OS screen pixels, same coordinate space as WorkArea. */
  x: number;
  y: number;
}

/**
 * The desktop shell's job, and only its job: own the OS window and report a
 * normalized view of the environment. It does not know about behavior states,
 * 3D models, or animation - see docs/05's module boundary table.
 */
export interface DesktopHost {
  /** Resolve once the host has determined the monitor to render onto. */
  ready(): Promise<WorkArea>;

  /** Fires whenever the work area changes (resolution/scale change, monitor add/remove). */
  onWorkAreaChange(handler: (area: WorkArea) => void): () => void;

  /**
   * Fires with the OS-level cursor position, polled independently of DOM hit-testing.
   * Required because a click-through window stops receiving ordinary mouse events -
   * see the Rust-side comment in apps/lingxi/src-tauri/src/lib.rs.
   */
  onGlobalCursorMove(handler: (point: CursorPoint) => void): () => void;

  /**
   * Toggle whether the window accepts input. `false` while the pointer is over the
   * character's hit region, `true` (click-through) everywhere else. Callers should
   * only invoke this on state change, not every frame - it is an IPC call.
   */
  setClickThrough(ignore: boolean): Promise<void>;

  /** Start an OS-level window drag from the current pointer-down (for "pick up the cat"). */
  beginWindowDrag(): Promise<void>;

  /** Hide the companion window (e.g. fullscreen app / screen recording / user toggle). */
  hide(): Promise<void>;
  show(): Promise<void>;

  /** Quit the whole application (tray menu "Quit"). */
  quit(): Promise<void>;
}

/**
 * What a renderer is capable of. The life engine / animation director must check
 * this before requesting a behavior a given renderer/asset can't perform - see
 * docs/05: "行为层不能请求不存在的能力" (the behavior layer must not request
 * capabilities that do not exist).
 */
export interface RendererCapabilities {
  /** Can move its root position (walk/wander), vs. being a fixed-position sprite. */
  locomotion: boolean;
  /** Can rotate to face a direction independent of locomotion. */
  facing: boolean;
  /** Supports an idle/ambient loop distinct from locomotion. */
  idleAnimation: boolean;
  /** Reports true hit-testing (e.g. raycast against real geometry) vs. a bounding box. */
  preciseHitTest: boolean;
}

export interface Renderer {
  readonly capabilities: RendererCapabilities;
  /** Mount onto a canvas/container the host owns. */
  mount(container: HTMLElement): void;
  /** Resize the render surface to match the current work area (in CSS pixels). */
  resize(width: number, height: number): void;
  /** Scale the model's on-screen size (1 = default). Also scales the hit-test region. */
  setScale(scale: number): void;
  /**
   * Switch the visual theme ("主题"/皮肤) by id. Optional: a renderer with a single baked-in
   * look simply doesn't implement it, and callers must treat an unknown id as a no-op rather
   * than an error - a persisted theme id can outlive the asset it named.
   */
  setSkin?(id: string): void;
  /**
   * Replace the renderer's clip library, expression set and theme catalogue with user-supplied
   * ones. Returns a list of per-file problems; anything that failed validation is NOT applied,
   * so a bad file leaves the built-in version running rather than breaking the character.
   * Optional: a renderer with fixed, baked-in assets simply doesn't offer it.
   */
  applyCustomAssets?(payload: unknown): string[];
  /**
   * Styling for host-drawn UI (the speech bubble) that came out of the last applyCustomAssets.
   * Handed back rather than applied by the renderer: the overlay belongs to the host, and a
   * renderer reaching into the host's DOM would invert the dependency this contract exists for.
   */
  readonly customBubbleStyle?: Record<string, unknown> | null;
  /**
   * Switch the viewing angle ("视角") by preset id. Optional for the same reason as setSkin:
   * a 2D sprite renderer has no camera to aim. Implementations are expected to ease into the
   * new angle rather than cut, since the camera also defines where on screen a given logical
   * position lands.
   */
  setCameraPreset?(id: string): void;
  /**
   * Multiply the model's size by `multiplier` over `seconds`, on top of whatever setScale set.
   * Exists so a scripted performance can sell approach and retreat ("从远处跑过来越来越大")
   * without touching the user's own size preference. Renderers that cannot scale omit it.
   */
  setPerformanceZoom?(multiplier: number, seconds?: number): void;
  /**
   * Play a named action clip right now, ahead of whatever the renderer's own scheduler would
   * have chosen. Returns false for an unknown id. Optional: a renderer with no clip library
   * has nothing to play.
   */
  playAction?(id: string): boolean;
  /** Hold a named expression for `holdMs` (renderer's choice of default). False if unknown. */
  playExpression?(name: string, holdMs?: number): boolean;
  /**
   * The action clip currently playing, if any, and how long is left of it. A host uses this to
   * keep the character still for the clip's duration - an action and locomotion both want the
   * body, and a cat that walks out from under its own grooming animation reads as broken.
   */
  readonly playingAction?: { id: string; remainingMs: number; legFree: boolean } | null;
  /** Where the character's head currently is on screen, for anchoring overlays like a speech
   *  bubble. Same logical pixel space as resize/render. */
  headScreenPoint?(): { x: number; y: number };
  /**
   * How far the drawn character reaches from its anchor point, in logical screen pixels at the
   * current scale and camera. A host uses this to decide how close to each screen edge the
   * character may go - a single margin cannot be right for all four edges when the anchor is
   * not the centre of the body.
   */
  screenExtent?(): { above: number; below: number; halfWidth: number };
  /**
   * Machine-readable description of everything this renderer supports - clips, expressions,
   * themes, camera angles. Exists so a control surface (debug console, external agent) can be
   * built from what the renderer actually has, rather than from a hand-maintained list that
   * drifts. Shape is renderer-defined; callers treat it as opaque data to display or forward.
   */
  describeCapabilities?(): unknown;
  /**
   * Apply one frame of life-engine state. `position` is in the same logical (CSS-pixel)
   * space as `resize` was called with. `cursor` (same space, null if unknown/off-desktop)
   * lets a 3D renderer do something better than pure left/right facing - e.g. a subtle
   * head-turn toward the cursor - without the life engine needing to know it exists.
   */
  render(
    state: { state: string; position: { x: number; y: number }; facing: 1 | -1 },
    deltaSeconds: number,
    cursor: { x: number; y: number } | null,
  ): void;
  /** True if the given point (CSS pixels, same space as resize/render) hits the model. */
  hitTest(point: { x: number; y: number }): boolean;
  dispose(): void;
}
