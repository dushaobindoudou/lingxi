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
import { loadGroom, createGroom } from './realistic-groom.ts';
import { createFurWind } from './realistic-wind.ts';
import type { Renderer, RendererCapabilities } from '../../../packages/desktop-host-contract/index.d.ts';
import { AUTO_CAMERA_FOR_STATE, CAMERA_HEAD_PITCH, CAMERA_PRESETS, DEFAULT_CAMERA_ID, cameraPreset } from './rig/cameras.ts';
import { APP_PUPIL, createFaceRig, expressionValues, eyesOwnLids, restValue, type FaceRig, type FaceSpec, type IrisUniforms } from './realistic-face.ts';
import { createLocomotion, steeringStrideScale } from './realistic-locomotion.ts';
import { comfortableWalkPace, locomotionClip, locomotionRate, locomotionTransitionPhase, walkCadence } from './realistic-motion.ts';
import { createToyProp, type ToyKind, type ToyProp } from './rig/toys.ts';

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
// Strand density follows the cat's drawn height (device pixels): all of them from this tall, never under the floor.
// At the default .25 the cat is ~350 px tall and draws ~30% of them (see Groom.setDensity).
const GROOM_FULL_DENSITY_PX = 1200;
const GROOM_MIN_DENSITY = 0.12;
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
const LOOPING = new Set(['Idle', 'Walk', 'Run', 'Sleep', 'SideLie', 'Loaf', 'Sit', 'LieDown']);
// Clips that carry the body across the floor; the engine owns position, so their horizontal travel is removed.
const TRAVELLING = ['Walk', 'Run', 'Jump'];
// The tail's carriage while a clip that leaves it alone plays. The standing clips never move Tail0, Tail1 or Tail4 (a few
// degrees on Tail2-3 at most), so the tail stuck straight out back and down in its rest pose, a stick. Per bone, Tail0
// (root) to Tail4: `lift` (degrees, up about the cat's own side axis, each on top of the one before - a negative tip
// curls it back over) and `sway` (degrees, side to side, a wave running root to tip once per `period` seconds). Clips
// not listed (sitting, lying, grooming, sleeping) pose the tail themselves and get nothing.
// Rest segments run -32, -29, -15, +11, +36 degrees from level; walking lifts them to about 30, 50, 55, 45, 30 (the
// happy kitten's raised tail, tip hooked), standing to about -25, -20, -8, 5, 20 (low, hanging in a soft curve: any
// higher and from the front the tip stood up behind the head like a tuft).
const TAIL_WALK = { lift: [62, 17, -9, -36, -40], sway: [3, 4, 6, 8, 10], period: 1.5 };
const TAIL_STAND = { lift: [7, 2, -2, -13, -10], sway: [2, 3, 5, 7, 9], period: 3.2 };
const TAIL_RUN = { lift: [37, 2, -12, -26, -22], sway: [1, 2, 3, 4, 5], period: 0.9 };
const TAIL_CARRIAGE: Record<string, { lift: number[]; sway: number[]; period: number }> = {
  Walk: TAIL_WALK, Happy: TAIL_WALK, Curious: TAIL_WALK,
  Run: TAIL_RUN, Jump: TAIL_RUN,
  Idle: TAIL_STAND, Turn: TAIL_STAND, Yawn: TAIL_STAND, Bite: TAIL_STAND, Knead: TAIL_STAND, Stretch: TAIL_STAND, PawPlay: TAIL_STAND,
};
const TAIL_EASE_SECONDS = 0.35;
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
const COAT_GRADE = `
  { float lumC = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    diffuseColor.rgb = max(mix(vec3(lumC), diffuseColor.rgb, 1.25) * vec3(1.06, 1.0, 0.90), 0.0); }`;

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
  let oneShot: { id: string; clip: string; endsAt: number } | null = null;
  let idleSince = 0;
  let nextIdlePick = 6 + Math.random() * 6;
  const bones: THREE.Bone[] = [];
  let headBone: THREE.Bone | null = null;
  // Tail0..Tail4, and the model's own frame their lift and sway axes are given in (see TAIL_CARRIAGE)
  const tailBones: THREE.Bone[] = [];
  let tailFrame: THREE.Object3D | null = null;
  const tailLift = [0, 0, 0, 0, 0];
  const tailSway = [0, 0, 0, 0, 0];
  let tailPhase = 0;
  const shellMaterials: THREE.Material[] = [];
  const ownedMaterials: THREE.Material[] = [];
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
  // limbal ring, and catchlights that stay put on the lens.
  const irisUniforms: Record<'L' | 'R', IrisUniforms> = {
    L: { uPupil: { value: new THREE.Vector2(APP_PUPIL, APP_PUPIL) }, uGaze: { value: new THREE.Vector2() }, uCatch: { value: 1 }, uSpark: { value: 0 } },
    R: { uPupil: { value: new THREE.Vector2(APP_PUPIL, APP_PUPIL) }, uGaze: { value: new THREE.Vector2() }, uCatch: { value: 1 }, uSpark: { value: 0 } },
  };
  function irisMaterial(src: THREE.MeshStandardMaterial, side: 'L' | 'R') {
    const m = new THREE.MeshStandardMaterial({ map: src.map ?? null, roughness: 0.35, color: src.map ? 0xffffff : src.color });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, irisUniforms[side]);
      sh.fragmentShader = 'uniform vec2 uPupil; uniform vec2 uGaze; uniform float uCatch; uniform float uSpark;\n' + sh.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec2 guv = vMapUv - uGaze;
          // the review render's golden iris round the pupil: the map is lifted (it read dark olive at desktop size), the
          // dark limbal ring kept thin
          diffuseColor *= texture2D(map, guv);
          diffuseColor.rgb *= 1.35;
          float irisD = distance(guv, vec2(0.5));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.10, 0.085, 0.04), smoothstep(0.475, 0.50, irisD));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.757, 0.686), smoothstep(0.495, 0.515, irisD));
          vec2 pe = (guv - 0.5) / uPupil;
          float pey = abs(pe.y);
          float lensD = max(pey, abs(pe.x) / max(1.0 - pey * pey, 0.05));
          float lens = clamp((uPupil.y / uPupil.x - 1.8) / 2.5, 0.0, 1.0);
          float pd = mix(length(pe), lensD, lens);
          float pw = max(fwidth(pd), 0.02);
          diffuseColor.rgb = mix(vec3(0.004), diffuseColor.rgb, smoothstep(1.0 - pw, 1.0 + pw, pd));
          // a big soft catchlight up-left, a small one down-right - most of a kitten's 'wet', alive look - and, for
          // 闪亮 / 期待, two more small sparkles
          float catchL = smoothstep(0.085, 0.050, distance(vMapUv, vec2(0.37, 0.36))) + 0.7 * smoothstep(0.035, 0.018, distance(vMapUv, vec2(0.63, 0.64)));
          catchL += uSpark * 0.22 * (smoothstep(0.03, 0.012, distance(vMapUv, vec2(0.62, 0.33))) + smoothstep(0.022, 0.008, distance(vMapUv, vec2(0.33, 0.62))));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), clamp(catchL * 0.92 * uCatch, 0.0, 1.0));
        #endif`);
    };
    m.customProgramCacheKey = () => 'realcat-iris-v2';
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
  function shellMaterial(len: number, den: number, t: number, solid = false, underCurves = false) {
    // Coverage must not overwrite an already opaque body pixel with fractional framebuffer alpha.
    // Alpha hashing discards strand gaps, while every surviving sample stays opaque on the desktop.
    // `solid`: an opaque layer of undercoat (no strands), under the original curves.
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, alphaHash: !solid });
    m.onBeforeCompile = (sh) => {
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
      sh.fragmentShader = 'uniform float uShell; uniform float uDen; uniform vec3 uRim; varying vec3 vRest; varying float vScale;\n'
        + 'vec3 furHash3(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }\n'
        + sh.fragmentShader
          .replace('#include <color_fragment>', `#include <color_fragment>
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
            ${COAT_GRADE}`)
          .replace('#include <opaque_fragment>', underCurves ? '#include <opaque_fragment>' : `
            // light through the coat's edge where the view grazes it
            float ndv = abs(dot(normalize(normal), normalize(vViewPosition)));
            outgoingLight += uRim * pow(1.0 - ndv, 2.2) * uShell * 0.28;
            #include <opaque_fragment>`);
    };
    m.customProgramCacheKey = () => (solid ? 'realcat-fur-undercoat-v3' : underCurves ? 'realcat-fur-shell-under-curves-v1' : 'realcat-fur-shell-opaque-v5');
    shellMaterials.push(m);
    return m;
  }
  // The lids' own skin is dark brown (lid_color); in the Cycles render they carry their own short hair, in the coat's
  // colour, so a closed or half-closed eye reads as fur with a dark lash line. Here: every lid vertex but the lash
  // line takes the coat's colour round the eye - the average over a ring above it (per-vertex samples drew the
  // forehead's stripes, or below the eye the white muzzle, as streaks and blocks on a closed eye) - and grows a short
  // shell coat (furScale 0 on the lash line).
  const LID_COAT_LIFT = 1.4;
  function lidCoat(lids: THREE.SkinnedMesh[], head: THREE.Mesh | undefined, root: THREE.Object3D) {
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
      for (let c = 0; c < 3; c++) sum[c] = Math.min(1, (sum[c] / n) * LID_COAT_LIFT) * n;
      const scale = new Float32Array(lc.count);
      for (let i = 0; i < lc.count; i++) {
        const lum = 0.2126 * lc.getX(i) + 0.7152 * lc.getY(i) + 0.0722 * lc.getZ(i);
        const coat = THREE.MathUtils.smoothstep(lum, 0.012, 0.05);
        lc.setXYZ(i, THREE.MathUtils.lerp(lc.getX(i), sum[0] / n, coat), THREE.MathUtils.lerp(lc.getY(i), sum[1] / n, coat), THREE.MathUtils.lerp(lc.getZ(i), sum[2] / n, coat));
        scale[i] = coat;
      }
      lc.needsUpdate = true;
      m.geometry.setAttribute('furScale', new THREE.BufferAttribute(scale, 1));
    }
    return lids;
  }
  function furScaleAttribute(mesh: THREE.SkinnedMesh, bonePos: Record<string, THREE.Vector3>) {
    const pos = mesh.geometry.getAttribute('position');
    const out = new Float32Array(pos.count).fill(1);
    if (mesh.name.startsWith('LX_Head')) {
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
        // the front of the face keeps a short coat (the review renders' features are crisp); cheeks and crown stay full
        if (nrm) {
          nv.fromBufferAttribute(nrm, i).applyMatrix3(toWorldDir).normalize();
          s = Math.min(s, THREE.MathUtils.lerp(1, 0.3, THREE.MathUtils.smoothstep(nv.z, 0.35, 0.8)));
          // the cheeks: the sides of the lower head carry the long fluff that makes the kitten's head round
          const side = THREE.MathUtils.smoothstep(Math.abs(nv.x), 0.45, 0.85) * THREE.MathUtils.smoothstep(-nv.y, -0.2, 0.3);
          s *= 1 + 0.4 * side;
        }
        // bare only over the eye itself (the Eye bone sits ~2 cm behind the lens; the lids, 4.1-6.7 cm out, have their own
        // short coat, which the head's overhangs at its outer edge)
        for (const e of eyes) s = Math.min(s, THREE.MathUtils.clamp((v.distanceTo(e) - 0.042) / 0.014, 0, 1));
        if (nose) s = Math.min(s, THREE.MathUtils.clamp((v.distanceTo(nose) - 0.012) / 0.05, 0.25, 1));
        out[i] = s;
      }
    }
    mesh.geometry.setAttribute('furScale', new THREE.BufferAttribute(out, 1));
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
    const lidFur = lidCoat(lidMeshes, root.getObjectByName('LX_Head') as THREE.Mesh | undefined, root);
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
      }
    });
    for (let i = 0; i <= 4; i++) {
      const b = root.getObjectByName(`Tail${i}`) as THREE.Bone | undefined;
      if (b?.isBone) tailBones.push(b);
    }
    tailFrame = tailBones.length === 5 ? root : null;
    if (tailFrame) for (let i = 0; i < 5; i++) tailClipPose[i].copy(tailBones[i].quaternion);

    const coat: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      m.castShadow = !/Whisker|Cornea/.test(m.name);
      m.receiveShadow = true;
      const mat = m.material as THREE.MeshStandardMaterial;
      const name = mat?.name ?? '';
      if (/Iris/i.test(name)) m.material = irisMaterial(mat, name.endsWith('.R') ? 'R' : 'L');
      else if (/Cornea/i.test(name)) {
        const c = new THREE.MeshPhysicalMaterial({
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
        s.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>${COAT_GRADE}`); };
        s.customProgramCacheKey = () => 'realcat-skin';
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
    if (groomAsset) {
      if (!coat.length) throw new Error('Groom needs a skinned coat mesh');
      groom = createGroom(groomAsset, coat[0], root);
      ownedMaterials.push(groom.material);
      for (const mesh of groom.meshes) coat[0].parent!.add(mesh);
    }
    // With the original curves the shells are only their solid undercoat: the review render's round, dense volume (the
    // curves alone are too sparse at desktop size - a grey haze round a thin body), the curves drawing the outline.
    const layers = groom ? UNDERCOAT_LAYERS : shellCount;
    for (const base of coat) {
      const f = FUR[base.name.split('.')[0].replace(/_\d+$/, '')];
      furScaleAttribute(base, bonePos);
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
    for (const lid of groom ? [] : lidFur) {
      for (let i = 1; i <= Math.ceil(shellCount / 2); i++) {
        const s = new THREE.SkinnedMesh(lid.geometry, shellMaterial(LID_FUR.len, LID_FUR.den, i / Math.ceil(shellCount / 2)));
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

  function play(name: string, once = false) {
    const next = actions[name];
    if (!next || (next === current && !once)) return false;
    const phase = current ? locomotionTransitionPhase(currentName, name, current.time / current.getClip().duration) : 0;
    next.reset();
    next.time = phase * next.getClip().duration;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.timeScale = 1;
    next.play();
    if (current && current !== next) current.crossFadeTo(next, CROSSFADE_SECONDS, false);
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
  function uncarryTail() {
    if (tailFrame) for (let i = 0; i < 5; i++) tailBones[i].quaternion.copy(tailClipPose[i]);
  }
  const tailAxis = new THREE.Vector3();
  const tailFrameQ = new THREE.Quaternion();
  const tailParentQ = new THREE.Quaternion();
  const tailTurn = new THREE.Quaternion();
  function carryTail(deltaSeconds: number) {
    if (!tailFrame) return;
    const pose = TAIL_CARRIAGE[currentName];
    const k = deltaSeconds > 0 ? 1 - Math.exp(-deltaSeconds / TAIL_EASE_SECONDS) : 1;
    for (let i = 0; i < 5; i++) {
      tailLift[i] += ((pose?.lift[i] ?? 0) - tailLift[i]) * k;
      tailSway[i] += ((pose?.sway[i] ?? 0) - tailSway[i]) * k;
    }
    tailPhase = (tailPhase + deltaSeconds * Math.PI * 2 / (pose?.period ?? TAIL_STAND.period)) % (Math.PI * 2);
    tailFrame.getWorldQuaternion(tailFrameQ);
    for (let i = 0; i < 5; i++) tailClipPose[i].copy(tailBones[i].quaternion);
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
  let settledSince: number | null = null;
  let lastAnchor = { x: 0, y: 0 };
  let contextLost = false;
  renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); contextLost = true; });
  renderer.domElement.addEventListener('webglcontextrestored', () => { contextLost = false; });

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
      const loop = LOOPING.has(clip);
      play(clip, !loop);
      const ms = loop ? 4000 : actions[clip].getClip().duration * 1000;
      oneShot = { id, clip, endsAt: elapsed + ms / 1000 };
      return true;
    },
    playExpression(requested: string, holdMs = EXPRESSION_HOLD_MS) {
      const name = faceSpec?.expressions[requested] ? requested : EXPRESSION_ALIASES[requested] ?? requested;
      if (!faceRig || !faceSpec?.expressions[name]) return false;
      heldExpression = { name, until: elapsed + Math.max(0, holdMs) / 1000 };
      return true;
    },
    get playingAction() {
      if (!oneShot) return null;
      const remainingMs = Math.max(0, (oneShot.endsAt - elapsed) * 1000);
      return remainingMs > 0 ? { id: oneShot.id, remainingMs, legFree: false } : null;
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
        // the coat in the air: its velocity in cat heights a second (a kitten's trot and a big cat's look the same)
        const catHeight = TARGET_HEIGHT * effectiveScale();
        const over = cursor != null && catRect != null && cursor.x >= catRect.x0 && cursor.x <= catRect.x1 && cursor.y >= catRect.y0 && cursor.y <= catRect.y1;
        const air = lastAir = furWind.update(deltaSeconds, { x: velocityX * worldPerPixelX / catHeight, y: 0, z: velocityY * worldPerPixelZ / catHeight }, cursor ? { x: cursor.x, y: cursor.y, over } : null);
        // the pointer in the canvas's own NDC (a canvas fitted to the cat is a window onto the full frame)
        const view = fitCanvas && canvasRect.width ? canvasRect : { x: 0, y: 0, width, height };
        groom.setWind(air.wind, air.gust, {
          x: (air.stroke.x - view.x) / view.width * 2 - 1, y: 1 - (air.stroke.y - view.y) / view.height * 2,
          radius: STROKE_RADIUS_PX * unitsPerPixel, dx: air.stroke.dx, dy: -air.stroke.dy, amount: air.stroke.amount,
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
        if (elapsed - settledSince > SETTLE_DELAY_SECONDS) {
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
          facingAngle = presentation;
        }
      }
      const previousYaw = bodyYaw;
      if (state.state === 'dragged') bodyYaw = facingAngle;
      else {
        const toTurn = Math.atan2(Math.sin(facingAngle - bodyYaw), Math.cos(facingAngle - bodyYaw));
        const maxStep = TURN_RATE * deltaSeconds;
        bodyYaw += Math.abs(toTurn) <= maxStep ? toTurn : Math.sign(toTurn) * maxStep;
      }
      catRoot.rotation.y = bodyYaw;
      const yawRate = deltaSeconds > 0 ? Math.atan2(Math.sin(bodyYaw - previousYaw), Math.cos(bodyYaw - previousYaw)) / deltaSeconds : 0;
      steeringTurnRate += ((moving ? yawRate : 0) - steeringTurnRate) * (1 - Math.exp(-deltaSeconds / .16));
      walkStrideScale = steeringStrideScale(steeringTurnRate);

      // --- which clip ---
      if (loaded) {
        if (oneShot && elapsed >= oneShot.endsAt) oneShot = null;
        if (moving) oneShot = null;
        // a settled cat picks something to do now and then (the voxel director's job on the other style)
        if (moving || state.state !== 'idle' || oneShot) idleSince = elapsed;
        else if (autonomous && elapsed - idleSince > nextIdlePick) {
          const picks = IDLE_PICKS.filter(([c]) => actions[c]);
          let r = Math.random() * picks.reduce((t, [, w]) => t + w, 0);
          const pick = picks.find(([, w]) => (r -= w) < 0)?.[0];
          if (pick) {
            const loop = LOOPING.has(pick);
            play(pick, !loop);
            oneShot = { id: pick, clip: pick, endsAt: elapsed + (loop ? 6 + Math.random() * 6 : actions[pick].getClip().duration) };
          }
          idleSince = elapsed;
          nextIdlePick = 6 + Math.random() * 6;
        }
        let want = currentName;
        if (oneShot) want = oneShot.clip;
        else if (state.state === 'sleep') want = 'Sleep';
        else if (moving) {
          const naturalWalk = (strides.Walk ?? 0) * effectiveScale() / (actions.Walk?.getClip().duration || 1);
          const naturalRun = (strides.Run ?? 0) * effectiveScale() / (actions.Run?.getClip().duration || 1);
          want = locomotionClip(groundSpeed, naturalWalk, currentName === 'Run', Boolean(actions.Run), naturalRun);
        }
        else want = 'Idle';
        if (want !== currentName && !(oneShot && want === oneShot.clip && currentName === want)) play(want, oneShot != null && !LOOPING.has(want));
        // stride-matched playback: one clip cycle per stride of ground actually covered
        // Both sides of a crossfade must advance by the same ground distance.
        for (const name of ['Walk', 'Run']) {
          const action = actions[name];
          if (action?.isRunning() && strides[name] > 0) {
            const rate = locomotionRate(groundDistance, deltaSeconds, strides[name] * (name === 'Walk' ? walkStrideScale : 1), effectiveScale(), action.getClip().duration);
            action.timeScale = name === 'Walk' && moving ? walkCadence(rate) : rate;
          }
        }
        locomotion?.beforeMixer();
        faceRig?.beforeMixer();
        uncarryTail();
        mixer!.update(deltaSeconds);
        carryTail(deltaSeconds);
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
          faceRig.apply(faceNow, clipLids);
        }
      }

      // --- placement and facing (as renderer.ts) ---
      const stand = screenToWorld(state.position.x, state.position.y, 0);
      catRoot.position.set(stand.x, 0, stand.z);
      shadow.position.copy(screenToWorld(state.position.x, state.position.y, 0.004));
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

      locomotion?.update(deltaSeconds, steeringTurnRate, moving, currentName, current ? current.time / current.getClip().duration : 0);
      if (headBone && cameraHeadPitch) headBone.rotation.x += cameraHeadPitch;

      updateToy(state, deltaSeconds);
      if (contextLost) return;
      scene.updateMatrixWorld();
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
