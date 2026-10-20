import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readMotion } from './helpers/realistic-motion-asset.mjs';
import { createLocomotion, steeringStrideScale } from '../src/realistic-locomotion.ts';

test('the shipped patched walk plants its supporting paws through a curved path', () => {
  const { root, nodes, clips } = readMotion();
  assert.ok(clips.Walk.stride > .27, 'exercise the runtime clips.glb, not the old shuffle');
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clips.Walk.clip).play();
  const motion = createLocomotion(root);
  const offsets = { 'FrontPaw.L': 0, 'FrontPaw.R': .5, 'RearPaw.L': .25, 'RearPaw.R': .75 };
  const previous = new Map();
  const dt = 1 / 120, rate = .8;
  let worst = 0;
  for (let i = 0; i < 360; i++) {
    motion.beforeMixer();
    mixer.update(dt / steeringStrideScale(rate));
    root.rotation.y += rate * dt;
    root.position.add(new THREE.Vector3(Math.sin(root.rotation.y), 0, Math.cos(root.rotation.y)).multiplyScalar(clips.Walk.stride / clips.Walk.clip.duration * dt));
    motion.update(dt, rate, true, 'Walk', action.time / action.getClip().duration);
    root.updateMatrixWorld(true);
    for (const [name, offset] of Object.entries(offsets)) {
      const phase = (action.time / action.getClip().duration + offset) % 1;
      const p = nodes.find(n => n.name === name).getWorldPosition(new THREE.Vector3());
      const last = previous.get(name);
      // Exclude touchdown and toe-off, which intentionally ease into/out of the anchor.
      if (last && phase > .10 && phase < .50 && last.phase > .10 && last.phase < .50) {
        worst = Math.max(worst, Math.hypot(p.x - last.p.x, p.z - last.p.z));
      }
      previous.set(name, { p, phase });
    }
  }
  assert.ok(worst < .0008, `supporting paw moved ${(worst * 1000).toFixed(2)} mm/frame while turning`);
});

test('steering bends the torso without accumulating offsets into the next mixer frame', () => {
  const { root, nodes, clips } = readMotion();
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(clips.Walk.clip).play();
  mixer.update(.2);
  const chest = nodes.find(n => n.name === 'Chest');
  const authored = chest.quaternion.clone();
  const motion = createLocomotion(root);
  motion.update(.1, 1.2, true, 'Walk', .15);
  assert.ok(chest.quaternion.angleTo(authored) > .005, 'the chest must follow the turn');
  motion.beforeMixer();
  assert.ok(chest.quaternion.angleTo(authored) < 1e-7, 'restore the authored pose before the mixer');
});

test('an in-place walk pivot retains the authored skeleton', () => {
  for (const [clipName, moving] of [['Walk', false]]) {
    const a = readMotion(), b = readMotion();
    const mixerA = new THREE.AnimationMixer(a.root), mixerB = new THREE.AnimationMixer(b.root);
    const actionA = mixerA.clipAction(a.clips[clipName].clip).play();
    mixerB.clipAction(b.clips[clipName].clip).play();
    const motion = createLocomotion(a.root);
    const names = ['Pelvis', 'Head', 'FrontPaw.L', 'FrontPaw.R', 'RearPaw.L', 'RearPaw.R'];
    for (let i = 0; i < 120; i++) {
      motion.beforeMixer();
      mixerA.update(1 / 120); mixerB.update(1 / 120);
      motion.update(1 / 120, 0, moving, clipName, actionA.time / actionA.getClip().duration);
      a.root.updateMatrixWorld(true); b.root.updateMatrixWorld(true);
      for (const name of names) {
        const actual = a.nodes.find(n => n.name === name).getWorldPosition(new THREE.Vector3());
        const original = b.nodes.find(n => n.name === name).getWorldPosition(new THREE.Vector3());
        assert.ok(actual.distanceTo(original) < .0002, `${clipName} ${name} changed`);
      }
    }
  }
});
