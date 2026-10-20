// The realistic cat ("真实猫") - the Blender look-dev model (lingxi-v5fix, build_lingxi_v5.py) exported to glTF by
// scripts/blender/export_lingxi_v5_glb.py and drawn here as a second implementation of the same Renderer contract the
// voxel cat (renderer.ts) implements. Swapped in at runtime by renderer-switcher.ts.
//
// What it shares with the voxel renderer, on purpose and by copy rather than by refactor (the voxel file is 1400 lines
// of hard-won behaviour and stays untouched): the orthographic camera and its presets, screen -> ground placement by
// unprojection, the fitted canvas, facing from the engine's heading and the settle-to-face-the-viewer turn. Anything
// the host measures (where the cat stands, how big it draws, where its head is) therefore lands in the same place
// in either style, and a switch does not move the cat.
//
// The coat: groom.json/bin preserve sampled original Blender curves as skinned ribbons.
// Shells remain the compatibility fallback and the morph-aware eyelids' short undercoat.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { loadGroom, createGroom, shutLidLift, type GroomAsset } from './realistic-groom.ts';
import { createFurWind } from './realistic-wind.ts';
import { WHISKER, stepWhiskerSpring, whiskerMood, type WhiskerSpring, type WhiskerVec } from './realistic-whiskers.ts';
import { PET, petWeights, type PetWeights } from './realistic-pet.ts';
import { rebalanceLimbWeights } from './realistic-skin.ts';
import type { Renderer, RendererCapabilities } from '../../../packages/desktop-host-contract/index.d.ts';
import { AUTO_CAMERA_FOR_STATE, CAMERA_HEAD_PITCH, CAMERA_PRESETS, DEFAULT_CAMERA_ID, cameraPreset } from './rig/cameras.ts';
import { APP_PUPIL, createFaceRig, expressionValues, eyesOwnLids, restValue, type FaceRig, type FaceSpec, type IrisUniforms } from './realistic-face.ts';
import { createLocomotion, KITTEN_WALK, steeringStrideScale } from './realistic-locomotion.ts';
import { comfortableWalkPace, locomotionClip, locomotionRate, locomotionTransitionPhase, matchedWalkStride, sprintPace, walkCadence } from './realistic-motion.ts';
import { createToyProp, type ToyKind, type ToyProp } from './rig/toys.ts';
import { createNeckBlend, neckShellScale } from './realistic-neck.ts';

export interface RealisticRendererOptions {
  /** URL of the exported GLB. */
  assetUrl: string;
  /** Size the canvas to the cat rather than the screen (see renderer.ts, fitCanvasToFrame). */
  fitCanvasToCat?: boolean;
  /** Fur shells per coat mesh (0 = bare skin). */
  shells?: number;
  /** Let a settled cat pick things to do on its own (false: the look-dev harness's still frames). Default true. */
  autonomous?: boolean;
  /** Keep the clips' own blinks (false: face sheets show the expression alone, as Blender's mute the clips). Default true. */
  clipBlinks?: boolean;
  /** Look-dev comparison only: draw the legacy shell approximation. */
  originalGroom?: boolean;
}

export type ReadyRenderer = Renderer & { readonly ready: Promise<void> };

// Same apparent size as the voxel cat at scale 1. rig/cameras.ts says "the cat is ~0.8 tall", but the voxel cat's head
// and body measure 1.24x that on screen (harness, scale .5: 77 px against the realistic cat's 62 at .8).
const TARGET_HEIGHT = 1.0;
// The toys (rig/toys.ts) are modelled in the voxel cat's units. This many of them make one standing cat here, so the
// yarn ball is about a quarter of the cat's height, as it is beside the voxel cat.
const TOY_UNITS_PER_CAT = 16;
const MIN_HIT_RADIUS_PX = 40;
const MAX_FACING_YAW = Math.PI * 0.42;
const VELOCITY_SMOOTHING_SECONDS = 0.22;
const TURN_RATE = 5.2;
// Standing still the cat turns by stepping round (the walk cycle, in place), and slower: spun at TURN_RATE on the spot
// its legs swept round the floor rigidly. Starts past the first angle, stops inside the second.
const PIVOT_TURN_RATE = 2.4;
const PIVOT_START = 0.35;
const PIVOT_STOP = 0.05;
const PIVOT_CADENCE = 1.1;
// Standing, it shows itself three-quarter on, never square on: square on its body hid the hind legs - a double-click
// (the pointer on the cat, straight in front of it) turned it to face the user and its hind legs seemed to vanish.
const MIN_PRESENT_YAW = 0.5;
// The head's steadying while walking: how much of the step's sway it takes out, and over how long it averages (a
// stride is ~1.5 s)
const HEAD_STEADY_SHARE = 0.75;
const HEAD_STEADY_SECONDS = 1.2;
const SETTLE_DELAY_SECONDS = 0.5;
const CAMERA_EASE_SECONDS = 0.55;
const CAMERA_DISTANCE = 6;
const CROSSFADE_SECONDS = 0.28;

// Coat meshes that get shells: strand length (m, model space) and strand cells per metre.
// Longer on the head than the old v5 demo (.022): the look-dev kitten's round head is mostly cheek and crown fluff.
const FUR: Record<string, { len: number; den: number }> = {
  LX_Head: { len: 0.045, den: 500 },
  LX_Body: { len: 0.050, den: 420 },
  LX_Tail: { len: 0.060, den: 380 },
};
// the lids' short coat (see lidCoat)
const LID_FUR = { len: 0.007, den: 650 };
// The lids reach well past the eye: open, all of each lid lies in a ring 0.044-0.065 from the eye's axis, over the face's
// own coat (the eyeball is 0.0445 in radius, the face's coat starts at 0.042-0.046), and shut, its outer part still
// does. That ring - lid skin, undercoat and strands - was a flat brown mask round every eye, and an oval with a hard
// edge on a closed one. Past the eye the lids give way to the face: whole within `from` of the eye's axis, gone by `to`
// (model units). Their free edge, the lash line over the eyeball, stays.
const LID_TUCK = { from: 0.044, to: 0.05 };
const LID_UNDERCOAT_LAYERS = 3;
// the bare lash line along a lid's free edge (world units; the cat is ~1 tall)
const LASH_WIDTH = 0.004;
// Blender's Solidify on the lids is 2.2 mm thick, centred; the whole thickness outward here - at 1.1 mm the eye's
// dome still showed through a closing lid's edge (world units)
const LID_SOLIDIFY_OUT = 0.0022;
// the lids' undercoat lifted to their own strands' brightness: the ring average round the eye takes in the dark tabby
// stripes, and a closed lid read as a dark pad over the eye
const LID_UNDERCOAT_LIFT = 1.5;
// Strand density follows the cat's drawn height (device pixels): all of them from this tall, never under the floor (see
// Groom.setDensity). Since the strands are drawn at least a pixel wide (realistic-groom minimumWidthPx) fewer of them
// cover as much: at 1200 / .12 the small desktop cat spent its frame on strands it did not need. At .28 the desktop cat
// (~270 device px tall) drew under a third of its coat, each strand standing for three: thin and coarse ("毛太少"); half
// of it reads as a dense, soft coat, at the same desktop frame rate as measured side by side.
const GROOM_FULL_DENSITY_PX = 1000;
const GROOM_MIN_DENSITY = 0.5;
// With the original groom: an opaque undercoat out to this share of the coat's length, under the strands. Short: at
// .62 it buried every strand groomed flat along the body - the chest, the middle of the face, the flanks seen from the
// front - and close up the cat was a smooth painted surface with hair only round its outline. At .3 the strands lie on
// top everywhere and the undercoat only closes the gaps between them. Opaque layers hide each other but at the edge,
// so a few are enough.
const UNDERCOAT_LAYERS = 4;
const UNDERCOAT_REACH = 0.3;
// No stranded shells since the strands blend (realistic-groom): they accumulate into the coat's fluffy edge
// themselves, and the 12 layers this once had cost a quarter of the frame for no visible difference at desktop size.
const OUTER_LAYERS = 0;
// how far round the pointer a stroke reaches into the coat (CSS px; a fingertip-to-palm sized patch)
const STROKE_RADIUS_PX = 44;

// The host's action ids (data/actions.json, main.ts) -> the GLB's clips. Approximate where the look-dev cat has no
// exact clip; everything not listed is reported unsupported (false), never silently "played".
const ACTION_CLIPS: Record<string, string> = {
  'curled-sleep': 'Sleep', 'side-nap': 'SideLie', 'stretch-front': 'Stretch', 'stretch-back': 'Stretch',
  yawn: 'Yawn', 'sleepy-nod': 'Yawn', 'lick-paw': 'Lick', 'groom-chest': 'Lick', knead: 'Knead',
  'paw-wave': 'PawPlay', 'paw-reach': 'PawPlay', 'toy-swat': 'PawPlay', 'claw-screen': 'PawPlay',
  // the potty set pieces (fx/performances): the sit with the tail raised and quivering (TAIL_ACTION_CARRIAGE) for the
  // squat; kneading's alternating forepaws for scratching at the floor
  'potty-squat': 'Sit', 'potty-dig': 'Knead', 'potty-poop': 'Sit', 'potty-pee': 'Idle',
  pounce: 'Jump', 'hop-catch': 'Jump', 'play-bow': 'LieDown', 'stalk-crouch': 'LieDown',
  'curious-tilt': 'Curious', 'ear-listen': 'Curious', 'sniff-air': 'Curious', 'look-at-you': 'Curious', 'notice-you': 'Curious',
  greeting: 'Happy', affection: 'Happy', 'head-bump': 'Happy', 'purr-settle': 'Happy',
  hiss: 'Bite', sit: 'Sit', loaf: 'Loaf', 'belly-up': 'BellyUp', 'scratch-ear': 'ScratchEar',
  'wash-face': 'WashFace', 'groom-side': 'GroomSide',
  // the rest of the voxel library (and the WorkBuddy pack in it): the nearest clip, so a reaction written for the voxel
  // cat still moves this one instead of being rejected outright
  startle: 'Jump', 'play-peek': 'LieDown', 'roll-left': 'BellyUp', 'roll-right': 'BellyUp', 'sniff-floor': 'Curious',
  meow: 'Happy', 'shake-head': 'Curious', 'shake-fur': 'GroomSide', 'rear-up': 'Stretch', 'kiss-nuzzle': 'Happy',
  'slow-blink': 'Loaf', 'tail-greeting': 'Happy', 'tail-sweep': 'Sit', 'tail-tip': 'Curious', 'tail-wrap': 'Loaf',
  'tail-alert': 'Curious', 'wb-deploy': 'Stretch', 'wb-review': 'Curious', 'wb-suspend': 'Loaf', 'wb-wave-flag': 'PawPlay',
};
// Faces the voxel library has and face.json does not (the task-state set): the nearest face this cat can make.
const EXPRESSION_ALIASES: Record<string, string> = {
  待命: '认真', 排队中: '安然', 构建中: '认真', 绿灯: '开心', 红灯: '不爽', 上线: '期待', 待你确认: '好奇', 超时: '委屈',
  收工: '满足', 摸鱼: '放松',
};
// What a settled cat does on its own between the host's requests (weights). Loops are held for a while, then released.
const IDLE_PICKS: [string, number][] = [
  ['Curious', 3], ['Yawn', 1.5], ['Lick', 2], ['WashFace', 1.5], ['GroomSide', 1.2], ['ScratchEar', 1], ['Stretch', 1],
  ['Knead', 0.8], ['Sit', 1.5], ['Loaf', 1.2],
];
// Loops: held until something else is asked for.
const LOOPING = new Set(['Idle', 'Walk', 'Run', 'Sleep']);
// Clips that settle into a pose: where in the clip the pose is reached, and how the cat gets up again. Sit sits, holds
// and stands up within itself ('rest': play on from the hold); the others end lying down ('reverse': play back to get
// up). Looped, as they were, a sitting cat stood up and sat down again every two seconds and a lying one popped back
// up to standing at every loop - the legs jumping.
// `hold` is where the pose is reached (the lying clips are settled by 0.6 - body, then neck, then tail - and breathe
// after it: held there, the cat breathes on, the rest of the clip played back and forth). `pace`: the getting down and
// the getting up played at this speed. At the clips' own speed a cat dropped from standing to lying in 0.8 s, all of
// it at once - it read as a pop, not as lying down.
const SETTLE_CLIPS: Record<string, { hold: number; rise: 'rest' | 'reverse'; pace: number }> = {
  Sit: { hold: 0.5, rise: 'rest', pace: 0.75 }, Loaf: { hold: 0.6, rise: 'reverse', pace: 0.55 },
  LieDown: { hold: 0.6, rise: 'reverse', pace: 0.55 }, SideLie: { hold: 0.6, rise: 'reverse', pace: 0.5 },
};
// Curling up to sleep goes by way of lying down (the Sleep clip is one held pose: straight from standing it popped into a
// curl, and popped back up on waking): down, then the curl crossfaded in this slowly; waking, the reverse.
const CURL_SECONDS = 1.6;
// Clips that carry the body across the floor; the engine owns position, so their horizontal travel is removed.
const TRAVELLING = ['Walk', 'Run', 'Jump'];
// The tail's carriage while a clip that leaves it alone plays. The standing clips never move Tail0, Tail1 or Tail4 (a few
// degrees on Tail2-3 at most), so the tail stuck straight out back and down in its rest pose, a stick. Per bone, Tail0
// (root) to Tail4: `lift` (degrees, up about the cat's own side axis, each on top of the one before - a negative tip
// curls it back over) and `sway` (degrees, side to side, a wave running root to tip once per `period` seconds). Clips
// not listed (sitting, lying, grooming, sleeping) pose the tail themselves and get nothing.
// Rest segments run -32, -29, -15, +11, +36 degrees from level; walking lifts them to about 36, 56, 68, 74, 70 (the
// happy kitten's raised tail in one easy arc, the tip relaxed - hooked down at 30, the raised tail read as a stiff
// brush), standing to about -25, -20, -8, 5, 20 (low, hanging in a soft curve: any higher and from the front the tip
// stood up behind the head like a tuft).
const TAIL_WALK = { lift: [68, 17, -2, -20, -29], sway: [3, 4, 6, 8, 10], period: 1.5 };
const TAIL_STAND = { lift: [7, 2, -2, -13, -10], sway: [2, 3, 5, 7, 9], period: 3.2 };
const TAIL_RUN = { lift: [37, 2, -12, -26, -22], sway: [1, 2, 3, 4, 5], period: 0.9 };
// Host actions that carry the tail their own way over the clip's, from the tail's rest pose rather than on top of the
// clip's: the squat's sit wraps the tail round the paws, and a squatting cat holds it up and back, quivering. The sit
// pitches the pelvis up ~60 degrees, so the root lifts that much just to stand level behind.
// How long a held pose is held for these host actions (ms, once reached), where a set piece times its beats round it
const ACTION_HOLD_MS: Record<string, number> = { 'potty-squat': 2000, 'potty-poop': 2600, 'potty-pee': 3200 };
// Set pieces that stage the cat before they play: it turns on the spot to `yaw` (0 faces the viewer, PI away; the side
// it already shows), and only then acts - a standing cat is otherwise always shown three-quarter on to the viewer, and an
// action freezes its facing. Over the clip: `look` turns the chest, neck and head round to the viewer (over its
// shoulder); `liftHind` raises the hind leg on the viewer's side, out and up (a dog's leg-lift).
const ACTION_STAGING: Record<string, { yaw: number; look?: boolean; liftHind?: boolean }> = {
  'potty-poop': { yaw: Math.PI - 0.85, look: true },
  // the rump to the screen, nearly square on, so it pees at the viewer from under the leg raised out to the side
  'potty-pee': { yaw: Math.PI - 0.35, liftHind: true },
};
// The lying clips were authored and approved for the camera square in front of the cat (the review renders' "-app"
// views): SideLie and Sleep even set the head's world orientation to face that camera. Played from the three-quarter
// stance the cat stands in - or whatever heading it stopped at - the face pointed off past the viewer, the head looked
// wrenched round on the lying body. So the cat turns square on first, then lies down (the same staging as the potty set
// pieces), and the engine's sleep the same way.
const FRONT_FACING_CLIPS = new Set(['LieDown', 'Loaf', 'SideLie', 'Sleep']);
// the look over the shoulder: the most it turns (radians), and each bone's share of it, chest to head
const LOOK_BACK = { most: 2.3, shares: { Chest: 0.18, Neck: 0.4, Head: 0.42 } as Record<string, number> };
// the leg-lift (radians): out from the body, forward at the hip, the knee bent; the pelvis rolls away from it a little
const LEG_LIFT = { out: 1.45, forward: 0.2, knee: 0.6, pelvisRoll: 0.1 };
const TAIL_ACTION_CARRIAGE: Record<string, { lift: number[]; sway: number[]; period: number }> = {
  'potty-squat': { lift: [105, 12, 4, -6, -10], sway: [1.5, 2, 2.5, 3, 3.5], period: 0.32 },
  // the rump to the viewer: the tail well up off the floor behind it
  'potty-poop': { lift: [135, 15, 0, -12, -18], sway: [1.5, 2, 2.5, 3, 3.5], period: 0.32 },
  // standing, the pelvis level: up and over the back, quivering
  'potty-pee': { lift: [70, 25, 5, -10, -15], sway: [1.5, 2, 3, 4, 5], period: 0.28 },
};
const TAIL_CARRIAGE: Record<string, { lift: number[]; sway: number[]; period: number }> = {
  Walk: TAIL_WALK, Happy: TAIL_WALK, Curious: TAIL_WALK,
  Run: TAIL_RUN, Jump: TAIL_RUN,
  Idle: TAIL_STAND, Turn: TAIL_STAND, Yawn: TAIL_STAND, Bite: TAIL_STAND, Knead: TAIL_STAND, Stretch: TAIL_STAND, PawPlay: TAIL_STAND,
};
// The tail moves as a whip, not a stick: each bone springs toward its carriage, the root quickest and each one on more
// loosely (natural frequency, Hz, root to tip), a little under-damped - the root leads, the tip follows and swings a
// touch past before settling. One time constant for all five raised the whole tail at once, a rod on a hinge.
const TAIL_SPRING_HZ = [2.4, 2.0, 1.7, 1.4, 1.15];
const TAIL_DAMPING = 0.6;
// how far (radians) the sway wave lags from one tail bone to the next
const TAIL_WAVE_LAG = 0.6;
// The coat's color attribute is the SKIN under the Cycles hair, darker and duller than the golden caramel the hair
// shader makes of it: richer and a touch warmer here, on the shells and the bare skin alike.
// The face a clip implies while it plays and nothing is held (the voxel cat's actions carry theirs in actions.json).
const CLIP_EXPRESSION: Record<string, string> = {
  Sleep: '闭眼休息', SideLie: '放松', Happy: '开心', Curious: '好奇', Yawn: '困困', Lick: '满足', WashFace: '满足',
  GroomSide: '满足', ScratchEar: '满足', Knead: '陶醉', Stretch: '放松', PawPlay: '玩心', Jump: '期待', Bite: '生气',
  BellyUp: '撒娇', Loaf: '安心',
};
const DEFAULT_EXPRESSION = '安然';
const EXPRESSION_HOLD_MS = 4000;
// how fast the face eases to a new expression (time constant)
const FACE_EASE_SECONDS = 0.09;
// The slow blink - a cat's "I trust you", and the most 治愈 thing it does. When the pointer comes to rest by its face
// and stays (someone has stopped to look at it), the cat closes its eyes slowly, holds them shut a moment with a soft
// smile at the lids, and opens them again. Never on a timer, and not again for a while. `dwell`: seconds the pointer
// has to rest, within `reach` of the head (share of the cat's drawn height), moving less than `still` px; then the
// blink's `close` / `hold` / `open` (seconds) and the `rest` before the next one can come (seconds, random in between).
// how much deeper the breathing is drawn lying down and asleep (see breathe)
const BREATH_GAIN = 2.6;
const SLOW_BLINK = { dwell: 1.6, reach: 0.7, still: 12, close: 0.6, hold: 0.45, open: 0.85, rest: [14, 28] as const };
const COAT_GRADE = `
  { float lumC = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    diffuseColor.rgb = max(mix(vec3(lumC), diffuseColor.rgb, 1.25) * vec3(1.06, 1.0, 0.90), 0.0); }`;

