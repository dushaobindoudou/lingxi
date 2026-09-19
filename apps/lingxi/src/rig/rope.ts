// Verlet rope - a chain of points that swings, whips and settles under its own momentum.
//
// This is what the wand's feather hangs off. A sine wave cannot produce the thing that makes a
// cat toy feel like a cat toy: the tip LAGS the hand, overshoots when you stop, and keeps
// swinging afterwards. That behaviour is momentum plus constraint, and it is about forty lines
// of Verlet integration, which is why games have used exactly this for ropes, tails and cloth
// strips for decades.
//
// WHY NOT A PHYSICS ENGINE (the question was asked, and it is a fair one):
//
// Three.js is a renderer - it has no physics of its own - so the options were Rapier (WASM,
// ~1MB, full rigid-body + joints), cannon-es (~200KB pure JS), or this.
//
// The two things in this app that want physics are the yarn ball and the wand tip, and they
// want different things. The ball's motion is GAMEPLAY: the cat chases it, the behaviour is
// unit-tested, and it has to be deterministic and live in the life engine where there is no
// renderer and no DOM. Handing that to a physics engine would mean the cat's AI depends on a
// WASM blob and stops being testable in Node. The wand tip is the opposite - pure visual, no
// gameplay consequence - and a rope solver does it in a page of code.
//
// So neither side of the problem is served by a general 3D physics engine, and both are served
// well by keeping the ball analytic and the rope Verlet. A desktop pet also has to start
// instantly and idle at near-zero CPU, which is not what you get from spinning up a physics
// world for two objects. If the toy box ever grows to things that collide with each other,
// that calculus changes and Rapier is the one to reach for.
import * as THREE from 'three';

export interface RopeOptions {
  /** Number of points, including the fixed anchor. More = smoother, floppier. */
  points: number;
  /** Rest distance between neighbouring points, in the rope's own units. */
  segmentLength: number;
  /** Downward acceleration. Higher = the tip falls back to hanging faster. */
  gravity?: number;
  /** Velocity retained per second. Lower = settles sooner; high = whips for longer. */
  damping?: number;
  /** Constraint passes per step. More = stiffer and less stretchy. */
  iterations?: number;
}

export interface Rope {
  /** Point 0 is the anchor; the caller moves it and the rest follows. */
  readonly points: THREE.Vector3[];
  /** Advance the simulation. `anchor` is where point 0 is now. */
  update(anchor: THREE.Vector3, deltaSeconds: number): void;
  /** Drop the whole rope at `anchor`, at rest - used when the toy is first mounted. */
  reset(anchor: THREE.Vector3): void;
  /**
   * Kick the free end. Verlet stores velocity as (current - previous), so an impulse is applied
   * by displacing the previous position - which is how the cat batting the feather makes it
   * actually fly, instead of the toy politely ignoring being hit.
   */
  impulse(velocity: THREE.Vector3, fromIndex?: number): void;
}

export function createRope(options: RopeOptions): Rope {
  const count = Math.max(2, options.points);
  const segment = options.segmentLength;
  const gravity = options.gravity ?? 9;
  const damping = options.damping ?? 0.55;
  const iterations = options.iterations ?? 6;

  const points: THREE.Vector3[] = [];
  const previous: THREE.Vector3[] = [];
  for (let i = 0; i < count; i += 1) {
    points.push(new THREE.Vector3(0, -segment * i, 0));
    previous.push(new THREE.Vector3(0, -segment * i, 0));
  }

  const temp = new THREE.Vector3();
  const delta = new THREE.Vector3();

  return {
    points,

    reset(anchor) {
      for (let i = 0; i < count; i += 1) {
        points[i].set(anchor.x, anchor.y - segment * i, anchor.z);
        previous[i].copy(points[i]);
      }
    },

    impulse(velocity, fromIndex = 1) {
      for (let i = Math.max(1, fromIndex); i < count; i += 1) {
        // Stronger toward the tip: a hit near the middle of a string still whips the end.
        const share = (i - fromIndex + 1) / Math.max(1, count - fromIndex);
        previous[i].addScaledVector(velocity, -share);
      }
    },

    update(anchor, deltaSeconds) {
      // Clamped: a long frame (a stall, a tab coming back) would otherwise fling the rope
      // across the scene, because Verlet reads velocity out of the last position delta.
      const dt = Math.min(1 / 30, Math.max(1 / 240, deltaSeconds));
      const decay = Math.pow(damping, dt);

      points[0].copy(anchor);
      previous[0].copy(anchor);

      for (let i = 1; i < count; i += 1) {
        temp.copy(points[i]);
        // Verlet: the implied velocity is (current - previous), so momentum is free.
        delta.subVectors(points[i], previous[i]).multiplyScalar(decay);
        points[i].add(delta);
        points[i].y -= gravity * dt * dt;
        previous[i].copy(temp);
      }

      // Satisfy the distance constraints. Point 0 never moves - it is the hand.
      for (let pass = 0; pass < iterations; pass += 1) {
        for (let i = 0; i < count - 1; i += 1) {
          const a = points[i];
          const b = points[i + 1];
          delta.subVectors(b, a);
          const distance = delta.length();
          if (distance < 1e-6) continue;
          const correction = (distance - segment) / distance;
          if (i === 0) {
            b.addScaledVector(delta, -correction);
          } else {
            a.addScaledVector(delta, correction * 0.5);
            b.addScaledVector(delta, -correction * 0.5);
          }
        }
      }
    },
  };
}
