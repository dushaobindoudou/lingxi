import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createPettingSession, bellyIsExposed } from '../src/anim/petting.ts';
import { createVoxelPettingProbe, createSkinnedPettingProbe } from '../src/rig/petting.ts';
import { createLifeEngine } from '../../../packages/life-engine/src/index.mjs';

test('petting requires an explicit mode, a press and gentle travel on the same body region', () => {
  const session = createPettingSession();
  session.press();
  assert.equal(session.tick({x:0,y:0}, 'head', 0), null);
  session.setEnabled(true);
  for (let i=0;i<10;i++) assert.equal(session.tick({x:i*10,y:0},'head',i*40),null);
  session.press();
  assert.equal(session.tick({x:0,y:0},'head',500),null);
  assert.equal(session.tick({x:0,y:0},'head',1000),null,'holding still is not a stroke');
  for(let i=1;i<=2;i++) assert.equal(session.tick({x:i*10,y:0},'head',1000+i*40),null);
  assert.deepEqual(session.tick({x:30,y:0},'head',1120),{region:'head',clip:'pet-head',expression:'陶醉'});
  session.release();
  assert.equal(session.tick({x:60,y:0},'body',4000),null);
});

test('body, belly and head strokes do not transfer credit; fast sweeps and re-entry do not count', () => {
  for(const region of ['head','body','belly']) {
    const s=createPettingSession();s.setEnabled(true);s.press();
    s.tick({x:0,y:0},'head',0);s.tick({x:20,y:0},'head',50);
    s.tick({x:100,y:0},null,60);
    assert.equal(s.tick({x:110,y:0},region,100),null);
    assert.equal(s.tick({x:500,y:0},region,101),null);
    assert.equal(s.tick({x:510,y:0},region,141),null);
    assert.equal(s.tick({x:520,y:0},region,181),null);
    const reaction=s.tick({x:530,y:0},region,221);
    assert.equal(reaction?.region,region);
    assert.equal(reaction?.clip,region==='head'?'pet-head':region==='body'?'pet-back':null);
  }
});

test('belly is exposed only during the settled middle of the belly-up clip', () => {
  for(const remainingMs of [6000,5000,500,0]) assert.equal(bellyIsExposed({id:'belly-up',remainingMs},6000),false);
  assert.equal(bellyIsExposed({id:'belly-up',remainingMs:3000},6000),true);
  assert.equal(bellyIsExposed({id:'pet-head',remainingMs:3000},6000),false);
});

function fixture(style) {
  const root=new THREE.Group(), chest=new THREE.Group();root.add(chest);
  chest.name='spine2';
  const body=new THREE.Mesh(new THREE.BoxGeometry(2,1,3),new THREE.MeshBasicMaterial());
  body.name=style==='voxel'?'spine2:box':'LX_Body';chest.add(body);
  const head=new THREE.Group();head.name='head';head.position.set(0,0,3);root.add(head);
  const face=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial());
  face.name=style==='voxel'?'head:box':'LX_Head';head.add(face);
  const probe=style==='voxel'?createVoxelPettingProbe(root):createSkinnedPettingProbe(root,chest);
  const ray=new THREE.Raycaster();ray.layers.enableAll();
  return {chest,hit(x,y,z,dx,dy,dz,exposed){root.updateMatrixWorld(true);ray.set(new THREE.Vector3(x,y,z),new THREE.Vector3(dx,dy,dz));return probe(ray,exposed);}};
}

for(const style of ['voxel','realistic']) test(`${style}: posed surfaces distinguish head, back and exposed belly, excluding empty space`,()=>{
  const f=fixture(style);
  assert.equal(f.hit(0,5,3,0,-1,0,false),'head');
  assert.equal(f.hit(0,5,0,0,-1,0,true),'body','standing back is never belly');
  assert.equal(f.hit(8,5,0,0,-1,0,true),null);
  f.chest.rotation.z=Math.PI;
  assert.equal(f.hit(0,5,0,0,-1,0,false),'body','roll must be offered deliberately');
  assert.equal(f.hit(0,5,0,0,-1,0,true),'belly');
});

test('petting holds the cat for your hand, while input avoidance still moves it away',()=>{
  const engine=createLifeEngine({bounds:{width:1200,height:800},position:{x:500,y:400},idleMs:[0,0]});
  engine.setToy('yarn');engine.setPetting(true);
  for(let t=0;t<=1000;t+=20) {
    const s=engine.tick(t,{x:500,y:400});
    assert.equal(s.toy,null);assert.deepEqual(s.position,{x:500,y:400});
  }
  engine.setProtectedRegions([{x:400,y:300,width:200,height:200}]);
  const s=engine.tick(1100,null);
  assert.equal(s.inputAvoidance.overlapping,true);assert.notDeepEqual(s.position,{x:500,y:400});
});
