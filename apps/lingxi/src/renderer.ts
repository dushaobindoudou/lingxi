// Renderer module (docs/05-technical-architecture.md). Owns the Three.js scene and
// the currently-mounted model; knows nothing about the desktop host or the life
// engine's decision-making, only the `Renderer` contract's render/hitTest/resize shape.
//
// Composition, in the order a frame is assembled:
//   1. bodyController.reset()  - every node back to its authored rest transform
//   2. idleAnimator            - the involuntary baseline (breath, blink, tail, gait)
//   3. expression rig offsets  - ears and head tilt implied by the current face
//   4. director -> offsets     - the chosen action clip, crossfaded
//   5. bodyController.apply()  - additive channels, pose expansion, paw IK, ground contact
//   6. placement               - screen position and facing, applied last because reset()
//                                zeroes the root transform
import * as THREE from 'three';
import type { Renderer, RendererCapabilities } from '../../../packages/desktop-host-contract/index.d.ts';
import { buildRig, type Rig, type SkeletonData } from './rig/skeleton.ts';
import skeletonData from './data/skeleton.json';
import catalogue from './data/skins.json';
import { refineSkeleton } from './rig/anatomy.ts';
import { paintSkin, paintFace, setExpressions, resetExpressions, type ArtSkin, type FaceState } from './rig/art.ts';
import { loadCustomAssets, type CustomAssetPayload, type CustomSkin } from './rig/custom-assets.ts';
import { POSES } from './anim/poses.ts';
import { createBodyController } from './anim/body-controller.ts';
import { createDirector } from './anim/director.ts';
import { createIdleAnimator } from './anim/idle.ts';
import { createBodyFlex } from './anim/body-flex.ts';
import { CAMERA_PRESETS, DEFAULT_CAMERA_ID, AUTO_CAMERA_FOR_STATE, CAMERA_HEAD_PITCH, cameraPreset } from './rig/cameras.ts';
import { createToyProp, type ToyKind, type ToyProp } from './rig/toys.ts';

export { CAMERA_PRESETS, DEFAULT_CAMERA_ID, type CameraPreset } from './rig/cameras.ts';

/** Refined proportions: boxes overlap at the bending joints so the torso reads as one soft
 *  body instead of a chain of separate blocks. Same joint topology, so every clip and pose
 *  authored against the base skeleton still applies. */
const SKELETON = refineSkeleton(skeletonData as unknown as SkeletonData);
const BUILT_IN_SKINS = catalogue as ArtSkin[];
/** Built-ins plus whatever the user's skins.json adds; a custom skin with a built-in id wins. */
let SKINS: CustomSkin[] = BUILT_IN_SKINS as CustomSkin[];
export const DEFAULT_SKIN_ID = 'honey-mittens';

/** Ear pose implied by each expression's ear layer, in radians. */
const EAR_ANGLE: Record<FaceState['ear'], number> = {
  neutral: 0,
  forward: 0.13,
  airplane: 0.8,
  back: -0.48,
};

/** The face boxes the rig still carries. The painted decal replaces all of them, so their
 *  meshes are hidden - the pivots stay, because the idle animator still drives them. */
const FACE_BOX = /^(eye|pupil|brow|nose|mouth|whisker|jaw|tongue)/;

export function listSkins(): readonly ArtSkin[] {
  return SKINS;
}

