import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifeEngine } from '../src/index.mjs';

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

test('starts idle and transitions to wander after the idle window elapses', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 1000 }, idleDurationMsRange: [50, 50] });
  assert.equal(engine.state, 'idle');
  engine.tick(0, null);
  assert.equal(engine.state, 'idle');
  const snap = engine.tick(1000, null); // well past idleUntil
  assert.equal(snap.state, 'wander');
  assert.ok(snap.target, 'wander should have picked a target');
});

test('wandering arrives at its target and returns to idle', () => {
  const engine = createLifeEngine({
    bounds: { width: 1000, height: 1000 },
    position: { x: 500, y: 500 },
    idleDurationMsRange: [1, 1],
    speed: 100000, // effectively teleport so the test does not depend on many frames
  });
  engine.tick(0, null);
  engine.tick(10, null); // now wandering
  assert.equal(engine.state, 'wander');
  const snap = engine.tick(20, null); // one giant step should arrive
  assert.equal(snap.state, 'idle');
});

test('cursor proximity alone does not trigger follow in the default "auto" mode', () => {
  const engine = createLifeEngine({
    bounds: { width: 1000, height: 1000 },
    position: { x: 500, y: 500 },
    speed: 50,
  });
  assert.equal(engine.mode, 'auto');
  const snap = engine.tick(0, { x: 520, y: 500 });
  assert.notEqual(snap.state, 'follow_cursor');
});

test('"play" mode: the cat seeks the cursor immediately, at any distance', () => {
  const engine = createLifeEngine({
    bounds: { width: 2000, height: 2000 },
    position: { x: 100, y: 100 },
    speed: 50,
  });
  engine.setInteractionMode('play');
  const snap = engine.tick(0, { x: 1900, y: 1900 }); // far corner, well outside any old "follow radius"
  assert.equal(snap.state, 'follow_cursor');
});

test('"play" mode: keeps following as the cursor moves far away; only a null cursor releases it', () => {
  const engine = createLifeEngine({ bounds: { width: 2000, height: 2000 }, position: { x: 500, y: 500 } });
  engine.setInteractionMode('play');
  engine.tick(0, { x: 520, y: 500 }); // enters follow
  assert.equal(engine.state, 'follow_cursor');
  const stillFollowing = engine.tick(16, { x: 1900, y: 1900 }); // now far away
  assert.equal(stillFollowing.state, 'follow_cursor');
  const released = engine.tick(32, null); // cursor signal lost entirely
  assert.equal(released.state, 'idle');
});

test('"play" mode: following stops short of the cursor instead of covering it', () => {
  const engine = createLifeEngine({
    bounds: { width: 1000, height: 1000 },
    position: { x: 500, y: 500 },
    followStandoff: 40,
    speed: 100000,
  });
  engine.setInteractionMode('play');
  const cursor = { x: 800, y: 500 };
  let snap;
  for (let i = 0; i < 5; i += 1) snap = engine.tick(i * 16, cursor);
  assert.ok(Math.abs(distance(snap.position, cursor) - 40) < 1, 'should settle ~followStandoff away from the cursor');
});

test('"play" mode: chasing a cursor reported outside bounds never carries the cat off-screen', () => {
  const engine = createLifeEngine({
    bounds: { width: 1000, height: 800 },
    position: { x: 500, y: 400 },
    margin: 20,
    speed: 100000,
  });
  engine.setInteractionMode('play');
  // A cursor far outside bounds (e.g. a second monitor, or a bad reading) - standoffPoint
  // would otherwise push the destination even further out.
  let snap;
  for (let i = 0; i < 5; i += 1) snap = engine.tick(i * 16, { x: 5000, y: -3000 });
  assert.ok(snap.position.x >= 20 - 1e-6 && snap.position.x <= 1000 - 20 + 1e-6);
  assert.ok(snap.position.y >= 20 - 1e-6 && snap.position.y <= 800 - 20 + 1e-6);
});

test('"auto" mode: a cursor closing in on the cat pushes it toward a screen corner, not toward the cursor', () => {
  const engine = createLifeEngine({
    bounds: { width: 2000, height: 2000 },
    position: { x: 500, y: 500 },
    avoidRadius: 150,
    speed: 300,
  });
  const snap = engine.tick(0, { x: 560, y: 500 }); // cursor within avoidRadius, no "recent movement" needed
  assert.equal(snap.state, 'wander');
  assert.ok(distance(snap.position, { x: 560, y: 500 }) > distance({ x: 500, y: 500 }, { x: 560, y: 500 }) - 1e-6);
});

