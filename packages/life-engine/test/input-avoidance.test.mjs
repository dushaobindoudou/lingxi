import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifeEngine } from '../src/index.mjs';

const input = { x: 400, y: 260, width: 200, height: 180 };
const contains = (r, p) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

test('a resting cat leaves the active input area even when the mouse is elsewhere', () => {
  const engine = createLifeEngine({
    bounds: { width: 1000, height: 700 }, position: { x: 500, y: 400 },
    idleDurationMsRange: [100000, 100000], random: () => 0.5,
    protectedRegions: [input],
  });
  for (let now = 0; now <= 6000; now += 16) engine.tick(now, { x: 50, y: 50 });
  assert.equal(contains(input, engine.position), false, 'cat is still resting on the focused input field');
});

function run(engine, start = 0, duration = 6000) {
  let snapshot;
  for (let now = start; now <= start + duration; now += 16) snapshot = engine.tick(now, null);
  return snapshot;
}
test('a newly focused input wakes a sleeping cat and outranks an action hold', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 700 }, position: { x: 500, y: 400 },
    energy: 0.3, sleepiness: 1, sleepSettleMs: 0, idleDurationMsRange: [100000, 100000] });
  run(engine, 0, 100);
  assert.equal(engine.state, 'sleep');
  engine.hold(100000, 100);
  engine.setProtectedRegions([input]);
  assert.equal(engine.tick(116, null).inputAvoidance.overlapping, true);
  run(engine, 132);
  assert.equal(contains(input, engine.position), false);
});
test('a route to an agent destination goes around the input rather than through it', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 700 }, position: { x: 250, y: 350 },
    speed: 220, protectedRegions: [input], random: () => 0.5 });
  engine.suggestMoveTo({ x: 780, y: 350 }, 0, 30000);
  for (let now = 0; now <= 20000; now += 16) {
    engine.tick(now, null);
    assert.equal(contains(input, engine.position), false, `entered input at ${now}ms`);
    if (Math.hypot(engine.position.x - 780, engine.position.y - 350) < 10) return;
  }
  assert.fail(`failed to walk around input: ${JSON.stringify(engine.position)}`);
});
test('full-screen input stays protected until focus clears instead of moving endlessly', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 700 },
    protectedRegions: [{ x: -200, y: -200, width: 1400, height: 1100 }], random: () => 0.5 });
  assert.equal(run(engine).inputAvoidance.overlapping, true);
  engine.setProtectedRegions([]);
  assert.equal(engine.tick(7000, null).inputAvoidance.overlapping, false);
});
test('manual dragging is respected; releasing over an input immediately yields', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 700 }, protectedRegions: [input], position: { x: 500, y: 400 } });
  engine.beginDrag({ x: 500, y: 400 });
  assert.equal(engine.tick(0, null).inputAvoidance.overlapping, false);
  engine.endDrag(16);
  assert.equal(engine.tick(32, null).inputAvoidance.overlapping, true);
});
test('an active toy inside an input cannot pull the cat into that input', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 700 }, protectedRegions: [input], position: { x: 200, y: 350 } });
  engine.setToy('laser', { x: 500, y: 350 });
  for (let now = 0; now <= 6000; now += 16) {
    engine.tick(now, { x: 500, y: 350 });
    assert.equal(contains(input, engine.position), false);
  }
});
test('a swept toy-contact correction cannot place the body inside an input', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 700 }, protectedRegions: [input], position: { x: 200, y: 350 },
    toyInteraction: () => ({ target: { x: 500, y: 350 }, touching: true, petContactPosition: { x: 500, y: 350 } }),
  });
  engine.setToy('yarn', { x: 500, y: 350 });
  engine.throwToy({ x: 0, y: 0 });
  const snapshot = engine.tick(0, null);
  assert.equal(contains(input, snapshot.position), false, 'collision correction bypassed input avoidance');
});
