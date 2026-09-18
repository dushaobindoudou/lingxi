// Standalone rig preview harness - runs in a plain browser, no Tauri.
//
// Exists because the companion window can only be inspected by launching the real macOS app,
// which makes iterating on the rig (pivots, rest pose, poses, gait, skins) slow and hard to
// verify. This page assembles a frame the SAME way renderer.ts does - refined skeleton,
// painted body atlas, face decal, idle baseline, director, body controller - so anything that
// looks right here looks right there. Keep the two composition orders in sync; a preview that
// composes differently from the app is worse than no preview.
//
// Not part of the shipped app: it's a separate Vite entry, only built when explicitly asked.
import * as THREE from 'three';
import { buildRig, type Rig, type SkeletonData } from './rig/skeleton.ts';
import skeletonData from './data/skeleton.json';
import catalogue from './data/skins.json';
import { refineSkeleton } from './rig/anatomy.ts';
import { paintSkin, paintFace, type ArtSkin, type FaceState } from './rig/art.ts';
import { createBodyController } from './anim/body-controller.ts';
import { createDirector } from './anim/director.ts';
import { createIdleAnimator } from './anim/idle.ts';

const SKELETON = refineSkeleton(skeletonData as unknown as SkeletonData);
const SKINS = catalogue as ArtSkin[];
const DEFAULT_SKIN_ID = 'honey-mittens';
const EAR_ANGLE: Record<FaceState['ear'], number> = { neutral: 0, forward: 0.13, airplane: 0.8, back: -0.48 };
const FACE_BOX = /^(eye|pupil|brow|nose|mouth|whisker|jaw|tongue)/;

const stage = document.getElementById('stage')!;
const stats = document.getElementById('stats')!;
const skinSelect = document.getElementById('skin') as HTMLSelectElement;
const actionSelect = document.getElementById('action') as HTMLSelectElement;
const stateSelect = document.getElementById('pet-state') as HTMLSelectElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2622);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
stage.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xfff3e0, 0x3a2e26, 1.1));
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 1.0);
key.position.set(-1.2, 2, 1.5);
scene.add(key);

// Ground reference: the rest-pose paws must sit exactly on this line, which is the quickest
// visual check that ground contact was derived correctly.
const grid = new THREE.GridHelper(120, 24, 0x6b5c4e, 0x453c34);
scene.add(grid);

const faceCanvas = document.createElement('canvas');
faceCanvas.width = faceCanvas.height = 256;
const faceTexture = new THREE.CanvasTexture(faceCanvas);
faceTexture.colorSpace = THREE.SRGBColorSpace;
faceTexture.generateMipmaps = false;
faceTexture.minFilter = faceTexture.magFilter = THREE.LinearFilter;

// Built in mountSkin, because the gait measures its stride off the rig's real bone lengths.
let idleAnimator!: ReturnType<typeof createIdleAnimator>;
const director = createDirector(SKELETON.nodes.map((n) => n.id));

let skin: ArtSkin = SKINS.find((s) => s.id === DEFAULT_SKIN_ID) ?? SKINS[0];
let rig!: Rig;
let bodyTexture!: THREE.CanvasTexture;
let bodyMaterial!: THREE.MeshStandardMaterial;
let faceMaterial!: THREE.MeshBasicMaterial;
let faceGeometry!: THREE.PlaneGeometry;
let bodyController!: ReturnType<typeof createBodyController>;

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

  const atlas = paintSkin(SKELETON.nodes, skin);
  bodyTexture = new THREE.CanvasTexture(atlas.canvas);
  bodyTexture.colorSpace = THREE.SRGBColorSpace;
  bodyTexture.magFilter = bodyTexture.minFilter = THREE.NearestFilter;
  bodyTexture.generateMipmaps = false;
  bodyMaterial = new THREE.MeshStandardMaterial({ map: bodyTexture, roughness: 1, metalness: 0 });
  rig.root.traverse((o) => { if (o instanceof THREE.Mesh) o.material = bodyMaterial; });
  for (const node of SKELETON.nodes) {
    if (!FACE_BOX.test(node.id)) continue;
    for (const child of rig.node(node.id).children) if (child instanceof THREE.Mesh) child.visible = false;
  }

  const headSpec = SKELETON.nodes.find((n) => n.id === 'head')!;
  const [hx, hy, hz] = headSpec.box.size;
  faceGeometry = new THREE.PlaneGeometry(hx, hy);
  faceMaterial = new THREE.MeshBasicMaterial({
    map: faceTexture, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const faceMesh = new THREE.Mesh(faceGeometry, faceMaterial);
  faceMesh.position.set(headSpec.box.offset[0], headSpec.box.offset[1], headSpec.box.offset[2] + hz / 2 + 0.025);
  rig.node('head').add(faceMesh);

  bodyController = createBodyController(rig, SKELETON);
  idleAnimator = createIdleAnimator(rig);
  refreshStats();
  refit();
}

let walking = false;
let spinning = false;
let gaitPhase = 0;
let elapsed = 0;
let earAngle = 0;
let headTilt = 0;
let viewAngle = { theta: Math.PI * 0.25, height: 14, distance: 80 };

/** The rig's origin is hipC, not its centre of mass, so the view has to be framed on the
 *  measured bounds - otherwise the cat sits off-screen and every proportion judgement made
 *  from this harness would be made on a badly cropped image. Declared above mountSkin
 *  because mountSkin -> refit() reads them. */
const focus = new THREE.Vector3();
let fitRadius = 26;

function refreshStats() {
  const box = new THREE.Box3().setFromObject(rig.root);
  const size = box.getSize(new THREE.Vector3());
  const action = director.currentAction;
  stats.textContent = [
    `盒子数: ${countBoxes(rig.root)}`,
    `包围盒: ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}`,
    `最低点 y: ${box.min.y.toFixed(3)}  (应为 0)`,
    `动作库: ${director.actions.length} 个`,
    `当前动作: ${action ? action.name : '—'}`,
  ].join('\n');
}

function countBoxes(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) n += 1; });
  return n;
}

