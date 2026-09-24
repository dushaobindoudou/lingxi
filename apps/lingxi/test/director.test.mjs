// The idle scheduler decides what the cat does when nobody asked for anything. It must never
// decide to jump.
//
// "现在偶尔会跳一下，跳这个动作是不合理的": `hop-catch` and `pounce` sit in the 玩耍 category,
// which the idle state draws from, so every minute or so a cat with nothing to catch would
// crouch and spring straight up at empty air. A jump is a reaction - to the toy it is chasing,
// or to a caller asking for one by name - and those two paths must still work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDirector } from '../src/anim/director.ts';
import { leavesFloor } from '../src/anim/motion.ts';

const skeleton = JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/skeleton.json', import.meta.url)), 'utf8'));
const nodeIds = skeleton.nodes.map((n) => n.id);

/** Deterministic Math.random, so a failure names a reproducible run rather than a flake. */
function withSeed(seed, body) {
  const original = Math.random;
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try { return body(); } finally { Math.random = original; }
}

/** Run the director for `seconds` of cat time and return every clip it started on its own. */
function scheduled(state, moving, seconds, seed) {
  return withSeed(seed, () => {
    const director = createDirector(nodeIds);
    const started = [];
    let previous = null;
    for (let t = 0; t < seconds; t += 0.1) {
      director.update(0.1, state, moving);
      const now = director.currentAction?.id ?? null;
      if (now && now !== previous) started.push(now);
      previous = now;
    }
    return { director, started };
  });
}

test('the library has jumps in it, so the next test is not passing on an empty set', () => {
  const director = createDirector(nodeIds);
  const jumps = director.actions.filter(leavesFloor).map((a) => a.id);
  for (const id of ['hop-catch', 'pounce']) assert.ok(jumps.includes(id), `${id} should count as leaving the floor`);
});

test('an idle cat never jumps on its own, however long it is left', () => {
  for (const seed of [1, 7, 42, 2026]) {
    for (const [state, moving] of [['idle', false], ['wander', true], ['ai_directed', false]]) {
      // An hour of cat time is several hundred scheduled clips.
      const { director, started } = scheduled(state, moving, 3600, seed);
      const jumps = started.filter((id) => leavesFloor(director.actions.find((a) => a.id === id)));
      assert.deepEqual(jumps, [], `seed ${seed}, ${state}: the scheduler started ${jumps.join(', ')} unprompted`);
    }
  }
});

test('keeping jumps out did not empty the play category', () => {
  // The filter is on "leaves the floor", not on 玩耍 - a roll, a play-bow and a stalk are still
  // things a cat does on its own.
  const { started } = scheduled('idle', false, 3600, 7);
  const play = new Set(['roll-left', 'roll-right', 'belly-up', 'play-bow', 'stalk-crouch']);
  assert.ok(started.some((id) => play.has(id)), `an hour of idling never played: ${[...play].join(', ')}`);
  assert.ok(started.length > 200, `only ${started.length} clips in an hour - the scheduler has stalled`);
});

test('a jump asked for by name still plays - the toy reactions and agents depend on it', () => {
  const director = createDirector(nodeIds);
  for (const id of ['hop-catch', 'pounce']) {
    assert.equal(director.play(id), true);
    director.update(0.016, 'idle', false);
    assert.equal(director.currentAction?.id, id);
  }
});
