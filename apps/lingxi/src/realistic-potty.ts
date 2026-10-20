// Motion in metres in the unscaled GLB. Sit's hind paws are already on the floor, but its pelvis rests on it;
// lifting the pelvis while holding the chest and paws leaves a supported, arched squat instead of a seated cat.
export const POTTY_SQUAT = { rumpLift: 0.075, rumpForward: 0.025, hindSpread: 0.018 };
// The poop set piece walks away 1.4 s after starting Dig. Fit three distinct strokes and the sniff inside that beat.
export const POTTY_DIG = { duration: 1.4, strokeSeconds: 0.32, strokes: 3, leadIn: 0.04, pawForward: 0.06, pawBack: 0.045, pawLift: 0.045, sniffAt: 1.08 };

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export const smooth01 = (value: number) => { const t = clamp01(value); return t * t * (3 - 2 * t); };

/** One paw lifts, reaches ahead, scrapes backwards along the ground, then returns while the other rests. */
export function digPaw(time: number, side: 'L' | 'R') {
  const stroke = Math.floor((time - POTTY_DIG.leadIn) / POTTY_DIG.strokeSeconds);
  if (stroke < 0 || stroke >= POTTY_DIG.strokes || stroke % 2 !== (side === 'L' ? 0 : 1)) return { y: 0, z: 0 };
  const phase = (time - POTTY_DIG.leadIn) / POTTY_DIG.strokeSeconds - stroke;
  if (phase < 0.28) {
    const u = smooth01(phase / 0.28);
    return { y: POTTY_DIG.pawLift * u, z: POTTY_DIG.pawForward * u };
  }
  if (phase < 0.76) {
    const u = smooth01((phase - 0.28) / 0.48);
    return { y: POTTY_DIG.pawLift * (1 - u), z: POTTY_DIG.pawForward - (POTTY_DIG.pawForward + POTTY_DIG.pawBack) * u };
  }
  const u = smooth01((phase - 0.76) / 0.24);
  return { y: 0, z: -POTTY_DIG.pawBack * (1 - u) };
}

/** Downward gaze during scratching; a smaller, slower dip lets the kitten inspect and sniff at the end. */
export function digHead(time: number) {
  const down = smooth01(time / 0.18);
  const sniff = smooth01((time - POTTY_DIG.sniffAt) / 0.12) * (1 - smooth01((time - 1.28) / 0.12));
  return { neck: down * (0.18 + 0.12 * sniff), head: down * (0.16 + 0.12 * sniff) };
}
