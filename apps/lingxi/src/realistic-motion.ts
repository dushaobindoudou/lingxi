/** A travelling clip's distance is in asset metres; screen motion and scale determine its clock. */
export function locomotionRate(distance: number, seconds: number, stride: number, scale: number, duration: number): number {
  if (seconds <= 0 || stride <= 0 || scale <= 0 || duration <= 0) return 0;
  return Math.max(0, distance) * duration / (seconds * stride * scale);
}

/** Use the run's longer stride before the walk turns into frantic tiny steps. Hysteresis avoids toggling. */
export function locomotionClip(groundSpeed: number, walkSpeed: number, running: boolean, hasRun: boolean): 'Walk' | 'Run' {
  return hasRun && groundSpeed > walkSpeed * (running ? 1.55 : 1.9) ? 'Run' : 'Walk';
}

/** Project a comfortable walk into logical screen pixels, including the current heading and camera. */
export function comfortableWalkPace(stride: number, duration: number, scale: number, pixelX: number, pixelZ: number, yaw: number): number | null {
  if (stride <= 0 || duration <= 0 || scale <= 0) return null;
  const pixelsPerMetre = Math.hypot(Math.sin(yaw) / Math.abs(pixelX), Math.cos(yaw) / Math.abs(pixelZ));
  return stride * scale / duration * pixelsPerMetre * 1.3;
}
