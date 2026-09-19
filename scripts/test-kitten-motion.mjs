import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {routePoses,matchesMask,KittenMotionController,supportPose} from '../assets/characters/lingxi/v6/motion-controller.js';
const {clips}=JSON.parse(await readFile(new URL('../assets/characters/lingxi/v6/animations.json',import.meta.url)));
for(const from of ['stand','rest','sit','sleep','side','groom_sit'])for(const target of clips.filter(c=>c.category!=='micro')){
 const route=routePoses(clips,from,target.entry);let p=from;for(const step of route){assert.equal(step.entry,p);p=step.exit;}assert.equal(p,supportPose(target.entry));
}
assert.deepEqual(routePoses(clips,'sleep','stand').map(c=>c.id),['sleep_to_rest','rest_to_stand']);
assert(matchesMask('j_l_upper_eyelid_015.quaternion',['l_eyelid']));assert(!matchesMask('j_r_upper_eyelid_022.quaternion',['l_eyelid']));assert(!matchesMask('j_body_00.position',['head','eyelids']));assert(matchesMask('j_r_eye_021.quaternion',['eyes']));
class Action{constructor(clip){this.clip=clip;}getClip(){return this.clip;}reset(){return this;}setEffectiveWeight(){return this;}setEffectiveTimeScale(){return this;}setLoop(){return this;}play(){return this;}crossFadeFrom(){return this;}stop(){return this;}}
const actions=new Map();const mixer={time:0,addEventListener(){},clipAction(c){if(!actions.has(c))actions.set(c,new Action(c));return actions.get(c);}};
const controller=new KittenMotionController({LoopRepeat:1,LoopOnce:0},mixer,clips.map(c=>({name:c.id})),{clips});
controller.request(clips.find(c=>c.id==='sleep_loop'));assert.equal(controller.base.info.id,'rest_to_sleep');
controller.request(clips.find(c=>c.id==='stand_idle'));assert.equal(controller.base.info.id,'rest_to_sleep');
controller.finished(controller.base.action);assert.equal(controller.base.info.id,'sleep_to_rest');controller.finished(controller.base.action);assert.equal(controller.base.info.id,'rest_to_stand');controller.finished(controller.base.action);assert.equal(controller.base.info.id,'stand_idle');
console.log('PASS all pose routes, sided masks, pending request during support transfer');

controller.queue=[];controller.pending=null;controller.playBase(clips.find(c=>c.id==='groom_paw'));controller.finished(controller.base.action);assert.equal(controller.base.info.id,'groom_to_sit');controller.finished(controller.base.action);assert.equal(controller.base.info.id,'sit_idle');console.log('PASS grooming returns through recovery to seated idle');
