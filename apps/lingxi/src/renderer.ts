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
import { paintSkin, paintFace, type ArtSkin, type FaceState } from './rig/art.ts';
import { createBodyController } from './anim/body-controller.ts';
import { createDirector } from './anim/director.ts';
import { createIdleAnimator } from './anim/idle.ts';

/** Refined proportions: boxes overlap at the bending joints so the torso reads as one soft
 *  body instead of a chain of separate blocks. Same joint topology, so every clip and pose
 *  authored against the base skeleton still applies. */
const SKELETON = refineSkeleton(skeletonData as unknown as SkeletonData);
const SKINS = catalogue as ArtSkin[];
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
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  // Steep-ish downward tilt (position well above and only modestly behind the look-at
  // point), not the shallower (0,1.4,2.6) this used to be. Reason: the position-mapping
  // below (worldPerPixelZ) moves the cat along world Z to cover the full logical-Y range,
  // but the *near/far clip test* is a dot product with camForward (0,0.1) - a SEPARATE
  // axis from the on-screen-vertical axis (groundUp). With the old, shallower tilt,
  // camForward's Z-component was much larger relative to groundUp's Z-component
  // (|camForward.z/groundUp.z| ~= 2.6), so the same on-screen vertical range consumed way
  // more of the near..far depth budget than intended: the logical bottom edge mapped to a
  // *negative* view-space depth (behind the camera - reported as "下边界会消失"), and the
  // top edge landed close enough to `far` to leave a visible dead zone before actually
  // reaching the frustum's edge ("上边界有个 gap 始终无法拖动上去"). A steeper tilt
  // shrinks that ratio (~0.65 here) enough that the full logical-Y range maps to depths
  // that stay safely inside (near, far) even at a 1:1 (square-ish) window aspect ratio -
  // see worldPerPixelZ's comment for the derivation this depends on.
  camera.position.set(0, 2.4, 1.3);
  camera.lookAt(0, 0.4, 0);

  // The ground-plane (world y=0) basis the tilted camera actually sees, derived from its real
  // position/lookAt rather than assumed - see the worldPerPixelX/Z comment in applyFrustum for
  // why this matters. `groundRight`/`groundUp` are the world-space directions that move the
  // projected image purely right and purely up, restricted to travel *on the ground plane*
  // (the cat's y stays fixed - only x/z ever change).
  const camForward = new THREE.Vector3(0, 0.4, 0).sub(camera.position).normalize();
  const groundRight = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();
  const groundUp = new THREE.Vector3().crossVectors(groundRight, camForward); // cross of two orthonormal unit vectors: already unit length

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

  // --- the mounted cat: rig + painted body atlas + painted face decal -------------------
  const faceCanvas = document.createElement('canvas');
  faceCanvas.width = faceCanvas.height = 256;
  const faceTexture = new THREE.CanvasTexture(faceCanvas);
  faceTexture.colorSpace = THREE.SRGBColorSpace;
  faceTexture.generateMipmaps = false;
  faceTexture.minFilter = faceTexture.magFilter = THREE.LinearFilter;

  let skin: ArtSkin = SKINS.find((s) => s.id === DEFAULT_SKIN_ID) ?? SKINS[0];
  let rig!: Rig;
  let bodyTexture!: THREE.CanvasTexture;
  let bodyMaterial!: THREE.MeshStandardMaterial;
  let faceMaterial!: THREE.MeshBasicMaterial;
  let faceGeometry!: THREE.PlaneGeometry;
  let bodyController!: ReturnType<typeof createBodyController>;

  const idleAnimator = createIdleAnimator();
  const director = createDirector(SKELETON.nodes.map((node) => node.id));

  function mountSkin(next: ArtSkin) {
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
    rig.root.scale.setScalar(VOXEL_TO_WORLD * modelScale);

    const atlas = paintSkin(SKELETON.nodes, skin);
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
    paintFace(faceCanvas, skin, director.update(0, 'idle', false).face, false);
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

  mountSkin(skin);

  /** Shortest-path angle interpolation - a naive lerp can spin the long way around
   *  when the target crosses the -PI/PI seam, which looks like a wrong-way flip. */
  function lerpAngle(from: number, to: number, t: number): number {
    const delta = Math.atan2(Math.sin(to - from), Math.cos(to - from));
    return from + delta * t;
  }

  // Radians of leg-swing phase per logical pixel of ground covered - tuned so the stride
  // looks natural at the default wander speed (packages/life-engine's cfg.speed), not tied
  // to any particular animation frame rate or life-engine speed setting.
  const GAIT_PHASE_PER_PIXEL = 0.09;
  // Never let the clickable/draggable region shrink below this, even at the smallest tray
  // size preset (0.25x) - a hit target that shrinks proportionally with visual scale becomes
  // impractically small to grab (reported as "拖拽也有问题不是很灵敏").
  const MIN_HIT_RADIUS_PX = 40;
  // How far the body may yaw away from "square to the viewer". The cat is a desktop pet seen
  // on a flat screen: if it ever turns past profile the face - the entire expressive surface,
  // and the whole point of the face decal - is pointing at the wallpaper. See the fold in
  // render() for how rear-facing travel directions get mirrored into this range.
  const MAX_FACING_YAW = Math.PI * 0.42;

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

  const capabilities: RendererCapabilities = {
    locomotion: true,
    facing: true,
    idleAnimation: true,
    preciseHitTest: true, // real raycast against the rig's boxes (see hitTest)
  };

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
      rig.root.scale.setScalar(VOXEL_TO_WORLD * modelScale);
    },

    render(state, deltaSeconds: number, cursor: { x: number; y: number } | null) {
      elapsed += deltaSeconds;

      // Advance the gait phase by actual distance moved (an odometer, not a clock) so the
      // legs cycle in proportion to ground covered - see the idle animator's doc comment.
      const dx = lastPosition ? state.position.x - lastPosition.x : 0;
      const dy = lastPosition ? state.position.y - lastPosition.y : 0;
      const moved = Math.hypot(dx, dy);
      lastPosition = { x: state.position.x, y: state.position.y };
      gaitPhase += moved * GAIT_PHASE_PER_PIXEL;
      // Amplitude still needs a walking/idle gate: standing still should hold a settled
      // pose (amplitude 0) rather than freeze mid-stride at whatever phase it stopped at.
      const walking = state.state === 'wander' || state.state === 'follow_cursor' || state.state === 'ai_directed';
      const walkAmount = walking && moved > 0.01 ? 1 : 0;

      // 1. rest pose, 2. involuntary baseline
      bodyController.reset();
      idleAnimator.update(rig, elapsed, deltaSeconds, gaitPhase, walkAmount);

      // 3. the current expression's implied ear/head pose, eased rather than snapped
      const frame = director.update(deltaSeconds, state.state, walkAmount > 0);
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
        paintFace(faceCanvas, skin, frame.face, frame.blink);
        faceTexture.needsUpdate = true;
      }

      // 6. placement - after apply(), because bodyController.reset() zeroes the root
      // transform and apply() owns root.position.y for ground contact.
      const px = state.position.x - width / 2;
      const py = state.position.y - height / 2;
      rig.root.position.x = px * worldPerPixelX;
      rig.root.position.z = py * worldPerPixelZ;

      // Face the direction of travel - but never past profile. The raw ground-plane angle is
      // geometrically right for a 3D scene and wrong for this one: walking toward the bottom
      // of the screen maps to travelling away from the camera, which turned the cat's back on
      // the viewer and hid the face entirely ("他要跟屏幕外的人交互...否则看不到脸了").
      // Folding - mirroring a rear-facing angle across the screen plane, keeping its left/right
      // sign - is continuous (unlike a clamp, where a hair's difference around straight-down
      // would flip the cat ~144 degrees) and reads naturally: the cat simply walks "down" while
      // still angled toward you.
      if (moved > 0.5) {
        const raw = Math.atan2(dx * worldPerPixelX, dy * worldPerPixelZ);
        const folded = Math.abs(raw) > Math.PI / 2 ? Math.sign(raw) * (Math.PI - Math.abs(raw)) : raw;
        facingAngle = Math.max(-MAX_FACING_YAW, Math.min(MAX_FACING_YAW, folded));
      }
      // Position already snaps 1:1 to the cursor while dragged (see main.ts's native
      // mousemove handler) - a slower rotation catch-up during a fast drag makes the body
      // visibly lag the anchor point even though the anchor itself is instant, reading as
      // "still not very responsive" on top of the latency fix. Snap orientation instantly
      // too while actively held; keep the gentler ease everywhere else (wander/follow
      // shouldn't spin on a dime, that looks robotic rather than alive).
      const rotationLerp = state.state === 'dragged' ? 1 : Math.min(1, deltaSeconds * 10);
      rig.root.rotation.y = lerpAngle(rig.root.rotation.y, facingAngle, rotationLerp);

      // A subtle, independent head turn toward the cursor - "how should the cat look at
      // me" - layered on top of the body's own facing rather than replacing it, and
      // clamped so it reads as a glance, not a neck injury.
      let targetHeadYaw = 0;
      if (cursor) {
        const toCursorX = cursor.x - state.position.x;
        const toCursorY = cursor.y - state.position.y;
        if (Math.hypot(toCursorX, toCursorY) > 4) {
          // Same world-space conversion as facingAngle above, and for the same reason: this
          // is compared directly against facingAngle below, so it must be measured in the
          // same (world-space) angle convention or the comparison itself is meaningless.
          const desiredYaw = Math.atan2(toCursorX * worldPerPixelX, toCursorY * worldPerPixelZ);
          const delta = Math.atan2(Math.sin(desiredYaw - facingAngle), Math.cos(desiredYaw - facingAngle));
          targetHeadYaw = Math.max(-0.5, Math.min(0.5, delta));
        }
      }
      headYaw += (targetHeadYaw - headYaw) * Math.min(1, deltaSeconds * 6);
      const head = rig.node('head');
      head.rotation.y += headYaw;
      head.rotation.z += headTilt;

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
      const worldRadius = rig.boundingRadius * VOXEL_TO_WORLD * modelScale;
      const minWorldRadius = MIN_HIT_RADIUS_PX * unitsPerPixelX;
      if (worldRadius >= minWorldRadius) return false;
      const catWorldPos = new THREE.Vector3();
      rig.root.getWorldPosition(catWorldPos);
      const sphere = new THREE.Sphere(catWorldPos, minWorldRadius);
      return raycaster.ray.intersectSphere(sphere, new THREE.Vector3()) !== null;
    },

    dispose() {
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
