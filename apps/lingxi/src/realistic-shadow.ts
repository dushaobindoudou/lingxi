// Shadow dimensions are in model-height units; the renderer scales them with the cat.
export const CONTACT_SHADOW = {
  // The paw joints sit above the sole in the exported rest pose. Subtract these offsets before measuring lift.
  pawRestY: [0.065, 0.065, 0.108, 0.108],
  pawSize: [0.23, 0.19],
  pawFadeHeight: 0.12,
  bodyRestY: 0.326,
  bodyDownRange: 0.18,
} as const;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => value * value * (3 - 2 * value);

/** A planted sole makes a tight dark patch; the patch broadens and vanishes as the paw lifts. */
export function pawContactShadow(lift: number): { opacity: number; spread: number } {
  const air = smooth(clamp01(lift / CONTACT_SHADOW.pawFadeHeight));
  return { opacity: 0.96 * (1 - air) ** 2, spread: 1 + 0.65 * air };
}

/** The lowered torso covers more floor in sitting and lying poses. */
export function bodyContactShadow(drop: number): { opacity: number; length: number; width: number } {
  const down = smooth(clamp01(drop / CONTACT_SHADOW.bodyDownRange));
  return { opacity: 0.68 + 0.18 * down, length: 0.95 + 0.18 * down, width: 0.62 + 0.24 * down };
}
