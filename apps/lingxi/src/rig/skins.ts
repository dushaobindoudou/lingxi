// Skin catalogue. A skin is (colours) + (optional sparse proportion overrides); the rig
// topology in data/skeleton.json is shared by all of them.
//
// Layer 1 (colours) is live. Layer 2 (a texture atlas per skin) and layer 3 (full breed
// proportion sets) both slot in here without touching the builder or anything downstream -
// see buildRig's header comment for the rule that keeps that true.
import warmTabby from '../../../../presets/skins/warm-tabby.json';
import silverCloud from '../../../../presets/skins/silver-cloud.json';
import type { VoxelSkin } from './skeleton.ts';

/**
 * Proportion demo: same 46 boxes, shorter leg segments. Everything that depends on leg
 * length - standing height, IK reach, stride length - derives from the rig, so this is the
 * entire definition of a short-legged breed. Included now specifically to keep the
 * "no hardcoded dimensions" rule honest: if it ever breaks, a Munchkin will look wrong
 * immediately instead of silently at v2.
 */
const MUNCHKIN_PROPORTIONS: NonNullable<VoxelSkin['proportions']> = {
  upperFL: { size: [2.2, 2.6, 2.2], segmentLength: 2.6 },
  lowerFL: { size: [1.9, 2.4, 1.9], segmentLength: 2.4 },
  upperFR: { size: [2.2, 2.6, 2.2], segmentLength: 2.6 },
  lowerFR: { size: [1.9, 2.4, 1.9], segmentLength: 2.4 },
  thighL: { size: [3.2, 3.2, 3.0], segmentLength: 3.0 },
  shinL: { size: [2.4, 3.0, 2.4], segmentLength: 3.0 },
  footL: { size: [2.0, 2.6, 2.0], segmentLength: 2.6 },
  thighR: { size: [3.2, 3.2, 3.0], segmentLength: 3.0 },
  shinR: { size: [2.4, 3.0, 2.4], segmentLength: 3.0 },
  footR: { size: [2.0, 2.6, 2.0], segmentLength: 2.6 },
};

const SKINS: VoxelSkin[] = [
  warmTabby as VoxelSkin,
  silverCloud as VoxelSkin,
  { ...(warmTabby as VoxelSkin), id: 'munchkin-tabby', name: '短腿虎斑', proportions: MUNCHKIN_PROPORTIONS },
];

export const DEFAULT_SKIN_ID = 'warm-tabby';

export function listSkins(): readonly VoxelSkin[] {
  return SKINS;
}

/** Unknown id falls back to the default rather than throwing - a stale persisted skin id
 *  should degrade to "the normal cat", not to a blank window. */
export function getSkin(id: string): VoxelSkin {
  return SKINS.find((skin) => skin.id === id) ?? SKINS.find((skin) => skin.id === DEFAULT_SKIN_ID) ?? SKINS[0];
}
