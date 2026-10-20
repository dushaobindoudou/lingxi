/**
 * The legs' skin, re-weighted so a leg moves as one piece with its thigh.
 *
 * The model's weights leave the thigh mostly on the trunk: half way down the hind thigh only ~45% of the skin follows
 * the femur and ~40% stays with the pelvis, and the pelvis still holds ~20% at the knee (the shoulder side is the same,
 * a little milder). So when a leg swings back in a step the skin round the thigh and knee stays half behind, and the
 * leg looks as if it shortens and slides up into the body ("走路的时候会轻微缩回去"). Below the hip and shoulder joints
 * most of the trunk's share moves onto the leg; above them nothing changes, so the haunch and shoulder still blend
 * into the flank.
 *
 * Plain arrays, no three.js, so it runs on the body and on the groom's strands alike (their per-point weights come
 * from the same Blender sources and must keep following the same skin) and can be tested on its own.
 */
export interface LimbSpec {
  upper: string;
  lower: string;
  /** trunk bones whose share below the joint moves onto the leg */
  trunk: string[];
}

const REAR_TRUNK = ['Pelvis', 'Loin', 'LoinB', 'Spine'];
const FRONT_TRUNK = ['Chest', 'Spine', 'LoinB', 'Neck', 'NeckB'];
export const LIMBS: LimbSpec[] = (['L', 'R'] as const).flatMap((side) => [
  { upper: `RearUpper.${side}`, lower: `RearLower.${side}`, trunk: REAR_TRUNK },
  { upper: `FrontUpper.${side}`, lower: `FrontLower.${side}`, trunk: FRONT_TRUNK },
]);

export const LIMB_SKIN = {
  // the share of the trunk's weight moved onto the leg, easing in between these points down the upper leg (0 = the
  // joint, 1 = the knee or elbow). Not from the joint itself: the top of the thigh has to stay part of the flank, or a
  // leg folded right under the body (loaf, lying down) turns the skin over at the hip into a bare flap
  strength: 0.85,
  from: 0.3,
  full: 0.85,
  // below the knee the moved share goes to the lower leg instead, handed over right at the knee: a wide hand-over split
  // the knee's skin further between the two bones, and a knee folded right up (lying down) pinched it into a thin fin
  lowerFrom: 0.95,
  lowerFull: 1.1,
  // only skin that is already largely the leg's (the thigh itself carries 0.35-0.45 of it): the back, and the fold of
  // belly in front of the thigh (~0.2), stay with the trunk
  legFrom: 0.15,
  legFull: 0.35,
  // and only out at the leg, as a share of the joint's distance from the midline: the belly between the legs carries a
  // little of their weight too, and handed to them it went with a folded leg and stood up off the belly as a fin
  medialFrom: 0.35,
  medialFull: 0.6,
} as const;

const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Re-weights in place. `points` are xyz in the skeleton's bind space (where `bones` are), four joints and weights per
 * point. Returns how many points changed.
 */
export function rebalanceLimbWeights(
  points: ArrayLike<number>,
  joints: { [i: number]: number; length: number },
  weights: { [i: number]: number; length: number },
  boneNames: readonly string[],
  bonePosition: (name: string) => readonly [number, number, number] | undefined,
  limbs: LimbSpec[] = LIMBS,
  config: typeof LIMB_SKIN = LIMB_SKIN,
): number {
  const index = new Map(boneNames.map((name, i) => [name, i]));
  const rigs = limbs.flatMap((limb) => {
    const upper = index.get(limb.upper), lower = index.get(limb.lower);
    const hip = bonePosition(limb.upper), knee = bonePosition(limb.lower);
    if (upper == null || lower == null || !hip || !knee) return [];
    const axis = [knee[0] - hip[0], knee[1] - hip[1], knee[2] - hip[2]];
    const length2 = axis[0] ** 2 + axis[1] ** 2 + axis[2] ** 2;
    const trunk = new Set(limb.trunk.map((name) => index.get(name)).filter((i): i is number => i != null));
    return length2 > 0 ? [{ upper, lower, hip, axis, length2, trunk }] : [];
  });
  const count = Math.floor(weights.length / 4);
  const bone: number[] = [], share: number[] = [];
  let changed = 0;
  for (let p = 0; p < count; p++) {
    for (const rig of rigs) {
      let leg = 0;
      for (let c = 0; c < 4; c++) {
        const j = joints[p * 4 + c];
        if (j === rig.upper || j === rig.lower) leg += weights[p * 4 + c];
      }
      if (leg < config.legFrom) continue;
      const out = rig.hip[0] !== 0 ? smoothstep(config.medialFrom, config.medialFull, points[p * 3] / rig.hip[0]) : 1;
      if (out <= 0) continue;
      const t = ((points[p * 3] - rig.hip[0]) * rig.axis[0] + (points[p * 3 + 1] - rig.hip[1]) * rig.axis[1]
        + (points[p * 3 + 2] - rig.hip[2]) * rig.axis[2]) / rig.length2;
      const f = config.strength * smoothstep(config.from, config.full, t) * smoothstep(config.legFrom, config.legFull, leg) * out;
      if (f <= 1e-4) continue;
      bone.length = share.length = 0;
      let moved = 0;
      for (let c = 0; c < 4; c++) {
        const j = joints[p * 4 + c], w = weights[p * 4 + c];
        if (w <= 0) continue;
        const m = rig.trunk.has(j) ? w * f : 0;
        moved += m;
        bone.push(j); share.push(w - m);
      }
      if (moved <= 1e-5) continue;
      const k = smoothstep(config.lowerFrom, config.lowerFull, t);
      for (const [j, add] of [[rig.upper, moved * (1 - k)], [rig.lower, moved * k]] as const) {
        const at = bone.indexOf(j);
        if (at >= 0) share[at] += add; else { bone.push(j); share.push(add); }
      }
      // the four largest, renormalised
      const order = share.map((_, i) => i).sort((a, b) => share[b] - share[a]).slice(0, 4);
      let total = 0;
      for (const i of order) total += share[i];
      for (let c = 0; c < 4; c++) {
        const i = order[c];
        joints[p * 4 + c] = i == null ? 0 : bone[i];
        weights[p * 4 + c] = i == null || total <= 0 ? 0 : share[i] / total;
      }
      changed++;
    }
  }
  return changed;
}
