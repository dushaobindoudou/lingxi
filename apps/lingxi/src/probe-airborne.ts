// Airborne probe - dev-only, NOT a build input. Open /probe-airborne.html against `npm run dev`.
//
// test/airborne.test.mjs checks the KEYFRAMES of every jump. That is necessary and it was not
// sufficient: those keyframes were fine, in voxels, while the body controller added them to a
// root scaled by VOXEL_TO_WORLD x size, so the cat drawn on screen jumped in world units - six
// shoulder heights at 12g at the medium size - and every test stayed green. This page measures
// what the pose pipeline actually does to the body, with the root scaled and yawed the way the
// renderer leaves it, so a unit or frame mistake anywhere between the JSON and the mesh shows
// up as a number.
//
// For each clip that moves the root it reports, in voxels and cm: the most daylight under the
// lowest point of the body, how long it was off the floor, the gravity the torso's own
// trajectory implies during that time, and how far the body travelled along its facing.
import * as THREE from 'three';
import skeletonData from './data/skeleton.json';
import skins from './data/skins.json';
import { refineSkeleton } from './rig/anatomy.ts';
import { buildRig, type SkeletonData } from './rig/skeleton.ts';
import { createIdleAnimator } from './anim/idle.ts';
import { createBodyController } from './anim/body-controller.ts';
import { createDirector } from './anim/director.ts';

const SKELETON = refineSkeleton(skeletonData as unknown as SkeletonData);
const VOXEL_CM = (skeletonData as { units: { voxelCm: number } }).units.voxelCm;
const skin = (skins as any[]).find((s) => s.id === 'honey-mittens');
const rig = buildRig(skin, SKELETON);
const controller = createBodyController(rig, SKELETON);
const idle = createIdleAnimator(rig);
const director = createDirector(SKELETON.nodes.map((n) => n.id));

// renderer.ts's VOXEL_TO_WORLD at the medium size preset, and a yaw that is not a multiple of
// 90 degrees, so a lunge applied in the wrong frame cannot happen to line up.
const SCALE = 0.055 * 0.5;
const YAW = 0.6;

const meshes: THREE.Mesh[] = [];
rig.root.traverse((o) => { if (o instanceof THREE.Mesh && o.visible) { o.geometry.computeBoundingBox(); meshes.push(o); } });
const box = new THREE.Box3();
const part = new THREE.Box3();
const torso = new THREE.Vector3();
const facing = new THREE.Vector3();

function pose(offsets: Record<string, number>) {
  controller.reset();
  rig.root.scale.setScalar(SCALE);
  controller.apply(offsets);
  rig.root.rotation.y = YAW; // the renderer sets yaw after apply(), so do the same
  rig.root.updateMatrixWorld(true);
  box.makeEmpty();
  for (const mesh of meshes) { part.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld); box.union(part); }
  rig.node('spine2').getWorldPosition(torso);
  // Travel measured along the cat's own forward axis (+z rotated by the yaw), in voxels.
  facing.set(Math.sin(YAW), 0, Math.cos(YAW));
  return {
    clearance: box.min.y / SCALE,
    torso: torso.y / SCALE,
    forward: (torso.x * facing.x + torso.z * facing.z) / SCALE,
  };
}

const rest = pose({});
const crouched = pose({ 'pose.crouch': 1 });

const report: Record<string, unknown> = {
  voxelCm: VOXEL_CM,
  shoulderVoxels: (skeletonData as { reference: { shoulderHeight: number } }).reference.shoulderHeight,
  crouchDepthVoxels: +(rest.torso - crouched.torso).toFixed(2),
  clips: {} as Record<string, unknown>,
};

