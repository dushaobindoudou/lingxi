/** Model-space whisker tip motion. The GLB already curves and tapers each whisker; this only bends its free end. */
export const WHISKER = {
  // The exported 1.36 mm root a little finer: at .36 (0.49 mm) the whiskers drew under a pixel wide and vanished, even
  // against a dark background, where a kitten's whiskers are its clearest white lines
  width: 0.6,
  opacity: 0.95,
  fadeFrom: 0.75, // the last quarter of a whisker fades to nothing: it ended bright and blunt
  hz: 3.1,
  damping: 0.56,
  maxBend: 0.025, // a little over a tenth of the ~0.22 m whisker length
  yawDrag: 0.0035, // metres of opposite tip travel per radian/second of head yaw
  breeze: 0.012,
  stroke: 0.018,
  forward: 0.009,
  back: -0.011,
} as const;

export type WhiskerVec = [number, number, number];
export interface WhiskerSpring { position: WhiskerVec; velocity: WhiskerVec }

export function whiskerMood(expression: string): number {
  if (['好奇', '警觉', '警惕', '期待', '玩心', '认真'].includes(expression)) return WHISKER.forward;
  if (['惊吓', '生气', '委屈', '不爽', '嫌弃'].includes(expression)) return WHISKER.back * 1.3;
  if (['放松', '闭眼休息', '困困', '安心', '陶醉', '满足'].includes(expression)) return WHISKER.back;
  return 0;
}

/** A bounded damped spring; long frame stalls reset so the free ends never fling across the face. */
export function stepWhiskerSpring(spring: WhiskerSpring, target: WhiskerVec, seconds: number): WhiskerSpring {
  if (seconds > 0.25) return { position: target.map(clampBend) as WhiskerVec, velocity: [0, 0, 0] };
  const steps = Math.max(1, Math.ceil(Math.max(0, seconds) * 120));
  const dt = Math.max(0, seconds) / steps;
  const w = Math.PI * 2 * WHISKER.hz;
  const position = [...spring.position] as WhiskerVec;
  const velocity = [...spring.velocity] as WhiskerVec;
  for (let n = 0; n < steps; n++) for (let axis = 0; axis < 3; axis++) {
    velocity[axis] += ((target[axis] - position[axis]) * w * w - 2 * WHISKER.damping * w * velocity[axis]) * dt;
    position[axis] += velocity[axis] * dt;
    if (Math.abs(position[axis]) > WHISKER.maxBend) {
      position[axis] = clampBend(position[axis]);
      velocity[axis] = 0;
    }
  }
  return { position, velocity };
}

function clampBend(value: number) { return Math.max(-WHISKER.maxBend, Math.min(WHISKER.maxBend, value)); }
