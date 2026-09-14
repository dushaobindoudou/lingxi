// Renderer module (docs/05-technical-architecture.md). Owns the Three.js scene and
// the currently-mounted model; knows nothing about the desktop host or the life
// engine's decision-making, only the `Renderer` contract's render/hitTest/resize shape.
import * as THREE from 'three';
import type { Renderer, RendererCapabilities } from '../../../packages/desktop-host-contract/index.d.ts';
import { buildRig, type Rig } from './rig/skeleton.ts';
import { getSkin, DEFAULT_SKIN_ID } from './rig/skins.ts';
import { createIdleAnimator } from './anim/idle.ts';

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

  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x3a2e26, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(-1.2, 2, 1.5);
  scene.add(key);

  // The voxel rig replaces the old hand-assembled placeholder: same box aesthetic, but a
  // real joint hierarchy with pivots at the joints, built from data/skeleton.json so that
  // proportion-override skins work. See rig/skeleton.ts.
  let rig: Rig = buildRig(getSkin(DEFAULT_SKIN_ID));
  scene.add(rig.root);
  const idleAnimator = createIdleAnimator();

  // World units per voxel. The rig is authored at ~40 units nose-to-tail; the scene's
  // frustum is sized in the ~2.6-unit range, so it needs bringing down to scene scale.
  const VOXEL_TO_WORLD = 0.055;
  rig.root.scale.setScalar(VOXEL_TO_WORLD);

  let container: HTMLElement | null = null;
  let width = 1;
  let height = 1;
  let elapsed = 0;
  let modelScale = 1;
  let gaitPhase = 0;
  let lastPosition: { x: number; y: number } | null = null;
  let facingAngle = 0; // rotation.y the body is currently holding/turning toward (rig faces +Z)
  let headYaw = 0; // local head turn beyond the body's own facing, toward the cursor

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

  // World units per CSS pixel at the model's depth, recomputed on resize so the
  // life engine's pixel-space position maps onto a stable place in the ortho frustum.
  // Only used to size the frustum (apparent zoom) and, in hitTest, to convert a pixel radius
  // to a world-space one - NOT for placing the cat (see worldPerPixelX/Z below).
  let unitsPerPixelX = 0.01;
  let unitsPerPixelY = 0.01;
  // World units of ground-plane travel per logical pixel, along each *logical* axis (x = left/
  // right, y = up/down in screen space, i.e. life-engine's position.x/.y). NOT simply
  // unitsPerPixelX/Y: those describe the frustum's own scale, which only maps 1:1 to on-screen
  // travel for an axis the camera looks straight down. This camera is tilted (position
  // (0,1.4,2.6) looking at (0,0.4,0)), so a plain `position.x/.y * unitsPerPixelX/Y` mapping
  // undershoots badly - moving the cat all the way to a logical screen edge only got it
  // partway there on screen (reported as "上下左右似乎无法移动到边缘位置"): the frustum's
  // *half*-width is unitsPerPixelX*width, but a logical pixel offset from center only ever
  // reaches +-width/2, i.e. half of that half-width again; and vertically, ground-plane travel
  // (world z) only shows up on screen scaled by groundUp's z-component (~0.36 here, since the
  // camera's tilt means moving "into the screen" only partly reads as "up/down"), so the same
  // naive mapping undershot vertical travel far worse than horizontal. Solving for the actual
  // ground-plane basis (groundRight/groundUp, computed above from the real camera geometry)
  // fixes both by construction, and keeps working correctly if the camera tilt is ever tuned.
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
    preciseHitTest: false, // bounding-sphere hit test for now; swap in a raycast once the real mesh lands
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
      idleAnimator.update(rig, elapsed, deltaSeconds, gaitPhase, walkAmount);

      // life-engine position is in CSS-pixel space with +y downward (screen space); map onto
      // the ground plane the tilted camera looks down on, using worldPerPixelX/Z (see their
      // definition in applyFrustum) rather than the frustum's own unitsPerPixelX/Y - the
      // latter looked plausible and even got the sign right, but only ever got the cat
      // partway to a screen edge (reported as "上下左右似乎无法移动到边缘位置": worse
      // vertically than horizontally, because the camera's tilt foreshortens the z axis on
      // top of the shared shortfall on both axes - see worldPerPixelX/Z's comment for the
      // exact factors).
      const px = state.position.x - width / 2;
      const py = state.position.y - height / 2;
      rig.root.position.x = px * worldPerPixelX;
      rig.root.position.z = py * worldPerPixelZ;

      // Face the actual direction of travel, in the full 2D sense - not just left/right.
      // The old version only ever picked between two fixed left/right lean angles (from
      // `state.facing`, a left/right-only signal), so moving mostly up or down left the
      // body pointed sideways with no real up/down turn at all (reported: "向上，和向下
      // 走的时候他身体的方向好像不太对"). Must convert to the same world-space (x,z) the
      // position mapping above uses, not raw logical (dx,dy), before taking the angle:
      // worldPerPixelX and worldPerPixelZ are no longer equal (see their comment), so an
      // angle derived straight from logical pixels would point subtly wrong except when
      // moving purely horizontally or vertically - this was harmless before that fix (equal
      // scale factors on both axes leave atan2's angle unchanged) but would silently break
      // facing again if left as a raw-pixel angle now.
      // Held (not reset) when not moving, so it doesn't snap to a default when idle/dragged.
      if (moved > 0.5) {
        facingAngle = Math.atan2(dx * worldPerPixelX, dy * worldPerPixelZ);
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
      rig.node('head').rotation.y = headYaw;

      renderer.render(scene, camera);
    },

    hitTest(point: { x: number; y: number }) {
      ndc.set((point.x / width) * 2 - 1, -(point.y / height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const catWorldPos = new THREE.Vector3();
      rig.root.getWorldPosition(catWorldPos);
      const worldRadius = Math.max(rig.boundingRadius * VOXEL_TO_WORLD * modelScale, MIN_HIT_RADIUS_PX * unitsPerPixelX);
      const sphere = new THREE.Sphere(catWorldPos, worldRadius);
      const hitPoint = new THREE.Vector3();
      return raycaster.ray.intersectSphere(sphere, hitPoint) !== null;
    },

    dispose() {
      rig.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
