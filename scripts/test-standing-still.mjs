import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as THREE from '../apps/lingxi/node_modules/three/build/three.module.js';
import {createIdleAnimator} from '../apps/lingxi/src/anim/idle.ts';
test('standing idle keeps pelvis and foot anchors still instead of perpetual body rocking',()=>{
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,new THREE.Object3D());return nodes.get(id);};
 const rig={node,restRotation:()=>[0,0,0]};const animator=createIdleAnimator();
 let maxRoll=0;
 for(let i=0;i<600;i++){animator.update(rig,i/60,1/60,0,0);maxRoll=Math.max(maxRoll,Math.abs(node('hipC').rotation.z));}
 assert.ok(maxRoll<1e-6,`standing pelvis roll reached ${maxRoll.toFixed(6)} rad; standing should stay planted`);
});
