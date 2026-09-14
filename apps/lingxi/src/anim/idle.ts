// Layer 1 of the three-layer animation model: the procedural base that NEVER stops running -
// breathing, blinking, tail sway, ear twitches. Pose and reaction layers add on top of it
// rather than replacing it, which is why "dragged while asleep" needs no special case.
//
// Two rules from the spec are load-bearing here and easy to lose in a later refactor:
//   1. The base sines must stay mutually non-harmonic (1.55 / 2.3 / 3.7 Hz). The moment two
//      of them line up, the cat reads as a machine.
//   2. Blink intervals must be random. A fixed blink period is one of the clearest tells of
//      a fake creature.
import * as THREE from 'three';
import type { Rig } from '../rig/skeleton.ts';
import { createSpring, stepSpring, SPRING_TUNING, type SpringState } from '../rig/spring.ts';

const BREATH_HZ = 1.55;
const TAIL_HZ = 2.3;
const SHIFT_HZ = 3.7;

const TAIL_SEGMENTS = ['tail0', 'tail1', 'tail2', 'tail3', 'tail4', 'tail5', 'tail6'] as const;

/** Walk gait phase offsets: hind-left, fore-left, hind-right, fore-right (spec §3.4). */
const LEG_PHASE = { hindL: 0, foreL: 0.25, hindR: 0.5, foreR: 0.75 };

interface EarTwitch {
  side: 'L' | 'R';
  until: number;
  next: number;
}

export interface IdleAnimator {
  update(rig: Rig, elapsed: number, dt: number, gaitPhase: number, walkAmount: number): void;
}

export function createIdleAnimator(): IdleAnimator {
  const tailSprings: SpringState[] = TAIL_SEGMENTS.map(() => createSpring(0));
  const lid = createSpring(1);

  let scapBaseY: { L: number; R: number } | null = null;
  let blinkUntil = 0;
  let nextBlink = 1.6 + Math.random() * 4.4;
  const ear: EarTwitch = { side: 'L', until: 0, next: 2.5 + Math.random() * 5 };

  return {
    update(rig, elapsed, dt, gaitPhase, walkAmount) {
      // --- breathing: joint rotation only, never torso scale (principle one) ---
      const breath = Math.sin(elapsed * BREATH_HZ * Math.PI * 2);
      rig.node('spine2').rotation.x = breath * 0.012;
      rig.node('spine1').rotation.x = breath * 0.016;
      // Neck counter-rotates so the head doesn't nod along with the ribcage.
      rig.node('neck2').rotation.x = -breath * 0.02;

      // --- tail: per-segment delay. Segment n chases segment n-1's CURRENT value, with
      // stiffness falling off down the chain, so one driver produces a travelling wave. ---
      const tailDrive = Math.sin(elapsed * TAIL_HZ * Math.PI * 2) * (0.06 + walkAmount * 0.1);
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

      // --- weight shift while standing: a barely-visible sway that keeps a standing cat
      // from looking frozen. Third non-harmonic frequency. ---
      const shift = Math.sin(elapsed * SHIFT_HZ * Math.PI * 2) * 0.006 * (1 - walkAmount);
      rig.node('hipC').rotation.z = shift;

      // --- legs: placeholder swing, NOT yet foot-planted. Phase 2 replaces this wholesale
      // with world-space planted feet + two-bone IK; until then this exists only so the
      // walk doesn't regress relative to the old placeholder model. ---
      const swing = (phaseOffset: number) => Math.sin((gaitPhase + phaseOffset * Math.PI * 2)) * walkAmount;

      const hindL = swing(LEG_PHASE.hindL);
      const hindR = swing(LEG_PHASE.hindR);
      const foreL = swing(LEG_PHASE.foreL);
      const foreR = swing(LEG_PHASE.foreR);

      const swingJoint = (id: string, amount: number) => {
        rig.node(id).rotation.x = rig.restRotation(id)[0] + amount;
      };
      swingJoint('thighL', hindL * 0.32);
      swingJoint('shinL', -hindL * 0.22);
      swingJoint('footL', hindL * 0.18);
      swingJoint('thighR', hindR * 0.32);
      swingJoint('shinR', -hindR * 0.22);
      swingJoint('footR', hindR * 0.18);

      swingJoint('upperFL', foreL * 0.34);
      swingJoint('lowerFL', -foreL * 0.2);
      swingJoint('upperFR', foreR * 0.34);
      swingJoint('lowerFR', -foreR * 0.2);

      // Scapula slide: the shoulder blade rides up out of the back line as the chest drops.
      // Driven, not authored - see the spec's 肩胛滑动 note.
      if (scapBaseY == null) {
        scapBaseY = { L: rig.node('scapL').position.y, R: rig.node('scapR').position.y };
      }
      rig.node('scapL').position.y = scapBaseY.L + Math.abs(foreL) * 0.35;
      rig.node('scapR').position.y = scapBaseY.R + Math.abs(foreR) * 0.35;
    },
  };
}
