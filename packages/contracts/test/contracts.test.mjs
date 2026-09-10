import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskStore, validateTaskEvent, composeCompanion, taskCue } from '../src/index.mjs';
const event = (extra={}) => ({ schemaVersion:1, provider:'codex', sourceId:'local-epoch-1', taskId:'task', eventId:'e1', state:'running', sequence:1, observedAt:1000, ...extra });
test('deduplicates delivery and ignores out-of-order updates', () => {
 const s=new TaskStore(); assert.equal(s.apply(event()), true); assert.equal(s.apply(event()), false);
 assert.equal(s.apply(event({eventId:'e2',sequence:2,state:'completed'})), true);
 assert.equal(s.apply(event({eventId:'late',sequence:1})), false); assert.equal(s.snapshot(1001)[0].state,'completed');
});
test('namespaces IDs by provider and connection epoch', () => {
 const s=new TaskStore(); for (const e of [event(),event({provider:'claude'}),event({sourceId:'remote'})]) s.apply(e);
 assert.equal(s.snapshot(1001).length,3);
});
test('stale source remains unknown freshness, never converted to completed', () => {
 const s=new TaskStore(); s.apply(event()); const [snapshot]=s.snapshot(62000); assert.equal(snapshot.stale,true); assert.equal(snapshot.state,'running');
 assert.equal(taskCue({...snapshot,state:'completed'},{enabled:true,stale:true}),'none');
});
test('malformed source events fail and prompt data does not escape', () => {
 for(const extra of [{sequence:NaN},{sequence:-1},{state:'invented'},{provider:'../x'},{observedAt:Infinity}]) assert.throws(()=>validateTaskEvent(event(extra)));
 assert.equal(validateTaskEvent(event({prompt:'private'})).prompt,undefined);
});
test('skin and personality are orthogonal and incompatible rigs rejected', () => {
 const skin={schemaVersion:1,id:'cream',name:'暖绒',rigId:'cat-v1',status:'planned',materials:{fur:'#F3EBDD'}};
 const personality={schemaVersion:1,id:'calm',name:'安静',traits:{independence:.7,curiosity:.4,gentleness:.9,playfulness:.2,sleepiness:.8},interactionCooldownSeconds:60};
 const c=composeCompanion(skin,personality,'cat-v1'); assert.equal(c.personality.id,'calm');
 assert.throws(()=>composeCompanion(skin,personality,'cat-v2'));
 assert.throws(()=>composeCompanion(skin,{...personality,traits:{...personality.traits,curiosity:5}},'cat-v1'));
 c.skin.materials.fur='#000000'; assert.equal(skin.materials.fur,'#F3EBDD');
});
test('task cues are opt-in, quiet-aware and ignore routine running events', () => {
 assert.equal(taskCue(event({state:'failed'})),'none');
 assert.equal(taskCue(event({state:'completed'}),{enabled:true}),'soft_glance');
 assert.equal(taskCue(event({state:'failed'}),{enabled:true,quiet:true}),'none');
 assert.equal(taskCue(event(),{enabled:true}),'none');
});