for (const s of SKINS) {
  const option = document.createElement('option');
  option.value = s.id;
  option.textContent = `${s.name} (${s.pattern})`;
  skinSelect.appendChild(option);
}
skinSelect.value = DEFAULT_SKIN_ID;
skinSelect.addEventListener('change', () => {
  mountSkin(SKINS.find((s) => s.id === skinSelect.value) ?? SKINS[0]);
});

mountSkin(skin);

{
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = '（自动）';
  actionSelect.appendChild(auto);
  for (const action of director.actions) {
    const option = document.createElement('option');
    option.value = action.id;
    option.textContent = `${action.name} · ${action.category ?? ''}`;
    actionSelect.appendChild(option);
  }
}
actionSelect.addEventListener('change', () => {
  if (actionSelect.value) director.play(actionSelect.value);
});

document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    spinning = false;
    if (btn.dataset.view === 'side') viewAngle = { theta: Math.PI / 2, height: 6, distance: 80 };
    if (btn.dataset.view === 'front') viewAngle = { theta: 0, height: 6, distance: 80 };
    if (btn.dataset.view === 'three') viewAngle = { theta: Math.PI * 0.25, height: 14, distance: 80 };
  });
});
document.getElementById('toggle-walk')!.addEventListener('click', (e) => {
  walking = !walking;
  (e.target as HTMLButtonElement).textContent = walking ? '停止' : '开始走';
});
document.getElementById('toggle-spin')!.addEventListener('click', () => { spinning = !spinning; });

function refit() {
  const box = new THREE.Box3().setFromObject(rig.root);
  box.getCenter(focus);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  fitRadius = sphere.radius * 1.15;
  resize();
}

function resize() {
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, true);
  const aspect = w / h;
  const halfH = aspect >= 1 ? fitRadius : fitRadius / aspect;
  const halfW = halfH * aspect;
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

let last = performance.now();
let statsTimer = 0;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  elapsed += dt;
  if (spinning) viewAngle.theta += dt * 0.6;

  camera.position.set(
    focus.x + Math.sin(viewAngle.theta) * viewAngle.distance,
    focus.y + viewAngle.height,
    focus.z + Math.cos(viewAngle.theta) * viewAngle.distance,
  );
  camera.lookAt(focus);

  const walkAmount = walking ? 1 : 0;
  gaitPhase += dt * (walking ? 7 : 0);

  // Same composition order as renderer.ts - see its header comment.
  bodyController.reset();
  idleAnimator.update(rig, elapsed, dt, gaitPhase, walkAmount);
  const dframe = director.update(dt, stateSelect.value, walkAmount > 0);
  const ease = 1 - Math.exp(-dt / 0.16);
  earAngle += ((EAR_ANGLE[dframe.face.ear] ?? 0) - earAngle) * ease;
  rig.node('earL').rotation.z -= earAngle;
  rig.node('earR').rotation.z += earAngle;
  const wantTilt = dframe.face.symbol === 'question' ? 0.12 : dframe.face.eye === 'half' ? 0.07 : 0;
  headTilt += (wantTilt - headTilt) * ease;
  bodyController.apply(dframe.offsets);
  rig.node('head').rotation.z += headTilt;
  if (dframe.faceDirty) {
    paintFace(faceCanvas, skin, dframe.face, dframe.blink);
    faceTexture.needsUpdate = true;
  }

  statsTimer += dt;
  if (statsTimer > 0.25) { statsTimer = 0; refreshStats(); }

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
