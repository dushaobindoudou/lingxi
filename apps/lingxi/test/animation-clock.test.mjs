import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { frameDelta } from '../src/animation-clock.ts';

test('the actual animation mixer finishes a two-second clip in two seconds at 5, 10, 30 and 60 fps', () => {
  for (const fps of [5, 10, 30, 60]) {
    const root = new THREE.Object3D();
    const clip = new THREE.AnimationClip('two seconds', 2, [new THREE.NumberKeyframeTrack('.position[x]', [0, 2], [0, 1])]);
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    for (let i = 1; i <= fps * 2; i++) mixer.update(frameDelta((i - 1) * 1000 / fps, i * 1000 / fps, 'realistic'));
    assert.ok(Math.abs(root.position.x - 1) < 1e-6, `${fps} FPS: ${root.position.x}`);
  }
  assert.equal(frameDelta(null, 100000, 'realistic'), 0);
  assert.equal(frameDelta(100, 300, 'voxel'), .1);
});
