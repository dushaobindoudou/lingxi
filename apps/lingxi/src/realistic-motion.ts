/** A travelling clip's distance is in asset metres; screen motion and scale determine its clock. */
export function locomotionRate(distance: number, seconds: number, stride: number, scale: number, duration: number): number {
  if (seconds <= 0 || stride <= 0 || scale <= 0 || duration <= 0) return 0;
  return Math.max(0, distance) * duration / (seconds * stride * scale);
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

/** Match the left forepaw's contact phase when changing between walk and gallop. */
export function locomotionTransitionPhase(from: string, to: string, phase: number): number {
  const offset: Record<string, number> = { Walk: 0, Run: .47 };
  if (!(from in offset) || !(to in offset)) return 0;
  return ((phase + offset[from] - offset[to]) % 1 + 1) % 1;
}