export function createThreeRenderer(): Renderer {
  const scene = new THREE.Scene();
  // Clip planes deliberately enormous and symmetric about the camera, INCLUDING a negative
  // near. An orthographic projection has no divide-by-depth, so "near" is only a clip test,
  // and a camera that clips nothing is exactly what this scene wants: the cat travels along
  // world Z to cover the screen's full vertical range, and how much depth that consumes
  // depends entirely on the tilt. The old 0.1..10 range is why the tilt used to be locked
  // near-overhead - at a shallow angle the bottom of the screen mapped behind the camera
  // ("下边界会消失") and the top ran into `far` ("上边界有个 gap"). With this range every
  // elevation from level to straight-down is safe, so the angle becomes a free design choice.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -200, 200);

  // Orthographic: the camera's distance from the subject changes nothing about apparent size,
  // so this is just a number big enough to sit clear of the model.
  const CAMERA_DISTANCE = 6;

  // The ground-plane (world y=0) basis the tilted camera actually sees, derived from its real
  // position/lookAt rather than assumed - see the worldPerPixelX/Z comment in applyFrustum for
  // why this matters. `groundRight`/`groundUp` are the world-space directions that move the
  // projected image purely right and purely up, restricted to travel *on the ground plane*
  // (the cat's y stays fixed - only x/z ever change). Recomputed on every angle change, since
  // that is precisely what changes them.
  const camForward = new THREE.Vector3();
  const groundRight = new THREE.Vector3();
  const groundUp = new THREE.Vector3();

  /** Point the camera at `elevationDeg` above the ground plane and rebuild everything derived
   *  from its orientation. Cheap enough to call every frame during an angle transition. */
  function applyCameraAngle(elevationDeg: number, lookAtY: number) {
    // Negative elevations are allowed - that is the whole point of the 仰视 preset, a camera
    // below the cat's eye line tilted up at it. Only the band around zero is excluded, where
    // the ground plane goes exactly edge-on and the pixel->ground mapping diverges.
    const safe = THREE.MathUtils.clamp(elevationDeg, -35, 88);
    const elevation = THREE.MathUtils.degToRad(Math.abs(safe) < 5 ? Math.sign(safe || 1) * 5 : safe);
    camera.position.set(0, lookAtY + Math.sin(elevation) * CAMERA_DISTANCE, Math.cos(elevation) * CAMERA_DISTANCE);
    camera.lookAt(0, lookAtY, 0);
    camera.updateMatrixWorld(true);
    camForward.set(0, lookAtY, 0).sub(camera.position).normalize();
    groundRight.crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();
    groundUp.crossVectors(groundRight, camForward); // cross of two orthonormal unit vectors: already unit length
    applyFrustum();
  }

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x3a2e26, 1.1));
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(-1.2, 2, 1.5);
  scene.add(key);

  // World units per voxel. The rig is authored at ~40 units nose-to-tail; the scene's
  // frustum is sized in the ~2.6-unit range, so it needs bringing down to scene scale.
  const VOXEL_TO_WORLD = 0.055;

  // --- contact shadow --------------------------------------------------------------------
  // A soft dark patch on the ground under the cat. There is no lighting-based shadow here (no
  // shadow map, and no floor to catch one), and without SOMETHING on the ground a 3D character
  // over a transparent desktop has nothing to sit on - it reads as a sticker floating over the
  // wallpaper. This is the cheapest cue that says "this is standing on a surface", and it is
  // also what makes a jump or a rear-up read as leaving the ground, because it shrinks and
  // fades as the body rises.
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  {
    const ctx = shadowCanvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    gradient.addColorStop(0, 'rgba(0,0,0,0.42)');
    gradient.addColorStop(0.55, 'rgba(0,0,0,0.20)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  }
  const shadowTexture = new THREE.CanvasTexture(shadowCanvas);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  // --- the mounted cat: rig + painted body atlas + painted face decal -------------------
  const faceCanvas = document.createElement('canvas');
  faceCanvas.width = faceCanvas.height = 256;
  const faceTexture = new THREE.CanvasTexture(faceCanvas);
  faceTexture.colorSpace = THREE.SRGBColorSpace;
  faceTexture.generateMipmaps = false;
  faceTexture.minFilter = faceTexture.magFilter = THREE.LinearFilter;

  let skin: CustomSkin = SKINS.find((s) => s.id === DEFAULT_SKIN_ID) ?? SKINS[0];
  let lastFrame: ReturnType<ReturnType<typeof createDirector>['update']> | null = null;
  let rig!: Rig;
  let bodyTexture!: THREE.CanvasTexture;
  let bodyMaterial!: THREE.MeshStandardMaterial;
  let faceMaterial!: THREE.MeshBasicMaterial;
  let faceGeometry!: THREE.PlaneGeometry;
  let bodyController!: ReturnType<typeof createBodyController>;

  // Rebuilt with the rig, because the gait measures its stride off the rig's actual bone
  // lengths - a skin with different proportions gets a stride that suits it.
  let idleAnimator!: ReturnType<typeof createIdleAnimator>;
  const bodyFlex = createBodyFlex();
  const nodeIds = SKELETON.nodes.map((node) => node.id);
  let director = createDirector(nodeIds);
  // A hand-drawn face sheet, if the active theme supplies one. Replaces the procedural face
  // painter entirely for that theme.
  let faceSheetImage: HTMLImageElement | null = null;
  let faceSheet: CustomSkin['faceSheet'] | null = null;

  function mountSkin(next: CustomSkin) {
    if (rig) {
      scene.remove(rig.root);
      rig.dispose();
      bodyTexture.dispose();
      bodyMaterial.dispose();
      faceMaterial.dispose();
      faceGeometry.dispose();
    }
    skin = next;
    rig = buildRig(skin, SKELETON);
    scene.add(rig.root);
    rig.root.scale.setScalar(effectiveScale());

    // A theme may ship a hand-painted atlas instead of the generated one. Drawn onto the same
    // canvas the generator would have used, so everything downstream is unchanged.
    const atlas = paintSkin(SKELETON.nodes, skin);
    const custom = next as CustomSkin;
    if (custom.bodyTexture) {
      const image = new Image();
      image.onload = () => {
        const ctx = atlas.canvas.getContext('2d');
        if (!ctx) return;
        ctx.clearRect(0, 0, atlas.canvas.width, atlas.canvas.height);
        ctx.drawImage(image, 0, 0, atlas.canvas.width, atlas.canvas.height);
        bodyTexture.needsUpdate = true;
      };
      image.src = custom.bodyTexture.src;
    }
    faceSheet = custom.faceSheet ?? null;
    faceSheetImage = null;
    if (faceSheet) {
      const image = new Image();
      image.onload = () => {
        faceSheetImage = image;
        repaintFace();
      };
      image.src = faceSheet.src;
    }
    bodyTexture = new THREE.CanvasTexture(atlas.canvas);
    bodyTexture.colorSpace = THREE.SRGBColorSpace;
    bodyTexture.magFilter = bodyTexture.minFilter = THREE.NearestFilter;
    bodyTexture.generateMipmaps = false;
    bodyMaterial = new THREE.MeshStandardMaterial({ map: bodyTexture, roughness: 1, metalness: 0 });
    rig.root.traverse((object) => {
      if (object instanceof THREE.Mesh) object.material = bodyMaterial;
    });
    for (const node of SKELETON.nodes) {
      if (!FACE_BOX.test(node.id)) continue;
      for (const child of rig.node(node.id).children) {
        if (child instanceof THREE.Mesh) child.visible = false;
      }
    }

    const headSpec = SKELETON.nodes.find((node) => node.id === 'head')!;
    const [hx, hy, hz] = headSpec.box.size;
    faceGeometry = new THREE.PlaneGeometry(hx, hy);
    // depthWrite off + a polygon offset so the decal never z-fights the head box it sits on.
    faceMaterial = new THREE.MeshBasicMaterial({
      map: faceTexture, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const faceMesh = new THREE.Mesh(faceGeometry, faceMaterial);
    faceMesh.position.set(headSpec.box.offset[0], headSpec.box.offset[1], headSpec.box.offset[2] + hz / 2 + 0.025);
    rig.node('head').add(faceMesh);

    bodyController = createBodyController(rig, SKELETON);
    idleAnimator = createIdleAnimator(rig);
    lastFrame = director.update(0, 'idle', false);
    repaintFace();
  }

  /** Draw the face - either the procedural painter, or a cell of the theme's own face sheet. */
  function repaintFace() {
    if (!lastFrame) return;
    if (faceSheet && faceSheetImage) {
      const ctx = faceCanvas.getContext('2d')!;
      const cell = faceSheet.cells[lastFrame.expressionName] ?? faceSheet.fallback;
      const cw = faceSheetImage.width / faceSheet.columns;
      const ch = faceSheetImage.height / faceSheet.rows;
      const sx = (cell % faceSheet.columns) * cw;
      const sy = Math.floor(cell / faceSheet.columns) * ch;
      ctx.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
      ctx.drawImage(faceSheetImage, sx, sy, cw, ch, 0, 0, faceCanvas.width, faceCanvas.height);
    } else {
      paintFace(faceCanvas, skin, lastFrame.face, lastFrame.blink);
    }
    faceTexture.needsUpdate = true;
  }

  let container: HTMLElement | null = null;
  let width = 1;
  let height = 1;
  let elapsed = 0;
  let modelScale = 1;
  let gaitPhase = 0;
  let lastPosition: { x: number; y: number } | null = null;
  let facingAngle = 0; // rotation.y the body is currently holding/turning toward (rig faces +Z)
  let headYaw = 0; // local head turn beyond the body's own facing, toward the cursor
  let earAngle = 0;
  let headTilt = 0;
  // Low-passed velocity in logical px/s. Facing is derived from THIS, never from a single
  // frame's delta - see the FACING_* constants.
  let velocityX = 0;
  let velocityY = 0;
  let walkBlend = 0; // eased 0..1 version of "is walking", so the gait fades instead of popping
  let settledSince: number | null = null; // when the cat last stopped, for the turn-to-face delay
  let bodyYaw = 0; // the hips' yaw; the spine curve in bodyFlex is layered on top of it
  let cameraHeadPitch = 0; // chin lift that belongs to the current camera preset
  let groundedRootY = 0; // lowest root height seen - the reference for 'is it airborne'
  let lastLoadedBubbleStyle: Record<string, unknown> | null = null;

  // The currently-mounted toy prop, if any. Kept in the same scene and scaled with the cat, so
  // a toy is always the right size relative to it at every size preset.
  let toyProp: ToyProp | null = null;
  let toyKind: ToyKind | null = null;

  // --- performance zoom -----------------------------------------------------------------
  // A multiplier on top of the user's own size preset, used only by scripted performances to
  // sell depth: the cat starts small and far up the screen, and swells as it charges the
  // "lens" ("你可以把屏幕当做是一个镜头，你从远处跑过来越来越大做完动作再回去").
  //
  // It has to be scale rather than camera distance because the camera is ORTHOGRAPHIC - moving
  // an ortho camera closer changes nothing at all about apparent size. Switching to a
  // perspective camera for the duration would be the other option and is much worse: the
  // entire pixel->ground-plane mapping this file is built on (worldPerPixelX/Z) assumes no
  // perspective divide, so the cat's screen position would jump the instant the projection
  // changed. Scaling the model leaves that mapping exactly intact.
  //
  // Separate from `modelScale` on purpose: a performance must never overwrite the size the
  // user picked in the tray. It multiplies, and it always returns to 1.
  let performanceZoom = 1;
  let performanceZoomTarget = 1;
  let performanceZoomTau = 0.5; // seconds; the ease time constant

  /** Squash the rear hemisphere so the cat never turns fully away, without mirroring it. */
  function biasTowardViewer(angle: number) {
    const magnitude = Math.abs(angle);
    if (magnitude <= VIEWER_BIAS_FROM) return angle;
    const past = (magnitude - VIEWER_BIAS_FROM) / (Math.PI - VIEWER_BIAS_FROM);
    return Math.sign(angle) * (VIEWER_BIAS_FROM + past * (VIEWER_BIAS_MAX - VIEWER_BIAS_FROM));
  }

  /** The scalar actually applied to the rig: user preset * whatever a performance is doing. */
  function effectiveScale() {
    return VOXEL_TO_WORLD * modelScale * performanceZoom;
  }

  let cameraId = DEFAULT_CAMERA_ID;
  let cameraElevation = cameraPreset(DEFAULT_CAMERA_ID).elevationDeg;
  let cameraLookAtY = cameraPreset(DEFAULT_CAMERA_ID).lookAtY;

  mountSkin(skin);

  // --- stride --------------------------------------------------------------------------
  // The gait owns its own stride (gait.ts derives it from the rig's real bone lengths), and the
  // odometer below measures ground covered in WORLD units, not screen pixels. That distinction
  // matters: the camera is tilted, so a pixel of vertical screen travel is ~2.5x more ground
  // than a pixel of horizontal travel. Counting screen pixels made the legs cycle at the wrong
  // rate for any direction other than sideways, which is the "the legs have nothing to do with
  // the distance covered" complaint ("走路的距离和腿不是很协调") - worst, as reported, when
  // moving diagonally. Counting real ground distance is correct by construction at every angle,
  // every zoom and every size preset.
  // Never let the clickable/draggable region shrink below this, even at the smallest tray
  // size preset (0.25x) - a hit target that shrinks proportionally with visual scale becomes
  // impractically small to grab (reported as "拖拽也有问题不是很灵敏").
  const MIN_HIT_RADIUS_PX = 40;
  // How far the body may yaw away from "square to the viewer". The cat is a desktop pet seen
  // on a flat screen: if it ever turns past profile the face - the entire expressive surface,
  // and the whole point of the face decal - is pointing at the wallpaper. See the fold in
  // render() for how rear-facing travel directions get mirrored into this range.
  const MAX_FACING_YAW = Math.PI * 0.42;

  // --- facing stability -----------------------------------------------------------------
  // Facing used to be read straight off one frame's position delta. At 60fps a wandering cat
  // moves ~1.5 logical px per frame, so the "direction" that delta describes is mostly
  // rounding noise, and any hesitation in the behavior layer (see life-engine's
  // avoidRetargetCooldownMs) turned into the body snapping to a new heading every frame -
  // the shaking the whole thing was reported for ("一直晃眼都要瞎了"). Three guards, in order:
  /** Time constant of the velocity low-pass, in seconds. Averages roughly this long a window
   *  of travel, so a heading needs sustained movement - not one frame - to exist at all. */
  const VELOCITY_SMOOTHING_SECONDS = 0.22;
  /** Below this smoothed speed (logical px/s) the cat counts as standing still and simply
   *  KEEPS its current facing. Well under the ~90px/s wander pace, well over sensor noise. */
  const FACING_SPEED_THRESHOLD = 26;
  /** Radians/second the body may turn. A rate limit rather than a per-frame lerp fraction:
   *  a real turn takes the same wall-clock time regardless of frame rate, and no single
   *  frame can ever spin the cat, however wrong the heading it was handed. */
  const TURN_RATE = 5.2;
  /** How long the cat stands still before it bothers turning back to face the viewer. Long
   *  enough that a brief pause mid-route doesn't make it pirouette, short enough that a cat
   *  that has settled somewhere is looking at you rather than away. */
  const SETTLE_DELAY_SECONDS = 0.5;
  /**
   * How far the body may turn away from the viewer before further turning is compressed.
   *
   * The face is the entire expressive surface of this thing - expressions are the interaction,
   * not decoration - so a cat that spends half its time showing you its back has thrown away
   * most of what it is for ("猫咪依然记得要尽量多时候屏幕，表情互动是核心").
   *
   * This is NOT the old fold, which mirrored rear angles and made walking away look identical
   * to walking toward you (the "只会后退" complaint). Compression is monotonic: the direction
   * it is heading still reads correctly and turning stays continuous, the rear hemisphere is
   * just squashed so "directly away" is never quite reached.
   */
  const VIEWER_BIAS_FROM = Math.PI * 0.55;
  const VIEWER_BIAS_MAX = Math.PI * 0.78;
  /** Below this distance the cat does not turn its head toward the cursor at all, and between
   *  here and GLANCE_FADE_FAR the glance fades in. See the comment at the glance itself. */
  const GLANCE_FADE_NEAR = 70;
  const GLANCE_FADE_FAR = 190;
  /** How fast the camera eases between angles when the preset (or 'auto') changes. Slow
   *  enough to read as a camera move, not a cut. */
  const CAMERA_EASE_SECONDS = 0.55;

  // World units per CSS pixel at the model's depth, recomputed on resize so the
  // life engine's pixel-space position maps onto a stable place in the ortho frustum.
  // Only used to size the frustum (apparent zoom) and, in hitTest, to convert a pixel radius
  // to a world-space one - NOT for placing the cat (see worldPerPixelX/Z below).
  let unitsPerPixelX = 0.01;
  let unitsPerPixelY = 0.01;
  // World units of ground-plane travel per logical pixel, along each *logical* axis (x = left/
  // right, y = up/down in screen space, i.e. life-engine's position.x/.y). NOT simply
  // unitsPerPixelX/Y: those describe the frustum's own scale, which only maps 1:1 to on-screen
  // travel for an axis the camera looks straight down. This camera is tilted, so a plain
  // `position.x/.y * unitsPerPixelX/Y` mapping undershoots badly - moving the cat all the way
  // to a logical screen edge only got it partway there on screen (reported as "上下左右似乎
  // 无法移动到边缘位置"): the frustum's *half*-width is unitsPerPixelX*width, but a logical
  // pixel offset from center only ever reaches +-width/2, i.e. half of that half-width again;
  // and vertically, ground-plane travel (world z) only shows up on screen scaled by groundUp's
  // z-component (~0.36 here, since the camera's tilt means moving "into the screen" only partly
  // reads as "up/down"), so the same naive mapping undershot vertical travel far worse than
  // horizontal. Solving for the actual ground-plane basis (groundRight/groundUp, computed above
  // from the real camera geometry) fixes both by construction, and keeps working correctly if
  // the camera tilt is ever tuned.
  let worldPerPixelX = 0.01;
  let worldPerPixelZ = 0.01;

  function applyFrustum() {
    const halfW = width * unitsPerPixelX;
    const halfH = height * unitsPerPixelY;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    worldPerPixelX = halfW / (width / 2) / groundRight.x;
    // Negative: logical +y is *down* the screen (screen-space convention), which is the
    // camera's *bottom* (NDC -1) - the same "not simply negate" relationship documented on
    // the position mapping below, just solved in the other direction here.
    worldPerPixelZ = -(halfH / (height / 2)) / groundUp.z;
  }

  // Safe only here: applyFrustum reads the unitsPerPixel* bindings declared just above.
  applyCameraAngle(cameraElevation, cameraLookAtY);

  const capabilities: RendererCapabilities = {
    locomotion: true,
    facing: true,
    idleAnimation: true,
    preciseHitTest: true, // real raycast against the rig's boxes (see hitTest)
  };

  const headProjection = new THREE.Vector3();
  // --- exact screen -> world placement ----------------------------------------------------
  // worldPerPixelX/Z describe how much world travel a pixel of screen travel is worth. That is
  // a DIFFERENTIAL relationship and it is correct as one, but it says nothing about the origin:
  // multiplying a logical offset by it and calling the result a position quietly assumed that
  // the ground point for screen-centre projects to screen-centre, and it does not - the camera
  // aims at `lookAtY`, above the floor, so the whole ground plane lands lower on screen than
  // its logical coordinates say. Measured at 103px of error at the default camera angle and
  // 139px at 仰视 (see probe-projection.html).
  //
  // Anything with volume hides that: the cat's body still covers roughly the right area. A
  // laser dot or a yarn ball meant to sit exactly under the pointer does not hide it at all,
  // which is how it surfaced ("原点在鼠标的正下方" / "毛线球应该始终在鼠标的位置").
  //
  // So placement is done by unprojecting instead: ask where a given screen point crosses the
  // plane the object lives on. Exact at every camera angle, by construction, and it also means
  // the cat's feet now land exactly on its logical position rather than ~100px below it.
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const placement = new THREE.Vector3();

  function screenToWorld(screenX: number, screenY: number, planeY: number) {
    ndc.set((screenX / width) * 2 - 1, -(screenY / height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    groundPlane.constant = -planeY;
    return raycaster.ray.intersectPlane(groundPlane, placement) ?? placement.set(0, planeY, 0);
  }
  const headBoxHeight = SKELETON.nodes.find((node) => node.id === 'head')!.box.size[1];
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  return {
    capabilities,

    mount(target: HTMLElement) {
      container = target;
      container.appendChild(renderer.domElement);
      renderer.domElement.style.position = 'absolute';
      renderer.domElement.style.inset = '0';
      renderer.domElement.style.pointerEvents = 'none'; // hit-testing is done in world space by main.ts, not DOM events
    },

    resize(w: number, h: number) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, true);
      // keep the model a fixed apparent size regardless of window size: fix world-units-per-pixel
      unitsPerPixelX = 2.6 / Math.max(width, height);
      unitsPerPixelY = unitsPerPixelX;
      applyFrustum();
    },

    setScale(scale: number) {
      modelScale = Math.max(0.05, scale);
      rig.root.scale.setScalar(effectiveScale());
      // The toy keeps the user's size and ignores the performance zoom - a performance is the
      // cat rushing the camera, not the whole world changing size.
      toyProp?.object.scale.setScalar(VOXEL_TO_WORLD * modelScale);
      toyProp?.setWorldScale?.(VOXEL_TO_WORLD * modelScale);
    },

    /**
     * Swap in the user's own actions / expressions / themes. Returns the problems found, one
     * per file - nothing is applied unless it validated, so a broken file leaves the built-in
     * version running and the caller gets a message to show.
     */
    applyCustomAssets(payload: CustomAssetPayload) {
      const loaded = loadCustomAssets(payload, {
        nodeIds,
        poseNames: Object.keys(POSES),
        rigId: SKELETON.id,
      });
      if (loaded.expressions) setExpressions(loaded.expressions);
      else resetExpressions();
      // Handed back to the caller rather than applied here: the fx layer belongs to the host,
      // not to the renderer, and the renderer has no business reaching into it.
      lastLoadedBubbleStyle = loaded.bubble ?? null;

      // The director caches the expression names it validates against, so it is rebuilt rather
      // than mutated whenever either file changes.
      director = createDirector(nodeIds, loaded.actions);

      const merged = new Map<string, CustomSkin>();
      for (const entry of BUILT_IN_SKINS as CustomSkin[]) merged.set(entry.id, entry);
      for (const entry of loaded.skins ?? []) merged.set(entry.id, entry);
      SKINS = [...merged.values()];

      // Re-mount whatever theme is current (it may itself have just been redefined).
      mountSkin(SKINS.find((entry) => entry.id === skin.id) ?? SKINS[0]);
      return loaded.errors;
    },

    /** Switch the active theme ("主题"/皮肤). Rebuilds the rig and repaints both atlases;
     *  no-op for an unknown id, so a stale persisted setting can never leave a blank cat. */
    setSkin(id: string) {
      const next = SKINS.find((candidate) => candidate.id === id);
      if (!next || next.id === skin.id) return;
      mountSkin(next);
    },

    /** Ramp the model toward `multiplier` times the user's own size over `seconds`. Used by
     *  performances to fake approach and retreat under an orthographic camera; always returned
     *  to 1 when the performance ends. */
    setPerformanceZoom(multiplier: number, seconds = 0.5) {
      performanceZoomTarget = Math.max(0.15, Math.min(6, multiplier));
      performanceZoomTau = Math.max(0.05, seconds);
    },

    /** Switch the viewing angle ("视角"). See CAMERA_PRESETS; the change is eased in over
     *  CAMERA_EASE_SECONDS by render(), never cut. */
    setCameraPreset(id: string) {
      cameraId = CAMERA_PRESETS.some((preset) => preset.id === id) ? id : DEFAULT_CAMERA_ID;
    },

    // --- direct drive, for the debug console and external agents -------------------------
    // These bypass the director's own scheduling on purpose: a debug console exists to answer
    // "what does clip X actually look like", and an agent driving the pet needs to be able to
    // say "be happy now" without waiting for the idle timer to roll the dice.

    playAction(id: string) {
      return director.play(id);
    },

    /** Bubble styling from the last applyCustomAssets, for the host to hand to its fx layer. */
    get customBubbleStyle() {
      return lastLoadedBubbleStyle;
    },

    /** The clip playing right now, so the host can hold the cat still for its duration. */
    get playingAction() {
      return director.playing;
    },

    /** Where to hang something above the cat's head, in the same logical pixels as
     *  resize/render. Projected from the real head bone plus the head's own height, so a
     *  bubble clears the ears instead of sitting across the face, and so it tracks the model
     *  through crouches, jumps, camera angle changes and the performance zoom. */
    headScreenPoint() {
      const head = rig.node('head');
      head.getWorldPosition(headProjection);
      // Clear the top of the head. Taken from the head box rather than a fixed pixel offset,
      // because the whole point is that it has to hold at any scale and any camera angle.
      headProjection.y += headBoxHeight * effectiveScale() * 0.9;
      headProjection.project(camera);
      return {
        x: (headProjection.x * 0.5 + 0.5) * width,
        y: (-headProjection.y * 0.5 + 0.5) * height,
      };
    },

    playExpression(name: string, holdMs?: number) {
      return director.playExpression(name, holdMs);
    },

    /** Everything this renderer can be asked to do, as data. Pushed to the Rust side at
     *  startup so `GET /capabilities` can answer an agent without the webview being involved,
     *  and used to build the debug console's grids. */
    describeCapabilities() {
      return {
        actions: director.actions.map((action) => ({
          id: action.id,
          name: action.name,
          category: action.category ?? '',
          duration: action.duration,
          expression: action.expression,
          description: action.description ?? '',
        })),
        expressions: director.expressionNames,
        skins: SKINS.map((entry) => ({ id: entry.id, name: entry.name, description: entry.description })),
        cameras: CAMERA_PRESETS.map((preset) => ({
          id: preset.id,
          name: preset.name,
          description: preset.description,
          elevationDeg: preset.elevationDeg,
        })),
      };
    },

    render(state, deltaSeconds: number, cursor: { x: number; y: number } | null) {
      elapsed += deltaSeconds;

      // Camera angle, eased toward whatever the current preset asks for. In 'auto' the
      // request depends on what the cat is doing (see AUTO_CAMERA_FOR_STATE), so this is
      // re-read every frame; with a fixed preset the target is constant and this settles and
      // stops doing anything. Easing on the ANGLE (not cutting between cameras) is what keeps
      // a switch from teleporting the cat on screen, since the pixel->world mapping is
      // derived from the angle.
      if (Math.abs(performanceZoom - performanceZoomTarget) > 1e-4) {
        performanceZoom += (performanceZoomTarget - performanceZoom) * (1 - Math.exp(-deltaSeconds / performanceZoomTau));
        rig.root.scale.setScalar(effectiveScale());
      }

      const wanted = cameraPreset(cameraId === 'auto' ? (AUTO_CAMERA_FOR_STATE[state.state] ?? 'game') : cameraId);
      const cameraEase = 1 - Math.exp(-deltaSeconds / CAMERA_EASE_SECONDS);
      if (Math.abs(wanted.elevationDeg - cameraElevation) > 0.01 || Math.abs(wanted.lookAtY - cameraLookAtY) > 0.0005) {
        cameraElevation += (wanted.elevationDeg - cameraElevation) * cameraEase;
        cameraLookAtY += (wanted.lookAtY - cameraLookAtY) * cameraEase;
        applyCameraAngle(cameraElevation, cameraLookAtY);
      }
      // A low camera gets you an upward view; the cat lifting its chin is what turns that into
      // the cat looking up at YOU. Eased alongside the angle so they arrive together.
      cameraHeadPitch += ((CAMERA_HEAD_PITCH[wanted.id] ?? 0) - cameraHeadPitch) * cameraEase;

      // Odometer, not a clock: one gait cycle per stride of ground covered, so the feet and
      // the distance travelled can never drift apart at any speed.
      const dx = lastPosition ? state.position.x - lastPosition.x : 0;
      const dy = lastPosition ? state.position.y - lastPosition.y : 0;
      lastPosition = { x: state.position.x, y: state.position.y };
      const groundMoved = Math.hypot(dx * worldPerPixelX, dy * worldPerPixelZ);
      const strideWorld = Math.max(1e-6, idleAnimator.strideVoxels * effectiveScale());
      gaitPhase += groundMoved / strideWorld;

      // Speed is only needed as a "is it walking" gate now - the DIRECTION it faces comes from
      // the engine's own heading, not from differentiating position (see below).
      if (deltaSeconds > 0) {
        const ease = 1 - Math.exp(-deltaSeconds / VELOCITY_SMOOTHING_SECONDS);
        velocityX += (dx / deltaSeconds - velocityX) * ease;
        velocityY += (dy / deltaSeconds - velocityY) * ease;
      }
      const speed = Math.hypot(velocityX, velocityY);

      // Amplitude still needs a walking/idle gate: standing still should hold a settled
      // pose (amplitude 0) rather than freeze mid-stride at whatever phase it stopped at.
      // Eased rather than binary, so a cat that arrives somewhere settles out of its stride
      // instead of the legs snapping straight on the frame the engine says "idle".
      const walking =
        state.state === 'wander' || state.state === 'ai_directed' || state.state === 'play_toy';
      const walkTarget = walking && speed > FACING_SPEED_THRESHOLD * 0.35 ? 1 : 0;
      walkBlend += (walkTarget - walkBlend) * (1 - Math.exp(-deltaSeconds / 0.14));
      const walkAmount = walkBlend < 0.01 ? 0 : walkBlend;

      // 1. rest pose, 2. involuntary baseline
      bodyController.reset();
      idleAnimator.update(rig, elapsed, deltaSeconds, gaitPhase, walkAmount);

      // 3. the current expression's implied ear/head pose, eased rather than snapped
      // 0.5, not >0: walkAmount now fades in and out, and the director treats "moving" as a
      // hard gate that cancels whatever clip is playing. Reading the fade itself would cancel
      // and restart clips twice per stop.
      const frame = director.update(deltaSeconds, state.state, walkAmount > 0.5);
      const ease = 1 - Math.exp(-deltaSeconds / 0.16);
      earAngle += ((EAR_ANGLE[frame.face.ear] ?? 0) - earAngle) * ease;
      rig.node('earL').rotation.z -= earAngle;
      rig.node('earR').rotation.z += earAngle;
      // A questioning or sleepy face reads much better with a slight head cant; it is the
      // cheapest single cue that turns a static expression into an attitude.
      const wantTilt = frame.face.symbol === 'question' ? 0.12 : frame.face.eye === 'half' ? 0.07 : 0;
      headTilt += (wantTilt - headTilt) * ease;

      // 4 + 5. the chosen clip, crossfaded, then applied with pose expansion / IK / contact
      bodyController.apply(frame.offsets);

      if (frame.faceDirty) {
        lastFrame = frame;
        repaintFace();
      }

      // The swat fires on the one frame the engine reports contact - an explicit trigger, not
      // something the idle scheduler could ever have rolled at the right moment.
      if ((state as { batted?: boolean }).batted) {
        director.play('toy-swat');
        // Let the toy itself react to being hit, not just the cat.
        toyProp?.struck?.();
      }

      // 5b. the toy, if there is one. Mounted/unmounted here rather than through a setter so
      // the renderer simply follows whatever the life engine says exists - there is no second
      // copy of "is there a toy right now" to fall out of sync.
      const toyState = (state as {
        toy?: { kind: string; position: { x: number; y: number }; velocity: { x: number; y: number }; charge?: number } | null;
      }).toy ?? null;
      if (toyState?.kind !== toyKind) {
        if (toyProp) {
          scene.remove(toyProp.object);
          if (toyProp.worldLayer) scene.remove(toyProp.worldLayer);
          toyProp.dispose();
          toyProp = null;
        }
        toyKind = (toyState?.kind as ToyKind | undefined) ?? null;
        if (toyKind) {
          toyProp = createToyProp(toyKind);
          toyProp.object.scale.setScalar(VOXEL_TO_WORLD * modelScale);
          toyProp.setWorldScale?.(VOXEL_TO_WORLD * modelScale);
          scene.add(toyProp.object);
          // World layers are added unscaled and unmoved - see ToyProp.worldLayer.
          if (toyProp.worldLayer) scene.add(toyProp.worldLayer);
        }
      }
      if (toyProp && toyState) {
        // Placed so the toy's own anchor height lands exactly on its logical screen point -
        // which for the cursor-driven toys means exactly on the pointer.
        const at = screenToWorld(toyState.position.x, toyState.position.y, toyProp.anchorHeight * effectiveScale());
        toyProp.object.position.copy(at);
        const toySpeed = Math.hypot(toyState.velocity.x, toyState.velocity.y);
        toyProp.update(deltaSeconds, toySpeed, toyState.charge ?? 0, {
          // Logical velocity mapped onto the ground plane, so a ball rolls the way it travels.
          x: toyState.velocity.x * worldPerPixelX,
          z: toyState.velocity.y * worldPerPixelZ,
          scale: 1 / Math.max(1e-6, effectiveScale()),
        });
      }

      // 5c. contact shadow, sized to the cat and faded by how far off the ground it is.
      {
        const spread = rig.boundingRadius * effectiveScale() * 2.1;
        shadow.position.copy(screenToWorld(state.position.x, state.position.y, 0.004));
        // root.position.y is whatever the ground-contact rule computed. The lowest value it
        // ever settles at is "standing"; anything above that means the cat is genuinely off
        // the floor (a jump, a rear-up, the claw lunge).
        groundedRootY = groundedRootY === 0 ? rig.root.position.y : Math.min(groundedRootY, rig.root.position.y);
        const lift = Math.max(0, rig.root.position.y - groundedRootY);
        const airborne = Math.min(1, lift / Math.max(1e-6, rig.boundingRadius * effectiveScale() * 0.6));
        shadow.scale.set(spread * (1 - airborne * 0.28), spread * 0.78 * (1 - airborne * 0.28), 1);
        (shadow.material as THREE.MeshBasicMaterial).opacity = (1 - airborne * 0.75) * 0.9;
      }

      // 6. placement - after apply(), because bodyController.reset() zeroes the root
      // transform and apply() owns root.position.y for ground contact.
      const stand = screenToWorld(state.position.x, state.position.y, 0);
      rig.root.position.x = stand.x;
      rig.root.position.z = stand.z;

      // --- facing -------------------------------------------------------------------------
      // Read straight off the engine's own heading. It used to be DERIVED here, by smoothing
      // the position deltas and taking their angle, and that derivation was the root of the
      // remaining shake: differentiating position turns every wobble in position into a wobble
      // in orientation, and the pixel->ground mapping amplifies it by ~2.5x for movement up or
      // down the screen (much more at a shallow camera), which is why it was worst travelling
      // diagonally. The engine now owns a heading it can only travel along, already rate
      // limited and already smooth, so there is nothing left to differentiate or to amplify.
      const headingScreen = (state as { heading?: number }).heading;
      if (headingScreen !== undefined && speed > FACING_SPEED_THRESHOLD) {
        // Screen heading -> ground-plane angle. Full 360 degrees, no fold and no clamp: folding
        // is what used to make the cat moonwalk away from the viewer instead of turning round.
        facingAngle = biasTowardViewer(
          Math.atan2(Math.cos(headingScreen) * worldPerPixelX, Math.sin(headingScreen) * worldPerPixelZ),
        );
        settledSince = null;
      } else if (headingScreen === undefined && speed > FACING_SPEED_THRESHOLD) {
        // A host whose engine predates headings still gets the old behaviour rather than none.
        facingAngle = Math.atan2(velocityX * worldPerPixelX, velocityY * worldPerPixelZ);
        settledSince = null;
      } else {
        // STOPPED: turn back to present the face. This is where "don't show the viewer your
        // back" belongs - it is a thing a settled cat does, not a constraint on locomotion.
        if (settledSince == null) settledSince = elapsed;
        if (elapsed - settledSince > SETTLE_DELAY_SECONDS) {
          let presentation = 0;
          if (cursor) {
            const toCursorX = cursor.x - state.position.x;
            const toCursorY = cursor.y - state.position.y;
            if (Math.hypot(toCursorX, toCursorY) > 40) {
              const raw = Math.atan2(toCursorX * worldPerPixelX, toCursorY * worldPerPixelZ);
              const folded = Math.abs(raw) > Math.PI / 2 ? Math.sign(raw) * (Math.PI - Math.abs(raw)) : raw;
              presentation = Math.max(-MAX_FACING_YAW, Math.min(MAX_FACING_YAW, folded));
            }
          }
          facingAngle = presentation;
        }
      }

      // Position already snaps 1:1 to the cursor while dragged (see main.ts's native
      // mousemove handler) - a slower rotation catch-up during a fast drag makes the body
      // visibly lag the anchor point even though the anchor itself is instant, reading as
      // "still not very responsive" on top of the latency fix. Snap orientation instantly
      // too while actively held; everywhere else turn at a bounded angular RATE (see
      // TURN_RATE), which both looks like a real turn and caps how far a single frame can
      // ever rotate the body.
      const previousBodyYaw = bodyYaw;
      if (state.state === 'dragged') {
        bodyYaw = facingAngle;
      } else {
        const toTurn = Math.atan2(Math.sin(facingAngle - bodyYaw), Math.cos(facingAngle - bodyYaw));
        const maxStep = TURN_RATE * deltaSeconds;
        bodyYaw += Math.abs(toTurn) <= maxStep ? toTurn : Math.sign(toTurn) * maxStep;
      }
      rig.root.rotation.y = bodyYaw;

      // The root yaw is the HIPS. bodyFlex lays a curve along the spine on top of it so the
      // nose leads the turn and the tail counterweights it - the difference between an animal
      // turning and a rigid model being rotated ("现在僵硬的身体非常不好，要灵活一点").
      const yawRate = deltaSeconds > 0
        ? Math.atan2(Math.sin(bodyYaw - previousBodyYaw), Math.cos(bodyYaw - previousBodyYaw)) / deltaSeconds
        : 0;
      bodyFlex.update(rig, yawRate, Math.max(walkAmount, state.state === 'dragged' ? 1 : 0), deltaSeconds);

      // A subtle, independent head turn toward the cursor - "how should the cat look at
      // me" - layered on top of the body's own facing rather than replacing it, and
      // clamped so it reads as a glance, not a neck injury.
      // The glance is WEIGHTED BY DISTANCE rather than gated by it. A hard on/off threshold is
      // what made the cursor shake the head when it sat near the cat: right at the boundary the
      // target flipped between "look at the cursor" and "look straight ahead" on alternate
      // frames, and just inside it the bearing to a cursor a few pixels away swings through
      // enormous angles for tiny mouse movements ("鼠标放到头上的时候如果位置偏一点的话就会
      // 晃"). Fading the glance to nothing as the cursor closes in fixes both: there is no
      // boundary to flicker across, and by the time the bearing gets unstable the weight that
      // would apply it is already zero.
      // Default: look back at the viewer, by however much the body is turned away. A cat
      // walking away while glancing back over its shoulder is both what cats do and what keeps
      // the face on screen. Only overridden when there is a cursor worth watching instead.
      let targetHeadYaw = Math.max(-0.55, Math.min(0.55, -facingAngle * 0.7));
      if (cursor) {
        const toCursorX = cursor.x - state.position.x;
        const toCursorY = cursor.y - state.position.y;
        const reach = Math.hypot(toCursorX, toCursorY);
        const weight = Math.min(1, Math.max(0, (reach - GLANCE_FADE_NEAR) / (GLANCE_FADE_FAR - GLANCE_FADE_NEAR)));
        if (weight > 0) {
          // A cursor to watch outranks the look-back, blended by the same distance weight so
          // there is no discontinuity where one takes over from the other.
          // Shortest-angle difference against the body's actual heading. Both are world-space
          // ground-plane angles in the same convention - differencing a raw cursor angle
          // against a folded body angle is what used to pin the head at its limit and flip its
          // sign the moment the cat crossed the cursor's x.
          const rawYaw = Math.atan2(toCursorX * worldPerPixelX, toCursorY * worldPerPixelZ);
          const delta = Math.atan2(Math.sin(rawYaw - facingAngle), Math.cos(rawYaw - facingAngle));
          const toCursor = Math.max(-0.5, Math.min(0.5, delta));
          targetHeadYaw = toCursor * weight + targetHeadYaw * (1 - weight);
        }
      }
      headYaw += (targetHeadYaw - headYaw) * (1 - Math.exp(-deltaSeconds / 0.24));
      const head = rig.node('head');
      head.rotation.y += headYaw;
      head.rotation.z += headTilt;
      head.rotation.x += cameraHeadPitch;

      renderer.render(scene, camera);
    },

    hitTest(point: { x: number; y: number }) {
      ndc.set((point.x / width) * 2 - 1, -(point.y / height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      // Precise: intersect the actual boxes. The old bounding-sphere test treated a
      // cat-shaped object as a ball, so a click in the empty space beside it still counted
      // as a grab and teleported the pet ("点击有时候会空白的地方影响整个位置").
      if (raycaster.intersectObject(rig.root, true).length > 0) return true;
      // ...but a precise silhouette is impossible to grab at the smallest size presets, so
      // keep the generous circle as a fallback only while the model really is that small.
      const worldRadius = rig.boundingRadius * effectiveScale();
      const minWorldRadius = MIN_HIT_RADIUS_PX * unitsPerPixelX;
      if (worldRadius >= minWorldRadius) return false;
      const catWorldPos = new THREE.Vector3();
      rig.root.getWorldPosition(catWorldPos);
      const sphere = new THREE.Sphere(catWorldPos, minWorldRadius);
      return raycaster.ray.intersectSphere(sphere, new THREE.Vector3()) !== null;
    },

    dispose() {
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
      shadowTexture.dispose();
      rig.dispose();
      bodyTexture.dispose();
      bodyMaterial.dispose();
      faceTexture.dispose();
      faceMaterial.dispose();
      faceGeometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
