import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {createLifeEngine} from '../../../packages/life-engine/src/index.mjs';
import {buildRig} from '../src/rig/skeleton.ts';
import {refineSkeleton} from '../src/rig/anatomy.ts';
import {createBodyController} from '../src/anim/body-controller.ts';
import {createToyProp} from '../src/rig/toys.ts';
import {createToyContactTester,createToyInteractionProbe} from '../src/rig/toy-contact.ts';

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const skeleton=refineSkeleton(read('../src/data/skeleton.json'));
const skin=read('../src/data/skins.json').find(skin=>skin.id==='honey-mittens');
const noop=()=>{};
const context=new Proxy({}, {get:(_,key)=>key==='getImageData'||key==='createImageData'
  ?(_x,_y,width=1,height=1)=>({data:new Uint8ClampedArray(width*height*4),width,height})
  :key==='createLinearGradient'||key==='createRadialGradient'?()=>({addColorStop:noop}):noop});
globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>context})};

function setup(size=.25,elevation=24){
  const width=1280,height=800,units=2.6/Math.max(width,height);
  const camera=new THREE.OrthographicCamera(-width*units,width*units,height*units,-height*units,-200,200);
  const angle=THREE.MathUtils.degToRad(elevation);
  camera.position.set(0,.4+Math.sin(angle)*6,Math.cos(angle)*6);
  camera.lookAt(0,.4,0);camera.updateMatrixWorld(true);
  const raycaster=new THREE.Raycaster();
  function place(point,y){
    raycaster.setFromCamera(new THREE.Vector2(point.x/width*2-1,1-point.y/height*2),camera);
    const ray=raycaster.ray;
    return ray.at((y-ray.origin.y)/ray.direction.y,new THREE.Vector3());
  }
  const rig=buildRig(skin,skeleton),body=createBodyController(rig,skeleton);
  rig.root.traverse(object=>{if(/^(eye|pupil|brow|nose|mouth|whisker|jaw|tongue)/.test(object.name))object.visible=false});
  const scale=.055*size;
  rig.root.scale.setScalar(scale);body.reset();body.apply({});
  const anchor=place({x:500,y:500},0);
  rig.root.position.x=anchor.x;rig.root.position.z=anchor.z;rig.root.updateMatrixWorld(true);
  const project=point=>{const p=point.clone().project(camera);return {x:(p.x+1)*width/2,y:(1-p.y)*height/2}};
  const interaction=createToyInteractionProbe(rig,{scale:()=>scale,prop:()=>({kind:null,prop:null}),place,project});
  return {rig,scale,place,project,interaction,body};
}

function skinGap(rig,center,radius){
  let gap=Infinity;
  rig.root.traverse(object=>{
    if(!object.isMesh||!object.visible||!object.parent.visible)return;
    const box=new THREE.Box3().setFromObject(object);
    gap=Math.min(gap,box.distanceToPoint(center)-radius);
  });
  return gap;
}

test('a small cat does not launch a yarn ball while its rendered body is still separated from it',()=>{
  const {rig,scale,place,interaction}=setup();
  const engine=createLifeEngine({bounds:{width:1280,height:800},position:{x:500,y:500},speed:0,random:()=>.5,toyInteraction:interaction});
  engine.setToy('yarn',{x:533,y:500});engine.throwToy({x:0,y:0});
  const snapshot=engine.tick(0,null);
  const ball=createToyProp('yarn');
  const radius=ball.anchorHeight*scale;
  const center=place(snapshot.toy.position,radius);
  const gap=skinGap(rig,center,radius);
  assert.ok(gap>.005,`fixture must have visible separation, got ${gap}`);
  assert.equal(snapshot.batted,false,`ball launched with ${(gap/scale).toFixed(2)} voxels of air before contact`);
  assert.deepEqual(snapshot.toy.velocity,{x:0,y:0});
  ball.dispose();rig.dispose();
});

test('real ball contact follows all sizes and camera elevations, including contact beyond 34px',()=>{
  let beyondLegacyReach=false;
  for(const size of [.25,.5,1])for(const elevation of [-11,9,24,40,60]){
    const {rig,scale,project,interaction}=setup(size,elevation);
    const paw=rig.node('pawFR').children.find(child=>child.isMesh);
    const center=new THREE.Box3().setFromObject(paw).getCenter(new THREE.Vector3());
    center.y=2*scale;
    const at=project(center);
    beyondLegacyReach||=Math.hypot(at.x-500,at.y-500)>34;
    const engine=createLifeEngine({bounds:{width:1280,height:800},position:{x:500,y:500},speed:0,random:()=>.5,toyInteraction:interaction});
    engine.setToy('yarn',at);engine.throwToy({x:0,y:0});
    assert.equal(engine.tick(0,null).batted,true,`${size}x / ${elevation}°: actual paw contact`);
    rig.dispose();
  }
  assert.ok(beyondLegacyReach,'fixture must include contact outside the old fixed reach');
});

test('a fast ball crossing a paw between frames is struck at the contact position',()=>{
  const {rig,scale,project,interaction,place}=setup(.5);
  const paw=rig.node('pawFR').children.find(child=>child.isMesh);
  const center=new THREE.Box3().setFromObject(paw).getCenter(new THREE.Vector3());
  center.y=2*scale;
  const start=project(center.clone().add(new THREE.Vector3(-.4,0,0)));
  const end=project(center.clone().add(new THREE.Vector3(.4,0,0)));
  const engine=createLifeEngine({bounds:{width:1280,height:800},position:{x:500,y:500},speed:0,random:()=>.5,toyFriction:0,toyInteraction:interaction});
  engine.setToy('yarn',start);engine.tick(0,null);
  engine.throwToy({x:(end.x-start.x)*60,y:0});
  const snapshot=engine.tick(1000/60,null);
  assert.equal(snapshot.batted,true,'swept contact must not tunnel through a paw');
  assert.ok(snapshot.toy.position.x<end.x-10,'ball must stop at its first contact, not appear beyond the cat');
  assert.ok(skinGap(rig,place(snapshot.toy.position,2*scale),2*scale)<=1e-5);
  rig.dispose();
});

