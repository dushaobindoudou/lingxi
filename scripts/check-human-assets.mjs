#!/usr/bin/env node
// Parse the actual exported GLBs with the project's Three.js loader and evaluate
// skinned vertices/animations on the CPU. Texture pixels are checked in Blender;
// the bitmap shim here only reads embedded PNG dimensions, not a browser render.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import * as THREE from '../apps/lingxi/node_modules/three/build/three.module.js';
import { GLTFLoader } from '../apps/lingxi/node_modules/three/examples/jsm/loaders/GLTFLoader.js';

globalThis.self = globalThis;
globalThis.createImageBitmap = async (blob) => {
  const data = new DataView(await blob.arrayBuffer());
  assert.equal(data.getUint32(0), 0x89504e47, 'prepared textures must be valid PNG data');
  const width = data.getUint32(16), height = data.getUint32(20);
  assert.ok(width > 0 && height > 0);
  return { width, height, close() {} };
};
const root = fileURLToPath(new URL('..', import.meta.url));
const results = [];
for (const sex of ['male', 'female']) {
  const path = `${root}assets/characters/human/work/human-${sex}.glb`;
  const file = readFileSync(path);
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const bones = [], meshes = [];
  gltf.scene.traverse((node) => {
    if (node.isBone) bones.push(node);
    if (node.isSkinnedMesh) meshes.push(node);
  });
  assert.equal(bones.length, 65);
  assert.equal(meshes.length, 3);
  assert.equal(gltf.animations.length, 16);
  const audit = JSON.parse(readFileSync(`${root}assets/characters/human/work/human-${sex}-audit.json`, 'utf8'));
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const poses = [];
  for (const name of ['Idle_Loop', 'Walk_Loop', 'Crouch_Idle_Loop', 'Interact']) {
    const clip = gltf.animations.find((animation) => animation.name === name);
    assert.ok(clip, name);
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset().play();
    mixer.setTime(clip.duration / 2);
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const mesh of meshes) {
      mesh.skeleton.update();
      const position = mesh.geometry.attributes.position;
      for (let index = 0; index < position.count; index++) {
        const vertex = new THREE.Vector3().fromBufferAttribute(position, index);
        mesh.applyBoneTransform(index, vertex);
        vertex.applyMatrix4(mesh.matrixWorld);
        assert.ok(vertex.toArray().every(Number.isFinite));
        box.expandByPoint(vertex);
      }
    }
    const recorded = audit.poseBounds.find((pose) => pose.name === name).samples[1];
    // Three.js Y-up and Blender Z-up; sampling may differ by half a frame.
    assert.ok(Math.abs(box.min.y - recorded.min[2]) < .025, `${sex} ${name}: lower bound differs after export`);
    assert.ok(Math.abs(box.max.y - recorded.max[2]) < .025, `${sex} ${name}: upper bound differs after export`);
    const hands = bones.filter((bone) => /^hand_[lr]$/.test(bone.name))
      .map((bone) => ({ name: bone.name, position: bone.getWorldPosition(new THREE.Vector3()).toArray() }));
    poses.push({ name, seconds: clip.duration, verticalBounds: [box.min.y, box.max.y], hands });
  }
  assert.notDeepEqual(poses[0].hands, poses[2].hands, 'crouching must differ from idle, not a duplicate clip');
  results.push({ id: `human-${sex}`, bones: bones.length, skinnedMeshes: meshes.length,
    animations: gltf.animations.map((clip) => ({ name: clip.name, seconds: clip.duration })), poses });
  console.log(`human-${sex}: 65 bones, 3 skinned meshes, 16 clips; exported pose bounds match Blender`);
}
writeFileSync(`${root}assets/characters/human/work/threejs-validation.json`, JSON.stringify({
  checkedAt: new Date().toISOString(), scope: 'GLTFLoader, CPU skinning and AnimationMixer; not browser UI verification', results,
}, null, 2));
