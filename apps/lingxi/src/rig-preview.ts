// Standalone rig preview harness - runs in a plain browser, no Tauri.
//
// Exists because the companion window can only be inspected by launching the real macOS app,
// which makes iterating on the rig (pivots, rest pose, poses, gait, skins) slow and hard to
// verify. This page builds the same rig the app builds, from the same data, so anything that
// looks right here looks right there.
//
// Not part of the shipped app: it's a separate Vite entry, only built when explicitly asked.
import * as THREE from 'three';
import { buildRig, type Rig } from './rig/skeleton.ts';
import { getSkin, listSkins, DEFAULT_SKIN_ID } from './rig/skins.ts';
import { createIdleAnimator } from './anim/idle.ts';

const stage = document.getElementById('stage')!;
const stats = document.getElementById('stats')!;
const skinSelect = document.getElementById('skin') as HTMLSelectElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2a2622);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
const renderer = new THREE.WebGLRenderer({ antialias: true });
stage.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xfff3e0, 0x3a2e26, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.0);
key.position.set(-1.2, 2, 1.5);
scene.add(key);

// Ground reference: the rest-pose paws must sit exactly on this line, which is the quickest
// visual check that groundOffset was derived correctly.
const grid = new THREE.GridHelper(120, 24, 0x6b5c4e, 0x453c34);
scene.add(grid);

const animator = createIdleAnimator();
let rig: Rig = buildRig(getSkin(DEFAULT_SKIN_ID));
scene.add(rig.root);

let walking = false;
let spinning = false;
let gaitPhase = 0;
let elapsed = 0;
let viewAngle = { theta: Math.PI * 0.25, height: 14, distance: 80 };

function refreshStats() {
  const box = new THREE.Box3().setFromObject(rig.root);
  const size = box.getSize(new THREE.Vector3());
  stats.textContent = [
    `盒子数: ${countBoxes(rig.root)}`,
    `包围盒: ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)}`,
    `离地修正: ${rig.groundOffset.toFixed(2)}`,
    `最低点 y: ${box.min.y.toFixed(3)}  (应为 0)`,
    `后腿总长: ${(rig.segmentLength('thighL') + rig.segmentLength('shinL') + rig.segmentLength('footL')).toFixed(1)}`,
  ].join('\n');
}

function countBoxes(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n += 1;
  });
  return n;
}

function rebuild(skinId: string) {
  rig.dispose();
  rig = buildRig(getSkin(skinId));
  scene.add(rig.root);
  refreshStats();
  refit();
}

for (const skin of listSkins()) {
  const option = document.createElement('option');
  option.value = skin.id;
  option.textContent = `${skin.name} (${skin.id})`;
  skinSelect.appendChild(option);
}
skinSelect.value = DEFAULT_SKIN_ID;
skinSelect.addEventListener('change', () => rebuild(skinSelect.value));

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
document.getElementById('toggle-spin')!.addEventListener('click', () => {
  spinning = !spinning;
});

/** The rig's origin is hipC, not its centre of mass, so the view has to be framed on the
 *  measured bounds - otherwise the cat sits off-screen and every proportion judgement made
 *  from this harness would be made on a badly cropped image. */
const focus = new THREE.Vector3();
let fitRadius = 26;

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
refreshStats();
refit();

let last = performance.now();
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
  animator.update(rig, elapsed, dt, gaitPhase, walkAmount);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
