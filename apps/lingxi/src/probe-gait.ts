// Rig motion probe - dev-only, NOT a build input (see vite.config.ts's inputs). Open
// /probe-gait.html against `npm run dev`.
//
// This exists because of one specific, structural bug and is the regression check for it:
// ground contact used to be re-derived every frame from the bounding box of the whole posed
// body, INCLUDING the legs the walk cycle was swinging. The gait is rotation-only with no foot
// planting, so its paws dip below the floor line, and the contact rule answered by shoving the
// entire cat upward - 0.70 voxels of travel with jumps of up to 0.30 in a single frame at
// follow speed, every bit of it inherited by the head. Reported as the cat's head shaking
// whenever it moved ("走路的时候导致的闪烁...头就一直晃动...应该是整个骨骼结构的系统问题" -
// correctly diagnosed as structural).
//
// It now also measures the two things that replaced the old placeholder walk, plus what the
// cat actually gets up to in 'auto' mode. What "healthy" looks like, and what this page must
// keep printing:
//   rootY range        = 0.0000 in every row   (the body does not move vertically at all)
//   headY step         < 0.001                 (breathing only, ~0.04 range over 4s)
//   planted-foot slide < ~0.005 voxels/frame   (against a body advancing 0.10-0.24/frame, so
//                                               ~2%: the feet are genuinely on the ground.
//                                               This is what stops it looking like it floats)
//   performance-only clips wrongly auto-picked: none
// If rootY range is ever non-zero again while walking, the contact/gait coupling is back; if
// the foot slide approaches the body advance, foot planting has stopped working.
import * as THREE from 'three';
import skeletonData from './data/skeleton.json';
import skins from './data/skins.json';
import { refineSkeleton } from './rig/anatomy.ts';
import { buildRig, type SkeletonData } from './rig/skeleton.ts';
import { createIdleAnimator } from './anim/idle.ts';
import { createBodyController } from './anim/body-controller.ts';

const SKELETON = refineSkeleton(skeletonData as unknown as SkeletonData);
const skin = (skins as any[]).find((s) => s.id === 'honey-mittens');
const rig = buildRig(skin, SKELETON);
const controller = createBodyController(rig, SKELETON);
const idle = createIdleAnimator(rig);
const head = rig.node('head');

const dt = 1 / 60;
let elapsed = 0;
let gaitPhase = 0;
const lines: string[] = [];

function stats(label: string, walkAmount: number, gaitStep: number, frames = 240) {
  const rootYs: number[] = [];
  const headYs: number[] = [];
  const headXs: number[] = [];
  const tailXs: number[] = [];
  const pawYs: number[] = [];
  const lastPawZ: Record<string, number> = {};
  const previousPlanted: Record<string, boolean> = {};
  let bodyZ = 0;
  let slide = 0;
  const localZ: Record<string, { min: number; max: number }> = {};
  // Stance is determined by PHASE, which the gait defines exactly - not by guessing from the
  // paw's height. Height-based classification counts the first and last frames of the swing
  // (where the lift is still near zero but the paw is travelling fast) as stance, and reports
  // the swing speed as "slide". That measurement error is what made a correct gait look broken.
  const DUTY = 0.62;
  const PAW_PHASE: Record<string, number> = { pawBL: 0, pawFL: 0.25, pawBR: 0.5, pawFR: 0.75 };
  const isPlanted = (id: string, c: number) => (((c + PAW_PHASE[id]) % 1) + 1) % 1 < DUTY;
  for (let i = 0; i < frames; i += 1) {
    elapsed += dt;
    gaitPhase += gaitStep;
    controller.reset();
    idle.update(rig, elapsed, dt, gaitPhase, walkAmount);
    controller.apply({});
    rig.root.updateMatrixWorld(true);
    head.updateWorldMatrix(true, false);
    rootYs.push(rig.root.position.y);
    headYs.push(head.matrixWorld.elements[13]);
    headXs.push(head.matrixWorld.elements[12]);
    tailXs.push(rig.node('tail6').getWorldPosition(new THREE.Vector3()).x);
    // FOOT SLIDE is the number that matters now: how far a planted paw moves in WORLD space
    // while it is supposed to be standing still on the ground. Anything above ~0 is the cat
    // skating, which is what "floating instead of walking" looks like.
    const box = new THREE.Box3();
    rig.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.visible) box.expandByObject(o); });
    pawYs.push(box.min.y);
    // Advance the body by exactly the ground distance this frame's phase step represents, then
    // record where each paw sits in that moving world frame.
    bodyZ += gaitStep * idle.strideVoxels;
    const cyclesNow = gaitPhase;
    for (const id of ['pawFL', 'pawFR', 'pawBL', 'pawBR']) {
      const p = rig.node(id).getWorldPosition(new THREE.Vector3());
      localZ[id] = localZ[id] ?? { min: Infinity, max: -Infinity };
      localZ[id].min = Math.min(localZ[id].min, p.z);
      localZ[id].max = Math.max(localZ[id].max, p.z);
      const worldZ = p.z + bodyZ;
      const previous = lastPawZ[id];
      const planted = isPlanted(id, cyclesNow);
      if (planted && previous !== undefined && previousPlanted[id]) {
        slide = Math.max(slide, Math.abs(worldZ - previous));
      }
      lastPawZ[id] = worldZ;
      previousPlanted[id] = planted;
    }
  }
  const range = (a: number[]) => Math.max(...a) - Math.min(...a);
  const maxStep = (a: number[]) => { let m = 0; for (let i = 1; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - a[i - 1])); return m; };
  lines.push(
    `${label.padEnd(28)} rootY range=${range(rootYs).toFixed(4)} step=${maxStep(rootYs).toFixed(4)}` +
    `  headY range=${range(headYs).toFixed(4)} step=${maxStep(headYs).toFixed(4)}` +
    `  headX range=${range(headXs).toFixed(4)}` +
    `  tailTipX range=${range(tailXs).toFixed(4)}` +
    `  worst planted-foot slide/frame=${slide.toFixed(4)}` +
    `  pawFL local z travel=${(localZ.pawFL ? localZ.pawFL.max - localZ.pawFL.min : 0).toFixed(3)}`,
  );
}

