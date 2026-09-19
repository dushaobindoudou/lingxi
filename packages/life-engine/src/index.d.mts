export type BehaviorState = 'idle' | 'wander' | 'follow_cursor' | 'dragged' | 'ai_directed' | 'play_toy';
export type ToyKind = 'yarn' | 'feather' | 'laser';
export interface ToyState {
  kind: ToyKind;
  position: Vec2;
  velocity: Vec2;
  /** 0 normally; 0..1 while the user is holding the yarn ball and winding up a throw. */
  charge: number;
  /** True while the yarn ball is on the pointer rather than loose on the desktop. */
  held: boolean;
}
export type InteractionMode = 'auto' | 'play';
export interface Vec2 { x: number; y: number; }
export interface LifeEngineConfig {
  bounds?: { width: number; height: number };
  position?: Vec2;
  speed?: number;
  idleDurationMsRange?: [number, number];
  wanderRadius?: number;
  followRadius?: number;
  followReleaseRadius?: number;
  followSpeedMultiplier?: number;
  followStandoff?: number;
  avoidRadius?: number;
  followDeadband?: number;
  edgePatrolBias?: number;
  avoidRetargetCooldownMs?: number;
  /**
   * Source of randomness for every choice the engine makes, defaulting to Math.random. Inject a
   * seeded generator to replay behaviour exactly - which is what makes it possible to compare
   * two builds on the same decisions rather than on two different random walks.
   */
  random?: () => number;
  minRetargetDistance?: number;
  toyChaseSpeedMultiplier?: number;
  toyReach?: number;
  toyBatCooldownMs?: number;
  toyBatSpeed?: number;
  toyFriction?: number;
  toyRestSpeed?: number;
  toyBounceLoss?: number;
  toyFeatherLag?: number;
  dragStaleMs?: number;
  busyWindowMs?: number;
  cursorMoveEpsilon?: number;
  arriveThreshold?: number;
  margin?: number;
}
export interface LifeEngineSnapshot {
  state: BehaviorState;
  position: Vec2;
  facing: 1 | -1;
  /** The way the body points, radians. The character travels along this and nothing else. */
  heading: number;
  /** Radians/second the heading is sweeping through this tick; 0 when not steering. */
  turning: number;
  target: Vec2 | null;
  mode: InteractionMode;
  /**
   * The pointer's relationship with the character right now.
   *
   * `engaged` is contact. `byUser` is the interesting one: it says the USER closed the
   * distance - they reached over and touched the character - rather than the character having
   * wandered onto a pointer that was sitting still. The two look identical at the moment of
   * contact and mean opposite things, so affection should be gated on `byUser`, never on
   * `engaged` alone. It latches for the duration of one contact, so a hand that arrives and
   * then rests still counts as having arrived.
   */
  pointer: { engaged: boolean; byUser: boolean };
  /** What an outside driver is currently asking for, and when it lapses. Null if nothing is. */
  intent: { target: Vec2; until: number; speed: number } | null;
  /**
   * Timestamp of the last time the engine had to repair its own non-finite state, or null if it
   * never has. Serialising a broken position as `null` left callers unable to tell a broken cat
   * from a missing field; this says so outright.
   */
  recoveredAt: number | null;
  /** The toy currently on the desktop, if any - renderers that can draw one read this. */
  toy: ToyState | null;
  /** True for exactly the one tick the cat swats the toy; drives the swat animation. */
  batted: boolean;
}
export interface LifeEngine {
  readonly state: BehaviorState;
  readonly position: Vec2;
  readonly mode: InteractionMode;
  setBounds(bounds: { width: number; height: number }): void;
  beginDrag(cursor: Vec2): void;
  updateDrag(cursor: Vec2): void;
  endDrag(now: number): void;
  /** An external ("AI") driver suggests a place to walk to; expires on its own after holdMs. */
  /**
   * Ask the character to walk somewhere. Returns false, and changes nothing, if the point is
   * not a pair of finite numbers - a malformed target used to be clamped instead, and clamp is
   * Math.min/Math.max, which propagate NaN rather than rejecting it.
   */
  suggestMoveTo(targetPoint: Vec2, now: number, holdMs?: number, speedMultiplier?: number): boolean;
  /** Cancel any pending AI suggestion early. */
  clearIntent(): void;
  /**
   * Turn on the spot to face `angle` (radians, screen space; +y is down the screen, toward the
   * viewer). Turns at the body's own rate - never a snap - and is abandoned the moment anything
   * makes the character walk, since walking sets its own heading.
   */
  turnTo(angle: number): boolean;
  /** Stand still for `ms` without otherwise changing behaviour - used to stop the cat walking
   *  out from under an action clip that is mid-play. Weaker than a drag, a toy or an intent. */
  hold(ms: number, now: number): void;
  /** 'auto' (default, stays out of the way) or 'play' ("逗猫模式", follows the cursor). */
  setInteractionMode(mode: InteractionMode): void;
  /** Live-update the 'auto' mode avoidance radius (see LifeEngineConfig.avoidRadius) - the
   *  behavior preset picker in "性格行为" drives this without restarting the engine. */
  setAvoidRadius(radius: number): void;
  /**
   * Per-edge keep-out distances between the cat's ANCHOR POINT and each screen edge, in the same
   * logical pixels as `bounds`. Replaces the single `margin` for the cat itself (toys keep using
   * the plain one). The four numbers are expected to differ: the anchor is the cat's feet, so the
   * body extends far above it and barely below, and a host that wants an even-looking border has
   * to compensate. `bottom` may be negative, which lets the feet cross the bottom edge.
   * Any edge left out keeps its current value.
   */
  setMargins(margins: {
    top?: number; bottom?: number; left?: number; right?: number;
    /**
     * The tighter box the character confines its OWN wandering to, when nothing is driving it.
     * The top-level values stay the hard limit, reached only by drags, toys and performances.
     * Omit this and roaming is pinned to the hard limit, which is the old single-box behaviour.
     */
    roam?: { top?: number; bottom?: number; left?: number; right?: number };
  }): void;
  /** Hard recovery: recenter and drop whatever it was doing (drag included). */
  resetPosition(): void;
  /** Put a toy on the desktop (see TOY_KINDS). Outranks every autonomous drive, not a drag. */
  setToy(kind: ToyKind, at?: Vec2 | null): void;
  /** Take the toy away; autonomy resumes on the next tick. */
  clearToy(): void;
  /** Launch the yarn ball. No-op for the wand and the laser, which have no momentum. */
  throwToy(velocity: Vec2): void;
  /** Pick the yarn ball up to the cursor and start winding up a throw. */
  beginCharge(now: number): boolean;
  /** 0..1 wind-up progress. */
  chargeLevel(now: number): number;
  /** Let go, throwing along `aim` (or away from the cat if there is no aim). */
  releaseCharge(now: number, aim?: Vec2 | null): boolean;
  /** Reposition the current toy (a drag), zeroing its velocity. */
  moveToy(point: Vec2): void;
  readonly toy: ToyState | null;
  tick(now: number, cursor: Vec2 | null): LifeEngineSnapshot;
}
export function createLifeEngine(config?: LifeEngineConfig): LifeEngine;
export const BEHAVIOR_STATES: readonly BehaviorState[];
export const INTERACTION_MODES: readonly InteractionMode[];
export const TOY_KINDS: readonly ToyKind[];
