// Perception <-> AI Driver contract. Types only, zero runtime, zero dependencies -
// matches the project's existing packages/contracts and packages/desktop-host-contract
// convention. This is the "sensor" half of "让 AI 驱动这个宠物": what any external
// decision-maker (a rule engine, an LLM loop, a human debug panel) can read about what
// the user is doing, and the one narrow channel it can use to nudge the pet.
//
// Scope, stated honestly: everything here is observable WITHOUT macOS Accessibility
// permission (cursor position, and clicks/drags that land on the pet itself, since those
// only reach the app when the window is captured). Perceiving clicks/keystrokes that happen
// *elsewhere* on the desktop needs a real global event tap, which is a separate, still
// permission-gated capability this contract deliberately does not claim to provide yet -
// see docs/16-desktop-shell-prototype.md.

export interface Vec2 {
  x: number;
  y: number;
}

/** One observed thing the user did. Kept small and serializable - this crosses process
 *  boundaries (frontend -> Rust -> local HTTP -> whatever AI driver is listening). */
export type ActivityEvent =
  | { type: 'click_on_pet'; at: number; position: Vec2 }
  | { type: 'drag_start'; at: number; position: Vec2 }
  | { type: 'drag_end'; at: number; position: Vec2; durationMs: number }
  | { type: 'cursor_entered_pet'; at: number }
  | { type: 'cursor_left_pet'; at: number }
  | { type: 'scale_changed'; at: number; scale: number }
  | { type: 'visibility_changed'; at: number; visible: boolean };

/**
 * A rolling, privacy-conscious summary an AI driver can poll instead of replaying the raw
 * event log. Counts and durations only - no cursor trail, no keystrokes, nothing that
 * reconstructs what the user was doing elsewhere on their desktop.
 */
export interface ActivitySummary {
  /** Milliseconds since the user last did anything the pet could perceive. */
  idleMs: number;
  /** How long, cumulatively, the cursor has spent within the pet's follow radius. */
  cursorNearPetMs: number;
  /** Direct interactions in the current session. */
  clicksOnPet: number;
  dragCount: number;
  totalDragMs: number;
  /** Times the tray/management panel changed the pet's size, most recent last. */
  scaleChanges: number;
}

/**
 * A first cut at "growth" - see docs 04-life-engine.md for the product-level behavior
 * design this should eventually feed. Deliberately a flat, cheap-to-compute v0 score
 * (bounded 0-100) rather than a claim about a real pet-growth system; recompute the
 * formula freely as the product design solidifies, but keep the shape stable so an
 * external driver doesn't need to change its parsing every time the weights change.
 */
export interface GrowthMetrics {
  /** 0-100, monotonically non-decreasing within a session; a coarse "how attended-to" score. */
  engagementScore: number;
  /** Total interactions (clicks + drags) since the app was launched. */
  lifetimeInteractionCount: number;
}

/** 'auto' ("工作模式") = stays out of the way, resting at a corner of the work area on the
 *  far side of the cursor. 'play' ("逗猫模式") = unconditionally seeks out and hovers near
 *  the cursor, at any distance. See LifeEngine.setInteractionMode. */
export type InteractionMode = 'auto' | 'play';

export interface PerceptionSnapshot {
  observedAt: number;
  cursor: Vec2 | null;
  petPosition: Vec2;
  petState: string;
  mode: InteractionMode;
  /** The pet's own name, set on the management window's "首页" page. Descriptive only. */
  catName: string;
  /** Which AI agent the user has marked as "currently driving this pet" - 'none' by
   *  default. A label/preference, not an access-control check: the HTTP bridge itself
   *  (GET /perception, POST /intent) doesn't gate on this - see the "Agent 接入" page's
   *  copy and TrayState::apply_active_agent's doc comment in src-tauri/src/lib.rs. */
  activeAgent: string;
  activity: ActivitySummary;
  growth: GrowthMetrics;
  /**
   * The life system's slow variables - see `Vitals` in packages/life-engine.
   *
   * Optional because a host that does not run the life engine (a test harness, a reduced
   * renderer) still produces a valid snapshot; a reader should treat absent as "this host
   * does not model it", never as zero.
   */
  vitals?: Vitals | null;
  /** The traits the engine is actually applying, which is not necessarily what is persisted. */
  personality?: Personality | null;
}

/** Mirrors packages/life-engine's Vitals. Repeated rather than imported: this contract is
 *  deliberately dependency-free so a non-JS host can implement it from the file alone. */
export interface Vitals {
  energy: number;
  sleepiness: number;
  nightness: number;
  sleepThreshold: number;
  asleep: boolean;
  sleptAt: number | null;
  wokeAt: number | null;
}

export type Personality = Record<
  'independence' | 'curiosity' | 'gentleness' | 'playfulness' | 'sleepiness',
  number
>;

/**
 * What an external driver can ask for. Both fields are optional and independent: send
 * `targetPoint` alone for a one-off "walk over there for a bit" (a suggestion the life
 * engine may drop, e.g. the user is actively dragging the pet - see
 * `LifeEngine.suggestMoveTo`), send `mode` alone to switch between 'auto'/'play' (see
 * `LifeEngine.setInteractionMode`), or both at once. This is the single intent channel by
 * design - a richer future ask (a line of dialogue, a specific animation) extends this same
 * shape rather than becoming a second endpoint.
 */
export interface AIIntent {
  targetPoint?: Vec2;
  holdMs?: number;
  mode?: InteractionMode;
  /** Free-text reason, surfaced in debug tooling only - never parsed/trusted as a command. */
  reason?: string;
}

/** Implemented by the frontend (packages/perception's recorder); consumed by main.ts. */
export interface ActivityRecorder {
  record(event: ActivityEvent): void;
  summary(now: number): ActivitySummary;
  growth(): GrowthMetrics;
}
