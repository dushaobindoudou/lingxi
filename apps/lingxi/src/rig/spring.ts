// Critically-ish damped spring, the primitive the whole pose system is built on.
//
// Why springs instead of animation clips: a pose is a set of joint TARGETS, and every joint
// is always converging toward its current target. Transitions between any two poses are then
// free, always smooth, and interruptible at any instant - adding the Nth pose costs N lines
// of data instead of N-1 hand-authored transitions.

export interface SpringState {
  x: number;
  v: number;
}

export function createSpring(initial = 0): SpringState {
  return { x: initial, v: 0 };
}

/**
 * @param k stiffness - how hard it pulls toward the target
 * @param d damping - how fast the velocity bleeds off; too low overshoots, too high crawls
 * @param dt seconds; clamped by the caller, not here
 */
export function stepSpring(state: SpringState, target: number, k: number, d: number, dt: number): number {
  // Sub-stepped. This is explicit integration, which goes unstable once the step is large
  // relative to the stiffness - and "unstable" here does not mean slightly wrong, it means the
  // value diverges to infinity within a few frames and takes whatever it drives with it. The
  // caller capping dt is not enough protection on its own: the stiffest tuning in use (lid,
  // k=45) needs steps under ~0.05s, which is shorter than a single dropped frame.
  const MAX_STEP = 1 / 60;
  const steps = Math.min(8, Math.max(1, Math.ceil(dt / MAX_STEP)));
  const step = dt / steps;
  for (let i = 0; i < steps; i += 1) {
    state.v += (target - state.x) * k * step;
    state.v -= state.v * d * step;
    state.x += state.v * step;
  }
  return state.x;
}

/** Tuning from the spec's table. Heavier parts are stiff and settle; light parts overshoot. */
export const SPRING_TUNING = {
  spine: { k: 40, d: 13 },
  headAim: { k: 80, d: 16 },
  bodyAim: { k: 8.5, d: 5.6 },
  ear: { k: 55, d: 13 },
  tailRoot: { k: 26, d: 9 },
  tailTip: { k: 16, d: 7 },
  lid: { k: 45, d: 12 },
} as const;
