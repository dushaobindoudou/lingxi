// Desktop Shell <-> Animation Director contract (docs/05-technical-architecture.md,
// docs/decisions/001-realtime-desktop.md). Types only, zero runtime, zero dependencies -
// implementations live per-host (e.g. apps/desktop-shell's Tauri-backed host) and are
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
   * see the Rust-side comment in apps/desktop-shell/src-tauri/src/lib.rs.
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
