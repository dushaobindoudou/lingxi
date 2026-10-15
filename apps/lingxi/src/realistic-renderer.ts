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
// The coat: the Cycles render uses ~500k curve hairs, which a desktop pet cannot draw; here every coat mesh is drawn
// a few more times pushed out along its skinned normal (shell fur), with a cell noise cutting strands out of each
// shell. Soft, warm light and a contact shadow - no shadow map - keep it cheap and gentle.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { Renderer, RendererCapabilities } from '../../../packages/desktop-host-contract/index.d.ts';
import { AUTO_CAMERA_FOR_STATE, CAMERA_HEAD_PITCH, CAMERA_PRESETS, DEFAULT_CAMERA_ID, cameraPreset } from './rig/cameras.ts';

export interface RealisticRendererOptions {
  /** URL of the exported GLB. */
  assetUrl: string;
  /** Size the canvas to the cat rather than the screen (see renderer.ts, fitCanvasToFrame). */
  fitCanvasToCat?: boolean;
  /** Fur shells per coat mesh (0 = bare skin). */
  shells?: number;
}

export type ReadyRenderer = Renderer & { readonly ready: Promise<void> };

// Same apparent size as the voxel cat at scale 1. rig/cameras.ts says "the cat is ~0.8 tall", but the voxel cat's head
// and body measure 1.24x that on screen (harness, scale .5: 77 px against the realistic cat's 62 at .8).
const TARGET_HEIGHT = 1.0;
const MIN_HIT_RADIUS_PX = 40;
const MAX_FACING_YAW = Math.PI * 0.42;
const VELOCITY_SMOOTHING_SECONDS = 0.22;
const FACING_SPEED_THRESHOLD = 26;
const TURN_RATE = 5.2;
const SETTLE_DELAY_SECONDS = 0.5;
const CAMERA_EASE_SECONDS = 0.55;
const CAMERA_DISTANCE = 6;
const RUN_SPEED_PX = 300;
const CROSSFADE_SECONDS = 0.28;

// Coat meshes that get shells: strand length (m, model space) and strand cells per metre.
const FUR: Record<string, { len: number; den: number }> = {
  LX_Head: { len: 0.020, den: 520 },
  LX_Body: { len: 0.042, den: 380 },
  LX_Legs: { len: 0.030, den: 420 },
  LX_Tail: { len: 0.058, den: 360 },
};

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
};
// Loops: held until something else is asked for.
const LOOPING = new Set(['Idle', 'Walk', 'Run', 'Sleep', 'SideLie', 'Loaf', 'Sit', 'LieDown']);
// Clips that carry the body across the floor; the engine owns position, so their horizontal travel is removed.
const TRAVELLING = ['Walk', 'Run', 'Jump'];