test('setAvoidRadius changes avoidance at runtime without recreating the engine', () => {
  const engine = createLifeEngine({
    bounds: { width: 2000, height: 2000 },
    position: { x: 500, y: 500 },
    avoidRadius: 150,
    speed: 300,
  });
  // A cursor 60px away: inside the default 150 radius (would trigger avoidance), but
  // outside a tightened 40 radius - the "安静" behavior preset's whole point.
  engine.setAvoidRadius(40);
  const snap = engine.tick(0, { x: 560, y: 500 });
  assert.equal(snap.state, 'idle');
});

test('setAvoidRadius ignores non-positive/non-finite values instead of breaking avoidance', () => {
  const engine = createLifeEngine({
    bounds: { width: 2000, height: 2000 },
    position: { x: 500, y: 500 },
    avoidRadius: 150,
    speed: 300,
  });
  engine.setAvoidRadius(-10);
  engine.setAvoidRadius(NaN);
  engine.setAvoidRadius(0);
  const snap = engine.tick(0, { x: 560, y: 500 }); // still within the untouched 150 radius
  assert.equal(snap.state, 'wander');
});

test('"auto" mode: idle wandering targets the actual far corner of the work area, not a nearby hop', () => {
  const engine = createLifeEngine({
    bounds: { width: 3000, height: 2000 },
    position: { x: 1500, y: 1000 }, // dead center, far from any edge
    idleDurationMsRange: [10, 10],
    margin: 24,
    edgeRestJitterFraction: 0, // deterministic corner for the assertion
  });
  const cursor = { x: 100, y: 100 }; // near the top-left corner
  engine.tick(0, cursor);
  const snap = engine.tick(50, cursor); // idle window elapsed -> wander target picked
  assert.equal(snap.state, 'wander');
  // the farthest corner from a top-left cursor is the bottom-right one
  assert.ok(Math.abs(snap.target.x - (3000 - 24)) < 1);
  assert.ok(Math.abs(snap.target.y - (2000 - 24)) < 1);
});

test('"auto" mode: wandering to the rest corner actually arrives at the work-area edge', () => {
  const engine = createLifeEngine({
    bounds: { width: 3000, height: 2000 },
    position: { x: 1500, y: 1000 },
    idleDurationMsRange: [1, 1],
    margin: 24,
    edgeRestJitterFraction: 0,
    speed: 100000, // effectively teleport so the test does not depend on many frames
  });
  const cursor = { x: 100, y: 100 };
  engine.tick(0, cursor);
  engine.tick(10, cursor); // idle window elapsed -> now wandering toward the far corner
  assert.equal(engine.state, 'wander');
  // corner-to-corner distance across this bounds exceeds what a 10ms step covers even at this
  // speed; tick()'s deltaSeconds is capped at 0.25s per frame, so give it one full capped frame
  const snap = engine.tick(300, cursor);
  assert.equal(snap.state, 'idle');
  assert.ok(Math.abs(snap.position.x - (3000 - 24)) < 1);
  assert.ok(Math.abs(snap.position.y - (2000 - 24)) < 1);
});

test('switching out of "play" mode mid-chase hands control back to autonomy immediately', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 1000 }, position: { x: 500, y: 500 } });
  engine.setInteractionMode('play');
  engine.tick(0, { x: 520, y: 500 });
  assert.equal(engine.state, 'follow_cursor');
  engine.setInteractionMode('auto');
  assert.equal(engine.state, 'idle');
});

test('dragging overrides autonomous behavior and tracks the cursor exactly', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 1000 }, position: { x: 100, y: 100 } });
  engine.beginDrag({ x: 100, y: 100 });
  assert.equal(engine.state, 'dragged');
  engine.updateDrag({ x: 300, y: 250 });
  const snap = engine.tick(16, { x: 300, y: 250 });
  assert.deepEqual(snap.position, { x: 300, y: 250 });
  engine.endDrag(16);
  assert.equal(engine.state, 'idle');
});

test('a drag that stops receiving updateDrag() calls (a lost mouseup) auto-releases', () => {
  const engine = createLifeEngine({
    bounds: { width: 1000, height: 1000 },
    position: { x: 100, y: 100 },
    dragStaleMs: 100,
  });
  engine.beginDrag({ x: 100, y: 100 });
  engine.updateDrag({ x: 150, y: 150 });
  engine.tick(0, null); // consumes the update; still dragged
  assert.equal(engine.state, 'dragged');
  engine.tick(50, null); // no updateDrag in between - within the grace window
  assert.equal(engine.state, 'dragged');
  const snap = engine.tick(160, null); // still no updateDrag - past dragStaleMs
  assert.equal(snap.state, 'idle');
});

