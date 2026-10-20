import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { readMotion } from './helpers/realistic-motion-asset.mjs';
import { locomotionRate, locomotionClip } from '../src/realistic-motion.ts';

const asset = new URL('../public/characters/lingxi-realistic/current/cat.glb', import.meta.url);

// Read transforms directly: this exercises the shipped skeleton and clips without requiring image decoders or a GPU.

test('moving the integrated cat preserves its authored rear-foot trajectories at small and large sizes', { skip: !existsSync(asset) }, () => {
  for (const [scale, speed] of [[.315, .32], [.63, .08], [1.26, .08], [.315, .005]]) {
    const { root, nodes, clips } = readMotion();
    const authored = readMotion(false);
    const chosen = locomotionClip(speed, clips.Walk.stride * scale / clips.Walk.clip.duration, false, true);
    const { clip, stride } = clips[chosen];
    const feet = nodes.filter((n) => /^RearFoot\.[LR]$/.test(n.name));
    assert.equal(feet.length, 2);
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(clip).play();
    const sourceMixer = new THREE.AnimationMixer(authored.root);
    sourceMixer.clipAction(authored.clips[chosen].clip).play();
    const sourceFeet = authored.nodes.filter((n) => /^RearFoot\.[LR]$/.test(n.name));
    root.scale.setScalar(scale);
    authored.root.scale.setScalar(scale);
    const dt = 1 / 120;
    const rate = locomotionRate(speed * dt, dt, stride, scale, clip.duration);
    const count = Math.ceil(clip.duration * 2 / rate / dt);
    for (let i = 0; i < count; i++) {
      mixer.update(dt * rate);
      root.position.z += speed * dt;
      root.updateMatrixWorld(true);
      // Compare against the original travelling clip at the phase required by actual ground distance.
      // This includes the real foot roll/IK residuals; a bone tip near the ground is not itself a stationary sole.
      const cycles = speed * (i + 1) * dt / (stride * scale);
      sourceMixer.setTime((cycles % 1) * clip.duration);
      authored.root.position.z = Math.floor(cycles) * stride * scale;
      authored.root.updateMatrixWorld(true);
      feet.forEach((f, j) => {
        const error = f.getWorldPosition(new THREE.Vector3()).distanceTo(sourceFeet[j].getWorldPosition(new THREE.Vector3()));
        assert.ok(error < .0002, `${chosen}, scale ${scale}: runtime adds ${error * 1000} mm of foot displacement`);
      });
    }
  }
});
