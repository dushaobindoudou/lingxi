// Viewing-angle catalogue ("视角"). Deliberately its own module with no three.js import: the
// management window needs to list and label the angles, and pulling the whole renderer (and
// with it three.js) into that bundle just to read five constants would be absurd.

/**
 * Viewing angles ("视角"), as elevation above the ground plane the cat stands on.
 *
 * This used to be a single hardcoded, near-overhead camera (~61 degrees), which is a
 * map/strategy-game angle, not a character-game angle: from up there you mostly see the top
 * of a cat's head and its back, and the face - the entire expressive surface of this thing -
 * is a sliver ("绝对不能是屏幕向下看，啥都看不到"). Real games frame a character from close
 * to its own eye height and tilt down only slightly; 20-30 degrees is the usual 3/4 view.
 *
 * Why a preset LIST rather than one better number: the right angle genuinely differs by
 * situation. Watching it walk across the desktop wants some ground plane visible; a cat
 * sitting still that you're interacting with wants eye contact. 'auto' below switches
 * between them on its own.
 *
 * The camera is orthographic, so elevation is free to be anything: there is no perspective
 * distortion to fight and (with the clip planes set the way applyCameraAngle sets them) no
 * angle that can push the cat out of the frustum. The previous near-overhead value was not a
 * taste decision - it was a workaround for clipping that this file no longer has.
 */
export interface CameraPreset {
  id: string;
  name: string;
  description: string;
  /** Degrees above the ground plane. 0 = dead level with the cat, 90 = straight down. */
  elevationDeg: number;
  /** Height on the model the camera aims at, in world units (the cat is ~0.8 tall). */
  lookAtY: number;
}

export const CAMERA_PRESETS: readonly CameraPreset[] = [
  // Negative elevation: the camera sits just BELOW the cat's eye line and tilts up at it, the
  // framing you get crouching down to a pet's level and looking up. Combined with the head
  // pitch below it reads as the cat looking up at you / at the screen.
  { id: 'look-up', name: '仰视', description: '从略低处往上看，猫像在抬头看着屏幕外的你', elevationDeg: -11, lookAtY: 0.5 },
  { id: 'eye-level', name: '平视', description: '几乎与猫同高，脸最大、最有对视感', elevationDeg: 9, lookAtY: 0.42 },
  { id: 'game', name: '游戏视角', description: '经典 3/4 斜视角：脸清楚，走位也看得见', elevationDeg: 24, lookAtY: 0.40 },
  { id: 'shoulder', name: '俯身', description: '像站着低头看它，能看到更多地面', elevationDeg: 40, lookAtY: 0.34 },
  { id: 'overhead', name: '俯视', description: '偏俯拍，走位最清楚、脸最少（旧版默认）', elevationDeg: 60, lookAtY: 0.32 },
  { id: 'auto', name: '自动', description: '静止/互动时平视对上眼，走动时切到 3/4', elevationDeg: 0, lookAtY: 0 },
];

export const DEFAULT_CAMERA_ID = 'game';

/**
 * Extra head pitch per preset, radians, positive = nose up. A low camera on its own gets you
 * an upward VIEW; having the cat actually lift its chin is what makes it read as the cat
 * looking up at you rather than the camera happening to be on the floor.
 */
export const CAMERA_HEAD_PITCH: Record<string, number> = {
  'look-up': -0.17,
  overhead: 0.09,
};

/** Which concrete preset 'auto' resolves to, per life-engine state. */
export const AUTO_CAMERA_FOR_STATE: Record<string, string> = {
  idle: 'eye-level',
  dragged: 'eye-level',
  wander: 'game',
  ai_directed: 'game',
  play_toy: 'game',
};

export function cameraPreset(id: string): CameraPreset {
  return CAMERA_PRESETS.find((preset) => preset.id === id) ?? CAMERA_PRESETS[1];
}

