#!/usr/bin/env node
// Actual GLB parser, skin and animation evaluation; no simulated browser QA.
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import * as THREE from '../apps/lingxi/node_modules/three/build/three.module.js';
import {GLTFLoader} from '../apps/lingxi/node_modules/three/examples/jsm/loaders/GLTFLoader.js';

globalThis.self=globalThis;
globalThis.createImageBitmap=async blob=>{
  const data=new DataView(await blob.arrayBuffer());
  assert.equal(data.getUint32(0),0x89504e47,'embedded texture must be PNG');
  const width=data.getUint32(16),height=data.getUint32(20);
  assert.ok(width>0&&height>0);
  return {width,height,close(){}};
};
const directory=fileURLToPath(new URL('../assets/characters/human/work/yinyue/',import.meta.url));
const file=readFileSync(`${directory}yinyue-study.glb`);
assert.equal(file.readUInt32LE(0),0x46546c67);
const json=JSON.parse(file.subarray(20,20+file.readUInt32LE(12)).toString());
assert.ok(json.images.every(image=>image.bufferView!==undefined&&!image.uri),'textures must be self-contained');
assert.ok(json.buffers.every(buffer=>!buffer.uri),'buffers must be self-contained');
assert.equal(json.skins.length,1,'costume must reuse the female skeleton');
assert.equal(json.skins[0].joints.length,65);
const gltf=await new GLTFLoader().parseAsync(file.buffer.slice(file.byteOffset,file.byteOffset+file.byteLength),'');
const bones=[],meshes=[];
gltf.scene.traverse(node=>{if(node.isBone)bones.push(node);if(node.isSkinnedMesh)meshes.push(node)});
assert.equal(bones.length,65);
assert.equal(gltf.animations.length,16);
assert.equal(new Set(gltf.animations.map(clip=>clip.name)).size,16);
// Multi-material nodes become groups whose children use the underlying mesh name.
for(const name of ['head accessories','garment accessories']){
  assert.equal(json.nodes.find(node=>node.name?.includes(name))?.skin,0,`${name}: original skin`);
}
let vertices=0;
for(const mesh of meshes){
  const weights=mesh.geometry.attributes.skinWeight;
  assert.ok(weights,mesh.name);
  vertices+=weights.count;
  for(let i=0;i<weights.count;i++){
    const total=weights.getX(i)+weights.getY(i)+weights.getZ(i)+weights.getW(i);
    assert.ok(Math.abs(total-1)<.0002,`${mesh.name}: normalized weight ${i}`);
  }
}
const mixer=new THREE.AnimationMixer(gltf.scene),results=[];
for(const clip of gltf.animations){
  const samples=[];
  for(const fraction of [0,.5,1]){
    mixer.stopAllAction();
    const action=mixer.clipAction(clip).setLoop(THREE.LoopOnce,1);
    action.clampWhenFinished=true;action.reset().play();
    mixer.setTime(clip.duration*fraction);gltf.scene.updateMatrixWorld(true);
    const bounds=new THREE.Box3();
    for(const mesh of meshes){
      mesh.skeleton.update();
      const positions=mesh.geometry.attributes.position;
      for(let i=0;i<positions.count;i++){
        const vertex=new THREE.Vector3().fromBufferAttribute(positions,i);
        mesh.applyBoneTransform(i,vertex);vertex.applyMatrix4(mesh.matrixWorld);
        assert.ok(vertex.toArray().every(Number.isFinite),`${clip.name}: finite deformed geometry`);
        bounds.expandByPoint(vertex);
      }
    }
    samples.push({fraction,min:bounds.min.toArray(),max:bounds.max.toArray(),
      head:bones.find(bone=>bone.name==='Head').getWorldPosition(new THREE.Vector3()).toArray()});
  }
  results.push({name:clip.name,seconds:clip.duration,samples});
}
assert.notDeepEqual(results.find(clip=>clip.name==='Idle_Loop').samples[1].head,
  results.find(clip=>clip.name==='Walk_Loop').samples[1].head,'walk must move the actual skeleton');
const report={checkedAt:new Date().toISOString(),bones:bones.length,skinnedPrimitives:meshes.length,
  vertices,embeddedTextures:json.images.length,clips:results,
  scope:'GLTFLoader, all 16 AnimationMixer clips at 3 times, CPU skinning, normalized weights; not collision or browser UI QA'};
writeFileSync(`${directory}threejs-validation.json`,JSON.stringify(report,null,2));
console.log(`Yin Yue GLB: ${bones.length} bones, ${gltf.animations.length} animations, ${meshes.length} skinned primitives, ${json.images.length} embedded textures; all 48 sampled poses finite.`);
