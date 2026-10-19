/**
 * The air round the cat, as the coat feels it: how far each strand's tip is pushed, as a share of the strand's own
 * length (0.1 = a tip moved a tenth of the strand sideways), in world axes. Three sources:
 * - a soft indoor breeze that never quite stops, with now and then a gust that sweeps through the coat
 * - the cat's own movement: the coat trails behind a walk or a run and, when it stops, swings on past and settles
 *   (a damped spring on the body's velocity, so a start, a stop or a turn all show)
 * - the pointer stroking it: a hand run through the fur pushes the strands under it along with it, and they spring
 *   back after
 * Plain numbers, no three.js, so it can be tested on its own.
 */
export interface FurWindSample {
  /** steady bend, world axes */
  wind: [number, number, number];
  /** 0..1: how much of the bend travels through the coat as waves (a gust's front) rather than leaning it evenly */
  gust: number;
  /** stroke under the pointer: where (CSS px), which way on screen (unit vector, y down), how hard (bend share) */
  stroke: { x: number; y: number; dx: number; dy: number; amount: number };
}

export const FUR_WIND = {
  breeze: 0.05,
  gust: 0.28,
  // a gust every ~10 s on average, ~2 s long: the sum of three slow waves only now and then crosses this
  gustThreshold: 0.45,
  // the coat's lag behind the body: bend per (cat heights per second) of speed, a spring that overshoots a little
  drag: 0.08,
  maxDrag: 0.3,
  stiffness: 34,
  damping: 5.5,
  // a stroke: pointer speed (CSS px/s) for a full push, the push at full speed, and its own (springier) return
  strokeFullSpeed: 900,
  strokeMax: 0.9,
  strokeMinSpeed: 40,
  strokeStiffness: 55,
  strokeDamping: 6.5,
} as const;

interface Vec3 { x: number; y: number; z: number }

export function createFurWind(config = FUR_WIND) {
  let time = 0;
  const lag = { x: 0, y: 0, z: 0 };
  const lagVelocity = { x: 0, y: 0, z: 0 };
  const stroke = { x: 0, y: 0, dx: 1, dy: 0, amount: 0, velocity: 0 };
  let cursor: { x: number; y: number } | null = null;
  let cursorSpeed = 0;
  let cursorDir = { x: 1, y: 0 };

  function breeze(t: number): { dir: Vec3; strength: number; gust: number } {
    // slow waves at unrelated rates: smooth, never repeating within a session
    const n = (Math.sin(t * 0.83) + Math.sin(t * 0.47 + 1.3) + Math.sin(t * 0.21 + 4.1)) / 3;
    const gust = Math.max(0, n - config.gustThreshold) / (1 - config.gustThreshold);
    const gustShape = gust * gust * (3 - 2 * gust);
    const angle = 0.6 + 0.5 * Math.sin(t * 0.05) + 0.15 * Math.sin(t * 0.31);
    const strength = config.breeze * (0.75 + 0.25 * Math.sin(t * 0.9 + 0.4)) + config.gust * gustShape;
    return { dir: { x: Math.cos(angle), y: -0.12, z: Math.sin(angle) }, strength, gust: gustShape };
  }

  return {
    /**
     * @param dt seconds
     * @param bodyVelocity the cat's velocity in cat heights per second (world axes)
     * @param pointer the pointer (CSS px) and whether it is over the cat, or null
     */
    update(dt: number, bodyVelocity: Vec3, pointer: { x: number; y: number; over: boolean } | null): FurWindSample {
      const step = Math.min(Math.max(dt, 0), 0.05);
      time += step;
      // coat lag: a spring pulled toward trailing behind the motion
      for (const axis of ['x', 'y', 'z'] as const) {
        const target = -bodyVelocity[axis] * config.drag;
        const accel = (target - lag[axis]) * config.stiffness - lagVelocity[axis] * config.damping;
        lagVelocity[axis] += accel * step;
        lag[axis] += lagVelocity[axis] * step;
      }
      const lagSize = Math.hypot(lag.x, lag.y, lag.z);
      const lagScale = lagSize > config.maxDrag ? config.maxDrag / lagSize : 1;

      // the pointer: smoothed speed and direction
      if (pointer && cursor && step > 0) {
        const vx = (pointer.x - cursor.x) / step, vy = (pointer.y - cursor.y) / step;
        const speed = Math.hypot(vx, vy);
        cursorSpeed += (speed - cursorSpeed) * Math.min(1, step * 18);
        if (speed > 1) {
          const k = Math.min(1, step * 14);
          cursorDir = { x: cursorDir.x + (vx / speed - cursorDir.x) * k, y: cursorDir.y + (vy / speed - cursorDir.y) * k };
          const len = Math.hypot(cursorDir.x, cursorDir.y) || 1;
          cursorDir = { x: cursorDir.x / len, y: cursorDir.y / len };
        }
      } else cursorSpeed *= Math.exp(-step * 10);
      cursor = pointer ? { x: pointer.x, y: pointer.y } : null;
      const stroking = pointer?.over === true && cursorSpeed > config.strokeMinSpeed;
      const strokeTarget = stroking ? config.strokeMax * Math.min(1, cursorSpeed / config.strokeFullSpeed) : 0;
      if (stroking) {
        stroke.x = pointer!.x; stroke.y = pointer!.y;
        stroke.dx = cursorDir.x; stroke.dy = cursorDir.y;
      }
      const strokeAccel = (strokeTarget - stroke.amount) * config.strokeStiffness - stroke.velocity * config.strokeDamping;
      stroke.velocity += strokeAccel * step;
      stroke.amount += stroke.velocity * step;

      const air = breeze(time);
      return {
        wind: [
          air.dir.x * air.strength + lag.x * lagScale,
          air.dir.y * air.strength + lag.y * lagScale,
          air.dir.z * air.strength + lag.z * lagScale,
        ],
        gust: air.gust,
        stroke: { x: stroke.x, y: stroke.y, dx: stroke.dx, dy: stroke.dy, amount: stroke.amount },
      };
    },
  };
}
