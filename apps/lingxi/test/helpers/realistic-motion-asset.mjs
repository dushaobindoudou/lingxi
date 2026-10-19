import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
function readAsset(asset, strip) {
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

export function readMotion(strip = true) {
  const directory = new URL('../../public/characters/lingxi-realistic/current/', import.meta.url);
  const base = readAsset(new URL('cat.glb', directory), strip);
  const patch = readAsset(new URL('clips.glb', directory), strip);
  for (const [name, entry] of Object.entries(patch.clips)) {
    const tracks = entry.clip.tracks.map(track => {
      const copy = track.clone();
      const [uuid, field] = copy.name.split('.');
      const source = patch.nodes.find(n => n.uuid === uuid);
      const target = base.nodes.find(n => n.name === source.name);
      copy.name = `${target.uuid}.${field}`;
      return copy;
    });
    base.clips[name] = { clip: new THREE.AnimationClip(name, -1, tracks), stride: entry.stride };
  }
  return base;
}
