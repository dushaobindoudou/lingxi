import test from 'node:test';
import assert from 'node:assert/strict';
import actions from '../src/data/actions.json' with { type: 'json' };
import { PERFORMANCES, createPerformanceRunner } from '../src/fx/performances.ts';
import { createToyProp } from '../src/rig/toys.ts';
import { pickToyReaction } from '../src/anim/interactions.ts';
import { createLifeEngine } from '../../../packages/life-engine/src/index.mjs';

const POTTY = { 'pee-at-you': { action: 'potty-pee', mark: 'peeStream' }, 'poop-at-you': { action: 'potty-poop', mark: 'pottyMark' } };
for (const [id, { action, mark }] of Object.entries(POTTY)) {
  test(`${id} has a complete 8-12 second timeline and a cancellation cleanup`, t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const events = [];
    const fx = Object.fromEntries(['clear','pottyMark','pottyAccent','peeStream','speedLines','shake','vignette','hearts','impactFrame','clawSlash','tilt'].map(key => [key, () => events.push(key)]));
    const context = {
      engine: { position: {x:500,y:600}, suggestMoveTo: () => events.push('move'), turnTo: () => true, clearIntent: () => events.push('clearIntent'), hold: () => events.push('hold') },
      renderer: { setCameraPreset: () => {}, setPerformanceScale: () => events.push('scale'), playAction: clip => { events.push(clip); return true; }, playExpression: () => true },
      fx, viewport: () => ({width:1000,height:800}), petPosition: () => ({x:500,y:600}), restoreCamera: () => events.push('camera'), now: () => 0,
    };
    const def = PERFORMANCES.find(x => x.id === id);
    assert.ok(def && def.durationMs >= 8000 && def.durationMs <= 12000);
    const runner = createPerformanceRunner(context);
    assert.equal(runner.play(id), true);
    t.mock.timers.tick(6500);
    assert.ok(events.includes(action) && events.includes(mark) && events.includes('hold'), events.join(' '));
    runner.stop();
    assert.ok(events.includes('clear') && events.includes('camera') && events.includes('scale'));
    const count = events.length;
    t.mock.timers.tick(12000);
    assert.equal(events.length, count, 'stopped scene must not emit later beats');
  });
}

test('a renderer without the staged potty actions (the voxel cat) squats instead', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const played = [];
  const noop = () => {};
  const context = {
    engine: { position: {x:500,y:600}, suggestMoveTo: noop, turnTo: () => true, clearIntent: noop },
    renderer: { playAction: clip => { if (clip === 'potty-pee' || clip === 'potty-poop') return false; played.push(clip); return true; }, playExpression: () => true },
    fx: Object.fromEntries(['clear','pottyMark','pottyAccent','peeStream'].map(key => [key, noop])),
    viewport: () => ({width:1000,height:800}), petPosition: () => ({x:500,y:600}), restoreCamera: noop, now: () => 0,
  };
  const runner = createPerformanceRunner(context);
  runner.play('poop-at-you');
  t.mock.timers.tick(2000);
  assert.ok(played.includes('potty-squat'), played.join(' '));
  runner.stop();
});

test('potty clips return every channel to zero and stay manual-only', () => {
  for (const id of ['potty-dig','potty-squat']) {
    const clip = actions.actions.find(x => x.id === id);
    assert.equal(clip.category, '特效');
    for (const track of clip.tracks) {
      assert.deepEqual(track.keys[0], [0,0]);
      assert.deepEqual(track.keys.at(-1), [clip.duration,0]);
    }
  }
});

test('pet hand follows the pointer while the cat stays in place, then resumes', () => {
  const engine = createLifeEngine({bounds:{width:1000,height:800},position:{x:500,y:600},random:()=>.5});
  engine.tick(0,null);
  engine.setToy('pet');
  const snapshot = engine.tick(100,{x:510,y:400},true);
  assert.equal(snapshot.toy.kind,'pet');
  assert.deepEqual(snapshot.toy.position,{x:510,y:400});
  assert.deepEqual(snapshot.position,{x:500,y:600});
  assert.equal(snapshot.state,'idle');
  assert.equal(pickToyReaction({kind:'pet',distance:10,toySpeed:0,held:false}),null);
  engine.clearToy();
  assert.equal(engine.tick(200,null).toy,null);
  // drawn on the glass at the pointer (stage-fx), nothing in the scene
  const hand = createToyProp('pet');
  assert.equal(hand.object.children.length, 0);
  hand.dispose();
});
