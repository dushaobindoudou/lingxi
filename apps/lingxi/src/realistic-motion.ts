/** A travelling clip's distance is in asset metres; screen motion and scale determine its clock. */
export function locomotionRate(distance: number, seconds: number, stride: number, scale: number, duration: number): number {
  if (seconds <= 0 || stride <= 0 || scale <= 0 || duration <= 0) return 0;
  return Math.max(0, distance) * duration / (seconds * stride * scale);
}

/**
 * The walk's playback rate, kept to a believable cadence. Ground speed alone set it, and the live cat walked at 0.07x
 * through every slow arrival (it read as stuck) and pattered at 3x while steering shortened its stride. A walking cat
 * changes stride length more than cadence: outside this band the planted paws (realistic-locomotion's anchors) take up
 * the difference. Zero stays zero - a stopped cat does not keep stepping.
 */
// (max 2.6: the kitten's quick short steps, realistic-locomotion KITTEN_WALK, play the clip ~1.8x at an ordinary pace)
export const WALK_CADENCE = { min: 0.5, max: 2.6 };
export function walkCadence(rate: number): number {
  return rate > 0 ? Math.min(WALK_CADENCE.max, Math.max(WALK_CADENCE.min, rate)) : 0;
}

/** When cadence reaches its comfortable limits, shorten or lengthen the actual foot sweep to match ground travel. */
export function matchedWalkStride(nominalStrideScale: number, requiredRate: number, cadence: number, maxStrideScale: number): number {
  if (cadence <= 0) return nominalStrideScale;
  return Math.min(maxStrideScale, Math.max(0.08, nominalStrideScale * requiredRate / cadence));
}

/**
 * Use the run's longer stride before the walk turns into frantic tiny steps. Hysteresis avoids toggling.
 * `runSpeed` (the run's natural ground speed): the run is only chosen once it can play at a believable rate - the
 * look-dev Run covers 9x the Walk, so switching at 1.9x the walk played a .22x slow-motion run on the desktop.
 */
export function locomotionClip(groundSpeed: number, walkSpeed: number, running: boolean, hasRun: boolean, runSpeed?: number): 'Walk' | 'Run' {
  const runFloor = runSpeed && runSpeed > 0 ? runSpeed * (running ? 0.5 : 0.65) : 0;
  return hasRun && groundSpeed > Math.max(walkSpeed * (running ? 1.55 : 1.9), runFloor) ? 'Run' : 'Walk';
}

/** Project a comfortable walk into logical screen pixels, including the current heading and camera. */
export function comfortableWalkPace(stride: number, duration: number, scale: number, pixelX: number, pixelZ: number, yaw: number): number | null {
  if (stride <= 0 || duration <= 0 || scale <= 0) return null;
  const pixelsPerMetre = Math.hypot(Math.sin(yaw) / Math.abs(pixelX), Math.cos(yaw) / Math.abs(pixelZ));
  // The life engine applies gentleness and arrival/turn easing afterwards. 1.3 produced
  // ~0.8x playback for the default personality: a small kitten crept at 3 px/s. 2.1 suited the
  // old .158 m shuffle; the round ZZZ4 walk (.274 m a cycle) at 2.1 hurried at ~2x - 1.4 plays it
  // at ~1.3x, an unhurried stroll.
  return stride * scale / duration * pixelsPerMetre * 1.4;
}

/**
 * The run's playback rate at a sprint. The look-dev Run is a slow gallop - one stride in 1.3 s - and a chase matched to
 * its own speed galloped in slow motion and crept across the desktop (~270 px/s at desktop size, five seconds a screen).
 * A kitten tearing after a toy takes about two strides a second.
 */
export const SPRINT_RATE = 2.4;
/** The run at SPRINT_RATE, in logical screen pixels a second. */
export function sprintPace(stride: number, duration: number, scale: number, pixelX: number, pixelZ: number, yaw: number): number | null {
  if (stride <= 0 || duration <= 0 || scale <= 0) return null;
  const pixelsPerMetre = Math.hypot(Math.sin(yaw) / Math.abs(pixelX), Math.cos(yaw) / Math.abs(pixelZ));
  return stride * scale / duration * pixelsPerMetre * SPRINT_RATE;
}

/** Match the left forepaw's contact phase when changing between walk and gallop. */
export function locomotionTransitionPhase(from: string, to: string, phase: number): number {
  const offset: Record<string, number> = { Walk: 0, Run: .47 };
  if (!(from in offset) || !(to in offset)) return 0;
  return ((phase + offset[from] - offset[to]) % 1 + 1) % 1;
}
