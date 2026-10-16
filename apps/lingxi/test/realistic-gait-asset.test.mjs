import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { locomotionRate, locomotionClip } from '../src/realistic-motion.ts';

const asset = new URL('../public/characters/lingxi-realistic/current/cat.glb', import.meta.url);

// Read transforms directly: this exercises the shipped skeleton and clips without requiring image decoders or a GPU.
function readMotion(strip = true) {
  const bytes = readFileSync(asset);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  const binary = bytes.subarray(28 + jsonLength);
  const values = (index) => {
    const a = gltf.accessors[index];
    const v = gltf.bufferViews[a.bufferView];
    assert.equal(a.componentType, 5126);
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
    const out = new Float32Array(a.count * size);
    const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let i = 0; i < out.length; i++) out[i] = binary.readFloatLE(start + 4 * i);
    return out;
  };
  const nodes = gltf.nodes.map((n) => {
    const o = new THREE.Object3D();
    o.name = n.name ?? '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  gltf.nodes.forEach((n, i) => n.children?.forEach((j) => nodes[i].add(nodes[j])));
  const root = new THREE.Group();
  gltf.scenes[gltf.scene ?? 0].nodes.forEach((i) => root.add(nodes[i]));
  const clips = Object.fromEntries(gltf.animations.filter((a) => ['Walk', 'Run'].includes(a.name)).map((a) => {
    let stride = 0;
    const tracks = a.channels.filter((c) => c.target.path !== 'weights').map((c) => {
      const s = a.samplers[c.sampler];
      const node = nodes[c.target.node];
      const times = values(s.input), data = values(s.output);
      const field = { translation: 'position', rotation: 'quaternion', scale: 'scale' }[c.target.path];
      if (node.name === 'Root' && field === 'position') {
        stride = data[data.length - 1] - data[2];
        if (strip) for (let i = 2; i < data.length; i += 3) data[i] = data[2];
      }
      const Track = field === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
      return new Track(`${node.uuid}.${field}`, times, data);
    });
    return [a.name, { clip: new THREE.AnimationClip(a.name, -1, tracks), stride }];
  }));
  return { root, nodes, clips };
}

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
