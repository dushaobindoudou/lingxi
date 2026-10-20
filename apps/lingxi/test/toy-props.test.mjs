import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createToyProp} from '../src/rig/toys.ts';
import {createLifeEngine} from '../../../packages/life-engine/src/index.mjs';

test('the cursor holds the handle and the string hangs from the opposite rod end',()=>{
  const toy=createToyProp('feather');
  toy.update(1/60,0,0);toy.object.updateMatrixWorld(true);
  const rod=toy.object.children.find(o=>o.geometry?.type==='CylinderGeometry');
  const ends=[-1,1].map(sign=>rod.localToWorld(new THREE.Vector3(0,sign*rod.geometry.parameters.height/2,0)));
  const grip=toy.object.localToWorld(new THREE.Vector3());
  const held=ends[0].distanceTo(grip)<ends[1].distanceTo(grip)?0:1;
  assert.ok(ends[held].distanceTo(grip)<1e-5,'mouse must grip an actual endpoint');
  const string=toy.object.children.find(o=>o.isLine);
  const anchor=string.localToWorld(new THREE.Vector3().fromBufferAttribute(string.geometry.attributes.position,0));
  assert.ok(anchor.distanceTo(ends[1-held])<1e-5,'string must attach to the far end, not the held end');
  toy.dispose();
});

test('the feather handle follows the hand exactly while its rope supplies the lag',()=>{
  const engine=createLifeEngine({bounds:{width:1280,height:800},position:{x:100,y:100}});
  engine.setToy('feather',{x:500,y:400});engine.tick(0,{x:500,y:400});
  assert.deepEqual(engine.tick(16,{x:700,y:400}).toy.hand,{x:700,y:400});
});

test('a toy keeps moving during a jump, but the cat holds its launch position',()=>{
  const engine=createLifeEngine({bounds:{width:1280,height:800},position:{x:300,y:400}});
  engine.setToy('feather',{x:700,y:400});engine.tick(0,{x:700,y:400});
  const before=engine.position;
  engine.hold(1500,0,true);
  const during=engine.tick(100,{x:800,y:400});
  assert.deepEqual(during.position,before,'chasing must not slide the cat during its jump');
  assert.equal(during.batted,false,'a floor swat must not interrupt the jump');
  assert.deepEqual(during.toy.hand,{x:800,y:400});
});

test('yarn rolls by distance covered divided by its drawn radius',()=>{
  const toy=createToyProp('yarn'),scale=.0275,dt=1/60;
  toy.object.scale.setScalar(scale);
  toy.update(dt,100,0,{x:.4,z:0,scale:1/scale});
  toy.object.updateMatrixWorld(true);
  let ball;
  toy.object.traverse(object=>{if(object.isMesh&&object.geometry.type==='IcosahedronGeometry')ball=object});
  const rotation=ball.getWorldQuaternion(new THREE.Quaternion());
  const expected=.4/(toy.anchorHeight*scale)*dt;
  assert.ok(Math.abs(rotation.angleTo(new THREE.Quaternion())-expected)<1e-6,'rolling must use world travel, not unconverted pixel speed');
  toy.dispose();
});

test('rolling a ball keeps its charge halo flat on the floor',()=>{
  const toy=createToyProp('yarn');
  toy.update(.01,100,.5,{x:.4,z:0,scale:1/.0275});
  toy.object.updateMatrixWorld(true);
  let ring;
  toy.object.traverse(object=>{if(object.isMesh&&object.geometry.type==='RingGeometry')ring=object});
  const normal=new THREE.Vector3(0,0,1).transformDirection(ring.matrixWorld);
  assert.ok(Math.abs(normal.y)>.99999,'the ground halo must not inherit ball rotation');
  toy.dispose();
});

test('a settled feather hangs above the floor, not beneath the cat',()=>{
  const toy=createToyProp('feather'),scale=.0275;
  toy.object.scale.setScalar(scale);
  toy.object.position.y=toy.anchorHeight*scale;
  for(let i=0;i<180;i++)toy.update(1/60,0,0);
  toy.object.updateMatrixWorld(true);
  let lowest=Infinity;
  toy.object.traverse(object=>{
    if(object.isMesh&&(object.geometry.type==='ConeGeometry'||object.geometry.type==='IcosahedronGeometry')){
      lowest=Math.min(lowest,new THREE.Box3().setFromObject(object).min.y);
    }
  });
  assert.ok(lowest>=-1e-5,`feather hangs ${(lowest/scale).toFixed(2)} voxels beneath the floor`);
  toy.dispose();
});

test('laser trail marks lie on the same plane as the actual laser dot at every size',()=>{
  for(const scale of [.01375,.0275,.055]){
    const toy=createToyProp('laser');
    toy.object.scale.setScalar(scale);toy.setWorldScale(scale);
    toy.update(1/60,0,0);
    toy.object.position.x=.05;toy.update(1/60,0,0);
    toy.object.updateMatrixWorld(true);
    const dot=toy.object.children[0].getWorldPosition(new THREE.Vector3());
    const marks=toy.worldLayer.children.filter(mark=>mark.visible);
    assert.ok(marks.length>0);
    assert.ok(marks.every(mark=>Math.abs(mark.position.y-dot.y)<1e-6),'trail must not use an unscaled world height');
    toy.dispose();
  }
});

test('cursor-driven toys report travel speed so the cat does not treat a moving toy as stationary',()=>{
  for(const kind of ['feather','laser']){
    const engine=createLifeEngine({bounds:{width:1280,height:800},position:{x:100,y:100},speed:0});
    engine.setToy(kind,{x:500,y:400});engine.tick(0,{x:500,y:400});
    const snapshot=engine.tick(1000/60,{x:700,y:400});
    assert.ok(snapshot.toy.velocity.x>220,`${kind}: rapid pointer travel must be visible to play reactions`);
  }
});
