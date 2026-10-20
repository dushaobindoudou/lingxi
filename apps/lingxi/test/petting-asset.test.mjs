import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createSkinnedPettingProbe } from '../src/rig/petting.ts';
import { holdBellyPose } from '../src/realistic-play.ts';

const asset=new URL('../public/characters/lingxi-realistic/current/cat.glb',import.meta.url);
test('the shipped cat distinguishes posed touch regions without reskinning its full coat per query', {skip:!existsSync(asset)},async()=>{
  const savedSelf=globalThis.self, savedBitmap=globalThis.createImageBitmap;
  globalThis.self=globalThis;
  // Decode only the embedded PNG dimensions; this test never uploads a GPU texture.
  globalThis.createImageBitmap=async blob=>{
    const data=new DataView(await blob.arrayBuffer());
    return {width:data.getUint32(16),height:data.getUint32(20),close(){}};
  };
  let gltf;
  try {
    const bytes=readFileSync(asset);
    gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  } finally { globalThis.self=savedSelf;globalThis.createImageBitmap=savedBitmap; }
  const root=gltf.scene;
  const probe=createSkinnedPettingProbe(root,root.getObjectByName('Chest'));
  root.traverse(o=>{if(o.isSkinnedMesh)o.getVertexPosition=()=>{throw new Error('full CPU skinning in pointer loop');};});
  const ray=new THREE.Raycaster();
  function hit(bone,offset,exposed){
    root.updateWorldMatrix(true,true);
    const direction=new THREE.Vector3(...offset);
    const point=root.getObjectByName(bone).getWorldPosition(new THREE.Vector3());
    ray.set(point.add(direction),direction.clone().normalize().negate());
    return probe(ray,exposed);
  }
  assert.equal(hit('Head',[0,3,0],false),'head');
  assert.equal(hit('Chest',[0,3,0],true),'body','upright back must not become belly');
  const mixer=new THREE.AnimationMixer(root);
  mixer.clipAction(holdBellyPose(gltf.animations.find(c=>c.name==='BellyUp'))).play();
  mixer.setTime(3);
  assert.equal(hit('Spine',[0,1,3],true),'belly');
  assert.equal(hit('Spine',[0,1,3],false),'body');
  root.getObjectByName('Root').position.x+=2;
  assert.equal(hit('Spine',[0,1,3],true),'belly','touch regions must follow the posed bones');
  ray.set(new THREE.Vector3(20,20,20),new THREE.Vector3(0,-1,0));
  assert.equal(probe(ray,true),null);
});