const dt = 1 / 60;
for (const motion of director.actions) {
  if (!motion.tracks.some((t) => t.channel.startsWith('root.position.'))) continue;
  director.play(motion.id);
  let elapsed = 0;
  const frames: { t: number; clearance: number; torso: number; forward: number }[] = [];
  const count = Math.ceil(motion.duration / dt) + 2;
  for (let f = 0; f < count; f += 1) {
    elapsed += dt;
    controller.reset();
    idle.update(rig, elapsed, dt, 0, 0);
    const frame = director.update(dt, 'idle', false);
    frames.push({ t: +(f * dt).toFixed(4), ...pose(frame.offsets) });
  }
  const airborne = frames.filter((f) => f.clearance > 0.05);
  // Gravity from the torso itself: second differences over consecutive airborne frames. A
  // body in free fall has the same second difference on every one of them.
  const accel: number[] = [];
  for (let i = 1; i + 1 < frames.length; i += 1) {
    if (frames[i - 1].clearance > 0.05 && frames[i].clearance > 0.05 && frames[i + 1].clearance > 0.05) {
      accel.push((frames[i + 1].torso - 2 * frames[i].torso + frames[i - 1].torso) / (dt * dt));
    }
  }
  const mean = accel.length ? accel.reduce((a, b) => a + b, 0) / accel.length : null;
  const forward = frames.map((f) => f.forward - rest.forward);
  (report.clips as Record<string, unknown>)[motion.id] = {
    maxClearanceVoxels: +Math.max(...frames.map((f) => f.clearance)).toFixed(2),
    maxClearanceCm: +(Math.max(...frames.map((f) => f.clearance)) * VOXEL_CM).toFixed(1),
    airborneFrames: airborne.length,
    airborneSeconds: +(airborne.length * dt).toFixed(3),
    torsoGravityMs2: mean === null ? null : +((-mean * VOXEL_CM) / 100).toFixed(2),
    torsoGravitySpreadMs2: accel.length ? +(((Math.max(...accel) - Math.min(...accel)) * VOXEL_CM) / 100).toFixed(2) : null,
    forwardMaxVoxels: +Math.max(...forward).toFixed(2),
    forwardMinVoxels: +Math.min(...forward).toFixed(2),
    torsoPeakAboveRestVoxels: +(Math.max(...frames.map((f) => f.torso)) - rest.torso).toFixed(2),
    trace: frames.filter((_, i) => i % 2 === 0).map((f) => [f.t, +f.clearance.toFixed(2), +(f.torso - rest.torso).toFixed(2)]),
  };
}

document.getElementById('out')!.textContent = JSON.stringify(report);
document.title = 'done';

// ?strip - draw the poses side-on against a floor line, so the numbers above can be checked by eye.
// Each panel is [clip, seconds]; a clip of '' is the rest pose.
if (new URLSearchParams(location.search).has('strip')) {
  const { sampleMotion } = await import('./anim/motion.ts');
  const DEFAULT_PANELS: [string, number, string][] = [
    ['', 0, 'standing'],
    ['hop-catch', 0.44, 'hop-catch: coil'],
    ['hop-catch', 0.596, 'hop-catch: apex 3 vox'],
    ['pounce', 1.287, 'pounce: apex 2.5 vox'],
    ['claw-screen', 1.35, 'claw-screen: apex 1.5 vox'],
    ['rear-up', 1.0, 'rear-up: grounded'],
  ];
  // ?strip=clip@seconds,clip@seconds overrides the default set.
  const custom = new URLSearchParams(location.search).get('strip');
  const panels: [string, number, string][] = custom
    ? custom.split(',').map((entry) => { const [id, at] = entry.split('@'); return [id, Number(at ?? 0), entry]; })
    : DEFAULT_PANELS;
  const W = 220, H = 260;
  const canvas = document.createElement('canvas');
  canvas.width = W * panels.length; canvas.height = H;
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#f4efe6';
  document.body.appendChild(canvas);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0xf4efe6);
  renderer.setScissorTest(true);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x3a2e26, 1.3), new THREE.AmbientLight(0xffffff, 0.5));
  scene.add(rig.root);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(60, 0.15, 60), new THREE.MeshBasicMaterial({ color: 0x5a4a3a }));
  floor.position.y = -0.075;
  scene.add(floor);
  // One shoulder height (10 voxels) of ruler, at the back, for scale.
  for (let v = 0; v <= 10; v += 1) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, v % 5 ? 1.2 : 2.4), new THREE.MeshBasicMaterial({ color: 0x9a8a78 }));
    tick.position.set(-8, v, -22);
    scene.add(tick);
  }
  const camera = new THREE.OrthographicCamera(-20, 20, 30, -17, 0.1, 200);
  camera.position.set(60, 7, 0);
  camera.lookAt(0, 7, 0);
  const byId = new Map(director.actions.map((a) => [a.id, a]));
  panels.forEach(([id, t], i) => {
    controller.reset();
    rig.root.scale.setScalar(1);
    controller.apply(id ? sampleMotion(byId.get(id)!, t) : {});
    rig.root.rotation.y = 0;
    rig.root.updateMatrixWorld(true);
    renderer.setViewport(i * W, 0, W, H);
    renderer.setScissor(i * W, 0, W, H);
    renderer.render(scene, camera);
  });
  const labels = document.createElement('div');
  labels.style.cssText = `display:flex;font:12px ui-monospace,monospace;color:#3a2e26`;
  for (const [, , label] of panels) {
    const cell = document.createElement('div');
    cell.style.cssText = `width:${W}px;text-align:center;padding:4px 0`;
    cell.textContent = label;
    labels.appendChild(cell);
  }
  document.body.appendChild(labels);
  document.title = 'strip';
}
