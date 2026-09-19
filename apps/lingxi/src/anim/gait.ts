// Foot-planted gait.
//
// Replaces the placeholder that shipped before this: that one rotated every leg joint by
// `sin(phase)` and hoped it read as walking. It cannot, and the reason is not a tuning
// problem. A swinging leg whose paw is never actually stationary means the feet slide across
// the ground on every step, and sliding feet are precisely what "the cat looks like it is
// floating, not walking" describes ("感觉猫在飘一样，不是在走路"). No amount of adjusting the
// swing amplitude fixes it, because the error is that the feet have no relationship to the
// ground at all.
//
// What this does instead, which is the standard way quadruped locomotion is built:
//
//   STANCE  the paw is planted. It holds still in WORLD space, which means it travels
//           backwards through the body's own frame at exactly the speed the body is moving
//           forwards. That single property is what makes a walk look like a walk.
//   SWING   the paw lifts, arcs forward, and lands one stride ahead of where it lifted.
//
// The phase is driven by distance covered (see the renderer's odometer), not by a clock, so
// the two can never drift apart: walk twice as fast and the legs cycle twice as fast, stop and
// they stop, and no speed exists at which the feet skate.
//
// Everything is solved analytically in each leg's own sagittal (y/z) plane rather than with a
// generic IK solver: the chains are short, planar, and known, so a closed-form two-bone
// solution is both exact and cheap, and it cannot oscillate the way an iterative solver can.
import type { Rig } from '../rig/skeleton.ts';

/** Fraction of each leg's cycle spent on the ground. ~0.6 is a walk; 0.5 would be a trot. */
const DUTY = 0.62;

/**
 * Footfall offsets, as a fraction of the cycle. This is a lateral-sequence walk (LH, LF, RH,
 * RF) - the gait cats actually use at walking speed, and the one that keeps three feet on the
 * ground at any moment.
 */
const LEG_PHASE = { hindL: 0, foreL: 0.25, hindR: 0.5, foreR: 0.75 };

/**
 * How far the body sinks while walking, as a fraction of its standing height. This is not
 * decoration: the rig's legs are almost straight when standing (the front leg spans 6.06 of a
 * possible 6.10), so at standing height a paw can reach barely half a voxel fore or aft before
 * the leg runs out of length. Bending the knees is what buys the stride. Cats do lower
 * slightly into a walk for the same reason.
 */
const WALK_CROUCH = 0.16;

/** Fraction of the geometrically reachable fore/aft span actually used, leaving margin so the
 *  IK never hits its own limits (which is where a solver starts snapping). */
const REACH_USAGE = 0.8;

/** Peak lift of a swinging paw, as a fraction of standing height. */
const SWING_LIFT = 0.17;

interface Leg {
  /** Joints from the top of the chain down, all rotated about local x. */
  joints: string[];
  paw: string;
  lengths: number[];
  restAngles: number[];
  /** Rest position of the ground contact, in the chain-root's local y/z plane. */
  restContact: { y: number; z: number };
  /** Rest position of the joint two bones down - the elbow/hock the two-bone solve targets. */
  restMid: { y: number; z: number };
  /** Cumulative rest angle of the last bone, used to keep the paw flat. */
  restLastCumulative: number;
  restPawAngle: number;
  /** Which way this leg's middle joint folds. Measured from the rest pose, never assumed. */
  bendSign: 1 | -1;
  phase: number;
  standHeight: number;
}

export interface GaitPose {
  /** joint id -> absolute rotation.x to apply. */
  angles: Record<string, number>;
  /** Extra vertical offset applied to the shoulder blades, as before. */
  scapSlide: { L: number; R: number };
}

export interface Gait {
  /** Stride length in voxels: the ground distance one full leg cycle covers. The renderer
   *  divides real distance travelled by this to advance the phase. */
  readonly strideVoxels: number;
  /**
   * @param cycles gait phase in whole cycles (the distance odometer divided by strideVoxels)
   * @param walkAmount 0..1 blend between the authored standing pose and the walk
   */
  solve(cycles: number, walkAmount: number): GaitPose;
}

