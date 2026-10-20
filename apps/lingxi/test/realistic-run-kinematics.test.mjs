import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readMotion } from './helpers/realistic-motion-asset.mjs';
import { createLocomotion, KITTEN_RUN } from '../src/realistic-locomotion.ts';

const PAWS = ['FrontPaw.L', 'FrontPaw.R', 'RearPaw.L', 'RearPaw.R'];
const at = (rig, name) => rig.nodes.find(n => n.name === name);
const y = bone => bone.getWorldPosition(new THREE.Vector3()).y;

function runPair() {
  const plain = readMotion(), kitten = readMotion();
  const a = new THREE.AnimationMixer(plain.root), b = new THREE.AnimationMixer(kitten.root);
  const action = a.clipAction(plain.clips.Run.clip).play();
  b.clipAction(kitten.clips.Run.clip).play();
  const motion = createLocomotion(kitten.root);
  const dt = plain.clips.Run.clip.duration / 240;
  const rows = [];
  for (let i = 0; i < 720; i++) {
    motion.beforeMixer();
    a.update(dt); b.update(dt);
    const phase = action.time / plain.clips.Run.clip.duration;
    motion.update(dt, 0, true, 'Run', phase);
    plain.root.updateMatrixWorld(true); kitten.root.updateMatrixWorld(true);
    if (i < 240) continue; // Ignore the run overlay's entry fade.
    const pawPoints = PAWS.map(name => [at(plain, name).getWorldPosition(new THREE.Vector3()), at(kitten, name).getWorldPosition(new THREE.Vector3())]);
    const paws = pawPoints.map(pair => [pair[0].y, pair[1].y]);
    const hip = [y(at(plain, 'Pelvis')), y(at(kitten, 'Pelvis'))];
    const shoulder = [y(at(plain, 'Chest')), y(at(kitten, 'Chest'))];
    const torso = [plain.nodes.find(n => n.name === 'Pelvis').getWorldPosition(new THREE.Vector3()).distanceTo(at(plain, 'Chest').getWorldPosition(new THREE.Vector3())),
      kitten.nodes.find(n => n.name === 'Pelvis').getWorldPosition(new THREE.Vector3()).distanceTo(at(kitten, 'Chest').getWorldPosition(new THREE.Vector3()))];
    const spine = [at(plain, 'Spine').quaternion.clone(), at(kitten, 'Spine').quaternion.clone()];
    const tail = [y(at(plain, 'Tail4')), y(at(kitten, 'Tail4'))];
    rows.push({ phase, paws, pawPoints, hip, shoulder, torso, spine, tail });
  }
  return { rows, plain, kitten, motion, mixers: [a, b], action, dt };
}

test('kitten bound bends its back, alternates hip and shoulder load, and keeps authored flight', () => {
  const { rows, plain } = runPair();
  const near = p => rows.filter(r => Math.abs(r.phase - p) < .025);
  const mean = (samples, f) => samples.reduce((sum, row) => sum + f(row), 0) / samples.length;
  const hipAt = p => mean(near(p), r => r.hip[1] - r.hip[0]);
  const shoulderAt = p => mean(near(p), r => r.shoulder[1] - r.shoulder[0]);
  const spineAt = p => mean(near(p), r => r.spine[0].angleTo(r.spine[1]));
  const torsoAt = p => mean(near(p), r => r.torso[1] - r.torso[0]);
  const pawDelta = Math.max(...rows.flatMap(r => r.paws.map(pair => Math.abs(pair[1] - pair[0]))));
  const pawPositionDelta = Math.max(...rows.flatMap(r => r.pawPoints.map(pair => pair[0].distanceTo(pair[1]))));
  const low = PAWS.map((_, i) => Math.min(...rows.map(r => r.paws[i][0])));
  const airborne = index => rows.filter(r => r.paws.filter((pair, i) => pair[index] > low[i] + .018).length >= 3).length;
  const tailLift = mean(near(.5), r => r.tail[1] - r.tail[0]);
  if (process.env.RUN_METRICS) console.log(JSON.stringify({
    duration: plain.clips.Run.clip.duration, stride: plain.clips.Run.stride,
    hipLandingMm: hipAt(.98) * 1000, hipFlightMm: hipAt(.5) * 1000,
    shoulderLandingMm: shoulderAt(.98) * 1000, shoulderFlightMm: shoulderAt(.5) * 1000,
    spineFlightDeg: THREE.MathUtils.radToDeg(spineAt(.5)), torsoFlightReachMm: torsoAt(.5) * 1000,
    torsoLandingGatherMm: torsoAt(.98) * 1000, tailFlightLiftMm: tailLift * 1000,
    maxPawHeightChangeMm: pawDelta * 1000, maxPawPositionChangeMm: pawPositionDelta * 1000,
    tripleAirborneFrames: [airborne(0), airborne(1)],
  }));
  assert.ok(plain.clips.Run.stride > .9, 'measure the shipped gallop');
  assert.ok(spineAt(.5) > .045, 'mid-flight spine should extend visibly');
  assert.ok(torsoAt(.5) > .006 && torsoAt(.98) < -.006, 'torso should lengthen in flight and gather at landing');
  assert.ok(hipAt(.98) > .002 && hipAt(.5) < -.002, 'hips should rise then compress');
  assert.ok(shoulderAt(.98) < -.002 && shoulderAt(.5) > .002, 'shoulders should counter the hips');
  assert.ok(tailLift > .08, 'run tail should lift above the authored hanging tail');
  assert.ok(pawDelta < .003, 'the body overlay should leave paw heights near the clip');
  assert.ok(pawPositionDelta < .003, 'the body overlay should leave paw trajectories near the clip');
  assert.ok(airborne(0) > 0 && airborne(1) > 0, 'the clip flight must remain');
  assert.ok(Math.abs(airborne(1) - airborne(0)) < 3, 'do not add or erase a flight beat');
});

