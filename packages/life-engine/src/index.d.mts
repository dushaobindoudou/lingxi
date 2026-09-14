export type BehaviorState = 'idle' | 'wander' | 'follow_cursor' | 'dragged' | 'ai_directed';
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
  busyWindowMs?: number;
  cursorMoveEpsilon?: number;
  arriveThreshold?: number;
  margin?: number;
}
export interface LifeEngineSnapshot {
  state: BehaviorState;
  position: Vec2;
  facing: 1 | -1;
  target: Vec2 | null;
  mode: InteractionMode;
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
  suggestMoveTo(targetPoint: Vec2, now: number, holdMs?: number): void;
  /** Cancel any pending AI suggestion early. */
  clearIntent(): void;
  /** 'auto' (default, stays out of the way) or 'play' ("逗猫模式", follows the cursor). */
  setInteractionMode(mode: InteractionMode): void;
  /** Live-update the 'auto' mode avoidance radius (see LifeEngineConfig.avoidRadius) - the
   *  behavior preset picker in "性格行为" drives this without restarting the engine. */
  setAvoidRadius(radius: number): void;
  /** Hard recovery: recenter and drop whatever it was doing (drag included). */
  resetPosition(): void;
  tick(now: number, cursor: Vec2 | null): LifeEngineSnapshot;
}
export function createLifeEngine(config?: LifeEngineConfig): LifeEngine;
export const BEHAVIOR_STATES: readonly BehaviorState[];
export const INTERACTION_MODES: readonly InteractionMode[];
