/** Pointer contact on the projected rig, independent of three.js and of the current clip. */
export interface PetPoint { x: number; y: number }
export interface PetRigPoints {
  head: PetPoint;
  chest: PetPoint;
  spine: PetPoint;
  pelvis: PetPoint;
  tailRoot: PetPoint;
}
export interface PetWeights {
  head: number;
  back: number;
  rump: number;
  headX: number;
  headY: number;
  contact: number;
}

// Reach is a share of the kitten's drawn height; turns are radians. Ordinary strokes push the fur wind to about
// 0.2-0.35, so fullPoseStroke makes a hand moving at a natural pace clearly visible without an abrupt snap.
export const PET = {
  reach: { head: 0.37, back: 0.23, rump: 0.23 }, fullPoseStroke: 0.32,
  enter: 0.18, release: 0.62, interrupt: 0.09, relaxSeconds: 8,
  headYaw: 0.30, headRoll: 0.24, headPitch: 0.16, headBump: 0.12,
  backArch: 0.15, rumpLift: 0.11, tailLift: 1.0, tailCurl: 0.16, tailTremble: 0.035,
  earRelax: 0.09, eyeClose: 0.75, eyeRelax: 0.15, breathPeriod: 3.4, breathBase: 0.35, breathPulse: 0.48,
} as const;

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const falloff = (distance: number, radius: number) => {
  const t = clamp01(1 - distance / radius);
  return t * t * (3 - 2 * t);
};
function segmentDistance(p: PetPoint, a: PetPoint, b: PetPoint) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = clamp01(((p.x - a.x) * dx + (p.y - a.y) * dy) / Math.max(1e-6, dx * dx + dy * dy));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

/** A stroke belongs to the nearest body region; overlapping zones blend rather than snapping. */
export function petWeights(pointer: PetPoint, rig: PetRigPoints, drawnHeight: number, strokeAmount: number): PetWeights {
  const h = Math.max(1, drawnHeight);
  const strength = clamp01(strokeAmount / PET.fullPoseStroke);
  const headDistance = Math.hypot(pointer.x - rig.head.x, pointer.y - rig.head.y);
  const backDistance = Math.min(segmentDistance(pointer, rig.chest, rig.spine), segmentDistance(pointer, rig.spine, rig.pelvis));
  const rumpDistance = Math.min(Math.hypot(pointer.x - rig.tailRoot.x, pointer.y - rig.tailRoot.y),
    segmentDistance(pointer, rig.pelvis, rig.tailRoot));
  const head = falloff(headDistance, h * PET.reach.head) * strength;
  const back = falloff(backDistance, h * PET.reach.back) * strength;
  const rump = falloff(rumpDistance, h * PET.reach.rump) * strength;
  return {
    head, back, rump,
    headX: clamp01(Math.abs(pointer.x - rig.head.x) / (h * PET.reach.head)) * Math.sign(pointer.x - rig.head.x),
    headY: clamp01(Math.abs(pointer.y - rig.head.y) / (h * PET.reach.head)) * Math.sign(pointer.y - rig.head.y),
    contact: Math.max(head, back, rump),
  };
}