test('run overlay enters and leaves smoothly without accumulating on mixer poses', () => {
  const { plain, kitten, motion, mixers, action, dt } = runPair();
  const tailA = at(plain, 'Tail0'), tailB = at(kitten, 'Tail0');
  let first = 0, previous = Infinity;
  for (let i = 0; i < 240; i++) {
    motion.beforeMixer();
    mixers[0].update(dt); mixers[1].update(dt);
    motion.update(dt, 0, false, 'Idle', action.time / action.getClip().duration);
    const offset = tailA.quaternion.angleTo(tailB.quaternion);
    if (i === 0) first = offset;
    assert.ok(offset <= previous + 1e-5, 'run tail should fade rather than jump or accumulate');
    previous = offset;
  }
  assert.ok(first > .05, 'outgoing run pose should still be present on the first frame');
  assert.ok(previous < .001, 'outgoing overlay should disappear after the fade');
  let entry = 0, settled = 0;
  for (let i = 0; i < 240; i++) {
    motion.beforeMixer();
    mixers[0].update(dt); mixers[1].update(dt);
    motion.update(dt, 0, true, 'Run', action.time / action.getClip().duration);
    const offset = tailA.quaternion.angleTo(tailB.quaternion);
    if (i === 0) entry = offset;
    if (i === 239) settled = offset;
  }
  assert.ok(entry < KITTEN_RUN.tailLift[0] * .1, 'first run frame should ease in');
  assert.ok(settled > KITTEN_RUN.tailLift[0] * .7, 'the run overlay should reach full strength');
});

test('walking into a crossfaded run eases in the extra tail carriage', () => {
  const plain = readMotion(), kitten = readMotion();
  const a = new THREE.AnimationMixer(plain.root), b = new THREE.AnimationMixer(kitten.root);
  const walkA = a.clipAction(plain.clips.Walk.clip).play();
  const walkB = b.clipAction(kitten.clips.Walk.clip).play();
  const runA = a.clipAction(plain.clips.Run.clip);
  const runB = b.clipAction(kitten.clips.Run.clip);
  const motion = createLocomotion(kitten.root);
  const dt = 1 / 120;
  for (let i = 0; i < 120; i++) {
    motion.beforeMixer(); a.update(dt); b.update(dt);
    motion.update(dt, 0, true, 'Walk', walkA.time / walkA.getClip().duration);
  }
  runA.reset().play(); runB.reset().play();
  walkA.crossFadeTo(runA, .25, false);
  walkB.crossFadeTo(runB, .25, false);
  const tailA = at(plain, 'Tail0'), tailB = at(kitten, 'Tail0');
  const offsets = [];
  for (let i = 0; i < 90; i++) {
    motion.beforeMixer(); a.update(dt); b.update(dt);
    motion.update(dt, 0, true, 'Run', runA.time / runA.getClip().duration);
    offsets.push(tailA.quaternion.angleTo(tailB.quaternion));
  }
  assert.ok(offsets[0] < .03, 'the first run frame should stay close to the walk pose');
  assert.ok(offsets[30] > .12, 'the tail lift should grow through the clip crossfade');
  assert.ok(offsets.at(-1) > .17, 'the run carriage should settle at its full lift');
});