export function createRealisticRenderer(options: RealisticRendererOptions): ReadyRenderer {
  const shellCount = Math.max(0, Math.min(32, options.shells ?? 10));
  const fitCanvas = options.fitCanvasToCat === true;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Gentle, film-like roll-off: the white chest and paws keep their texture instead of clipping.
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.5;

  // Soft, warm studio light - the "治愈" look: a broad warm key from the front-left, a creamy sky / ground fill so no
  // side goes cold or dark, and a warm rim from behind that lights the coat's edge into a soft halo.
  const key = new THREE.DirectionalLight(0xfff0e0, 2.1);
  key.position.set(-1.3, 2.4, 2.2);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffe0c4, 1.5);
  rim.position.set(0.6, 1.6, -2.0);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xfff7ee, 0xe9d8c6, 1.0));

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
  const bones: THREE.Bone[] = [];
  let headBone: THREE.Bone | null = null;
  const shellMaterials: THREE.Material[] = [];
  const ownedMaterials: THREE.Material[] = [];
  let loaded = false;
  let debugInfo: unknown = null;
  let disposed = false;

  function irisMaterial(src: THREE.MeshStandardMaterial) {
    const m = new THREE.MeshStandardMaterial({ map: src.map ?? null, roughness: 0.42, color: src.map ? 0xffffff : src.color });
    ownedMaterials.push(m);
    return m;
  }
  function shellMaterial(len: number, den: number, t: number) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, alphaToCoverage: true });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uShell = { value: t };
      sh.uniforms.uLen = { value: len };
      sh.uniforms.uDen = { value: den };
      sh.vertexShader = 'uniform float uShell; uniform float uLen; attribute float furScale; varying vec3 vRest; varying float vScale;\n'
        + sh.vertexShader
          .replace('#include <begin_vertex>', '#include <begin_vertex>\n vRest = position; vScale = furScale;')
          .replace('#include <skinning_vertex>', `#include <skinning_vertex>
            float h = uShell * uLen * furScale;
            transformed += normalize(objectNormal) * h;
            transformed.y -= 0.3 * h * uShell;`);
      sh.fragmentShader = 'uniform float uShell; uniform float uDen; varying vec3 vRest; varying float vScale;\n'
        + 'float furHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }\n'
        + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
            vec3 q = vRest * uDen;
            float strand = furHash(floor(q));
            float r = length(fract(q) - 0.5);
            // A strand's cross-section fades out over its edge instead of being cut (alpha to coverage on the MSAA
            // buffer): hard discards made the outline a grain of single pixels.
            float edge = 0.62 * (1.0 - uShell) + 0.06;
            float a = smoothstep(edge + 0.08, edge - 0.04, r) * step(uShell * 0.85, strand) * step(0.02, vScale);
            if (a < 0.02) discard;
            diffuseColor.a = a;
            // roots a little deeper, tips catching the light: soft, not spiky
            diffuseColor.rgb *= mix(0.70, 1.10, uShell);`);
    };
    m.customProgramCacheKey = () => 'realcat-fur-shell';
    shellMaterials.push(m);
    return m;
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
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        let s = 1;
        for (const e of eyes) s = Math.min(s, THREE.MathUtils.clamp((v.distanceTo(e) - 0.036) / 0.03, 0, 1));
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

  const ready = new GLTFLoader().loadAsync(options.assetUrl).then((gltf) => {
    if (disposed) return;
    const root = gltf.scene;
    root.updateMatrixWorld(true);
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

    const coat: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = false;
      const mat = m.material as THREE.MeshStandardMaterial;
      const name = mat?.name ?? '';
      if (/Iris/i.test(name)) m.material = irisMaterial(mat);
      else if (/Cornea/i.test(name)) {
        const c = new THREE.MeshPhysicalMaterial({
          color: 0x000000, roughness: 0.04, transparent: true, opacity: 0.0, specularIntensity: 1,
          envMapIntensity: 1.0, depthWrite: false, premultipliedAlpha: true,
        });
        ownedMaterials.push(c);
        m.material = c;
        m.renderOrder = 2;
      } else if (m.geometry.getAttribute('color')) {
        const s = new THREE.MeshStandardMaterial({
          vertexColors: true, roughness: /Lid/i.test(name) ? 0.85 : 0.9, map: mat?.map ?? null, side: THREE.DoubleSide,
        });
        ownedMaterials.push(s);
        m.material = s;
      } else if (mat?.isMaterial) {
        mat.side = THREE.DoubleSide;
      }
      const base = m.name.split('.')[0].replace(/_\d+$/, '');
      if ((m as THREE.SkinnedMesh).isSkinnedMesh && FUR[base]) coat.push(m as THREE.SkinnedMesh);
    });
    for (const base of coat) {
      const f = FUR[base.name.split('.')[0].replace(/_\d+$/, '')];
      furScaleAttribute(base, bonePos);
      for (let i = 1; i <= shellCount; i++) {
        const s = new THREE.SkinnedMesh(base.geometry, shellMaterial(f.len, f.den, i / shellCount));
        s.bind(base.skeleton, base.bindMatrix);
        s.morphTargetInfluences = base.morphTargetInfluences;
        s.morphTargetDictionary = base.morphTargetDictionary;
        s.position.copy(base.position);
        s.quaternion.copy(base.quaternion);
        s.scale.copy(base.scale);
        s.frustumCulled = false;
        base.parent!.add(s);
      }
    }

    mixer = new THREE.AnimationMixer(root);
    for (const clip of gltf.animations) {
      if (TRAVELLING.includes(clip.name)) strides[clip.name] = stripTravel(clip);
      actions[clip.name] = mixer.clipAction(clip);
    }
    catRoot.add(root);
    model = root;
    catRoot.scale.setScalar(effectiveScale());
    play('Idle');
    loaded = true;
  });

  function play(name: string, once = false) {
    const next = actions[name];
    if (!next || (next === current && !once)) return false;
    next.reset();
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
  function fitCanvasToFrame() {
    const drawn = measureDrawnRect();
    catRect = drawn;
    const full = performanceScale != null;
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
      target.appendChild(renderer.domElement);
      const st = renderer.domElement.style;
      st.position = 'absolute';
      if (fitCanvas) { st.left = '0'; st.top = '0'; st.willChange = 'transform'; } else st.inset = '0';
      st.pointerEvents = 'none';
    },
    resize(w: number, h: number) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
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
    playExpression() {
      return false; // P2: face-controls.json through the GLB's shape keys and face bones
    },
    get playingAction() {
      if (!oneShot) return null;
      const remainingMs = Math.max(0, (oneShot.endsAt - elapsed) * 1000);
      return remainingMs > 0 ? { id: oneShot.id, remainingMs, legFree: false } : null;
    },
    get currentExpression() {
      return { name: '安然', held: false };
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
      return {
        style: 'realistic',
        debug: debugInfo,
        clips: Object.keys(actions),
        actions: Object.keys(ACTION_CLIPS).filter((id) => actions[ACTION_CLIPS[id]]),
        expressions: [],
        cameras: CAMERA_PRESETS.map((p) => ({ id: p.id, name: p.name })),
      };
    },
    render(state, deltaSeconds, cursor) {
      elapsed += deltaSeconds;
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
      const speed = Math.hypot(velocityX, velocityY);

      // --- which clip ---
      if (loaded) {
        if (oneShot && elapsed >= oneShot.endsAt) oneShot = null;
        const moving = (state.state === 'wander' || state.state === 'ai_directed' || state.state === 'play_toy' || state.state === 'follow_cursor')
          && speed > FACING_SPEED_THRESHOLD * 0.35;
        if (moving) oneShot = null;
        let want = currentName;
        if (oneShot) want = oneShot.clip;
        else if (state.state === 'sleep') want = 'Sleep';
        else if (moving) want = speed > RUN_SPEED_PX && actions.Run ? 'Run' : 'Walk';
        else want = 'Idle';
        if (want !== currentName && !(oneShot && want === oneShot.clip && currentName === want)) play(want, oneShot != null && !LOOPING.has(want));
        // stride-matched playback: one clip cycle per stride of ground actually covered
        if (current && (currentName === 'Walk' || currentName === 'Run') && strides[currentName] > 0) {
          const groundSpeed = Math.hypot(velocityX * worldPerPixelX, velocityY * worldPerPixelZ); // world units / s
          const cycle = strides[currentName] * effectiveScale(); // world units per cycle
          const natural = cycle / current.getClip().duration;
          current.timeScale = THREE.MathUtils.clamp(groundSpeed / Math.max(1e-6, natural), 0.35, 2.5);
        } else if (current) current.timeScale = 1;
        mixer!.update(deltaSeconds);
      }

      // --- placement and facing (as renderer.ts) ---
      const stand = screenToWorld(state.position.x, state.position.y, 0);
      catRoot.position.set(stand.x, 0, stand.z);
      shadow.position.copy(screenToWorld(state.position.x, state.position.y, 0.004));
      const spread = TARGET_HEIGHT * (performanceScale ?? modelScale) * 0.95;
      shadow.scale.set(spread, spread * 0.62, 1);

      const headingScreen = (state as { heading?: number }).heading;
      if (headingScreen !== undefined && speed > FACING_SPEED_THRESHOLD) {
        facingAngle = Math.atan2(Math.cos(headingScreen) * worldPerPixelX, Math.sin(headingScreen) * worldPerPixelZ);
        settledSince = null;
      } else if (headingScreen === undefined && speed > FACING_SPEED_THRESHOLD) {
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
      if (state.state === 'dragged') bodyYaw = facingAngle;
      else {
        const toTurn = Math.atan2(Math.sin(facingAngle - bodyYaw), Math.cos(facingAngle - bodyYaw));
        const maxStep = TURN_RATE * deltaSeconds;
        bodyYaw += Math.abs(toTurn) <= maxStep ? toTurn : Math.sign(toTurn) * maxStep;
      }
      catRoot.rotation.y = bodyYaw;
      if (headBone && cameraHeadPitch) headBone.rotation.x += cameraHeadPitch;

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
      (shadow.material as THREE.Material).dispose();
      shadowTexture.dispose();
      envTarget.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  return api;
}