test('the empty corner of a rotated body box does not count as touching',()=>{
  const root=new THREE.Group(),box=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));
  box.rotation.y=Math.PI/4;root.add(box);
  const contact=createToyContactTester(root);
  assert.equal(contact(new THREE.Vector3(.65,0,.65),.03),null);
  assert.ok(contact(new THREE.Vector3(.65,0,0),.03));
  box.geometry.dispose();
});

test('a cat chasing a stopped ball reaches real contact instead of stopping at an invisible radius',()=>{
  const {rig,interaction,place,body}=setup(.25);
  const engine=createLifeEngine({bounds:{width:1280,height:800},position:{x:500,y:500},random:()=>.5,toyInteraction:interaction});
  engine.setToy('yarn',{x:600,y:500});engine.throwToy({x:0,y:0});
  let snapshot;
  for(let frame=0;frame<300;frame++){
    snapshot=engine.tick(frame*1000/60,null);
    if(snapshot.batted)break;
    body.reset();body.apply({});
    const ground=place(snapshot.position,0);
    rig.root.position.x=ground.x;rig.root.position.z=ground.z;
    rig.root.rotation.y=Math.atan2(Math.cos(snapshot.heading),Math.sin(snapshot.heading)/Math.sin(24*Math.PI/180));
    rig.root.updateMatrixWorld(true);
  }
  assert.equal(snapshot.batted,true,'chase must remain playable with real contact');
  rig.dispose();
});

test('held balls stay in the hand and laser contact never gives the dot free momentum',()=>{
  const {rig,scale,project,interaction}=setup(.5);
  const paw=rig.node('pawFR').children.find(child=>child.isMesh);
  const center=new THREE.Box3().setFromObject(paw).getCenter(new THREE.Vector3());
  center.y=2*scale;
  const engine=createLifeEngine({bounds:{width:1280,height:800},position:{x:500,y:500},speed:0,toyInteraction:interaction});
  engine.setToy('yarn',project(center));
  assert.equal(engine.tick(0,null).batted,false);
  assert.deepEqual(engine.toy.velocity,{x:0,y:0});
  center.y=0;
  const dot=project(center);
  engine.setToy('laser',dot);
  const snapshot=engine.tick(100,dot);
  assert.equal(snapshot.batted,true);
  assert.deepEqual(snapshot.toy.position,dot);
  assert.deepEqual(snapshot.toy.velocity,{x:0,y:0});
  rig.dispose();
});

test('the feather chase destination follows the actual plume, not the handle screen point',()=>{
  const {rig,scale,place,project}=setup(.5);
  const feather=createToyProp('feather');
  feather.object.scale.setScalar(scale);
  const hand={x:550,y:450};
  feather.object.position.copy(place(hand,feather.anchorHeight*scale));
  for(let i=0;i<180;i++)feather.update(1/60,0,0);
  feather.object.updateMatrixWorld(true);
  const interaction=createToyInteractionProbe(rig,{scale:()=>scale,prop:()=>({kind:'feather',prop:feather}),place,project});
  const sphere=feather.contactSphere(new THREE.Sphere());
  const result=interaction({kind:'feather',position:hand,previousPosition:hand,
    petPosition:{x:500,y:500},previousPetPosition:{x:500,y:500}});
  const paw=rig.node('pawFR').children.find(child=>child.isMesh);
  const offset=new THREE.Box3().setFromObject(paw).getCenter(new THREE.Vector3()).sub(rig.root.position);
  const destination=place(result.target,0);
  assert.ok(Math.abs(destination.x+offset.x-sphere.center.x)<1e-6);
  assert.ok(Math.abs(destination.z+offset.z-sphere.center.z)<1e-6);
  assert.ok(Math.hypot(result.target.x-hand.x,result.target.y-hand.y)>10,'visible feather and hand must be different targets');
  feather.dispose();rig.dispose();
});

test('a tiny cat at eye level can reach a laser without stopping in the walk arrival deadband',()=>{
  const {rig,interaction,place,body}=setup(.25,9);
  const engine=createLifeEngine({bounds:{width:1280,height:800},position:{x:500,y:500},random:()=>.5,toyInteraction:interaction});
  engine.setToy('laser',{x:500,y:450});
  let snapshot;
  for(let frame=0;frame<360;frame++){
    snapshot=engine.tick(frame*1000/60,null);
    if(snapshot.batted)break;
    body.reset();body.apply({});
    const ground=place(snapshot.position,0);
    rig.root.position.x=ground.x;rig.root.position.z=ground.z;
    rig.root.rotation.y=Math.atan2(Math.cos(snapshot.heading),Math.sin(snapshot.heading)/Math.sin(9*Math.PI/180));
    rig.root.updateMatrixWorld(true);
  }
  assert.equal(snapshot.batted,true,`stopped ${Math.hypot(snapshot.target.x-snapshot.position.x,snapshot.target.y-snapshot.position.y).toFixed(2)}px before physical contact`);
  rig.dispose();
});