test('a drag is clamped to bounds even if the offset would carry it off-screen', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 800 }, position: { x: 990, y: 10 }, margin: 20 });
  engine.beginDrag({ x: 10, y: 10 }); // huge offset: position (990,10) minus cursor (10,10)
  engine.updateDrag({ x: 15, y: 15 }); // would put position at (995, 15) - just inside, fine
  engine.updateDrag({ x: -500, y: 900 }); // would put position at (-480, 905) - well off-screen
  assert.ok(engine.position.x >= 20 - 1e-6 && engine.position.x <= 1000 - 20 + 1e-6);
  assert.ok(engine.position.y >= 20 - 1e-6 && engine.position.y <= 800 - 20 + 1e-6);
});

test('a drag with regular updateDrag() calls never auto-releases', () => {
  const engine = createLifeEngine({
    bounds: { width: 1000, height: 1000 },
    position: { x: 100, y: 100 },
    dragStaleMs: 100,
  });
  engine.beginDrag({ x: 100, y: 100 });
  for (let i = 0; i < 10; i += 1) {
    engine.updateDrag({ x: 100 + i, y: 100 });
    engine.tick(i * 50, null); // 50ms apart, well under dragStaleMs each time
  }
  assert.equal(engine.state, 'dragged');
});

test('"play" mode: facing tracks the cursor directly, not the (potentially noisy) standoff point', () => {
  const engine = createLifeEngine({
    bounds: { width: 1000, height: 1000 },
    position: { x: 500, y: 500 },
    speed: 100000,
  });
  engine.setInteractionMode('play');
  const snapRight = engine.tick(0, { x: 700, y: 500 });
  assert.equal(snapRight.facing, 1);
  const snapLeft = engine.tick(16, { x: 300, y: 500 });
  assert.equal(snapLeft.facing, -1);
});

test('resetPosition recenters and cancels a drag, an AI intent, and a mid-wander', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 800 }, position: { x: 50, y: 50 } });
  engine.beginDrag({ x: 50, y: 50 });
  assert.equal(engine.state, 'dragged');
  engine.resetPosition();
  assert.equal(engine.state, 'idle');
  assert.deepEqual(engine.position, { x: 500, y: 400 });

  engine.suggestMoveTo({ x: 900, y: 700 }, 0, 5000);
  engine.tick(0, null);
  assert.equal(engine.state, 'ai_directed');
  engine.resetPosition();
  const snap = engine.tick(10, null);
  assert.notEqual(snap.state, 'ai_directed'); // the pending intent must not immediately reassert itself
});

test('an AI-suggested destination moves the cat and expires on its own', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 1000 }, position: { x: 100, y: 100 }, speed: 100000 });
  engine.tick(0, null); // establish a baseline "now" so the next tick has a non-zero delta
  engine.suggestMoveTo({ x: 800, y: 800 }, 0, 500);
  const snap = engine.tick(10, null);
  assert.equal(snap.state, 'ai_directed');
  assert.deepEqual(snap.position, { x: 800, y: 800 }); // huge speed: arrives same tick
});

test('a drag always overrides a pending AI suggestion', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 1000 }, position: { x: 100, y: 100 } });
  engine.suggestMoveTo({ x: 800, y: 800 }, 0, 5000);
  engine.beginDrag({ x: 100, y: 100 });
  assert.equal(engine.state, 'dragged');
  engine.updateDrag({ x: 250, y: 250 });
  const snap = engine.tick(10, null);
  assert.equal(snap.state, 'dragged');
  assert.deepEqual(snap.position, { x: 250, y: 250 });
});

test('an expired AI suggestion is dropped and autonomy resumes', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 1000 }, position: { x: 500, y: 500 }, idleDurationMsRange: [1, 1] });
  engine.suggestMoveTo({ x: 10, y: 10 }, 0, 5); // expires almost immediately
  engine.tick(0, null);
  const snap = engine.tick(100, null); // well past expiry
  assert.notEqual(snap.state, 'ai_directed');
});

test('setBounds clamps the current position into the new work area', () => {
  const engine = createLifeEngine({ bounds: { width: 2000, height: 2000 }, position: { x: 1900, y: 1900 }, margin: 20 });
  engine.setBounds({ width: 500, height: 500 });
  assert.ok(engine.position.x <= 500 - 20 + 1e-6);
  assert.ok(engine.position.y <= 500 - 20 + 1e-6);
});
