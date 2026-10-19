import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readMotion } from './helpers/realistic-motion-asset.mjs';
import { createLocomotion, KITTEN_WALK } from '../src/realistic-locomotion.ts';
import { locomotionRate, matchedWalkStride, walkCadence } from '../src/realistic-motion.ts';

const PAWS = [
  ['FrontPaw.L', 0], ['FrontPaw.R', .5], ['RearPaw.L', .25], ['RearPaw.R', .75],
];
const wrap = n => ((n % 1) + 1) % 1;

function measureWalk(desiredRate = 1.3) {
  const { root, nodes, clips } = readMotion();
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clips.Walk.clip).play();
  const motion = createLocomotion(root);
  const pawNodes = PAWS.map(([name]) => nodes.find(n => n.name === name));
  const pelvis = nodes.find(n => n.name === 'Pelvis');
  const dt = 1 / 120;
  const groundSpeed = clips.Walk.stride * KITTEN_WALK.stride / clips.Walk.clip.duration * desiredRate;
  const rate = walkCadence(locomotionRate(groundSpeed * dt, dt, clips.Walk.stride * KITTEN_WALK.stride, 1, clips.Walk.clip.duration));
  const strideScale = matchedWalkStride(KITTEN_WALK.stride, desiredRate, rate, 1);
  const records = PAWS.map(() => []), hips = [], all = [];
  for (let i = 0; i < Math.ceil(clips.Walk.clip.duration / rate / dt) * 4; i++) {
    motion.beforeMixer();
    mixer.update(dt * rate);
    root.position.z += groundSpeed * dt;
    const phase = action.time / action.getClip().duration;
    motion.update(dt, 0, true, 'Walk', phase, strideScale);
    root.updateMatrixWorld(true);
    hips.push(pelvis.getWorldPosition(new THREE.Vector3()).y);
    const sample = pawNodes.map((paw, j) => {
      const p = paw.getWorldPosition(new THREE.Vector3());
      const relativePhase = wrap(phase + PAWS[j][1]);
      const row = { p, phase: relativePhase, frame: i };
      records[j].push(row);
      return row;
    });
    all.push(sample);
  }
  const slip = [], swing = [], supportY = [], supportYRange = [], positionJumps = [];
  for (const rows of records) {
    let maxStep = 0, maxSpan = 0, maxSwing = -Infinity;
    let maxJump = 0, maxJumpPhase = 0;
    for (let i = 1; i < rows.length; i++) {
      const jump = rows[i].p.distanceTo(rows[i - 1].p);
      if (jump > maxJump) { maxJump = jump; maxJumpPhase = rows[i].phase; }
    }
    positionJumps.push({ distance: maxJump, phase: maxJumpPhase });
    const support = rows.filter(r => r.phase > .02 && r.phase < .60);
    for (let i = 1; i < support.length; i++) {
      const a = support[i - 1], b = support[i];
      if (b.frame !== a.frame + 1) continue;
      maxStep = Math.max(maxStep, Math.hypot(b.p.x - a.p.x, b.p.z - a.p.z));
    }
    let start = support[0];
    for (let i = 1; i <= support.length; i++) {
      if (i === support.length || support[i].frame !== support[i - 1].frame + 1) {
        const end = support[i - 1];
        maxSpan = Math.max(maxSpan, Math.hypot(end.p.x - start.p.x, end.p.z - start.p.z));
        start = support[i];
      }
    }
    const floor = Math.min(...support.map(r => r.p.y));
    supportY.push(floor);
    supportYRange.push(Math.max(...support.map(r => r.p.y)) - floor);
    for (const r of rows) if (r.phase > .69 && r.phase < .93) maxSwing = Math.max(maxSwing, r.p.y - floor);
    slip.push({ maxStep, maxSpan }); swing.push(maxSwing);
  }
  const airborne = all.map(rows => rows.filter((r, j) => r.p.y > supportY[j] + .018).length);
  return {
    supportSlipMaxFrame: Math.max(...slip.map(s => s.maxStep)),
    supportSlipMaxSpan: Math.max(...slip.map(s => s.maxSpan)),
    supportYRange,
    positionJumps,
    swingLiftMin: Math.min(...swing), swingLift: swing,
    airborneMax: Math.max(...airborne), airborneTripleFrames: airborne.filter(n => n >= 3).length,
    pelvisRange: Math.max(...hips) - Math.min(...hips),
    pelvisSamples: hips.slice(0, 120).filter((_, i) => i % 10 === 0),
  };
}

test('shipped walk has planted support, visible swing clearance, and a loaded torso', () => {
  const metrics = measureWalk();
  if (process.env.WALK_METRICS) console.log(JSON.stringify(metrics));
  assert.ok(metrics.supportSlipMaxFrame < .0004, 'support paw should not skate frame to frame');
  assert.ok(metrics.supportSlipMaxSpan < .001, 'support paw should stay planted across the stance');
  assert.ok(Math.max(...metrics.supportYRange) < .005, 'support paw should not bob visibly above its landing point');
  assert.ok(metrics.swingLiftMin > .060, 'each paw should clear the floor visibly during swing');
  assert.ok(Math.max(...metrics.positionJumps.map(j => j.distance)) < .009, 'toe-off should not snap to the swing path');
  assert.ok(metrics.airborneMax <= 2, 'a walk retains at least two supporting paws');
  assert.ok(metrics.pelvisRange > .015 && metrics.pelvisRange < .035, 'the loaded torso dips and recovers gently');
});

test('slow capped cadence shortens the foot sweep to match ground travel', () => {
  const metrics = measureWalk(.2);
  assert.ok(metrics.supportSlipMaxSpan < .001);
  assert.ok(metrics.airborneMax <= 2);
  assert.ok(matchedWalkStride(.72, .2, .5, 1) < .3);
});
