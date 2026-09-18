// Quiet baseline animation. Standing has no perpetual pelvis sway; occasional tail
// movement and slow breathing are independent from explicit action clips.
import * as THREE from 'three';
import type { Rig } from '../rig/skeleton.ts';
import { createSpring, stepSpring, SPRING_TUNING, type SpringState } from '../rig/spring.ts';
import { createGait, type Gait } from './gait.ts';

const BREATH_HZ = 0.38;
const TAIL_HZ = 0.28;

const TAIL_SEGMENTS = ['tail0', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6'] as const;

interface EarTwitch {
  side: 'L' | 'R';
  until: number;
  next: number;
}

export interface IdleAnimator {
  /**
   * @param cycles gait phase in whole cycles - the distance odometer divided by the stride.
   *   NOT a clock: see gait.ts. Feeding a time-based value here reintroduces foot sliding.
   */
  update(rig: Rig, elapsed: number, dt: number, cycles: number, walkAmount: number): void;
  /** Stride length in voxels, so the caller can convert distance travelled into cycles. */
  readonly strideVoxels: number;
}

export function createIdleAnimator(rig: Rig): IdleAnimator {
  const tailSprings: SpringState[] = TAIL_SEGMENTS.map(() => createSpring(0));
  const lid = createSpring(1);
  const gait: Gait = createGait(rig);

  let scapBaseY: { L: number; R: number } | null = null;
  let blinkUntil = 0;
  let nextBlink = 1.6 + Math.random() * 4.4;
  const ear: EarTwitch = { side: 'L', until: 0, next: 2.5 + Math.random() * 5 };

  return {
    strideVoxels: gait.strideVoxels,

    update(rig, elapsed, dt, cycles, walkAmount) {
      // --- breathing: joint rotation only, never torso scale (principle one) ---
      const breath = Math.sin(elapsed * BREATH_HZ * Math.PI * 2);
      // Rest-relative, like the tail and legs below: a bare assignment here would silently
      // discard whatever curve skeleton.json's restPose authored into the spine and neck.
      rig.node('spine2').rotation.x = rig.restRotation('spine2')[0] + breath * 0.002;
      rig.node('spine1').rotation.x = rig.restRotation('spine1')[0] + breath * 0.003;
      // Neck counter-rotates so the head doesn't nod along with the ribcage.
      rig.node('neck2').rotation.x = rig.restRotation('neck2')[0] - breath * 0.004;

      // --- tail: per-segment delay. Segment n chases segment n-1's CURRENT value, with
      // stiffness falling off down the chain, so one driver produces a travelling wave. ---
      const quietPhase = elapsed % 12;
      const tailEnvelope = quietPhase < 3 ? Math.sin(quietPhase / 3 * Math.PI) ** 2 : 0;
      // Amplitudes are divided by the segment count because these rotations COMPOUND: every
      // segment is a child of the one before it, and in steady state they all settle near the
      // same driven value, so the tip's angle is roughly the sum of all seven. The original
      // per-segment 0.08/0.10 therefore produced ~0.7rad (40 degrees) of sweep at the tip. The
      // tail stands straight up, so that sweep sits at the very top of the silhouette and reads
      // as the whole cat swaying side to side ("还会有左右摇晃的感觉") even though the body and
      // head are provably motionless. These constants are the intended TIP amplitude.
      const TAIL_TIP_SWAY_IDLE = 0.13;
      const TAIL_TIP_SWAY_WALK = 0.26;
      const perSegment = (TAIL_TIP_SWAY_IDLE * tailEnvelope + walkAmount * TAIL_TIP_SWAY_WALK) / TAIL_SEGMENTS.length;
      const tailDrive = Math.sin(elapsed * TAIL_HZ * Math.PI * 2) * perSegment;
      for (let i = 0; i < TAIL_SEGMENTS.length; i += 1) {
        const t = i / (TAIL_SEGMENTS.length - 1);
        const k = THREE.MathUtils.lerp(SPRING_TUNING.tailRoot.k, SPRING_TUNING.tailTip.k, t);
        const d = THREE.MathUtils.lerp(SPRING_TUNING.tailRoot.d, SPRING_TUNING.tailTip.d, t);
        const target = i === 0 ? tailDrive : tailSprings[i - 1].x;
        const value = stepSpring(tailSprings[i], target, k, d, dt);
        const node = rig.node(TAIL_SEGMENTS[i]);
        node.rotation.y = value;
        // Sway rides on top of the authored arc rather than replacing it - the curve lives
        // in skeleton.json's restPose, not as literals here.
        node.rotation.x = rig.restRotation(TAIL_SEGMENTS[i])[0] + value * 0.2;
      }

      // --- blink: random interval, short duration. Eye boxes squash in Y; that is the voxel
      // convention and is explicitly allowed - principle one scopes the no-scaling rule to
      // root and torso nodes, not the face. ---
      if (elapsed >= nextBlink && elapsed >= blinkUntil) {
        blinkUntil = elapsed + 0.10 + Math.random() * 0.03;
        nextBlink = elapsed + 1.6 + Math.random() * 4.4;
      }
      const lidTarget = elapsed < blinkUntil ? 0.06 : 1;
      const lidValue = stepSpring(lid, lidTarget, SPRING_TUNING.lid.k, SPRING_TUNING.lid.d, dt);
      for (const id of ['eyeL', 'eyeR']) {
        rig.node(id).scale.y = Math.max(0.05, lidValue);
      }

      // --- ear twitch: one ear, briefly, on a random schedule ---
      if (elapsed >= ear.next) {
        ear.side = Math.random() < 0.5 ? 'L' : 'R';
        ear.until = elapsed + 0.16;
        ear.next = elapsed + 2.5 + Math.random() * 5;
      }
      const twitching = elapsed < ear.until;
      rig.node('earL').rotation.z = ear.side === 'L' && twitching ? -0.28 : 0;
      rig.node('earR').rotation.z = ear.side === 'R' && twitching ? 0.28 : 0;

      // Grounded standing: weight shifts belong to named, occasional actions.
      rig.node('hipC').rotation.z = rig.restRotation('hipC')[2];

      // --- legs: real foot-planted gait (see gait.ts) --------------------------------------
      // The placeholder that used to live here rotated each joint by sin(phase) and never put a
      // paw on the ground; that is what made the cat look like it was floating. gait.ts solves
      // each leg so its paw holds still against the ground through stance.
      const pose = gait.solve(cycles, walkAmount);
      for (const [id, angle] of Object.entries(pose.angles)) rig.node(id).rotation.x = angle;

      // Scapula slide: the shoulder blade rides up out of the back line as the chest drops.
      // Driven, not authored - see the spec's 肩胛滑动 note.
      if (scapBaseY == null) {
        scapBaseY = { L: rig.node('scapL').position.y, R: rig.node('scapR').position.y };
      }
      rig.node('scapL').position.y = scapBaseY.L + pose.scapSlide.L;
      rig.node('scapR').position.y = scapBaseY.R + pose.scapSlide.R;
    },
  };
}