// The closed mouth, drawn into the muzzle's coat: from the philtrum's foot out and down to either side, the cat's
// upside-down Y (人), and the philtrum up to the nose, in the model's rest coordinates (x across, mirrored; y up), so the
// line rides the face as the lips and corners move. The head mesh is too sparse there to carry it as vertex colour -
// painted, it broke up into ragged dark triangles, a crack from the nose down. (Traced off LX_LipUpper's rim it was a
// ω - out, then up to the corners - a cartoon smile; a cat's mouth runs down from the philtrum.)
const MOUTH_CURVE: [number, number][] = [[0, 0.4465], [0.0030, 0.4449], [0.0060, 0.4432], [0.0090, 0.4417], [0.0120, 0.4405],
  [0.0150, 0.4397]];
const PHILTRUM: [[number, number], [number, number]] = [[0, 0.4465], [0, 0.4690]];
// half-widths (model units; never under ~a pixel), the mouth only on the face's front (rest z), its colour, how dark
// the line and the philtrum are drawn, and where the line fades out toward its ends (|x|): a cat's mouth has no
// marked corners, it trails off under the whisker pads. The philtrum is a faint groove, its coat not parted (parted,
// the bare undercoat down the middle read as a crack from the nose to the mouth).
const MOUTH = {
  width: 0.0007, philtrumWidth: 0.0004, frontFrom: 0.425, frontFull: 0.44, colour: [0.22, 0.14, 0.13],
  line: 0.9, philtrum: 0.4, fadeFrom: 0.009, fadeTo: 0.016,
} as const;
const glslVec2 = ([x, y]: [number, number]) => `vec2(${x.toFixed(5)}, ${y.toFixed(5)})`;
const MOUTH_GLSL = `
  float mouthSegment(vec2 p, vec2 a, vec2 b) { vec2 ab = b - a; float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0); return length(p - a - ab * t); }
  // distance (model units, front view) to the mouth's ω (x) and to the philtrum (y)
  vec2 mouthDistance(vec3 rest) {
    vec2 p = vec2(abs(rest.x), rest.y);
    float d = 1e3;
    ${MOUTH_CURVE.slice(1).map((q, i) => `d = min(d, mouthSegment(p, ${glslVec2(MOUTH_CURVE[i])}, ${glslVec2(q)}));`).join('\n    ')}
    return vec2(d, mouthSegment(p, ${glslVec2(PHILTRUM[0])}, ${glslVec2(PHILTRUM[1])}));
  }`;
/** The distance to the mouth's line (not the philtrum) on the CPU, for the strands rooted on it. */
function mouthLineDistance(x: number, y: number): number {
  const seg = (px: number, py: number, [ax, ay]: [number, number], [bx, by]: [number, number]) => {
    const abx = bx - ax, aby = by - ay;
    const t = Math.min(1, Math.max(0, ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby)));
    return Math.hypot(px - ax - abx * t, py - ay - aby * t);
  };
  const px = Math.abs(x);
  let d = Infinity;
  for (let i = 1; i < MOUTH_CURVE.length; i++) d = Math.min(d, seg(px, y, MOUTH_CURVE[i - 1], MOUTH_CURVE[i]));
  return d;
}