// Cycles per frame at each pace: ground covered per frame divided by the gait's own stride.
// (Representative screen: 1470x956, 24-degree camera, 1x size preset.)
const u = 2.6 / 1470;
const worldPerPixelX = 2 * u;
const strideWorld = idle.strideVoxels * 0.055;
const cyclesPerFrame = (pxPerSecond: number) => (pxPerSecond / 60) * worldPerPixelX / strideWorld;
lines.push(`gait strideVoxels = ${idle.strideVoxels.toFixed(3)}`);
stats('standing still', 0, 0);
stats('walking (wander 90px/s)', 1, cyclesPerFrame(90));
stats('walking (follow 225px/s)', 1, cyclesPerFrame(225));
document.getElementById('out')!.textContent = lines.join('\n');

// --- behaviour probe: does 'auto' mode actually do things? ---------------------------------
// Runs the real life engine and the real director against each other for five simulated
// minutes, with the same walkAmount gate the renderer uses. Deterministic, headless, and - the
// point - free of interference from whatever the live app is doing at the time.
import { createLifeEngine } from '../../../packages/life-engine/src/index.mjs';
import { createDirector } from './anim/director.ts';

{
  const engine = createLifeEngine({ bounds: { width: 1470, height: 956 }, position: { x: 735, y: 478 } });
  const director = createDirector(SKELETON.nodes.map((n) => n.id));
  const step = 1 / 60;
  let vx = 0;
  let vy = 0;
  let walkBlend = 0;
  let last: { x: number; y: number } | null = null;
  let heldFor: string | null = null;
  const started: Record<string, number> = {};
  let framesWithClip = 0;
  let framesWalking = 0;
  const totalFrames = 60 * 300;

  for (let f = 0; f < totalFrames; f += 1) {
    const now = f * (1000 / 60);
    const snap = engine.tick(now, null);
    const dx = last ? snap.position.x - last.x : 0;
    const dy = last ? snap.position.y - last.y : 0;
    last = { ...snap.position };
    const ease = 1 - Math.exp(-step / 0.22);
    vx += (dx / step - vx) * ease;
    vy += (dy / step - vy) * ease;
    const speed = Math.hypot(vx, vy);
    const walking = snap.state === 'wander' || snap.state === 'follow_cursor' || snap.state === 'ai_directed' || snap.state === 'play_toy';
    walkBlend += ((walking && speed > 26 * 0.35 ? 1 : 0) - walkBlend) * (1 - Math.exp(-step / 0.14));
    const moving = walkBlend > 0.5;
    if (moving) framesWalking += 1;

    director.update(step, snap.state, moving);
    const playing = director.playing;
    if (playing) {
      framesWithClip += 1;
      if (playing.id !== heldFor) {
        heldFor = playing.id;
        started[playing.id] = (started[playing.id] ?? 0) + 1;
        engine.hold(playing.remainingMs, now);
      }
    } else {
      heldFor = null;
    }
  }

  const totalStarts = Object.values(started).reduce((a, b) => a + b, 0);
  lines.push('');
  lines.push(`--- 'auto' mode over 5 simulated minutes ---`);
  lines.push(`  clips played: ${totalStarts} (about one every ${(300 / Math.max(1, totalStarts)).toFixed(1)}s)`);
  lines.push(`  distinct clips: ${Object.keys(started).length} of ${director.actions.length} in the library`);
  lines.push(`  time walking: ${((100 * framesWalking) / totalFrames).toFixed(0)}%   time performing: ${((100 * framesWithClip) / totalFrames).toFixed(0)}%`);
  const forbidden = Object.keys(started).filter((id) => director.actions.find((a) => a.id === id)?.category === '特效');
  lines.push(`  performance-only clips wrongly auto-picked: ${forbidden.length === 0 ? 'none' : forbidden.join(', ')}`);
  document.getElementById('out')!.textContent = lines.join('\n');
}