/** Planar forward kinematics for a chain hanging down -y: a bone at cumulative angle T points
 *  along (-cos T, -sin T) in (y, z). Positive angles swing a paw backwards (-z is the tail
 *  end; the rig faces +z). */
function forwardKinematics(lengths: number[], angles: number[]) {
  const points: { y: number; z: number; cumulative: number }[] = [];
  let cumulative = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    cumulative += angles[i];
    y -= lengths[i] * Math.cos(cumulative);
    z -= lengths[i] * Math.sin(cumulative);
    points.push({ y, z, cumulative });
  }
  return points;
}

/**
 * Closed-form two-bone IK in the plane. Returns the two local rotations that put the end of
 * the second bone at (ty, tz), measured from the first bone's pivot.
 *
 * `bendSign` picks which of the two mirror solutions to take - i.e. which way the knee folds.
 * It is measured off the rest pose per leg rather than hardcoded, because a cat's front elbow
 * and hind stifle fold in opposite directions and a wrong guess turns the leg inside out.
 */
function solveTwoBone(l1: number, l2: number, ty: number, tz: number, bendSign: number) {
  const reach = Math.hypot(ty, tz);
  const distance = Math.min(Math.max(reach, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  // Direction to the target, in the same "angle from straight down" convention as the chain.
  const toTarget = Math.atan2(-tz, -ty);
  const clamp = (v: number) => Math.min(1, Math.max(-1, v));
  const atRoot = Math.acos(clamp((l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance)));
  const atJoint = Math.acos(clamp((l1 * l1 + l2 * l2 - distance * distance) / (2 * l1 * l2)));
  return [toTarget - bendSign * atRoot, bendSign * (Math.PI - atJoint)];
}

export function createGait(rig: Rig): Gait {
  function describeLeg(joints: string[], paw: string, phase: number): Leg {
    const lengths = joints.map((id) => rig.segmentLength(id));
    const restAngles = joints.map((id) => rig.restRotation(id)[0]);
    const points = forwardKinematics(lengths, restAngles);
    const restContact = points[points.length - 1];
    const restMid = points[1];

    // Which way does this leg's middle joint actually fold? Solve the rest pose both ways and
    // keep whichever reproduces it.
    const candidates: (1 | -1)[] = [1, -1];
    let bendSign: 1 | -1 = 1;
    let bestError = Infinity;
    for (const sign of candidates) {
      const [a, b] = solveTwoBone(lengths[0], lengths[1], restMid.y, restMid.z, sign);
      const error = Math.abs(a - restAngles[0]) + Math.abs(b - restAngles[1]);
      if (error < bestError) {
        bestError = error;
        bendSign = sign;
      }
    }

    return {
      joints,
      paw,
      lengths,
      restAngles,
      restContact: { y: restContact.y, z: restContact.z },
      restMid: { y: restMid.y, z: restMid.z },
      restLastCumulative: restContact.cumulative,
      restPawAngle: rig.restRotation(paw)[0],
      bendSign,
      phase,
      standHeight: -restContact.y,
    };
  }

  const legs: Leg[] = [
    describeLeg(['upperFL', 'lowerFL'], 'pawFL', LEG_PHASE.foreL),
    describeLeg(['upperFR', 'lowerFR'], 'pawFR', LEG_PHASE.foreR),
    describeLeg(['thighL', 'shinL', 'footL'], 'pawBL', LEG_PHASE.hindL),
    describeLeg(['thighR', 'shinR', 'footR'], 'pawBR', LEG_PHASE.hindR),
  ];

  // The stride the geometry actually permits, set by whichever leg runs out of reach first -
  // in practice the front pair, whose bones are shorter. Derived rather than chosen, so a skin
  // with different proportions (a short-legged Munchkin, say) gets a stride that suits it
  // instead of one that makes it skate.
  let stanceSpan = Infinity;
  for (const leg of legs) {
    const crouched = leg.standHeight * (1 - WALK_CROUCH);
    const span = leg.joints.length === 2
      ? Math.sqrt(Math.max(0, (leg.lengths[0] + leg.lengths[1]) ** 2 - crouched ** 2))
      // Three-bone (hind) legs solve to the hock, which sits much closer than the paw, so their
      // limit is the two upper bones against that shorter distance.
      // The hock sits ABOVE the contact, so its depth below the hip is the standing height
      // MINUS that gap. restContact.y and restMid.y are both negative, and their difference is
      // negative, so this adds it rather than subtracting - getting that sign backwards made
      // the hind reach come out imaginary, clamp to zero, and take the whole stride with it.
      : Math.sqrt(Math.max(0, (leg.lengths[0] + leg.lengths[1]) ** 2 - (crouched + (leg.restContact.y - leg.restMid.y)) ** 2));
    stanceSpan = Math.min(stanceSpan, 2 * REACH_USAGE * span);
  }
  const strideVoxels = Math.max(1, stanceSpan / DUTY);

  const angles: Record<string, number> = {};

  return {
    strideVoxels,

    solve(cycles: number, walkAmount: number) {
      const amount = Math.min(1, Math.max(0, walkAmount));
      for (const leg of legs) {
        const drop = leg.standHeight * WALK_CROUCH;
        const t = ((cycles + leg.phase) % 1 + 1) % 1;

        let alongZ: number;
        let lift = 0;
        if (t < DUTY) {
          // STANCE. The paw slides backwards through the body frame by exactly the distance
          // the body advances, which is what holds it still against the ground.
          alongZ = stanceSpan * (0.5 - t / DUTY);
        } else {
          // SWING. Forward and over, landing one full stride ahead of where it lifted.
          const u = (t - DUTY) / (1 - DUTY);
          alongZ = stanceSpan * (-0.5 + u);
          lift = leg.standHeight * SWING_LIFT * Math.sin(Math.PI * u);
        }

        const contact = {
          y: leg.restContact.y + (drop + lift) * amount,
          z: leg.restContact.z + alongZ * amount,
        };

        let solved: number[];
        if (leg.joints.length === 2) {
          solved = solveTwoBone(leg.lengths[0], leg.lengths[1], contact.y, contact.z, leg.bendSign);
        } else {
          // Hind leg: solve the upper two bones to the hock, then let the metatarsus point at
          // the contact. Keeping the hock a fixed offset from the contact preserves the
          // characteristic angled hind foot instead of straightening it out.
          const midTarget = {
            y: contact.y + (leg.restMid.y - leg.restContact.y),
            z: contact.z + (leg.restMid.z - leg.restContact.z),
          };
          const [a, b] = solveTwoBone(leg.lengths[0], leg.lengths[1], midTarget.y, midTarget.z, leg.bendSign);
          // The third bone takes up whatever is left so its world-space angle is unchanged.
          solved = [a, b, leg.restLastCumulative - (a + b)];
        }

        let cumulative = 0;
        for (let i = 0; i < leg.joints.length; i += 1) {
          // Blend against the authored standing pose so starting and stopping eases rather
          // than snapping between two different postures.
          const value = leg.restAngles[i] + (solved[i] - leg.restAngles[i]) * amount;
          angles[leg.joints[i]] = value;
          cumulative += value;
        }
        // Keep the paw flat to the ground whatever the leg above it is doing.
        angles[leg.paw] = leg.restPawAngle + (leg.restLastCumulative - cumulative) * amount;
      }

      // The shoulder blade no longer slides on a separate sine of its own. It used to, and with
      // planted feet that is actively wrong: the blade is the top of the front leg's chain, so
      // moving it vertically moves the paw the IK just finished placing on the ground - it put
      // the sliding straight back in. Whatever the shoulder does now falls out of the leg
      // solution itself, which is where it should have come from.
      return { angles, scapSlide: { L: 0, R: 0 } };
    },
  };
}