export function createRealisticRenderer(options: RealisticRendererOptions): ReadyRenderer {
  const shellCount = Math.max(0, Math.min(64, options.shells ?? 32));
  const fitCanvas = options.fitCanvasToCat === true;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true });
  renderer.debug.onShaderError = (gl, program, vertex, fragment) => {
    throw new Error(`真实猫着色器编译失败: ${gl.getProgramInfoLog(program)} ${gl.getShaderInfoLog(vertex)} ${gl.getShaderInfoLog(fragment)}`);
  };
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Gentle, film-like roll-off: the white chest and paws keep their texture instead of clipping.
  // (AgX is what Blender's own view transform is, so the Cycles review renders and this agree; Neutral and ACES both
  // pushed the coat to a saturated orange)
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.3;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.5;

  // Soft, warm studio light - the "治愈" look: a broad warm key from the front-left, a creamy sky / ground fill so no
  // side goes cold or dark, and a warm rim from behind that lights the coat's edge into a soft halo.
  // Soft shadows, from the key only: the cat grounded on the floor and shaded under its own chin and between its legs.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const KEY_OFFSET = new THREE.Vector3(-1.3, 2.4, 2.2);
  const key = new THREE.DirectionalLight(0xffe9d2, 2.4);
  key.position.copy(KEY_OFFSET);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xffe0c4, 1.6);
  rim.position.set(0.6, 1.6, -2.0);
  scene.add(rim);
  // a soft fill from the viewer's side lifts the face, the way the review renders' front fill does
  const fill = new THREE.DirectionalLight(0xfff8f0, 0.55);
  fill.position.set(0.2, 0.9, 3.0);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight(0xfff7ee, 0xe9d8c6, 1.1));
  const shadowCatcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.055 }));
  shadowCatcher.rotation.x = -Math.PI / 2;
  shadowCatcher.receiveShadow = true;
  // no cast shadow on the desktop: a cat-shaped silhouette lying on the screen read as a cut-out; the soft contact blob
  // under the paws grounds it (the self-shadowing of the coat stays)
  shadowCatcher.visible = false;
  scene.add(shadowCatcher);

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 200);
  const camForward = new THREE.Vector3();
  const groundRight = new THREE.Vector3();
  const groundUp = new THREE.Vector3();
  let width = 1;
  let height = 1;
  let unitsPerPixel = 0.01;
  let worldPerPixelX = 0.01;
  let worldPerPixelZ = 0.01;
  let cameraId = DEFAULT_CAMERA_ID;
  let cameraElevation = cameraPreset(DEFAULT_CAMERA_ID).elevationDeg;
  let cameraLookAtY = cameraPreset(DEFAULT_CAMERA_ID).lookAtY;
  let cameraHeadPitch = 0;

  function applyCameraAngle(elevationDeg: number, lookAtY: number) {
    const safe = THREE.MathUtils.clamp(elevationDeg, -35, 88);
    const elevation = THREE.MathUtils.degToRad(Math.abs(safe) < 5 ? Math.sign(safe || 1) * 5 : safe);
    camera.position.set(0, lookAtY + Math.sin(elevation) * CAMERA_DISTANCE, Math.cos(elevation) * CAMERA_DISTANCE);
    camera.lookAt(0, lookAtY, 0);
    camera.updateMatrixWorld(true);
    camForward.set(0, lookAtY, 0).sub(camera.position).normalize();
    groundRight.crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();
    groundUp.crossVectors(groundRight, camForward);
    applyFrustum();
  }
  function applyFrustum() {
    const halfW = width * unitsPerPixel;
    const halfH = height * unitsPerPixel;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    worldPerPixelX = halfW / (width / 2) / groundRight.x;
    worldPerPixelZ = -(halfH / (height / 2)) / groundUp.z;
  }
  applyCameraAngle(cameraElevation, cameraLookAtY);

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const placement = new THREE.Vector3();
  function screenToWorld(screenX: number, screenY: number, planeY: number) {
    ndc.set((screenX / width) * 2 - 1, -(screenY / height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const ray = raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-9) return placement;
    const t = (planeY - ray.origin.y) / ray.direction.y;
    return placement.copy(ray.origin).addScaledVector(ray.direction, t);
  }
  const projected = new THREE.Vector3();
  function worldToScreen(p: THREE.Vector3) {
    projected.copy(p).project(camera);
    return { x: (projected.x * 0.5 + 0.5) * width, y: (-projected.y * 0.5 + 0.5) * height };
  }

  // --- contact shadow ---------------------------------------------------------------------
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  {
    const g = shadowCanvas.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(70,52,40,0.42)');
    grad.addColorStop(0.55, 'rgba(70,52,40,0.18)');
    grad.addColorStop(1, 'rgba(70,52,40,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false, toneMapped: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.renderOrder = -1;
  scene.add(shadow);

  // --- the cat ----------------------------------------------------------------------------
  const catRoot = new THREE.Group();
  scene.add(catRoot);
  let model: THREE.Object3D | null = null;
  let modelUnitScale = 1; // metres -> world units at scale 1
  let restHeight = 0.66;
  let modelScale = 1;
  let performanceScale: number | null = null;
  let performanceTarget = 1;
  let performanceTau = 0.6;
  let performanceReleasing = false;
  const effectiveScale = () => modelUnitScale * (performanceScale ?? modelScale);

  let mixer: THREE.AnimationMixer | null = null;
  const actions: Record<string, THREE.AnimationAction> = {};
  const strides: Record<string, number> = {}; // metres of ground per clip cycle (travelling clips)
  let current: THREE.AnimationAction | null = null;
  let currentName = '';
  let oneShot: { id: string; clip: string; endsAt: number; rising?: boolean } | null = null;
  let idleSince = 0;
  let nextIdlePick = 6 + Math.random() * 6;
  const bones: THREE.Bone[] = [];
  let headBone: THREE.Bone | null = null;
  // the body's coat mesh (its shape keys: Breath)
  let coatBody: THREE.SkinnedMesh | null = null;
  // the teeth and the lips' parts (lips, mouth, tongue) show only with the jaw open (an expression's or a clip's): with it
  // closed the coat draws the mouth (MOUTH_CURVE), and the parts' edges poked through it as ragged pink slivers and a
  // fang's tip as a buck tooth
  let jawBone: THREE.Bone | null = null;
  const jawRest = new THREE.Quaternion();
  const teeth: THREE.Object3D[] = [];
  const JAW_OPEN_SHOWS_TEETH = 0.04;
  // The head's skin is cut along the mouth so the jaw can open: each vertex on the line is there twice, one copy on the
  // upper lip's bones, one on the jaw's. Any face that moves the lips but not the jaw - the resting 'cat' mouth lifts its
  // corners - pulled the cut open into a ragged slit, the crack under the nose. With the jaw closed the two copies are
  // sewn together (both on the pair's average weights); open, they part again.
  let mouthSeam: { index: THREE.BufferAttribute; weight: THREE.BufferAttribute; vertices: number[]; own: number[][]; sewn: number[][] } | null = null;
  let mouthSewn = false;
  function findMouthSeam(head: THREE.Mesh) {
    const pos = head.geometry.getAttribute('position'), index = head.geometry.getAttribute('skinIndex') as THREE.BufferAttribute,
      weight = head.geometry.getAttribute('skinWeight') as THREE.BufferAttribute;
    if (!pos || !index || !weight) return;
    const at = new Map<string, number[]>();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (z < MOUTH.frontFrom - 0.02 || Math.abs(x) > 0.05 || y < 0.42 || y > 0.48) continue;
      const k = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
      at.set(k, [...(at.get(k) ?? []), i]);
    }
    const read = (i: number) => [0, 1, 2, 3].map((c) => [index.getComponent(i, c), weight.getComponent(i, c)] as [number, number]);
    const vertices: number[] = [], own: number[][] = [], sewn: number[][] = [];
    for (const copies of at.values()) {
      if (copies.length < 2) continue;
      const sum = new Map<number, number>();
      for (const i of copies) for (const [j, w] of read(i)) if (w > 0) sum.set(j, (sum.get(j) ?? 0) + w / copies.length);
      const top = [...sum.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const total = top.reduce((t, [, w]) => t + w, 0);
      const average = [0, 1, 2, 3].flatMap((c) => top[c] ? [top[c][0], top[c][1] / total] : [0, 0]);
      for (const i of copies) { vertices.push(i); own.push(read(i).flat()); sewn.push(average); }
    }
    if (vertices.length) mouthSeam = { index, weight, vertices, own, sewn };
  }
  function sewMouth(sewn: boolean) {
    if (!mouthSeam || sewn === mouthSewn) return;
    mouthSewn = sewn;
    const { index, weight, vertices } = mouthSeam;
    vertices.forEach((i, n) => {
      const w = (sewn ? mouthSeam!.sewn : mouthSeam!.own)[n];
      for (let c = 0; c < 4; c++) { index.setComponent(i, c, w[c * 2]); weight.setComponent(i, c, w[c * 2 + 1]); }
    });
    index.needsUpdate = weight.needsUpdate = true;
  }
  let pelvisBone: THREE.Object3D | null = null;
  let chestBone: THREE.Object3D | null = null;
  const bodyCentre = new THREE.Vector3();
  const bodyPoint = new THREE.Vector3();
  // Tail0..Tail4, and the model's own frame their lift and sway axes are given in (see TAIL_CARRIAGE)
  const tailBones: THREE.Bone[] = [];
  let tailFrame: THREE.Object3D | null = null;
  const tailLift = [0, 0, 0, 0, 0], tailLiftVelocity = [0, 0, 0, 0, 0];
  const tailSway = [0, 0, 0, 0, 0];
  let tailPhase = 0;
  const shellMaterials: THREE.Material[] = [];
  const ownedMaterials: THREE.Material[] = [];
  const whiskerBends = [new THREE.Vector3(), new THREE.Vector3()];
  let whiskerSprings: WhiskerSpring[] = [
    { position: [0, 0, 0], velocity: [0, 0, 0] },
    { position: [0, 0, 0], velocity: [0, 0, 0] },
  ];
  const previousHeadQ = new THREE.Quaternion();
  const currentHeadQ = new THREE.Quaternion();
  const headTurnQ = new THREE.Quaternion();
  const inverseHeadQ = new THREE.Quaternion();
  const localAir = new THREE.Vector3();
  let whiskersPrimed = false;
  // GLSL `float lidShown(vec3 rest)` (see LID_TUCK), written once the eyes are found
  let lidTuckGlsl = 'float lidShown(vec3 rest) { return 1.0; }';
  let loaded = false;
  let frameSeconds = 1 / 60;
  let debugInfo: unknown = null;
  let locomotion: ReturnType<typeof createLocomotion> | null = null;
  let steeringTurnRate = 0;
  let walkStrideScale = 1;
  let groom: ReturnType<typeof createGroom> | null = null;
  const furWind = createFurWind();
  let lastAir: ReturnType<typeof furWind.update> | null = null;
  let textureAudit: { material: string; texture: string | null }[] = [];
  let groundSpeed = 0;
  const autonomous = options.autonomous ?? true;
  // the face (realistic-face.ts): what is held, what shows, eased per control
  let faceRig: FaceRig | null = null;
  let faceSpec: FaceSpec | null = null;
  const faceProblems: string[] = [];
  let heldExpression: { name: string; until: number } | null = null;
  let faceName = '';
  let faceTarget: Record<string, number> = {};
  const faceNow: Record<string, number> = {};
  let slowBlinkAt: number | null = null;
  let slowBlinkNotBefore = 3;
  let slowBlinkDwell: { since: number; x: number; y: number } | null = null;
  /** Start a slow blink when someone's pointer has come to rest by the face of a settled cat (SLOW_BLINK). */
  function watchForSlowBlink(cursor: { x: number; y: number } | null, settled: boolean) {
    if (!cursor || !settled || slowBlinkAt != null || !headBone || !catRect) { slowBlinkDwell = null; return; }
    headBone.getWorldPosition(bonePoint);
    const head = worldToScreen(bonePoint);
    if (Math.hypot(cursor.x - head.x, cursor.y - head.y) > SLOW_BLINK.reach * (catRect.y1 - catRect.y0)) { slowBlinkDwell = null; return; }
    if (!slowBlinkDwell || Math.hypot(cursor.x - slowBlinkDwell.x, cursor.y - slowBlinkDwell.y) > SLOW_BLINK.still) {
      slowBlinkDwell = { since: elapsed, x: cursor.x, y: cursor.y };
      return;
    }
    if (elapsed - slowBlinkDwell.since >= SLOW_BLINK.dwell && elapsed >= slowBlinkNotBefore) {
      slowBlinkAt = elapsed;
      slowBlinkDwell = null;
    }
  }
  /** How shut the slow blink has the eyes now, 0..1. */
  function slowBlinkWeight() {
    if (slowBlinkAt == null) return 0;
    const { close, hold, open, rest } = SLOW_BLINK;
    const t = elapsed - slowBlinkAt;
    if (t >= close + hold + open) {
      slowBlinkAt = null;
      slowBlinkNotBefore = elapsed + rest[0] + Math.random() * (rest[1] - rest[0]);
      return 0;
    }
    if (t < close) return THREE.MathUtils.smoothstep(t, 0, close);
    if (t < close + hold) return 1;
    return 1 - THREE.MathUtils.smoothstep(t, close + hold, close + hold + open);
  }
  const faceControls = new Set<string>();
  let clipLids = options.clipBlinks === false ? 0 : 1;
  let clipLidsTarget = 1;
  function wantedExpression() {
    if (heldExpression && elapsed < heldExpression.until && faceSpec?.expressions[heldExpression.name]) return { name: heldExpression.name, held: true };
    const implied = CLIP_EXPRESSION[currentName];
    return { name: implied && faceSpec?.expressions[implied] ? implied : DEFAULT_EXPRESSION, held: false };
  }
  let disposed = false;

  // The Cycles iris draws its pupil procedurally (face-controls 'mat' PupilW/H, GazeX/Y), which glTF cannot carry: drawn
  // here on the iris map's UV disc, per eye, from the face (realistic-face.ts) - the pupil an ellipse that closes to a
  // pointed lens as it gets tall (a slit), the look moving the iris pattern across the lens over a pale sclera, a dark
  // limbal ring, and broad reflections that stay put on the lens.
  const irisUniforms: Record<'L' | 'R', IrisUniforms> = {
    L: { uPupil: { value: new THREE.Vector2(APP_PUPIL, APP_PUPIL) }, uGaze: { value: new THREE.Vector2() }, uCatch: { value: 1 }, uSpark: { value: 0 } },
    R: { uPupil: { value: new THREE.Vector2(APP_PUPIL, APP_PUPIL) }, uGaze: { value: new THREE.Vector2() }, uCatch: { value: 1 }, uSpark: { value: 0 } },
  };
  function irisMaterial(src: THREE.MeshStandardMaterial, side: 'L' | 'R') {
    const m = new THREE.MeshStandardMaterial({ map: src.map ?? null, roughness: 0.5, color: src.map ? 0xffffff : src.color });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, irisUniforms[side]);
      sh.fragmentShader = 'uniform vec2 uPupil; uniform vec2 uGaze; uniform float uCatch; uniform float uSpark;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec2 guv = vMapUv - uGaze;
          // The map already has fine fibres. Add a low-contrast radial layer and a warmer collarette so that those
          // fibres survive the small desktop rendering without becoming a flat bright disc.
          diffuseColor *= texture2D(map, guv);
          diffuseColor.rgb *= 1.28;
          float irisD = distance(guv, vec2(0.5));
          vec2 irisRay = guv - 0.5;
          float irisAngle = atan(irisRay.y, irisRay.x);
          float fibres = sin(irisAngle * 93.0 + irisD * 44.0 + sin(irisAngle * 19.0) * 1.5);
          float fibreMask = smoothstep(0.19, 0.30, irisD) * (1.0 - smoothstep(0.43, 0.48, irisD));
          diffuseColor.rgb *= 1.0 + 0.10 * fibres * fibreMask;
          float collarette = smoothstep(uPupil.x * 0.88, uPupil.x * 1.18, irisD) * (1.0 - smoothstep(uPupil.x * 1.55, uPupil.x * 1.9, irisD));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.54, 0.32, 0.13), 0.22 * collarette);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.068, 0.038), smoothstep(0.465, 0.50, irisD));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.757, 0.686), smoothstep(0.495, 0.515, irisD));
          vec2 pe = (guv - 0.5) / uPupil;
          float pey = abs(pe.y);
          float lensD = max(pey, abs(pe.x) / max(1.0 - pey * pey, 0.05));
          float lens = clamp((uPupil.y / uPupil.x - 1.8) / 2.5, 0.0, 1.0);
          float pd = mix(length(pe), lensD, lens);
          float pw = max(fwidth(pd) * 1.5, 0.035);
          diffuseColor.rgb = mix(vec3(0.008, 0.007, 0.006), diffuseColor.rgb, smoothstep(1.0 - pw, 1.0 + pw, pd));
          // a big soft catchlight up-left, a small one down-right - most of a kitten's 'wet', alive look - and, for
          // 闪亮 / 期待, two more small sparkles. (A square window and a lower bounce were tried: they greyed the
          // pupil over, a milky eye.)
          float catchL = smoothstep(0.085, 0.050, distance(vMapUv, vec2(0.37, 0.36))) + 0.7 * smoothstep(0.035, 0.018, distance(vMapUv, vec2(0.63, 0.64)));
          catchL += uSpark * 0.22 * (smoothstep(0.03, 0.012, distance(vMapUv, vec2(0.62, 0.33))) + smoothstep(0.022, 0.008, distance(vMapUv, vec2(0.33, 0.62))));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), clamp(catchL * 0.92 * uCatch, 0.0, 1.0));
        #endif`);
    };
    m.customProgramCacheKey = () => 'realcat-iris-v3';
    ownedMaterials.push(m);
    return m;
  }
  // Blender writes the coat's color attribute as display (sRGB) values; glTF readers take COLOR_0 as linear, which
  // washes the caramel out to grey-cream. Converted once at load (?srgbcolors=0 in the harness skips it to compare).
  const convertVertexColors = !/[?&]srgbcolors=0/.test(globalThis.location?.search ?? '');
  const converted = new WeakSet<THREE.BufferAttribute>();
  function vertexColorsToLinear(geometry: THREE.BufferGeometry) {
    const c = geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!c || converted.has(c) || !convertVertexColors) return;
    const col = new THREE.Color();
    for (let i = 0; i < c.count; i++) {
      col.setRGB(c.getX(i), c.getY(i), c.getZ(i), THREE.SRGBColorSpace);
      c.setXYZ(i, col.r, col.g, col.b);
    }
    c.needsUpdate = true;
    converted.add(c);
  }
  // Shell fur, tuned for looks first (performance comes later): fine jittered strands that taper and end at their own
  // length, combed back and down along the body (the comb turns with the bones), anti-aliased in screen space, dark at
  // the roots (the coat's own occlusion) and lit through at the rim where the eye grazes the coat - the soft halo the
  // Cycles renders have.
  // `underCurves`: the shells sit under the original groom, which draws the coat's edge and carries the hair highlight.
  // They get neither: on the outer shells both read as a milky film over the stripes - the hair highlight along one
  // smooth comb direction is a broad sheen, not lines along strands, and the rim lit every bulge's edge (thigh,
  // shoulder) as a pale see-through oval.
  // The tufts inside the ears (LX_EarFurnish: 320 thin tubes an ear, u along each from root to tip). Cycles shades them as
  // hair; drawn as opaque white tubes they were hard, aliased lines crossing into a gauze over the pink ear. Here each
  // fades from about half opaque at its root to nothing at its tip, unwritten to depth, so together they are a soft
  // white down.
  const EAR_TUFT = { alpha: 0.5, fadeFrom: 0.2 };
  // the bump textures' relief (see the normal-map fix in the material pass): 1 reads at desktop size, 3 turned the ears grainy
  const BUMP_SCALE = 1;
  function earTuftMaterial(source: THREE.MeshStandardMaterial) {
    const m = new THREE.MeshStandardMaterial({
      color: source.color.clone(), roughness: 0.9, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    m.defines = { USE_UV: '' };
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
        diffuseColor.a *= ${EAR_TUFT.alpha.toFixed(2)} * (1.0 - smoothstep(${EAR_TUFT.fadeFrom.toFixed(2)}, 1.0, vUv.x));`);
    };
    m.customProgramCacheKey = () => 'realcat-ear-tuft-v1';
    ownedMaterials.push(m);
    return m;
  }
  function shellMaterial(len: number, den: number, t: number, solid = false, underCurves = false, lid = false) {
    // Coverage must not overwrite an already opaque body pixel with fractional framebuffer alpha.
    // Alpha hashing discards strand gaps, while every surviving sample stays opaque on the desktop.
    // `solid`: an opaque layer of undercoat (no strands), under the original curves. `lid`: a lid's coat, given way to
    // the face's past the eye (LID_TUCK).
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, alphaHash: !solid });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uLidTuck = { value: lid ? 1 : 0 };
      sh.uniforms.uShell = { value: t };
      sh.uniforms.uLen = { value: len };
      sh.uniforms.uDen = { value: den };
      sh.uniforms.uRim = { value: new THREE.Color(0xffd9b8) };
      sh.vertexShader = 'uniform float uShell; uniform float uLen; attribute float furScale; varying vec3 vRest; varying float vScale;\n'
        + sh.vertexShader
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n vScale = furScale;')
          // strands sit on the surface as its shape keys move it (a closing lid's coat would otherwise smear)
          .replace('#include <morphtarget_vertex>', '#include <morphtarget_vertex>\n vRest = transformed;')
          .replace('#include <skinning_vertex>', `#include <skinning_vertex>
            // the solid undercoat shrinks faster toward the eyes (furScale squared): out at full height round the eye it
            // bulged over the rim and made the eyes small
            float h = uShell * uLen * ${solid ? 'furScale * furScale' : 'furScale'};
            vec3 nrm = normalize(objectNormal);
            // combed toward the tail (-z in the model) and down, more at the tip; turned with the bones
            vec3 comb = vec3(0.0, -0.55, -1.0);
            #ifdef USE_SKINNING
              comb = (skinMatrix * vec4(comb, 0.0)).xyz;
            #endif
            vec3 dir = normalize(nrm + normalize(comb) * 0.55 * uShell);
            transformed += dir * h;`);
      sh.fragmentShader = 'uniform float uShell; uniform float uDen; uniform vec3 uRim; uniform float uLidTuck; varying vec3 vRest; varying float vScale;\n'
        + 'vec3 furHash3(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }\n'
        + MOUTH_GLSL + '\n' + lidTuckGlsl + '\n'
        + sh.fragmentShader
          .replace('#include <color_fragment>', `#include <color_fragment>
            // a lid's coat past the eye, dithered out (an opaque layer has no alpha to fade with)
            if (uLidTuck > 0.5 && lidShown(vRest) <= furHash3(vec3(gl_FragCoord.xy, uShell * 61.0)).x) discard;
            vec3 q = vRest * uDen;
            vec3 cell = floor(q);
            vec3 rnd = furHash3(cell);
            // the strand's own length: most reach 60-100% of the coat, a few stop short
            float strandLen = 0.55 + 0.45 * rnd.x;
            vec3 centre = 0.5 + (rnd - 0.5) * 0.55;
            float d = length(fract(q) - centre);
            float radius = mix(0.46, 0.10, clamp(uShell / strandLen, 0.0, 1.0));
            float fw = max(fwidth(d), 1e-4);
            // an opaque undercoat through the inner half (at desktop size single strands are sub-pixel: thinning every
            // shell turned the whole coat to fog), strands only toward the outside, where they make the soft outline
            float strand = (1.0 - smoothstep(radius - fw, radius + fw, d)) * step(uShell, strandLen);
            float undercoat = 1.0 - smoothstep(0.40, 0.70, uShell);
            float a = (${solid ? '1.0' : 'max(undercoat, strand)'}) * step(0.02, vScale);
            if (a < 0.03) discard;
            diffuseColor.a = a;
            // the coat's occlusion: roots deep, tips light
            diffuseColor.rgb *= mix(0.60, 1.08, smoothstep(0.0, 0.85, uShell));
            ${COAT_GRADE}
            // the closed mouth (MOUTH_CURVE): a fine dark line, never under about a pixel wide, in a soft crease
            {
              float front = smoothstep(${MOUTH.frontFrom}, ${MOUTH.frontFull}, vRest.z);
              vec2 md = mouthDistance(vRest);
              float lipW = max(${MOUTH.width}, fwidth(md.x) * 0.75), philW = max(${MOUTH.philtrumWidth}, fwidth(md.y) * 0.6);
              float ends = 1.0 - smoothstep(${MOUTH.fadeFrom}, ${MOUTH.fadeTo}, abs(vRest.x));
              float line = max((1.0 - smoothstep(lipW * 0.5, lipW * 1.5, md.x)) * ends, ${MOUTH.philtrum} * (1.0 - smoothstep(philW * 0.5, philW * 1.5, md.y)));
              float crease = 1.0 - smoothstep(0.0, 0.0035, min(md.x, md.y));
              diffuseColor.rgb *= 1.0 - 0.16 * crease * front;
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${MOUTH.colour.join(', ')}), ${MOUTH.line} * line * front);
            }`)
          .replace('#include <opaque_fragment>', underCurves ? '#include <opaque_fragment>' : `
            // light through the coat's edge where the view grazes it
            float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
            outgoingLight += uRim * pow(1.0 - ndv, 2.2) * uShell * 0.28;
            #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => (solid ? 'realcat-fur-undercoat-v5' : underCurves ? 'realcat-fur-shell-under-curves-v3' : 'realcat-fur-shell-opaque-v7');
    shellMaterials.push(m);
    return m;
  }
  /**
   * GLSL `float lidShown(vec3 rest)`: how much of a lid to draw at a point of its rest pose (shape keys and all) - whole
   * over the eye, gone past it (LID_TUCK), by the distance from the nearer eye's axis. The lids, face and groom share
   * one rest space (their nodes carry no transform), so one function serves the lids' skin, undercoat and strands.
   */
  /** A lid's Blink key lifted onto the closed eye's dome (realistic-groom LID_DOME): shut, it sat in a hollow. */
  function raiseShutLid(lid: THREE.Mesh, eye: { centre: THREE.Vector3; axis: THREE.Vector3 }) {
    const index = lid.morphTargetDictionary?.Blink;
    const blink = index == null ? undefined : lid.geometry.morphAttributes.position?.[index];
    if (!blink || !lid.geometry.morphTargetsRelative) return;
    const pos = lid.geometry.getAttribute('position');
    const frame = { centre: eye.centre.toArray(), axis: eye.axis.toArray() };
    for (let i = 0; i < pos.count; i++) {
      const lift = shutLidLift(pos.getX(i) + blink.getX(i), pos.getY(i) + blink.getY(i), pos.getZ(i) + blink.getZ(i), frame);
      if (lift > 0) blink.setXYZ(i, blink.getX(i) + eye.axis.x * lift, blink.getY(i) + eye.axis.y * lift, blink.getZ(i) + eye.axis.z * lift);
    }
    blink.needsUpdate = true;
  }
  /** The eyes (left, right) in a lid's rest space - the face's and the groom's too (their nodes carry no transform). */
  function eyeFrames(root: THREE.Object3D, lid: THREE.Object3D) {
    const eyes = ['EyeL', 'EyeR'].map((name) => root.getObjectByName(name)).filter((e): e is THREE.Object3D => !!e);
    if (eyes.length !== 2) return null;
    lid.updateWorldMatrix(true, false);
    const toLocal = new THREE.Matrix4().copy(lid.matrixWorld).invert();
    return eyes.map((e) => {
      const centre = e.getWorldPosition(new THREE.Vector3()).applyMatrix4(toLocal);
      // the eye looks along its bone (+y), turned into the lid's space
      const tip = e.localToWorld(new THREE.Vector3(0, 1, 0)).applyMatrix4(toLocal);
      return { centre, axis: tip.sub(centre).normalize() };
    });
  }
  function lidTuck(eyes: { centre: THREE.Vector3; axis: THREE.Vector3 }[] | null) {
    if (!eyes) return 'float lidShown(vec3 rest) { return 1.0; }';
    const glsl = (v: THREE.Vector3) => `vec3(${v.x.toFixed(5)}, ${v.y.toFixed(5)}, ${v.z.toFixed(5)})`;
    const [l, r] = eyes;
    return `float lidShown(vec3 rest) {
      vec3 dl = rest - ${glsl(l.centre)}, dr = rest - ${glsl(r.centre)};
      bool left = dot(dl, dl) < dot(dr, dr);
      vec3 d = left ? dl : dr, axis = left ? ${glsl(l.axis)} : ${glsl(r.axis)};
      return 1.0 - smoothstep(${LID_TUCK.from}, ${LID_TUCK.to}, length(d - axis * dot(d, axis)));
    }`;
  }
  // The lids' own skin is dark brown (lid_color); in the Cycles render they carry their own short hair, in the coat's
  // colour, so a closed or half-closed eye reads as fur with a dark lash line. Here: every lid vertex but the lash
  // line takes the coat's colour round the eye - the average over a ring above it (per-vertex samples drew the
  // forehead's stripes, or below the eye the white muzzle, as streaks and blocks on a closed eye) - and grows a short
  // shell coat (furScale 0 on the lash line).
  // (the stranded shells' lit tips draw the coat ~1.4x brighter; the groom's solid undercoat is shaded as the face's)
  const LID_COAT_LIFT = 1.4;
  function lidCoat(lids: THREE.SkinnedMesh[], head: THREE.Mesh | undefined, root: THREE.Object3D, lift = LID_COAT_LIFT) {
    const hc = head?.geometry.getAttribute('color');
    if (!head || !hc || !lids.length) return [];
    const hp = head.geometry.getAttribute('position');
    const v = new THREE.Vector3();
    const radial = new THREE.Vector3();
    for (const m of lids) {
      const lc = m.geometry.getAttribute('color');
      const eye = root.getObjectByName(((m.userData.name as string | undefined) ?? '').endsWith('.R') ? 'EyeR' : 'EyeL');
      if (!lc || !eye) continue;
      const centre = eye.getWorldPosition(new THREE.Vector3());
      solidifyLid(m, centre);
      const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(eye.getWorldQuaternion(new THREE.Quaternion()));
      const sum = [0, 0, 0];
      let n = 0;
      for (let i = 0; i < hp.count; i++) {
        v.fromBufferAttribute(hp, i).applyMatrix4(head.matrixWorld);
        radial.subVectors(v, centre);
        radial.addScaledVector(axis, -radial.dot(axis));
        const r = radial.length();
        if (r < 0.025 || r > 0.045 || radial.y < 0.3 * r) continue;
        sum[0] += hc.getX(i); sum[1] += hc.getY(i); sum[2] += hc.getZ(i); n++;
      }
      if (!n) continue;
      // the vertex colour is the skin under the coat; the shells' lit tips draw the coat ~1.4x brighter
      for (let c = 0; c < 3; c++) sum[c] = Math.min(1, (sum[c] / n) * lift) * n;
      const scale = new Float32Array(lc.count);
      const fromLash = lashDistance(m, centre);
      for (let i = 0; i < lc.count; i++) {
        // the lash line by where it is - the lid's free edge, the one of its two open rims nearer the eye - not by how
        // dark it is: the lid's skin is dark in patches all over, and every dark vertex stayed bare, dark skin, which
        // showed between the rows of lid strands as rings of dark bands round a closed eye
        const coat = THREE.MathUtils.smoothstep(fromLash[i], LASH_WIDTH * 0.4, LASH_WIDTH);
        // Leave a narrow brown lash, but lift its nearly black source skin toward the coat to avoid a row of dark
        // polygon steps at the eye's edge. Fur still starts beyond the free edge, so a blink keeps its clear outline.
        const tint = 0.27 + 0.73 * coat;
        lc.setXYZ(i, THREE.MathUtils.lerp(lc.getX(i), sum[0] / n, tint), THREE.MathUtils.lerp(lc.getY(i), sum[1] / n, tint), THREE.MathUtils.lerp(lc.getZ(i), sum[2] / n, tint));
        scale[i] = coat;
      }
      lc.needsUpdate = true;
      m.geometry.setAttribute('furScale', new THREE.BufferAttribute(scale, 1));
    }
    return lids;
  }
  /**
   * The lid's outer face as Blender's Solidify draws it (2.2 mm thick, centred: the outer face 1.1 mm out). lids.glb
   * carries the lid's middle surface only, which lies on the eyeball itself - closing, the lid slid into the eye and
   * the eye showed through it: a squint or a closed eye was drawn by the lid's strands alone, over a lid that wasn't
   * there. Pushed out along its normal, away from the eye.
   */
  function solidifyLid(mesh: THREE.Mesh, eye: THREE.Vector3) {
    const pos = mesh.geometry.getAttribute('position');
    const nrm = mesh.geometry.getAttribute('normal');
    if (!nrm) return;
    const toLocal = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
    const eyeLocal = eye.clone().applyMatrix4(toLocal);
    const scale = mesh.matrixWorld.getMaxScaleOnAxis() || 1;
    const p = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i); n.fromBufferAttribute(nrm, i).normalize();
      if (n.dot(p.clone().sub(eyeLocal)) < 0) n.negate();
      p.addScaledVector(n, LID_SOLIDIFY_OUT / scale);
      pos.setXYZ(i, p.x, p.y, p.z);
    }
    pos.needsUpdate = true;
    mesh.geometry.computeBoundingSphere();
  }
  /** Each vertex's distance (world) to the lid's free edge: of the mesh's open rims, the one nearer the eye. */
  function lashDistance(mesh: THREE.Mesh, eye: THREE.Vector3): Float32Array {
    const pos = mesh.geometry.getAttribute('position');
    const index = mesh.geometry.getIndex();
    const world = Array.from({ length: pos.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
    const out = new Float32Array(pos.count).fill(Infinity);
    if (!index) return out;
    // an edge used by one triangle only lies on an open rim; welded by position (the export splits vertices at seams)
    const key = (i: number) => world[i].toArray().map((c) => c.toFixed(5)).join(',');
    const edges = new Map<string, number>();
    const tri = index.array;
    for (let t = 0; t < tri.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = key(tri[t + e]), b = key(tri[t + (e + 1) % 3]);
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
    const rim = new Set<string>();
    for (const [k, n] of edges) if (n === 1) for (const end of k.split('|')) rim.add(end);
    const rimPoints = world.filter((_, i) => rim.has(key(i)));
    if (!rimPoints.length) return out;
    // two rims, round the eye and away from it: the nearer half of the rim points
    const near = [...rimPoints].sort((a, b) => a.distanceTo(eye) - b.distanceTo(eye));
    const cut = (near[0].distanceTo(eye) + near[near.length - 1].distanceTo(eye)) / 2;
    const lash = near.filter((p) => p.distanceTo(eye) < cut);
    for (let i = 0; i < world.length; i++) for (const p of lash) out[i] = Math.min(out[i], world[i].distanceTo(p));
    return out;
  }
  /** The coat mesh's Breath shape key, looked up by rest position (the nearest of its vertices within 1.5 cm). */
  function breathLookup(body: THREE.SkinnedMesh) {
    const index = body.morphTargetDictionary?.Breath;
    const delta = index == null ? undefined : body.geometry.morphAttributes.position?.[index];
    if (!delta || !body.geometry.morphTargetsRelative) return undefined;
    const pos = body.geometry.getAttribute('position');
    const cell = 0.015, grid = new Map<string, number[]>();
    const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(delta.getX(i)) + Math.abs(delta.getY(i)) + Math.abs(delta.getZ(i)) < 1e-6) continue;
      const k = key(pos.getX(i), pos.getY(i), pos.getZ(i));
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
    }
    return (x: number, y: number, z: number) => {
      let best = cell * cell, found = -1;
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const i of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
          const d = (pos.getX(i) - x) ** 2 + (pos.getY(i) - y) ** 2 + (pos.getZ(i) - z) ** 2;
          if (d < best) { best = d; found = i; }
        }
      }
      return found < 0 ? null : [delta.getX(found), delta.getY(found), delta.getZ(found)] as const;
    };
  }
  /** realistic-skin's leg weights on one skinned mesh, in its skeleton's bind space */
  function rebalanceLegSkin(mesh: THREE.SkinnedMesh) {
    const geometry = mesh.geometry;
    const pos = geometry.getAttribute('position'), joints = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
    if (!pos || !joints || !weights) return;
    const names = mesh.skeleton.bones.map((b) => (b.userData.name as string | undefined) ?? b.name);
    const bind = new THREE.Matrix4();
    const position = (name: string) => {
      const i = names.indexOf(name);
      if (i < 0) return undefined;
      const p = new THREE.Vector3().setFromMatrixPosition(bind.copy(mesh.skeleton.boneInverses[i]).invert());
      return [p.x, p.y, p.z] as const;
    };
    const points = new Float32Array(pos.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix).toArray(points, i * 3);
    if (rebalanceLimbWeights(points, joints.array as Uint16Array, weights.array as Float32Array, names, position) > 0) {
      joints.needsUpdate = weights.needsUpdate = true;
    }
  }
  function furScaleAttribute(mesh: THREE.SkinnedMesh, bonePos: Record<string, THREE.Vector3>, neckBlend: (x: number, y: number, z: number) => number) {
    const pos = mesh.geometry.getAttribute('position');
    const out = new Float32Array(pos.count).fill(1);
    if (mesh.name.startsWith('LX_Body')) {
      // The opaque body undercoat used to stand ~15 mm above the 2-6 mm paw curves, hiding them like smooth mittens.
      // Its solid layers use furScale squared, so a short 0.42 scale keeps the skin covered while the paw hairs emerge.
      // Up the lower leg too: its strands are long enough (16-34 mm) but groomed flat down the leg, inside the 15 mm of
      // undercoat, so the shin was a smooth sleeve. Eased back to the full undercoat by 20 cm (higher, it thinned the belly).
      for (let i = 0; i < pos.count; i++) {
        const paw = 1 - THREE.MathUtils.smoothstep(pos.getY(i), 0.055, 0.2);
        out[i] = 1 - 0.58 * paw;
      }
    } else if (mesh.name.startsWith('LX_Head')) {
      const v = new THREE.Vector3();
      const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
      const local = (p?: THREE.Vector3) => (p ? p.clone().applyMatrix4(inv) : null);
      const eyes = [local(bonePos.EyeL), local(bonePos.EyeR)].filter(Boolean) as THREE.Vector3[];
      const nose = local(bonePos.Nose);
      const nrm = mesh.geometry.getAttribute('normal');
      const nv = new THREE.Vector3();
      const toWorldDir = new THREE.Matrix3().setFromMatrix4(mesh.matrixWorld);
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        let s = 1;
        // the front of the face keeps a shorter coat (the review renders' features are crisp); cheeks and crown stay
        // full. Only a little shorter since the undercoat is short itself: at .3 its edge ringed the eyes and muzzle
        // with a visible circular seam
        if (nrm) {
          nv.fromBufferAttribute(nrm, i).applyMatrix3(toWorldDir).normalize();
          s = Math.min(s, THREE.MathUtils.lerp(1, 0.7, THREE.MathUtils.smoothstep(nv.z, 0.35, 0.8)));
          // the cheeks: the sides of the lower head carry the long fluff that makes the kitten's head round
          const side = THREE.MathUtils.smoothstep(Math.abs(nv.x), 0.45, 0.85) * THREE.MathUtils.smoothstep(-nv.y, -0.2, 0.3);
          s *= 1 + 0.4 * side;
        }
        // The nearest head vertices start about 4.2 cm from each Eye bone. The previous 4.2-6.6 cm ramp left most
        // of that visible ring nearly bare, exposing a flat brown patch of head skin around the short lid coat.
        // Start the ramp inside the head's actual eye opening and keep a little undercoat at its edge.
        for (const e of eyes) s = Math.min(s, 0.28 + 0.72 * THREE.MathUtils.smoothstep(v.distanceTo(e), 0.037, 0.061));
        if (nose) s = Math.min(s, THREE.MathUtils.clamp((v.distanceTo(nose) - 0.012) / 0.05, 0.25, 1));
        out[i] = s * neckShellScale(neckBlend(v.x, v.y, v.z));
      }
    }
    mesh.geometry.setAttribute('furScale', new THREE.BufferAttribute(out, 1));
  }

  // The chin. Under the mouth the head mesh steps back ~2 cm and runs in a straight slope to the throat, and down its
  // middle it is a groove 1.5-2 cm behind the jaw either side: no chin in profile, a hollow under the mouth from the front
  // (with the lips' own parts hidden while the mouth is closed, nothing covers it). Wherever the surface lies behind a
  // rounded chin - CHIN_PROFILE down the middle, falling away to the sides - it is brought out to it; what already
  // stands in front of it is left alone.
  const CHIN_PROFILE: [number, number][] = [[0.388, 0.360], [0.395, 0.374], [0.400, 0.384], [0.405, 0.396], [0.410, 0.408],
    [0.415, 0.421], [0.420, 0.433], [0.425, 0.442], [0.430, 0.448], [0.435, 0.452], [0.440, 0.455], [0.449, 0.455]];
  function chinLift(x: number, y: number, z: number) {
    const first = CHIN_PROFILE[0], last = CHIN_PROFILE[CHIN_PROFILE.length - 1];
    if (y <= first[0] || y >= last[0] || z < 0.33) return 0;
    let k = 1;
    while (CHIN_PROFILE[k][0] < y) k++;
    const [y0, z0] = CHIN_PROFILE[k - 1], [y1, z1] = CHIN_PROFILE[k];
    const target = z0 + (z1 - z0) * (y - y0) / (y1 - y0) - 3.0 * x * x;
    const fade = THREE.MathUtils.smoothstep(y, first[0], first[0] + 0.01) * (1 - THREE.MathUtils.smoothstep(y, last[0] - 0.004, last[0]));
    const side = 1 - THREE.MathUtils.smoothstep(Math.abs(x), 0.045, 0.085);
    return Math.max(0, target - z) * fade * side * THREE.MathUtils.smoothstep(z, 0.33, 0.37);
  }
  function roundChin(head: THREE.Mesh, asset: GroomAsset | null) {
    const pos = head.geometry.getAttribute('position') as THREE.BufferAttribute;
    const nrm = head.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const step = 0.0002;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const dz = chinLift(x, y, z);
      if (dz === 0) continue;
      // Inverse transpose of the local z displacement, preserving the exported smooth normals.
      const dx = (chinLift(x + step, y, z) - chinLift(x - step, y, z)) / (2 * step);
      const dy = (chinLift(x, y + step, z) - chinLift(x, y - step, z)) / (2 * step);
      const zz = 1 + (chinLift(x, y, z + step) - chinLift(x, y, z - step)) / (2 * step);
      const nz = nrm.getZ(i) / zz;
      const normal = new THREE.Vector3(nrm.getX(i) - dx * nz, nrm.getY(i) - dy * nz, nz).normalize();
      nrm.setXYZ(i, normal.x, normal.y, normal.z);
      pos.setZ(i, z + dz);
    }
    pos.needsUpdate = true;
    nrm.needsUpdate = true;
    head.geometry.computeBoundingSphere();
    if (!asset) return;
    for (const part of asset.spec.parts) {
      if (!part.name.endsWith('_LX_Head')) continue;
      const data = new Float32Array(asset.bytes, part.positions.offset, part.positions.count);
      for (let strand = 0; strand < part.strands; strand++) {
        const start = strand * part.points * 3;
        const dz = chinLift(data[start], data[start + 1], data[start + 2]);
        if (dz === 0) continue;
        for (let point = 0; point < part.points; point++) data[start + point * 3 + 2] += dz;
      }
    }
  }
  // The head's paint round the mouth: dark vertex colours along the mouth line and down the philtrum (0.1-0.4 among the
  // muzzle's 0.87). The mesh is sparse there - a few vertices per 8 mm - so each dark vertex spread into a ragged dark
  // triangle, and the closed mouth read as a crack from the nose down and a torn mouth line. The lip parts draw the
  // mouth; the paint under and round them goes to the muzzle's own colour, and so do the strands growing from it.
  function mouthPaintShare(x: number, y: number, z: number) {
    const across = Math.hypot(x / 0.03, (y - 0.453) / 0.017);
    // the mouth line itself keeps a soft trace of its paint (fully cleared, the cat had no mouth); the philtrum, from it
    // up to the nose, is cleared
    const keep = THREE.MathUtils.lerp(0.62, 1, THREE.MathUtils.smoothstep(y, 0.452, 0.458));
    return (1 - THREE.MathUtils.smoothstep(across, 0.7, 1.0)) * THREE.MathUtils.smoothstep(z, 0.415, 0.435) * keep;
  }
  function cleanMouthPaint(head: THREE.Mesh, asset: GroomAsset | null) {
    const pos = head.geometry.getAttribute('position'), col = head.geometry.getAttribute('color');
    if (!pos || !col) return;
    // the muzzle round the region: its light vertices, averaged
    const ref = [0, 0, 0];
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const share = mouthPaintShare(x, y, z), near = mouthPaintShare(x * 0.6, 0.453 + (y - 0.453) * 0.6, z);
      if (share > 0 || near <= 0) continue;
      const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
      if (0.2126 * r + 0.7152 * g + 0.0722 * b < 0.6) continue;
      ref[0] += r; ref[1] += g; ref[2] += b; n++;
    }
    if (!n) return;
    for (let c = 0; c < 3; c++) ref[c] /= n;
    for (let i = 0; i < pos.count; i++) {
      const share = mouthPaintShare(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (share <= 0) continue;
      col.setXYZ(i, THREE.MathUtils.lerp(col.getX(i), ref[0], share), THREE.MathUtils.lerp(col.getY(i), ref[1], share), THREE.MathUtils.lerp(col.getZ(i), ref[2], share));
    }
    col.needsUpdate = true;
    if (!asset) return;
    for (const part of asset.spec.parts) {
      if (!part.name.endsWith('_LX_Head')) continue;
      const data = new Float32Array(asset.bytes, part.positions.offset, part.positions.count);
      const colors = new Float32Array(asset.bytes, part.colors.offset, part.colors.count);
      // the strands' own muzzle colour (their colour space is the groom's): light strands rooted round the region
      const sref = [0, 0, 0];
      let sn = 0;
      const shares = new Float32Array(part.strands);
      for (let strand = 0; strand < part.strands; strand++) {
        const r = strand * part.points * 3;
        const x = data[r], y = data[r + 1], z = data[r + 2];
        shares[strand] = mouthPaintShare(x, y, z);
        if (shares[strand] > 0 || mouthPaintShare(x * 0.6, 0.453 + (y - 0.453) * 0.6, z) <= 0) continue;
        const tip = r + (part.points - 1) * 3;
        if (0.2126 * colors[tip] + 0.7152 * colors[tip + 1] + 0.0722 * colors[tip + 2] < 0.5) continue;
        for (let c = 0; c < 3; c++) sref[c] += colors[tip + c];
        sn++;
      }
      // the strands rooted right on the mouth's line part from it, or the muzzle's white hairs lie across it (not on
      // the philtrum: parted there, the bare undercoat down the middle was a crack from the nose to the mouth)
      const radii = new Float32Array(asset.bytes, part.radii.offset, part.radii.count);
      for (let strand = 0; strand < part.strands; strand++) {
        const r = strand * part.points * 3;
        if (data[r + 2] < MOUTH.frontFrom || mouthLineDistance(data[r], data[r + 1]) > 0.0018) continue;
        radii.fill(0, strand * part.points, (strand + 1) * part.points);
      }
      if (!sn) continue;
      for (let c = 0; c < 3; c++) sref[c] /= sn;
      for (let strand = 0; strand < part.strands; strand++) {
        const share = shares[strand];
        if (share <= 0) continue;
        for (let point = 0; point < part.points; point++) for (let c = 0; c < 3; c++) {
          const k = (strand * part.points + point) * 3 + c;
          colors[k] += (sref[c] - colors[k]) * share;
        }
      }
    }
  }

  /** The engine owns where the cat is: keep a travelling clip's vertical bounce, drop its march across the floor. */
  function stripTravel(clip: THREE.AnimationClip): number {
    const track = clip.tracks.find((t) => t instanceof THREE.VectorKeyframeTrack && /(^|\b)Root\.position$/.test(t.name));
    if (!track) return 0;
    const v = track.values;
    const n = v.length / 3;
    if (n < 2) return 0;
    const d = new THREE.Vector3(v[(n - 1) * 3] - v[0], v[(n - 1) * 3 + 1] - v[1], v[(n - 1) * 3 + 2] - v[2]);
    const travel = d.length();
    if (travel < 1e-4) return 0;
    d.normalize();
    for (let i = 0; i < n; i++) {
      const dx = v[i * 3] - v[0], dy = v[i * 3 + 1] - v[1], dz = v[i * 3 + 2] - v[2];
      const along = dx * d.x + dy * d.y + dz * d.z;
      v[i * 3] -= along * d.x;
      v[i * 3 + 1] -= along * d.y;
      v[i * 3 + 2] -= along * d.z;
    }
    return travel;
  }

  // Next to the model: lids.glb (the four lids with their shape keys, which the main export loses to their Solidify) and
  // face.json (the face controls and expressions). Either missing leaves a cat with a resting face, and says why.
  const assetDir = options.assetUrl.replace(/[^/]*$/, '');
  const loader = new GLTFLoader();
  const ready = Promise.all([
    loader.loadAsync(options.assetUrl),
    loader.loadAsync(`${assetDir}lids.glb`).catch((e: unknown) => { faceProblems.push(`lids.glb: ${String(e)}`); return null; }),
    fetch(`${assetDir}face.json`)
      .then((r) => (r.ok ? (r.json() as Promise<FaceSpec>) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .catch((e: unknown) => { faceProblems.push(`face.json: ${String(e)}`); return null; }),
    options.originalGroom === false ? Promise.resolve(null) : loadGroom(assetDir),
    // clips.glb: clips re-made after the model's export (the round ZZZ4 walk), same skeleton - swapped in by name
    fetch(`${assetDir}clips.glb`, { method: 'HEAD' })
      .then((r) => (r.ok ? loader.loadAsync(`${assetDir}clips.glb`) : null))
      .catch((e: unknown) => { faceProblems.push(`clips.glb: ${String(e)}`); return null; }),
  ]).then(([gltf, lids, spec, groomAsset, clipPatch]) => {
    if (disposed) return;
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const required = /^(LX_IrisLayer\.[LR]|LX_Tex_Nose|LX_Tex_Ear)$/;
    const seenMaterials = new Set<THREE.Material>();
    root.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      for (const material of ([] as THREE.Material[]).concat((o as THREE.Mesh).material)) {
        if (seenMaterials.has(material) || !required.test(material.name)) continue;
        seenMaterials.add(material);
        const map = (material as THREE.MeshStandardMaterial).map;
        textureAudit.push({ material: material.name, texture: map?.name ?? null });
      }
    });
    const missingTextures = textureAudit.filter((m) => m.texture == null);
    if (missingTextures.length) throw new Error(`真实猫贴图加载失败：${missingTextures.map((m) => m.material).join('、')}`);
    if (lids) {
      const byName = new Map<string, THREE.Mesh>();
      root.traverse((o) => { if ((o as THREE.Mesh).isMesh) byName.set((o.userData.name as string | undefined) ?? o.name, o as THREE.Mesh); });
      lids.scene.traverse((o) => {
        const patch = o as THREE.Mesh;
        if (!patch.isMesh) return;
        const target = byName.get((patch.userData.name as string | undefined) ?? patch.name);
        // same armature, same joint order (both exports skin all 95 bones): the patch geometry drops straight in
        if (target) {
          target.geometry.dispose();
          target.geometry = patch.geometry;
          // the key names come from the GLB's extras.targetNames (GLTFLoader), not from the geometry
          target.morphTargetDictionary = { ...patch.morphTargetDictionary };
          target.morphTargetInfluences = (patch.morphTargetInfluences ?? []).slice();
        }
        for (const mat of ([] as THREE.Material[]).concat(patch.material)) { (mat as THREE.MeshStandardMaterial).map?.dispose(); mat.dispose(); }
      });
    }
    const lidMeshes: THREE.SkinnedMesh[] = [];
    root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && /^LX_Lid(Upper|Lower)\./.test((o.userData.name as string | undefined) ?? '')) lidMeshes.push(o as THREE.SkinnedMesh); });
    const lidFur = lidCoat(lidMeshes, root.getObjectByName('LX_Head') as THREE.Mesh | undefined, root, groomAsset ? LID_UNDERCOAT_LIFT : LID_COAT_LIFT);
    const eyes = lidMeshes.length ? eyeFrames(root, lidMeshes[0]) : null;
    lidTuckGlsl = lidTuck(eyes);
    if (eyes) for (const lid of lidMeshes) raiseShutLid(lid, eyes[/\.L$/.test((lid.userData.name as string | undefined) ?? '') ? 0 : 1]);
    const head = root.getObjectByName('LX_Head') as THREE.Mesh | undefined;
    if (head) {
      cleanMouthPaint(head, groomAsset);
      roundChin(head, groomAsset);
      findMouthSeam(head);
      sewMouth(true);
    }
    // Rest pose stands: its height sets the metres -> world units factor, so either style draws the same size.
    const box = new THREE.Box3().setFromObject(root);
    restHeight = Math.max(0.2, box.max.y - box.min.y);
    const sizeOf: Record<string, number> = {};
    root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { const b = new THREE.Box3().setFromObject(o); sizeOf[o.name] = +(b.max.y - b.min.y).toFixed(3); } });
    debugInfo = { restHeight: +restHeight.toFixed(3), box: [box.min.toArray().map((v) => +v.toFixed(3)), box.max.toArray().map((v) => +v.toFixed(3))], tallest: Object.entries(sizeOf).sort((a, b) => b[1] - a[1]).slice(0, 6) };
    modelUnitScale = TARGET_HEIGHT / restHeight;

    const bonePos: Record<string, THREE.Vector3> = {};
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        bones.push(o as THREE.Bone);
        bonePos[o.name.replace(/[._]/g, '')] = o.getWorldPosition(new THREE.Vector3());
        if (o.name === 'Head') headBone = o as THREE.Bone;
        if (o.name === 'Jaw') { jawBone = o as THREE.Bone; jawRest.copy(o.quaternion); }
        if (o.name === 'Pelvis') pelvisBone = o;
        if (o.name === 'Chest') chestBone = o;
      }
    });
    for (let i = 0; i <= 4; i++) {
      const b = root.getObjectByName(`Tail${i}`) as THREE.Bone | undefined;
      if (b?.isBone) tailBones.push(b);
    }
    tailFrame = tailBones.length === 5 ? root : null;
    if (tailFrame) for (let i = 0; i < 5; i++) { tailClipPose[i].copy(tailBones[i].quaternion); tailRest[i].copy(tailBones[i].quaternion); }

    const coat: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      m.castShadow = !/Whisker|Cornea/.test(m.name);
      m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      const name = mat?.name ?? '';
      if (/^LX_(Tooth|Lip|Mouth|Tongue)/.test(m.name)) teeth.push(m);
      if (/^LX_EarFurnish/.test(m.name)) m.material = earTuftMaterial(m.material as THREE.MeshStandardMaterial);
      // The export hands Blender's bump textures over as normal maps: ear_bump, nose_bump, the pads', the tongue's - one
      // grey channel each, read as a normal they point every which way, and the ears came out streaked with hard white
      // lines and black specks. They are height, so they go back to being height.
      if (mat?.normalMap && /_bump$/.test(mat.normalMap.name)) {
        mat.bumpMap = mat.normalMap;
        mat.bumpScale = BUMP_SCALE;
        mat.normalMap = null;
        mat.needsUpdate = true;
      }
      if (/^LX_Whisker/.test(m.name) && (m as THREE.SkinnedMesh).isSkinnedMesh) {
        const whisker = m as THREE.SkinnedMesh;
        const side = whisker.skeleton.bones.some((b) => b.name === 'WhiskerR') ? 1 : 0;
        const uv = whisker.geometry.getAttribute('uv');
        const length = new Float32Array(uv.count);
        for (let i = 0; i < uv.count; i++) length[i] = uv.getX(i);
        whisker.geometry.setAttribute('whiskerLength', new THREE.BufferAttribute(length, 1));
        // The asset already narrows toward its tip; reduce its oversized 1.36 mm root without changing its curve.
        const fiber = new THREE.MeshStandardMaterial({
          color: 0xfff3df, roughness: 0.52, metalness: 0, side: THREE.DoubleSide,
          transparent: true, opacity: WHISKER.opacity, depthWrite: false,
        });
        fiber.onBeforeCompile = (sh) => {
          sh.uniforms.uWhiskerBend = { value: whiskerBends[side] };
          sh.vertexShader = 'attribute float whiskerLength; uniform vec3 uWhiskerBend; varying float vWhiskerLength;\n' + sh.vertexShader
            .replace('#include <begin_vertex>', `#include <begin_vertex>
              vWhiskerLength = whiskerLength;
              transformed -= normal * ((1.0 - ${WHISKER.width.toFixed(3)}) * mix(0.00068, 0.000045, whiskerLength));
              transformed += uWhiskerBend * (whiskerLength * whiskerLength);`);
          sh.fragmentShader = 'varying float vWhiskerLength;\n' + sh.fragmentShader
            .replace('#include <color_fragment>', `#include <color_fragment>
              diffuseColor.a *= (1.0 - smoothstep(${WHISKER.fadeFrom.toFixed(2)}, 1.0, vWhiskerLength));`)
            .replace('#include <opaque_fragment>', `
              // A weak grazing glow catches the warm rim light without turning the fiber into a white wire.
              outgoingLight += vec3(0.16, 0.12, 0.08) * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.0);
              #include <opaque_fragment>`);
        };
        fiber.customProgramCacheKey = () => 'realcat-whisker-v2';
        ownedMaterials.push(fiber);
        m.material = fiber;
        m.receiveShadow = false;
        m.renderOrder = 3;
      } else if (/Iris/i.test(name)) m.material = irisMaterial(mat, name.endsWith('.R') ? 'R' : 'L');
      else if (/Cornea/i.test(name)) {
        const c = new THREE.MeshPhysicalMaterial({
          // (an 8% white film with a clearcoat was tried for the room's reflection: it greyed the pupils over)
          color: 0x000000, roughness: 0.04, transparent: true, opacity: 0.0, specularIntensity: 1,
          envMapIntensity: 1.0, depthWrite: false, premultipliedAlpha: true,
        });
        ownedMaterials.push(c);
        m.material = c;
        m.renderOrder = 2;
      } else if (m.geometry.getAttribute('color')) {
        vertexColorsToLinear(m.geometry);
        const s = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: /Lid/i.test(name) ? 0.85 : 0.9, map: mat?.map ?? null, side: THREE.DoubleSide,
        });
        const lid = /^LX_Lid(Upper|Lower)[LR]$/.test(m.name);
        s.onBeforeCompile = (sh) => {
          sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>${COAT_GRADE}`);
          if (!lid) return;
          // the lid's skin past the eye gives way to the face (LID_TUCK), dithered: it is opaque
          sh.vertexShader = 'varying vec3 vLidRest;\n' + sh.vertexShader.replace('#include <morphtarget_vertex>', '#include <morphtarget_vertex>\n vLidRest = transformed;');
          sh.fragmentShader = 'varying vec3 vLidRest;\n' + lidTuckGlsl + '\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
            if (lidShown(vLidRest) <= fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453)) discard;`);
        };
        s.customProgramCacheKey = () => (lid ? 'realcat-lid-skin-v1' : 'realcat-skin');
        ownedMaterials.push(s);
        m.material = s;
      } else if (mat?.isMaterial) {
        mat.side = THREE.DoubleSide;
        // the mouth's inside: Cycles shades it dark (little light gets in); here it would glow pink when the mouth opens
        if (/MouthPink|Tongue/.test(name) && !mat.userData.shaded) {
          mat.color.multiply(/Tongue/.test(name) ? new THREE.Color(0.62, 0.5, 0.52) : new THREE.Color(0.34, 0.2, 0.22));
          mat.envMapIntensity = 0.3;
          mat.userData.shaded = true;
        }
        // that darkening is the mouth's shadow; the shadow map's own speckles it inside
        if (/Mouth|Tongue|Teeth/.test(name)) m.receiveShadow = false;
      }
      const base = m.name.split('.')[0].replace(/_\d+$/, '');
      if ((m as THREE.SkinnedMesh).isSkinnedMesh && FUR[base]) coat.push(m as THREE.SkinnedMesh);
    });
    coatBody = coat.find((m) => m.morphTargetDictionary?.Breath != null) ?? null;
    const body = coat.find((m) => m.name.startsWith('LX_Body'));
    const neckBlend = body ? createNeckBlend(body.geometry.getAttribute('position').array) : () => 0;
    if (groomAsset) {
      if (!coat.length) throw new Error('Groom needs a skinned coat mesh');
      groom = createGroom(groomAsset, coat[0], root, {
        breath: breathLookup(coat[0]),
        eyes: eyes?.map((e) => ({ centre: e.centre.toArray(), axis: e.axis.toArray() })),
        neckBlend,
        // the muzzle's hairs part along the closed mouth's line (drawn in the undercoat), or they lay across it
        part: `${MOUTH_GLSL}
          ${lidTuckGlsl}
          float groomPart(vec3 rest) {
            // the lids' strands past the eye give way to the face's (LID_TUCK)
            float keep = vGroomLid > 0.5 ? lidShown(rest) : 1.0;
            if (rest.z < ${MOUTH.frontFrom}) return keep;
            vec2 md = mouthDistance(rest);
            return keep * smoothstep(${MOUTH.width}, ${MOUTH.width * 3.5}, md.x);
          }`,
      });
      ownedMaterials.push(...groom.materials);
      for (const mesh of [...groom.meshes, ...groom.children]) coat[0].parent!.add(mesh);
    }
    // the legs move as one piece with their thighs (realistic-skin): the skin, its shells (they share its geometry) and
    // the strands growing from it, all the same way
    for (const mesh of [...coat, ...(groom?.meshes ?? [])]) rebalanceLegSkin(mesh);
    // With the original curves the shells are only their solid undercoat: the review render's round, dense volume (the
    // curves alone are too sparse at desktop size - a grey haze round a thin body), the curves drawing the outline.
    const layers = groom ? UNDERCOAT_LAYERS : shellCount;
    for (const base of coat) {
      const f = FUR[base.name.split('.')[0].replace(/_\d+$/, '')];
      furScaleAttribute(base, bonePos, neckBlend);
      const total = groom ? layers + OUTER_LAYERS : layers;
      for (let i = 1; i <= total; i++) {
        const outer = groom && i > layers;
        const t = !groom ? i / shellCount : outer ? UNDERCOAT_REACH + (1 - UNDERCOAT_REACH) * (i - layers) / OUTER_LAYERS : UNDERCOAT_REACH * i / layers;
        const s = new THREE.SkinnedMesh(base.geometry, shellMaterial(f.len, f.den, t, groom != null && !outer, groom != null));
        s.bind(base.skeleton, base.bindMatrix);
        s.morphTargetInfluences = base.morphTargetInfluences;
        s.morphTargetDictionary = base.morphTargetDictionary;
        s.position.copy(base.position);
        s.quaternion.copy(base.quaternion);
        s.scale.copy(base.scale);
        s.frustumCulled = false;
        s.receiveShadow = true;
        base.parent!.add(s);
      }
    }
    // With the original groom the lids grow the same opaque undercoat as the face round them, under their own strands:
    // bare, a closed lid was a smooth flat brown disc, cut off where it met the face's undercoat - a patch over the eye.
    // Same shading as the face's (the undercoat's reach), just short.
    const lidLayers = groom ? LID_UNDERCOAT_LAYERS : Math.ceil(shellCount / 2);
    for (const lid of lidFur) {
      for (let i = 1; i <= lidLayers; i++) {
        const s = new THREE.SkinnedMesh(lid.geometry, groom
          ? shellMaterial(LID_FUR.len / UNDERCOAT_REACH, LID_FUR.den, UNDERCOAT_REACH * i / lidLayers, true, true, true)
          : shellMaterial(LID_FUR.len, LID_FUR.den, i / lidLayers, false, false, true));
        s.bind(lid.skeleton, lid.bindMatrix);
        // the same influences array: a blink closes the lid's coat with it
        s.morphTargetInfluences = lid.morphTargetInfluences;
        s.morphTargetDictionary = lid.morphTargetDictionary;
        s.position.copy(lid.position);
        s.quaternion.copy(lid.quaternion);
        s.scale.copy(lid.scale);
        s.frustumCulled = false;
        lid.parent!.add(s);
      }
    }

    if (spec) {
      // before any clip has posed the bones: the face reads their rest frames
      faceRig = createFaceRig(spec, root, irisUniforms);
      faceSpec = spec;
      if (faceRig.missing.length) faceProblems.push(`not in the model: ${faceRig.missing.join(', ')}`);
    }
    mixer = new THREE.AnimationMixer(root);
    const patched = new Set((clipPatch?.animations ?? []).map((c) => c.name));
    for (const clip of [...gltf.animations.filter((c) => !patched.has(c.name)), ...(clipPatch?.animations ?? [])]) {
      if (TRAVELLING.includes(clip.name)) strides[clip.name] = stripTravel(clip);
      actions[clip.name] = mixer.clipAction(clip);
    }
    catRoot.add(root);
    model = root;
    catRoot.scale.setScalar(effectiveScale());
    locomotion = createLocomotion(root);
    play('Idle');
    loaded = true;
  });

  /** How long a host action plays (s): a held pose's hold plus its getting down (see startAction), else the clip. */
  function actionSeconds(id: string, clip: string) {
    const loop = LOOPING.has(clip);
    return loop || SETTLE_CLIPS[clip]
      ? (ACTION_HOLD_MS[id] ?? 4000) / 1000 + settleSeconds(clip) + (clip === 'Sleep' ? settleSeconds('LieDown') + CURL_SECONDS : 0)
      : actions[clip].getClip().duration;
  }
  function startAction(id: string, clip: string, seconds = actionSeconds(id, clip)) {
    // curling up starts by lying down (viaLying takes it on from there)
    if (clip === 'Sleep' && currentName !== 'Sleep' && actions.LieDown) { lyingVia = 'down'; play('LieDown', true); }
    else play(clip, !LOOPING.has(clip));
    // a held pose is held 4 s once reached (getting down to it, and curling up by way of lying down, take their own time)
    oneShot = { id, clip, endsAt: elapsed + seconds };
  }
  // a set piece's staging (ACTION_STAGING, FRONT_FACING_CLIPS): turning to its mark, then (started) playing
  let staged: { id: string; clip: string; yaw: number; started: boolean; seconds?: number } | null = null;
  /** Play `id` (as `clip`), turning to its mark first if it has one. */
  function stageOrStart(id: string, clip: string, seconds?: number) {
    const stage = ACTION_STAGING[id];
    const yaw = stage ? (Math.sign(bodyYaw) || 1) * stage.yaw : FRONT_FACING_CLIPS.has(clip) ? 0 : null;
    if (yaw == null || Math.abs(Math.atan2(Math.sin(yaw - bodyYaw), Math.cos(yaw - bodyYaw))) < 0.06) {
      staged = stage ? { id, clip, yaw: bodyYaw, started: true, seconds } : null;
      startAction(id, clip, seconds);
      return;
    }
    // turn first (the render loop starts it once turned)
    staged = { id, clip, yaw, started: false, seconds };
    oneShot = null;
  }
  /** Seconds a settled clip takes to get up again (0 for any other clip). */
  function riseSeconds(clip: string) {
    const settle = SETTLE_CLIPS[clip];
    const duration = actions[clip]?.getClip().duration ?? 0;
    return settle ? (settle.rise === 'reverse' ? settle.hold : 1 - settle.hold) * duration / settle.pace : 0;
  }
  /** Seconds from standing to settled (0 for a clip that does not settle). */
  function settleSeconds(clip: string) {
    const settle = SETTLE_CLIPS[clip];
    return settle ? settle.hold * (actions[clip]?.getClip().duration ?? 0) / settle.pace : 0;
  }
  // the way into and out of Sleep (see CURL_SECONDS): 'down' while lying down to curl up, 'up' while getting up after
  let lyingVia: 'down' | 'up' | null = null;
  /** The clip to play for `want`, by way of lying down when it is Sleep or comes after it. */
  function viaLying(want: string, hurry: boolean): string {
    const lie = actions.LieDown, settle = SETTLE_CLIPS.LieDown;
    if (!lie || !actions.Sleep || (oneShot && oneShot.clip === 'LieDown')) { lyingVia = null; return want; }
    const settledAt = settle.hold * lie.getClip().duration;
    if (want === 'Sleep') {
      if (currentName === 'Sleep') return 'Sleep';
      if (currentName === 'LieDown' && lyingVia === 'down' && lie.time >= settledAt - 1e-3) {
        lyingVia = null;
        play('Sleep', false, CURL_SECONDS);
        return 'Sleep';
      }
      if (currentName !== 'LieDown' || lyingVia !== 'down') { lyingVia = 'down'; play('LieDown', true); }
      lie.timeScale = lie.time >= settledAt - 1e-3 ? 0 : settle.pace;
      if (lie.time > settledAt) lie.time = settledAt;
      return 'LieDown';
    }
    if (currentName === 'Sleep') {
      // uncurl back into lying, then get up from it
      lyingVia = 'up';
      play('LieDown', true, CURL_SECONDS);
      lie.time = settledAt;
      lie.timeScale = 0;
      return 'LieDown';
    }
    if (currentName === 'LieDown' && lyingVia) {
      if (lyingVia === 'down') lyingVia = 'up';
      // the curl fades out first, then the body gets up
      const uncurled = !actions.Sleep.isRunning() || actions.Sleep.getEffectiveWeight() < 0.02;
      lie.paused = false;
      lie.timeScale = uncurled ? -settle.pace * (hurry ? 2 : 1) : 0;
      if (lie.time > 0.02) return 'LieDown';
      lyingVia = null;
    }
    return want;
  }
  function play(name: string, once = false, fade = CROSSFADE_SECONDS) {
    const next = actions[name];
    if (!next || (next === current && !once)) return false;
    const phase = current ? locomotionTransitionPhase(currentName, name, current.time / current.getClip().duration) : 0;
    next.reset();
    next.time = phase * next.getClip().duration;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.timeScale = 1;
    next.play();
    if (current && current !== next) current.crossFadeTo(next, fade, false);
    current = next;
    currentName = name;
    return true;
  }

  // --- fitted canvas (as renderer.ts) ------------------------------------------------------
  const canvasRect = { x: 0, y: 0, width: 0, height: 0 };
  let catRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  let shrinkWantedSince: number | null = null;
  let elapsed = 0;
  const FIT_PADDING_PX = 10;
  const FIT_QUANTUM_PX = 64;
  const FIT_HEADROOM = 1.2;
  const bonePoint = new THREE.Vector3();

  /** Screen rect of the posed cat: every bone, padded by the coat and the ears' and paws' reach past their bones. */
  function measureDrawnRect() {
    const rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    const padPx = (0.09 * effectiveScale()) / unitsPerPixel;
    for (const b of bones) {
      b.getWorldPosition(bonePoint);
      const s = worldToScreen(bonePoint);
      rect.x0 = Math.min(rect.x0, s.x - padPx);
      rect.x1 = Math.max(rect.x1, s.x + padPx);
      rect.y0 = Math.min(rect.y0, s.y - padPx);
      rect.y1 = Math.max(rect.y1, s.y + padPx);
    }
    // the contact shadow
    const sx = worldToScreen(shadow.position);
    const r = (shadow.scale.x * 0.5) / unitsPerPixel;
    rect.x0 = Math.min(rect.x0, sx.x - r);
    rect.x1 = Math.max(rect.x1, sx.x + r);
    rect.y1 = Math.max(rect.y1, sx.y + r * 0.5);
    return rect;
  }
  // The toy the life engine says exists, if any - followed, never set: render() mounts and unmounts it from state.toy.
  let toyProp: ToyProp | null = null;
  let toyKind: ToyKind | null = null;
  function removeToy() {
    if (!toyProp) return;
    scene.remove(toyProp.object);
    if (toyProp.worldLayer) scene.remove(toyProp.worldLayer);
    toyProp.dispose();
    toyProp = null;
  }
  function updateToy(state: Parameters<Renderer['render']>[0], deltaSeconds: number) {
    const toyState = (state as {
      toy?: { kind: string; position: { x: number; y: number }; velocity: { x: number; y: number }; charge?: number } | null;
    }).toy ?? null;
    // the user's size, not a performance's zoom - the same rule as the voxel cat
    const toyScale = (TARGET_HEIGHT * modelScale) / TOY_UNITS_PER_CAT;
    if (toyState?.kind !== toyKind) {
      removeToy();
      toyKind = (toyState?.kind as ToyKind | undefined) ?? null;
      if (toyKind) {
        toyProp = createToyProp(toyKind);
        scene.add(toyProp.object);
        // world layers are added unscaled and unmoved - see ToyProp.worldLayer
        if (toyProp.worldLayer) scene.add(toyProp.worldLayer);
      }
    }
    if (!toyProp || !toyState) return;
    toyProp.object.scale.setScalar(toyScale);
    toyProp.setWorldScale?.(toyScale);
    // the toy's own anchor height lands exactly on its logical screen point (for the cursor toys: on the pointer)
    toyProp.object.position.copy(screenToWorld(toyState.position.x, toyState.position.y, toyProp.anchorHeight * toyScale));
    toyProp.update(deltaSeconds, Math.hypot(toyState.velocity.x, toyState.velocity.y), toyState.charge ?? 0, {
      x: toyState.velocity.x * worldPerPixelX,
      z: toyState.velocity.y * worldPerPixelZ,
      scale: 1 / Math.max(1e-6, toyScale),
    });
    if ((state as { batted?: boolean }).batted) toyProp.struck?.();
  }
  // On top of the clip's pose: ease toward the playing clip's carriage, then turn each bone about the model's side axis
  // (lift) and up axis (sway), both carried into its parent's frame, root first so every bone builds on the one before.
  // The mixer only writes a bone when its value changes (PropertyMixer.apply), and Tail0/1/4 hold one value through the
  // standing clips - so the clip's pose is kept here and put back before each mixer update (uncarryTail), or the turns
  // would pile up frame on frame.
  const tailClipPose = Array.from({ length: 5 }, () => new THREE.Quaternion());
  const tailRest = Array.from({ length: 5 }, () => new THREE.Quaternion());
  let tailOwnWeight = 0;
  function uncarryTail() {
    if (tailFrame) for (let i = 0; i < 5; i++) tailBones[i].quaternion.copy(tailClipPose[i]);
  }
  const tailAxis = new THREE.Vector3();
  const tailFrameQ = new THREE.Quaternion();
  const tailParentQ = new THREE.Quaternion();
  const tailTurn = new THREE.Quaternion();
  function carryTail(deltaSeconds: number) {
    if (!tailFrame) return;
    const own = oneShot ? TAIL_ACTION_CARRIAGE[oneShot.id] : undefined;
    const pose = own ?? TAIL_CARRIAGE[currentName];
    // in small steps: a long frame must not throw the spring
    const steps = Math.max(1, Math.ceil(deltaSeconds / (1 / 120)));
    const dt = deltaSeconds / steps;
    for (let i = 0; i < 5; i++) {
      const w = 2 * Math.PI * TAIL_SPRING_HZ[i];
      for (let n = 0; n < steps; n++) {
        tailLiftVelocity[i] += (((pose?.lift[i] ?? 0) - tailLift[i]) * w * w - 2 * TAIL_DAMPING * w * tailLiftVelocity[i]) * dt;
        tailLift[i] += tailLiftVelocity[i] * dt;
      }
      tailSway[i] += ((pose?.sway[i] ?? 0) - tailSway[i]) * (1 - Math.exp(-deltaSeconds / 0.5));
    }
    tailPhase = (tailPhase + deltaSeconds * Math.PI * 2 / (pose?.period ?? TAIL_STAND.period)) % (Math.PI * 2);
    tailFrame.getWorldQuaternion(tailFrameQ);
    for (let i = 0; i < 5; i++) tailClipPose[i].copy(tailBones[i].quaternion);
    // an action's own carriage starts from the rest pose, eased in and out
    tailOwnWeight += ((own ? 1 : 0) - tailOwnWeight) * (1 - Math.exp(-deltaSeconds / 0.4));
    if (tailOwnWeight > 1e-3) for (let i = 0; i < 5; i++) tailBones[i].quaternion.slerp(tailRest[i], tailOwnWeight);
    for (let i = 0; i < 5; i++) {
      const bone = tailBones[i];
      bone.parent!.getWorldQuaternion(tailParentQ).invert();
      tailAxis.set(1, 0, 0).applyQuaternion(tailFrameQ).applyQuaternion(tailParentQ);
      bone.quaternion.premultiply(tailTurn.setFromAxisAngle(tailAxis, THREE.MathUtils.degToRad(tailLift[i])));
      tailAxis.set(0, 1, 0).applyQuaternion(tailFrameQ).applyQuaternion(tailParentQ);
      const sway = tailSway[i] * Math.sin(tailPhase - i * TAIL_WAVE_LAG);
      bone.quaternion.premultiply(tailTurn.setFromAxisAngle(tailAxis, THREE.MathUtils.degToRad(sway)));
    }
  }
  // The head on top of the clip: steadied while the cat walks (a cat's head holds still while its body swings under
  // it - the clip's head nodding side to side with every step read as a dazed, wobbling gait) and pitched for the
  // camera. Undone before the mixer: the mixer writes a bone only when its value changes, so on a held pose (sleep)
  // an overlay left in place added up frame after frame.
  const headClipPose = new THREE.Quaternion();
  let headOverlaid = false;
  let headSteady: THREE.Quaternion | null = null;
  const rootQ = new THREE.Quaternion(), headQ = new THREE.Quaternion(), parentQ = new THREE.Quaternion();
  function unoverlayHead() {
    if (headBone && headOverlaid) headBone.quaternion.copy(headClipPose);
    headOverlaid = false;
  }
  function overlayHead(dt: number, moving: boolean) {
    if (!headBone?.parent) return;
    headClipPose.copy(headBone.quaternion);
    headOverlaid = true;
    headBone.parent.updateWorldMatrix(true, false);
    catRoot.getWorldQuaternion(rootQ);
    // the head relative to the body's facing, and a slow average of it: what the head would hold without the steps
    const relative = headBone.getWorldQuaternion(headQ).premultiply(rootQ.clone().invert());
    headSteady ??= relative.clone();
    headSteady.slerp(relative, 1 - Math.exp(-Math.max(0, dt) / HEAD_STEADY_SECONDS));
    let gait = 0;
    for (const name of ['Walk', 'Run']) if (actions[name]?.isRunning()) gait += actions[name].getEffectiveWeight();
    if (gait > 0.001) {
      relative.slerp(headSteady, HEAD_STEADY_SHARE * Math.min(1, gait));
      headBone.quaternion.copy(headBone.parent.getWorldQuaternion(parentQ).invert().multiply(relative.premultiply(rootQ)));
    }
    if (moving && currentName === 'Walk' && current) {
      // Apply the small contact nod after gaze stabilization, so the eyes do not inherit the full torso bounce.
      const phase = current.time / current.getClip().duration;
      headBone.rotation.x += KITTEN_WALK.headNod * Math.cos(4 * Math.PI * phase - .2 * Math.PI) * current.getEffectiveWeight();
    }
    if (cameraHeadPitch) headBone.rotation.x += cameraHeadPitch;
  }
  function animateWhiskers(seconds: number, cursor: { x: number; y: number } | null) {
    if (!headBone) return;
    headBone.getWorldQuaternion(currentHeadQ);
    const continuous = whiskersPrimed && seconds > 0 && seconds <= 0.25;
    const yawRate = continuous
      ? Math.max(-4, Math.min(4, 2 * headTurnQ.copy(previousHeadQ).invert().multiply(currentHeadQ).y
        * Math.sign(headTurnQ.w) / seconds)) : 0;
    previousHeadQ.copy(currentHeadQ);
    whiskersPrimed = true;
    inverseHeadQ.copy(currentHeadQ).invert();
    localAir.set(...(lastAir?.wind ?? [0, 0, 0])).applyQuaternion(inverseHeadQ);
    let strokeX = 0, strokeY = 0;
    if (cursor && lastAir?.stroke.amount && catRect) {
      headBone.getWorldPosition(bonePoint);
      const head = worldToScreen(bonePoint);
      const reach = STROKE_RADIUS_PX * (performanceScale ?? modelScale) * 1.5;
      const near = Math.max(0, 1 - Math.hypot(cursor.x - head.x, cursor.y - head.y) / reach);
      strokeX = lastAir.stroke.dx * lastAir.stroke.amount * near;
      strokeY = -lastAir.stroke.dy * lastAir.stroke.amount * near;
    }
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      const target: WhiskerVec = [
        localAir.x * WHISKER.breeze + strokeX * WHISKER.stroke,
        localAir.y * WHISKER.breeze + strokeY * WHISKER.stroke,
        whiskerMood(faceName) - sign * yawRate * WHISKER.yawDrag + localAir.z * WHISKER.breeze,
      ];
      whiskerSprings[side] = stepWhiskerSpring(whiskerSprings[side], target, seconds);
      whiskerBends[side].fromArray(whiskerSprings[side].position);
    }
  }
  // A staged set piece's pose over its clip (ACTION_STAGING): the look back over the shoulder, the hind leg raised. Eased
  // in once the action plays and out as it ends. Undone before the mixer, as the head's overlay.
  const stageSaved = new Map<THREE.Object3D, THREE.Quaternion>();
  let stageWeight = 0;
  let stagePose: { look?: boolean; liftHind?: boolean } | null = null;
  const stageAxis = new THREE.Vector3(), stageQ = new THREE.Quaternion(), stageParentQ = new THREE.Quaternion(), stageRootQ = new THREE.Quaternion();
  function unoverlayStage() {
    for (const [bone, q] of stageSaved) bone.quaternion.copy(q);
    stageSaved.clear();
  }
  /** Turn `bone` by `angle` about a world axis (in place, on top of whatever it holds). */
  function turnBone(bone: THREE.Object3D | undefined, axis: THREE.Vector3, angle: number) {
    if (!bone?.parent || Math.abs(angle) < 1e-5) return;
    if (!stageSaved.has(bone)) stageSaved.set(bone, bone.quaternion.clone());
    bone.parent.getWorldQuaternion(stageParentQ).invert();
    stageAxis.copy(axis).applyQuaternion(stageParentQ).normalize();
    bone.quaternion.premultiply(stageQ.setFromAxisAngle(stageAxis, angle));
  }
  function overlayStage(dt: number) {
    const active = staged?.started && oneShot?.id === staged.id && !oneShot.rising ? ACTION_STAGING[staged.id] : null;
    if (active) stagePose = active;
    stageWeight += ((active ? 1 : 0) - stageWeight) * (1 - Math.exp(-Math.max(0, dt) / 0.3));
    if (!stagePose || !model || stageWeight < 1e-3) return;
    const w = stageWeight * stageWeight * (3 - 2 * stageWeight);
    catRoot.getWorldQuaternion(stageRootQ);
    const up = new THREE.Vector3(0, 1, 0);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(stageRootQ);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(stageRootQ);
    if (stagePose.look) {
      // round to the viewer (yaw 0), chest to head
      const turn = THREE.MathUtils.clamp(Math.atan2(Math.sin(-bodyYaw), Math.cos(-bodyYaw)), -LOOK_BACK.most, LOOK_BACK.most) * w;
      for (const name of ['Chest', 'Neck', 'Head']) turnBone(model.getObjectByName(name), up, turn * LOOK_BACK.shares[name]);
    }
    if (stagePose.liftHind) {
      // the hind leg on the viewer's side (its left, -x, when the yaw's sine is positive), out away from the body
      const right = Math.sin(bodyYaw) < 0;
      const out = right ? 1 : -1;
      turnBone(model.getObjectByName('Pelvis'), forward, -out * LEG_LIFT.pelvisRoll * w);
      const upper = model.getObjectByName(right ? 'RearUpper.R' : 'RearUpper.L') ?? model.getObjectByName(right ? 'RearUpperR' : 'RearUpperL');
      const lower = model.getObjectByName(right ? 'RearLower.R' : 'RearLower.L') ?? model.getObjectByName(right ? 'RearLowerR' : 'RearLowerL');
      turnBone(upper, forward, out * LEG_LIFT.out * w);
      turnBone(upper, side, -LEG_LIFT.forward * w);
      turnBone(lower, side, LEG_LIFT.knee * w);
    }
    if (!active && stageWeight < 2e-3) stagePose = null;
  }
  // Petting follows the projected bones, so the same overlay works over Sit, Idle, Loaf and the lying clips. Keep its
  // saved clip pose separate from staging: each layer removes only the rotations it added, in reverse overlay order.
  const petSaved = new Map<THREE.Object3D, THREE.Quaternion>();
  const emptyPet: PetWeights = { head: 0, back: 0, rump: 0, headX: 0, headY: 0, contact: 0 };
  let petTarget: PetWeights = emptyPet;
  const petPose: PetWeights = { ...emptyPet };
  let petRelaxTime = 0;
  let petRelax = 0;
  const petAxis = new THREE.Vector3(), petParentQ = new THREE.Quaternion(), petTurn = new THREE.Quaternion(), petRootQ = new THREE.Quaternion();
  const petHeadPoint = new THREE.Vector3();
  function unoverlayPet() {
    for (const [bone, q] of petSaved) bone.quaternion.copy(q);
    petSaved.clear();
  }
  function turnPetBone(name: string, axis: THREE.Vector3, angle: number) {
    const bone = model?.getObjectByName(name);
    if (!bone?.parent || Math.abs(angle) < 1e-5) return;
    if (!petSaved.has(bone)) petSaved.set(bone, bone.quaternion.clone());
    bone.parent.getWorldQuaternion(petParentQ).invert();
    petAxis.copy(axis).applyQuaternion(petParentQ).normalize();
    bone.quaternion.premultiply(petTurn.setFromAxisAngle(petAxis, angle));
  }
  function samplePet(cursor: { x: number; y: number } | null, enabled: boolean) {
    // no hand moving over the coat, nothing to answer (and no rig to project: this runs whenever the pointer is about)
    if (!cursor || !enabled || !model || !headBone || !chestBone || !pelvisBone || !tailBones[0] || !lastAir || lastAir.stroke.amount < 1e-3) {
      petTarget = emptyPet;
      return;
    }
    const spine = model.getObjectByName('Spine');
    if (!spine) { petTarget = emptyPet; return; }
    model.updateWorldMatrix(true, true);
    const raised = (bone: THREE.Object3D, height: number) => {
      bone.getWorldPosition(bonePoint);
      bonePoint.y += height * effectiveScale();
      return worldToScreen(bonePoint);
    };
    headBone.getWorldPosition(petHeadPoint);
    petHeadPoint.y += 0.12 * effectiveScale();
    petTarget = petWeights(cursor, {
      head: worldToScreen(petHeadPoint),
      chest: raised(chestBone, 0.055), spine: raised(spine, 0.06), pelvis: raised(pelvisBone, 0.055),
      tailRoot: raised(tailBones[0], 0.015),
    }, TARGET_HEIGHT * effectiveScale() / unitsPerPixel, Math.max(0, lastAir.stroke.amount));
  }
  function overlayPet(dt: number, interrupted: boolean) {
    const tau = interrupted ? PET.interrupt : petTarget.contact > 0.01 ? PET.enter : PET.release;
    const k = 1 - Math.exp(-Math.max(0, dt) / tau);
    for (const name of ['head', 'back', 'rump', 'contact'] as const) petPose[name] += (petTarget[name] - petPose[name]) * k;
    if (petTarget.head > 0.01) {
      petPose.headX += (petTarget.headX - petPose.headX) * k;
      petPose.headY += (petTarget.headY - petPose.headY) * k;
    }
    petRelaxTime = petTarget.contact > 0.1 ? Math.min(PET.relaxSeconds, petRelaxTime + dt) : Math.max(0, petRelaxTime - dt * 2);
    petRelax = petPose.contact * petRelaxTime / PET.relaxSeconds;
    if (interrupted || !model || petPose.contact < 1e-3) return;
    catRoot.getWorldQuaternion(petRootQ);
    const up = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(petRootQ);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(petRootQ);
    const head = petPose.head, back = petPose.back, rump = petPose.rump;
    // Neck begins the nuzzle; the smaller counterturn on Head keeps the eyes on the hand.
    turnPetBone('Neck', up, head * petPose.headX * PET.headYaw);
    turnPetBone('Neck', forward, -head * petPose.headX * PET.headRoll);
    turnPetBone('Head', side, head * (PET.headBump - petPose.headY * PET.headPitch));
    // Spread the bend across three trunk joints so a seated or curled kitten does not hinge at one seam.
    turnPetBone('Loin', side, -back * PET.backArch * 0.35);
    turnPetBone('Spine', side, -back * PET.backArch * 0.4);
    turnPetBone('Chest', side, back * PET.backArch * 0.25);
    turnPetBone('Pelvis', side, rump * PET.rumpLift);
    turnPetBone('Tail0', side, rump * PET.tailLift);
    turnPetBone('Tail1', side, rump * PET.tailLift * 0.35);
    turnPetBone('Tail4', side, -rump * PET.tailCurl);
    turnPetBone('Tail4', up, rump * PET.tailTremble * Math.sin(elapsed * 19));
    // Relaxed ears splay a little; the face rig's expression and its ear keys remain underneath.
    // (the loader's names: GLTFLoader drops the dot from Blender's Ear.L)
    turnPetBone('EarL', forward, petRelax * PET.earRelax);
    turnPetBone('EarR', forward, -petRelax * PET.earRelax);
  }
  // Breathing: the clips key the body's Breath shape key (a rise and fall of the flanks and back), but at 4.6 mm on a
  // cat 0.8 tall it is under a pixel at desktop size - a sleeping cat that never breathed. Lying down and asleep it is
  // drawn deeper (BREATH_GAIN), eased in and out, and the strands rise and fall with the skin (realistic-groom). Undone
  // before the mixer: it writes a weight only when its value changes.
  let breathIndex: number | undefined;
  let breathRaw: number | null = null;
  let breathGain = 1;
  function unbreathe() {
    const body = coatBody;
    if (body?.morphTargetInfluences && breathIndex != null && breathRaw != null) body.morphTargetInfluences[breathIndex] = breathRaw;
    breathRaw = null;
  }
  function breathe(dt: number) {
    const body = coatBody;
    if (!body?.morphTargetInfluences) return;
    breathIndex ??= body.morphTargetDictionary?.Breath;
    if (breathIndex == null) return;
    const lying = currentName === 'Sleep' || currentName === 'LieDown' || currentName === 'Loaf' || currentName === 'SideLie';
    breathGain += ((lying ? BREATH_GAIN : 1) - breathGain) * (1 - Math.exp(-Math.max(0, dt) / 0.8));
    breathRaw = body.morphTargetInfluences[breathIndex];
    const purrBreath = petRelax * (PET.breathBase + PET.breathPulse * (0.5 + 0.5 * Math.sin(elapsed * Math.PI * 2 / PET.breathPeriod)));
    body.morphTargetInfluences[breathIndex] = Math.max(breathRaw * breathGain, purrBreath);
    groom?.setBreath(body.morphTargetInfluences[breathIndex]);
  }
  function fitCanvasToFrame() {
    const drawn = measureDrawnRect();
    catRect = drawn;
    // the whole frame while a toy is out: the yarn ball rolls anywhere and the laser's trail is a world layer, and a
    // canvas cropped to the cat would cut both off
    const full = performanceScale != null || toyProp != null;
    const x0 = full ? 0 : Math.max(0, Math.floor(drawn.x0 - FIT_PADDING_PX));
    const y0 = full ? 0 : Math.max(0, Math.floor(drawn.y0 - FIT_PADDING_PX));
    const x1 = full ? width : Math.min(width, Math.ceil(drawn.x1 + FIT_PADDING_PX));
    const y1 = full ? height : Math.min(height, Math.ceil(drawn.y1 + FIT_PADDING_PX));
    const needW = Math.max(1, x1 - x0);
    const needH = Math.max(1, y1 - y0);
    const sized = (need: number, limit: number) => Math.min(limit, Math.ceil((need * FIT_HEADROOM) / FIT_QUANTUM_PX) * FIT_QUANTUM_PX);
    let w = canvasRect.width;
    let h = canvasRect.height;
    if (full) {
      w = width; h = height; shrinkWantedSince = null;
    } else if (needW > w || needH > h) {
      w = Math.max(w, sized(needW, width)); h = Math.max(h, sized(needH, height)); shrinkWantedSince = null;
    } else {
      const fitW = sized(needW, width);
      const fitH = sized(needH, height);
      if (fitW < w * 0.7 || fitH < h * 0.7) {
        shrinkWantedSince ??= elapsed;
        if (elapsed - shrinkWantedSince >= 2) { w = fitW; h = fitH; shrinkWantedSince = null; }
      } else shrinkWantedSince = null;
    }
    const x = Math.floor(Math.min(Math.max((x0 + x1 - w) / 2, 0), Math.max(0, width - w)));
    const y = Math.floor(Math.min(Math.max((y0 + y1 - h) / 2, 0), Math.max(0, height - h)));
    if (w !== canvasRect.width || h !== canvasRect.height) {
      renderer.setSize(w, h, true);
      canvasRect.width = w;
      canvasRect.height = h;
    }
    if (x !== canvasRect.x || y !== canvasRect.y || !renderer.domElement.style.transform) {
      renderer.domElement.style.transform = `translate(${x}px, ${y}px)`;
      canvasRect.x = x;
      canvasRect.y = y;
    }
    camera.setViewOffset(width, height, x, y, w, h);
  }

  // --- motion state -----------------------------------------------------------------------
  let lastPosition: { x: number; y: number } | null = null;
  let velocityX = 0;
  let velocityY = 0;
  let facingAngle = 0;
  let bodyYaw = 0;
  let pivoting = false;
  let settledSince: number | null = null;
  let lastAnchor = { x: 0, y: 0 };
  let contextLost = false;
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; });
  // back, but its image-bitmap textures may not be (they drew black): the host rebuilds the renderer (needsRebuild)
  let contextRestored = false;
  renderer.domElement.addEventListener('webglcontextrestored', () => { contextLost = false; contextRestored = true; });

  const capabilities: RendererCapabilities = { locomotion: true, facing: true, idleAnimation: true, preciseHitTest: true };

  const api: ReadyRenderer = {
    ready,
    capabilities,
    mount(target: HTMLElement) {
      renderer.domElement.dataset.renderStyle = 'realistic';
      target.appendChild(renderer.domElement);
      const st = renderer.domElement.style;
      st.position = 'absolute';
      if (fitCanvas) { st.left = '0'; st.top = '0'; st.willChange = 'transform'; } else st.inset = '0';
      st.pointerEvents = 'none';
    },
    resize(w: number, h: number) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      if (fitCanvas) canvasRect.width = canvasRect.height = 0;
      else renderer.setSize(width, height, true);
      unitsPerPixel = 2.6 / Math.max(width, height);
      applyFrustum();
    },
    setScale(scale: number) {
      modelScale = Math.max(0.05, scale);
      catRoot.scale.setScalar(effectiveScale());
    },
    setCameraPreset(id: string) {
      cameraId = CAMERA_PRESETS.some((p) => p.id === id) ? id : DEFAULT_CAMERA_ID;
    },
    setPerformanceScale(heightFraction: number | null, seconds = 0.6) {
      performanceTau = Math.max(0.05, seconds / 3);
      if (heightFraction == null) {
        if (performanceScale != null) performanceReleasing = true;
        return;
      }
      // the scale at which the standing cat's height fills that fraction of the viewport
      const worldHeight = heightFraction * height * unitsPerPixel * 2;
      performanceTarget = worldHeight / TARGET_HEIGHT;
      performanceScale ??= modelScale;
      performanceReleasing = false;
    },
    playAction(id: string) {
      const clip = ACTION_CLIPS[id] ?? (actions[id] ? id : undefined);
      if (!clip || !actions[clip]) return false;
      stageOrStart(id, clip);
      return true;
    },
    playExpression(requested: string, holdMs = EXPRESSION_HOLD_MS) {
      const name = faceSpec?.expressions[requested] ? requested : EXPRESSION_ALIASES[requested] ?? requested;
      if (!faceRig || !faceSpec?.expressions[name]) return false;
      heldExpression = { name, until: elapsed + Math.max(0, holdMs) / 1000 };
      return true;
    },
    get needsRebuild() { return contextRestored; },
    get playingAction() {
      if (staged && !staged.started) {
        // still turning to its mark: the turn, then the whole action
        const turn = Math.abs(Math.atan2(Math.sin(staged.yaw - bodyYaw), Math.cos(staged.yaw - bodyYaw))) / PIVOT_TURN_RATE;
        return { id: staged.id, remainingMs: 1000 * (turn + actionSeconds(staged.id, staged.clip) + riseSeconds(staged.clip)), legFree: false };
      }
      if (!oneShot) return null;
      const remainingMs = Math.max(0, (oneShot.endsAt - elapsed) * 1000);
      const rising = oneShot.rising ? 0 : riseSeconds(oneShot.clip) * 1000;
      return remainingMs + rising > 0 ? { id: oneShot.id, remainingMs: remainingMs + rising, legFree: false } : null;
    },
    get currentExpression() {
      return faceRig ? wantedExpression() : { name: DEFAULT_EXPRESSION, held: false };
    },
    get headYaw() {
      return 0;
    },
    headScreenPoint() {
      if (!headBone) return { x: lastAnchor.x, y: lastAnchor.y - TARGET_HEIGHT * (performanceScale ?? modelScale) / unitsPerPixel };
      headBone.getWorldPosition(bonePoint);
      bonePoint.y += 0.12 * effectiveScale();
      return worldToScreen(bonePoint);
    },
    rumpScreenPoint() {
      const tailRoot = tailBones[0];
      if (!tailRoot) return { x: lastAnchor.x, y: lastAnchor.y - 0.35 * TARGET_HEIGHT * (performanceScale ?? modelScale) / unitsPerPixel };
      // just under the root of the tail, on the cat's own down (it may be squatting, or have a leg up)
      tailRoot.getWorldPosition(bonePoint);
      catRoot.getWorldQuaternion(stageRootQ);
      bonePoint.addScaledVector(new THREE.Vector3(0, -1, -0.25).normalize().applyQuaternion(stageRootQ), 0.035 * TARGET_HEIGHT * effectiveScale());
      return worldToScreen(bonePoint);
    },
    screenExtent() {
      if (!catRect) {
        const h = (TARGET_HEIGHT * (performanceScale ?? modelScale)) / unitsPerPixel;
        return { above: h, below: h * 0.1, halfWidth: h * 0.6 };
      }
      return {
        above: Math.max(0, lastAnchor.y - catRect.y0),
        below: Math.max(0, catRect.y1 - lastAnchor.y),
        halfWidth: Math.max(lastAnchor.x - catRect.x0, catRect.x1 - lastAnchor.x, 0),
      };
    },
    describeCapabilities() {
      const torso = model?.getObjectByName('Spine')?.getWorldPosition(new THREE.Vector3());
      return {
        style: 'realistic',
        debug: debugInfo,
        textures: textureAudit,
        fur: groom ? { mode: 'original-curves', strands: groom.meshes.reduce((n, m) => n + m.geometry.getAttribute('position').count / 12, 0), parts: groom.meshes.length, density: +groom.density.toFixed(2),
          air: lastAir && { wind: +Math.hypot(...lastAir.wind).toFixed(3), gust: +lastAir.gust.toFixed(2), stroke: +lastAir.stroke.amount.toFixed(3) } }
          : { mode: 'shells', layers: shellCount },
        animation: { elapsed: +elapsed.toFixed(3), clipTime: current ? +current.time.toFixed(3) : null, fps: +(1 / frameSeconds).toFixed(1), drawCalls: renderer.info.render.calls, triangles: renderer.info.render.triangles },
        torsoScreenPoint: torso ? worldToScreen(torso) : null,
        // live gait numbers: the engine's ground speed against what the playing clip covers at natural speed
        gait: {
          clip: currentName, timeScale: current ? +current.timeScale.toFixed(2) : null,
          speedPx: +Math.hypot(velocityX, velocityY).toFixed(1),
          yaw: +bodyYaw.toFixed(3), facing: +facingAngle.toFixed(3), turnRate: +steeringTurnRate.toFixed(3),
          groundSpeed: +groundSpeed.toFixed(4),
          animatedGroundSpeed: current && strides[currentName] ? +(strides[currentName] * (currentName === 'Walk' ? walkStrideScale : 1) * effectiveScale() / current.getClip().duration * current.timeScale).toFixed(4) : 0,
          worldPerPixel: [+worldPerPixelX.toFixed(5), +worldPerPixelZ.toFixed(5)], effectiveScale: +effectiveScale().toFixed(4),
          strides: Object.fromEntries(Object.entries(strides).map(([k, v]) => [k, { metres: +v.toFixed(3), seconds: +(actions[k]?.getClip().duration ?? 0).toFixed(3) }])),
        },
        clips: Object.keys(actions),
        actions: Object.keys(ACTION_CLIPS).filter((id) => actions[ACTION_CLIPS[id]]),
        expressions: faceRig && faceSpec
          ? [...Object.keys(faceSpec.expressions), ...Object.keys(EXPRESSION_ALIASES).filter((n) => !faceSpec!.expressions[n] && faceSpec!.expressions[EXPRESSION_ALIASES[n]])]
          : [],
        faceProblems,
        cameras: CAMERA_PRESETS.map((p) => ({ id: p.id, name: p.name })),
      };
    },
    locomotionPace() {
      return comfortableWalkPace(strides.Walk ?? 0, actions.Walk?.getClip().duration ?? 0, effectiveScale(), worldPerPixelX, worldPerPixelZ, facingAngle);
    },
    sprintPace() {
      return sprintPace(strides.Run ?? 0, actions.Run?.getClip().duration ?? 0, effectiveScale(), worldPerPixelX, worldPerPixelZ, facingAngle);
    },
    render(state, deltaSeconds, cursor) {
      elapsed += deltaSeconds;
      if (deltaSeconds > 0) frameSeconds += (deltaSeconds - frameSeconds) * .08;
      groom?.update(elapsed, renderer.domElement.height);
      groom?.setDensity(Math.max(GROOM_MIN_DENSITY, TARGET_HEIGHT * effectiveScale() / unitsPerPixel * renderer.getPixelRatio() / GROOM_FULL_DENSITY_PX));
      lastAnchor = { x: state.position.x, y: state.position.y };

      if (performanceScale != null) {
        const target = performanceReleasing ? modelScale : performanceTarget;
        performanceScale += (target - performanceScale) * (1 - Math.exp(-deltaSeconds / performanceTau));
        if (performanceReleasing && Math.abs(performanceScale - modelScale) < 1e-3) { performanceScale = null; performanceReleasing = false; }
        catRoot.scale.setScalar(effectiveScale());
      }

      const wanted = cameraPreset(cameraId === 'auto' ? (AUTO_CAMERA_FOR_STATE[state.state] ?? 'game') : cameraId);
      const cameraEase = 1 - Math.exp(-deltaSeconds / CAMERA_EASE_SECONDS);
      if (Math.abs(wanted.elevationDeg - cameraElevation) > 0.01 || Math.abs(wanted.lookAtY - cameraLookAtY) > 0.0005) {
        cameraElevation += (wanted.elevationDeg - cameraElevation) * cameraEase;
        cameraLookAtY += (wanted.lookAtY - cameraLookAtY) * cameraEase;
        applyCameraAngle(cameraElevation, cameraLookAtY);
      }
      cameraHeadPitch += ((CAMERA_HEAD_PITCH[wanted.id] ?? 0) - cameraHeadPitch) * cameraEase;

      const dx = lastPosition ? state.position.x - lastPosition.x : 0;
      const dy = lastPosition ? state.position.y - lastPosition.y : 0;
      lastPosition = { x: state.position.x, y: state.position.y };
      if (deltaSeconds > 0) {
        const ease = 1 - Math.exp(-deltaSeconds / VELOCITY_SMOOTHING_SECONDS);
        velocityX += (dx / deltaSeconds - velocityX) * ease;
        velocityY += (dy / deltaSeconds - velocityY) * ease;
      }
      const groundDistance = Math.hypot(dx * worldPerPixelX, dy * worldPerPixelZ);
      groundSpeed = deltaSeconds > 0 ? groundDistance / deltaSeconds : 0;
      if (groom) {
        const petMode = (state as { toy?: { kind: string } | null }).toy?.kind === 'pet';
        // the coat in the air: its velocity in cat heights a second (a kitten's trot and a big cat's look the same)
        const catHeight = TARGET_HEIGHT * effectiveScale();
        const over = cursor != null && catRect != null && cursor.x >= catRect.x0 && cursor.x <= catRect.x1 && cursor.y >= catRect.y0 && cursor.y <= catRect.y1;
        const air = lastAir = furWind.update(deltaSeconds, { x: velocityX * worldPerPixelX / catHeight, y: 0, z: velocityY * worldPerPixelZ / catHeight }, cursor ? { x: cursor.x, y: cursor.y, over } : null);
        // the pointer in the canvas's own NDC (a canvas fitted to the cat is a window onto the full frame)
        const view = fitCanvas && canvasRect.width ? canvasRect : { x: 0, y: 0, width, height };
        groom.setWind(air.wind, air.gust, {
          x: (air.stroke.x - view.x) / view.width * 2 - 1, y: 1 - (air.stroke.y - view.y) / view.height * 2,
          radius: STROKE_RADIUS_PX * (petMode ? 1.45 : 1) * unitsPerPixel,
          dx: air.stroke.dx, dy: -air.stroke.dy,
          amount: air.stroke.amount * (petMode ? 1.35 : 1),
        });
      }
      const moving = (state.state === 'wander' || state.state === 'ai_directed' || state.state === 'play_toy' || state.state === 'follow_cursor')
        && groundSpeed > 1e-4;

      const headingScreen = (state as { heading?: number }).heading;
      if (headingScreen !== undefined && moving) {
        facingAngle = Math.atan2(Math.cos(headingScreen) * worldPerPixelX, Math.sin(headingScreen) * worldPerPixelZ);
        settledSince = null;
      } else if (headingScreen === undefined && moving) {
        facingAngle = Math.atan2(velocityX * worldPerPixelX, velocityY * worldPerPixelZ);
        settledSince = null;
      } else {
        settledSince ??= elapsed;
        // a staged set piece turns to its mark first (ACTION_STAGING); not while it plays an action (a head bump, a
        // stretch): the body would spin rigidly under it - it holds still
        if (staged && !staged.started) facingAngle = staged.yaw;
        else if (state.state === 'sleep') facingAngle = currentName === 'Sleep' || lyingVia ? bodyYaw : 0;
        else if (oneShot) facingAngle = bodyYaw;
        else if (elapsed - settledSince > SETTLE_DELAY_SECONDS) {
          let presentation = 0;
          if (cursor) {
            const tx = cursor.x - state.position.x;
            const ty = cursor.y - state.position.y;
            if (Math.hypot(tx, ty) > 40) {
              const raw = Math.atan2(tx * worldPerPixelX, ty * worldPerPixelZ);
              const folded = Math.abs(raw) > Math.PI / 2 ? Math.sign(raw) * (Math.PI - Math.abs(raw)) : raw;
              presentation = Math.max(-MAX_FACING_YAW, Math.min(MAX_FACING_YAW, folded));
            }
          }
          if (Math.abs(presentation) < MIN_PRESENT_YAW) {
            // the side it already shows, unless the pointer is clearly to one side
            const side = Math.abs(presentation) > 0.15 ? Math.sign(presentation) : Math.sign(bodyYaw) || 1;
            presentation = side * MIN_PRESENT_YAW;
          }
          facingAngle = presentation;
        }
      }
      const previousYaw = bodyYaw;
      if (state.state === 'dragged') { bodyYaw = facingAngle; pivoting = false; }
      else {
        const toTurn = Math.atan2(Math.sin(facingAngle - bodyYaw), Math.cos(facingAngle - bodyYaw));
        const lying = currentName === 'Sleep' || lyingVia != null;
        pivoting = !moving && !oneShot && !(state.state === 'sleep' && lying) && Math.abs(toTurn) > (pivoting ? PIVOT_STOP : PIVOT_START);
        const maxStep = (moving ? TURN_RATE : PIVOT_TURN_RATE) * deltaSeconds;
        bodyYaw += Math.abs(toTurn) <= maxStep ? toTurn : Math.sign(toTurn) * maxStep;
      }
      catRoot.rotation.y = bodyYaw;
      // the staged set piece starts once it stands on its mark, and is over with its action
      if (staged && moving) staged = null;
      if (staged && !staged.started && Math.abs(Math.atan2(Math.sin(staged.yaw - bodyYaw), Math.cos(staged.yaw - bodyYaw))) < 0.06) {
        staged.started = true;
        startAction(staged.id, staged.clip, staged.seconds);
      }
      if (staged?.started && oneShot?.id !== staged.id) staged = null;
      // the engine's sleep: square on before it lies down (FRONT_FACING_CLIPS), then held
      const sleepTurn = state.state === 'sleep' && currentName !== 'Sleep' && !lyingVia && !oneShot && !staged
        && Math.abs(Math.atan2(Math.sin(bodyYaw), Math.cos(bodyYaw))) > 0.06;
      const yawRate = deltaSeconds > 0 ? Math.atan2(Math.sin(bodyYaw - previousYaw), Math.cos(bodyYaw - previousYaw)) / deltaSeconds : 0;
      steeringTurnRate += ((moving ? yawRate : 0) - steeringTurnRate) * (1 - Math.exp(-deltaSeconds / .16));
      walkStrideScale = steeringStrideScale(steeringTurnRate) * KITTEN_WALK.stride;

      // --- which clip ---
      if (loaded) {
        const settle = oneShot ? SETTLE_CLIPS[oneShot.clip] : undefined;
        const settled = settle && current === actions[oneShot!.clip] ? current : null;
        if (oneShot && settled && settle) {
          // settle into the pose and hold it; when the time is up, get up (the rest of the clip, or the clip backwards)
          const duration = settled.getClip().duration, holdAt = settle.hold * duration;
          if (!oneShot.rising && elapsed < oneShot.endsAt) {
            if (settled.time < holdAt - 1e-3 && settled.timeScale >= 0) settled.timeScale = settle.pace;
            else if (settle.rise === 'rest') { settled.time = holdAt; settled.timeScale = 0; }
            else {
              // settled: breathe, the rest of the clip back and forth
              settled.paused = false;
              if (settled.time >= duration - 0.05) settled.timeScale = -1;
              else if (settled.time <= holdAt + 1e-3) settled.timeScale = 1;
              else if (settled.timeScale === 0 || settled.timeScale === settle.pace) settled.timeScale = 1;
              settled.time = THREE.MathUtils.clamp(settled.time, holdAt, duration - 0.02);
            }
          } else if (!oneShot.rising && elapsed >= oneShot.endsAt) {
            oneShot.rising = true;
            settled.paused = false;
            if (settle.rise === 'reverse') {
              oneShot.endsAt = elapsed + settled.time / settle.pace;
              settled.timeScale = -settle.pace;
            } else {
              oneShot.endsAt = elapsed + riseSeconds(oneShot.clip);
              settled.time = holdAt;
              settled.timeScale = settle.pace;
            }
          }
        }
        if (oneShot && elapsed >= oneShot.endsAt && (!settle || oneShot.rising)) oneShot = null;
        if (moving) oneShot = null;
        // A real stroke is the one already moving the coat. Sample the previous posed rig before the mixer replaces it;
        // on a walking, turning or staged cat the response yields immediately to locomotion and authored action.
        const petInterrupted = moving || pivoting || !!oneShot || !!staged || currentName === 'Walk' || currentName === 'Run';
        samplePet(cursor, !petInterrupted);
        // a settled cat picks something to do now and then (the voxel director's job on the other style)
        if (moving || state.state !== 'idle' || oneShot || staged || petTarget.contact > 0.1 || petPose.contact > 0.1) idleSince = elapsed;
        else if (autonomous && elapsed - idleSince > nextIdlePick) {
          const picks = IDLE_PICKS.filter(([c]) => actions[c]);
          let r = Math.random() * picks.reduce((t, [, w]) => t + w, 0);
          const pick = picks.find(([, w]) => (r -= w) < 0)?.[0];
          if (pick) {
            const loop = LOOPING.has(pick);
            stageOrStart(pick, pick, loop || SETTLE_CLIPS[pick] ? 6 + Math.random() * 6 + settleSeconds(pick) : actions[pick].getClip().duration);
          }
          idleSince = elapsed;
          nextIdlePick = 6 + Math.random() * 6;
        }
        let want = currentName;
        if (oneShot) want = oneShot.clip;
        else if (state.state === 'sleep') want = sleepTurn ? 'Walk' : 'Sleep';
        else if (staged && !staged.started) want = pivoting ? 'Walk' : 'Idle';
        else if (moving) {
          const naturalWalk = (strides.Walk ?? 0) * effectiveScale() / (actions.Walk?.getClip().duration || 1);
          const naturalRun = (strides.Run ?? 0) * effectiveScale() / (actions.Run?.getClip().duration || 1);
          want = locomotionClip(groundSpeed, naturalWalk, currentName === 'Run', Boolean(actions.Run), naturalRun);
        }
        else want = pivoting ? 'Walk' : 'Idle';
        want = viaLying(want, moving);
        if (want !== currentName && !(oneShot && want === oneShot.clip && currentName === want)) play(want, oneShot != null && !LOOPING.has(want));
        // stride-matched playback: one clip cycle per stride of ground actually covered
        // Both sides of a crossfade must advance by the same ground distance.
        for (const name of ['Walk', 'Run']) {
          const action = actions[name];
          if (action?.isRunning() && strides[name] > 0) {
            const rate = locomotionRate(groundDistance, deltaSeconds, strides[name] * (name === 'Walk' ? walkStrideScale : 1), effectiveScale(), action.getClip().duration);
            const cadence = name === 'Walk' && pivoting ? PIVOT_CADENCE : name === 'Walk' && moving ? walkCadence(rate) : rate;
            action.timeScale = cadence;
            if (name === 'Walk' && moving) {
              // A cadence floor without a matching shorter sweep made each slow step scrub against its planted paw.
              walkStrideScale = matchedWalkStride(walkStrideScale, rate, cadence, steeringStrideScale(steeringTurnRate));
            }
          }
        }
        unoverlayPet();
        unoverlayStage();
        unoverlayHead();
        locomotion?.beforeMixer();
        faceRig?.beforeMixer();
        uncarryTail();
        unbreathe();
        mixer!.update(deltaSeconds);
        carryTail(deltaSeconds);
        breathe(deltaSeconds);
        if (faceRig && faceSpec) {
          const want = wantedExpression();
          if (want.name !== faceName) {
            faceName = want.name;
            faceTarget = expressionValues(faceSpec, faceName) ?? {};
            for (const c of Object.keys(faceTarget)) faceControls.add(c);
            clipLidsTarget = eyesOwnLids(faceSpec, faceName) || options.clipBlinks === false ? 0 : 1;
          }
          // no time passed (a first frame) snaps to the face rather than never reaching it
          const k = deltaSeconds > 0 ? 1 - Math.exp(-deltaSeconds / FACE_EASE_SECONDS) : 1;
          for (const c of faceControls) {
            const from = faceNow[c] ?? restValue(c);
            faceNow[c] = from + ((faceTarget[c] ?? restValue(c)) - from) * k;
          }
          clipLids += (clipLidsTarget - clipLids) * k;
          watchForSlowBlink(cursor, !moving && (state.state === 'idle' || state.state === 'play_toy') && !staged);
          const slow = slowBlinkWeight();
          const petEye = Math.min(0.88, PET.eyeClose * petPose.contact + PET.eyeRelax * petRelax);
          const eyelid = Math.max(slow, petEye);
          if (eyelid > 0) {
            // over the face, not instead of it: shut as far as the blink has got, smiling at the lids, the clip's own
            // blinks and any squint giving way to it
            const blinking = { ...faceNow };
            for (const side of ['L', 'R']) {
              blinking[`Blink.${side}`] = Math.max(blinking[`Blink.${side}`] ?? 0, eyelid);
              blinking[`SmileArc.${side}`] = Math.max(blinking[`SmileArc.${side}`] ?? 0, 0.55 * eyelid);
              blinking[`Squint.${side}`] = (blinking[`Squint.${side}`] ?? 0) * (1 - eyelid);
            }
            faceRig.apply(blinking, clipLids * (1 - eyelid));
          } else faceRig.apply(faceNow, clipLids);
        }
      }
      if (jawBone) {
        const open = 2 * Math.acos(Math.min(1, Math.abs(jawBone.quaternion.dot(jawRest))));
        for (const t of teeth) t.visible = open > JAW_OPEN_SHOWS_TEETH;
        sewMouth(open <= JAW_OPEN_SHOWS_TEETH);
      }

      // --- placement and facing (as renderer.ts) ---
      const stand = screenToWorld(state.position.x, state.position.y, 0);
      catRoot.position.set(stand.x, 0, stand.z);
      shadow.position.copy(screenToWorld(state.position.x, state.position.y, 0.004));
      // under the body, not the paws' anchor: sitting or lying the body moves back over the ground, and a contact
      // shadow left at the paws made the cat float above it
      if (pelvisBone && chestBone) {
        catRoot.updateMatrixWorld(true);
        const body = pelvisBone.getWorldPosition(bodyCentre).add(chestBone.getWorldPosition(bodyPoint)).multiplyScalar(0.5);
        shadow.position.x = body.x; shadow.position.z = body.z;
      }
      const spread = TARGET_HEIGHT * (performanceScale ?? modelScale) * 0.95;
      shadow.scale.set(spread, spread * 0.62, 1);
      // the key light and its shadow frustum ride with the cat, sized to it
      const reach = TARGET_HEIGHT * (performanceScale ?? modelScale) * 1.4;
      key.target.position.set(stand.x, 0, stand.z);
      key.position.set(stand.x, 0, stand.z).addScaledVector(KEY_OFFSET, reach);
      const sc = key.shadow.camera;
      sc.left = -reach; sc.right = reach; sc.top = reach; sc.bottom = -reach;
      sc.near = 0.01; sc.far = reach * 6;
      sc.updateProjectionMatrix();
      shadowCatcher.position.set(stand.x, 0.002, stand.z);
      shadowCatcher.scale.setScalar(reach * 2.5);

      locomotion?.update(deltaSeconds, steeringTurnRate, moving, currentName, current ? current.time / current.getClip().duration : 0, walkStrideScale);
      overlayHead(deltaSeconds, moving);
      overlayStage(deltaSeconds);
      overlayPet(deltaSeconds, moving || pivoting || !!oneShot || !!staged || currentName === 'Walk' || currentName === 'Run');

      updateToy(state, deltaSeconds);
      if (contextLost) return;
      scene.updateMatrixWorld();
      animateWhiskers(deltaSeconds, cursor);
      groom?.simulate(deltaSeconds);
      if (fitCanvas) {
        fitCanvasToFrame();
        renderer.render(scene, camera);
        camera.clearViewOffset();
      } else {
        catRect = measureDrawnRect();
        renderer.render(scene, camera);
      }
    },
    hitTest(point, precise = false) {
      if (!catRect) return false;
      const margin = MIN_HIT_RADIUS_PX + 16;
      if (point.x < catRect.x0 - margin || point.x > catRect.x1 + margin || point.y < catRect.y0 - margin || point.y > catRect.y1 + margin) return false;
      // The skinned silhouette, approximated by a capsule round every bone: cheap, posed, and a click beside the cat
      // misses. Thickness from the coat's radius at this size.
      const radiusPx = (0.075 * effectiveScale()) / unitsPerPixel;
      const a = new THREE.Vector3();
      for (const b of bones) {
        if (!(b.parent as THREE.Bone)?.isBone) continue;
        b.getWorldPosition(a);
        const p0 = worldToScreen(a);
        (b.parent as THREE.Bone).getWorldPosition(a);
        const p1 = worldToScreen(a);
        const vx = p1.x - p0.x, vy = p1.y - p0.y;
        const len2 = vx * vx + vy * vy;
        const t = len2 > 0 ? THREE.MathUtils.clamp(((point.x - p0.x) * vx + (point.y - p0.y) * vy) / len2, 0, 1) : 0;
        if (Math.hypot(point.x - (p0.x + t * vx), point.y - (p0.y + t * vy)) <= radiusPx) return true;
      }
      if (precise) return false;
      if (radiusPx * 4 >= MIN_HIT_RADIUS_PX) return false;
      return Math.hypot(point.x - lastAnchor.x, point.y - (catRect.y0 + catRect.y1) / 2) <= MIN_HIT_RADIUS_PX;
    },
    dispose() {
      disposed = true;
      mixer?.stopAllAction();
      model?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
      for (const m of [...shellMaterials, ...ownedMaterials]) m.dispose();
      groom?.dispose();
      shadow.geometry.dispose();
      shadowCatcher.geometry.dispose();
      (shadowCatcher.material as THREE.Material).dispose();
      (shadow.material as THREE.Material).dispose();
      shadowTexture.dispose();
      removeToy();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  return api;
}
