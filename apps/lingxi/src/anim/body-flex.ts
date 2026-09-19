// Spine flex through a turn.
//
// A cat is not a rigid plank on a turntable. When it changes direction the motion travels down
// the body as a wave: the head goes first (animals look where they are going before they get
// there), the shoulders follow, the ribcage bends, the hips come round last, and the tail
// swings out the other way as a counterweight. Yawing one rigid root by the heading angle -
// which is what this used to do - throws all of that away, and the result reads exactly as
// reported: stiff ("现在僵硬的身体非常不好，要灵活一点").
//
// So the root yaw is treated as the HIPS, and this module lays a curve along the spine on top
// of it. The nose ends up pointing further into the turn than the hips do, which is the whole
// visual difference between an animal turning and a model being rotated.
//
// Three classical animation principles, all of which fall out of the same curve:
//   - LEAD AND FOLLOW: the head leads, the hips trail.
//   - OVERLAPPING ACTION: each segment lags the one in front, so the bend arrives as a wave.
//   - COUNTERBALANCE: the tail swings outward, opposing the turn, like a real one does.
import type { Rig } from '../rig/skeleton.ts';

/**
 * How much of the total bend each joint contributes, hips-first. They sum to 1, so the nose
 * ends up leading the hips by the full bend angle. Weighted toward the neck because that is
 * where a cat is actually most mobile - a cat's lumbar spine bends far less than its neck.
 */
const BEND_SHARE: [string, number][] = [
  ['spine3', 0.08],
  ['spine2', 0.15],
  ['spine1', 0.20],
  ['neck2', 0.22],
  ['neck1', 0.20],
  ['head', 0.15],
];

/** The tail opposes the turn. Fractions of the total bend, root of the tail first. */
const TAIL_COUNTER: [string, number][] = [
  ['tail0', -0.30],
  ['tail1', -0.26],
  ['tail2', -0.20],
  ['tail3', -0.14],
];

/** Roll into the turn, as a fraction of the bend. Small: a cat banks, it does not lie over. */
const LEAN_SHARE: [string, number][] = [
  ['spine3', 0.10],
  ['spine2', 0.14],
  ['spine1', 0.10],
];

/** Radians of body curve per radian/second of turning. */
const BEND_PER_TURN_RATE = 0.20;
/** Hard cap on the curve, so a violent direction change can't fold the cat in half. */
const MAX_BEND = 0.5;
/** Time constant for easing the curve in and out, seconds. */
const BEND_EASE = 0.16;

export interface BodyFlex {
  /**
   * @param turnRate radians/second the body's facing is currently sweeping through. Sign is
   *   the same as rotation.y, so positive means turning toward the cat's left.
   * @param engagement 0..1 - how much the cat is actually moving. A stationary cat whose
   *   facing is being nudged should not throw its whole spine into it.
   */
  update(
    rig: Rig,
    turnRate: number,
    engagement: number,
    deltaSeconds: number,
    /**
     * Extra steady twist toward the viewer, laid along the same chain. Separate from the turn
     * bend because it is not a turn: it is the cat keeping its face on you while its body goes
     * somewhere else, and it must NEVER be applied to the root - the legs stride along the
     * root's forward axis, so rotating that away from the travel direction makes the feet skate.
     */
    presentation?: number,
  ): void;
  /** Current curve, radians, for anything that wants to react to it (e.g. the gait). */
  readonly bend: number;
}

/** Where the look-back twist is spent. Far more neck than spine, unlike a turn. */
const PRESENT_SHARE: [string, number][] = [
  ['spine2', 0.06],
  ['spine1', 0.12],
  ['neck2', 0.26],
  ['neck1', 0.30],
  ['head', 0.26],
];

export function createBodyFlex(): BodyFlex {
  let bend = 0;
  let twist = 0;

  return {
    get bend() {
      return bend;
    },

    update(rig, turnRate, engagement, deltaSeconds, presentation = 0) {
      const wanted = Math.max(
        -MAX_BEND,
        Math.min(MAX_BEND, turnRate * BEND_PER_TURN_RATE * Math.max(0, Math.min(1, engagement))),
      );
      // Eased rather than applied directly: turnRate is a per-frame quantity, and feeding it
      // straight into the pose would put frame-rate noise into the spine.
      bend += (wanted - bend) * (1 - Math.exp(-deltaSeconds / BEND_EASE));
      twist += (presentation - twist) * (1 - Math.exp(-deltaSeconds / BEND_EASE));
      if (Math.abs(bend) < 1e-4 && Math.abs(twist) < 1e-4) {
        bend = 0;
        twist = 0;
        return;
      }

      // The turn bend and the look-back twist ride the same chain, but the twist is weighted
      // toward the neck: a cat glancing behind itself moves its head and shoulders, not its hips.
      for (const [id, share] of BEND_SHARE) rig.node(id).rotation.y += bend * share;
      for (const [id, share] of PRESENT_SHARE) rig.node(id).rotation.y += twist * share;
      for (const [id, share] of TAIL_COUNTER) rig.node(id).rotation.y += bend * share;
      // Negative, because positive rotation.y turns the nose toward the cat's left while
      // positive rotation.z tips its top toward its right - banking into the turn needs them
      // to oppose.
      for (const [id, share] of LEAN_SHARE) rig.node(id).rotation.z -= bend * share;
    },
  };
}
