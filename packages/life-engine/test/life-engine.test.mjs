import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifeEngine, INTERACTION_MODES } from '../src/index.mjs';

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
  // Steering means arrival takes a few frames even at absurd speed - the cat has to turn onto
  // its route before it can travel along it. That is the point of the heading model.
  let snap;
  for (let frame = 1; frame <= 90 && engine.state === 'wander'; frame += 1) {
    snap = engine.tick(10 + frame * (1000 / 60), null);
  }
  assert.equal(engine.state, 'idle');
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

test('"auto" mode: a cursor parked on the cat produces ONE escape route, not a new one every frame', () => {
  // The regression this guards: the flee condition ("cursor is inside avoidRadius") stays true
  // for as long as the cursor sits there, and used to re-roll a random escape target on every
  // single tick. The cat then never travelled anywhere - it changed direction 60 times a
  // second and vibrated in place ("在停下的时候一直在晃").
  const engine = createLifeEngine({
    bounds: { width: 2000, height: 2000 },
    position: { x: 1000, y: 1000 },
    avoidRadius: 150,
    speed: 300,
  });
  const cursor = { x: 1040, y: 1000 }; // parked inside avoidRadius for the whole run
  const first = engine.tick(0, cursor);
  assert.equal(first.state, 'wander');
  const route = first.target;
  assert.ok(route, 'fleeing should commit to a target');

  // A second of frames with the cursor never leaving: same route throughout...
  for (let frame = 1; frame <= 60; frame += 1) {
    const snap = engine.tick(frame * (1000 / 60), cursor);
    assert.deepEqual(snap.target, route, `target changed on frame ${frame}`);
  }
  // ...and that commitment is what makes it actually cover ground instead of shuffling. Given
  // two seconds, because an escape route that starts out behind the cat legitimately spends the
  // first of them turning around rather than travelling.
  for (let frame = 61; frame <= 120; frame += 1) engine.tick(frame * (1000 / 60), cursor);
  assert.ok(
    distance(engine.position, { x: 1000, y: 1000 }) > 100,
    `expected to have fled, only covered ${distance(engine.position, { x: 1000, y: 1000 }).toFixed(0)}px`,
  );
});

test('"auto" mode: every step of an escape run moves roughly the same direction', () => {
  // The visible symptom of per-frame retargeting was direction, not distance: the renderer
  // derives which way the cat faces from where it actually moved, so a heading that reverses
  // between frames reads as shaking. Assert the per-frame heading stays consistent.
  const engine = createLifeEngine({
    bounds: { width: 2000, height: 2000 },
    position: { x: 1000, y: 1000 },
    avoidRadius: 150,
    speed: 300,
  });
  const cursor = { x: 1040, y: 1000 };
  engine.tick(0, cursor);
  // Skip the first half-second: the cat now steers onto its escape route instead of snapping
  // to it, and that turn is a real, intended manoeuvre.
  for (let frame = 1; frame <= 40; frame += 1) engine.tick(frame * (1000 / 60), cursor);
  const headings = [];
  for (let frame = 41; frame <= 100; frame += 1) {
    headings.push(engine.tick(frame * (1000 / 60), cursor).heading);
  }
  assert.ok(headings.length > 40);
  // What matters is that the heading never REVERSES frame to frame - that is the shaking. A
  // slow continuous drift is correct and expected: the bearing to the target keeps changing as
  // the cat closes on it, so a steering model keeps trimming toward it.
  let reversals = 0;
  let maxStep = 0;
  for (let i = 2; i < headings.length; i += 1) {
    const a = Math.atan2(Math.sin(headings[i - 1] - headings[i - 2]), Math.cos(headings[i - 1] - headings[i - 2]));
    const b = Math.atan2(Math.sin(headings[i] - headings[i - 1]), Math.cos(headings[i] - headings[i - 1]));
    maxStep = Math.max(maxStep, Math.abs(b));
    if (a * b < -1e-12 && Math.abs(b) > 1e-4) reversals += 1;
  }
  assert.equal(reversals, 0, 'the heading must never reverse mid-route - that is the shaking');
  // Once the turn onto the route is done the heading must be essentially still. Checking the
  // tail of the run rather than all of it, because how long the initial turn takes depends on
  // which edge the (deliberately random) escape target landed on.
  let settledStep = 0;
  for (let i = headings.length - 20; i < headings.length; i += 1) {
    const step = Math.atan2(Math.sin(headings[i] - headings[i - 1]), Math.cos(headings[i] - headings[i - 1]));
    settledStep = Math.max(settledStep, Math.abs(step));
  }
  assert.ok(settledStep < 0.03, `once committed the heading should be steady, still moving ${settledStep.toFixed(4)}/frame`);
  assert.ok(maxStep > 0, 'sanity: the cat should actually have been steering');
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

test('"auto" mode: idle wandering targets a point ON a work-area edge, not a nearby hop', () => {
  const engine = createLifeEngine({
    bounds: { width: 3000, height: 2000 },
    position: { x: 1500, y: 1000 }, // dead center, far from any edge
    idleDurationMsRange: [10, 10],
    margin: 24,
  });
  const cursor = { x: 100, y: 100 }; // near the top-left corner
  engine.tick(0, cursor);
  const snap = engine.tick(50, cursor); // idle window elapsed -> wander target picked
  assert.equal(snap.state, 'wander');
  // 'auto' mode is the "stay out of my way" mode, so a rest target must be literally on the
  // desktop's border: exactly one of the two coordinates sits at the margin.
  const onLeftOrRight = Math.abs(snap.target.x - 24) < 1 || Math.abs(snap.target.x - (3000 - 24)) < 1;
  const onTopOrBottom = Math.abs(snap.target.y - 24) < 1 || Math.abs(snap.target.y - (2000 - 24)) < 1;
  assert.ok(onLeftOrRight || onTopOrBottom, `expected an edge point, got ${JSON.stringify(snap.target)}`);
});

test('"auto" mode: edge choice is biased away from the cursor', () => {
  // Not a hard guarantee for any single pick (every edge keeps a non-zero weight on purpose -
  // see rollEdgeRestTarget), so assert the distribution: with the cursor pinned to the top-left,
  // the great majority of rest targets should land on the right or bottom border.
  let farSide = 0;
  const attempts = 200;
  for (let i = 0; i < attempts; i += 1) {
    const engine = createLifeEngine({
      bounds: { width: 3000, height: 2000 },
      position: { x: 1500, y: 1000 },
      idleDurationMsRange: [10, 10],
      margin: 24,
    });
    const cursor = { x: 100, y: 100 };
    engine.tick(0, cursor);
    const { target } = engine.tick(50, cursor);
    if (Math.abs(target.x - (3000 - 24)) < 1 || Math.abs(target.y - (2000 - 24)) < 1) farSide += 1;
  }
  assert.ok(farSide / attempts > 0.8, `only ${farSide}/${attempts} picks were on the far side`);
});

test('"auto" mode: wandering to the rest spot actually arrives at the work-area edge', () => {
  const engine = createLifeEngine({
    bounds: { width: 3000, height: 2000 },
    position: { x: 1500, y: 1000 },
    idleDurationMsRange: [1, 1],
    margin: 24,
    speed: 100000, // effectively teleport so the test does not depend on many frames
  });
  const cursor = { x: 100, y: 100 };
  engine.tick(0, cursor);
  engine.tick(10, cursor); // idle window elapsed -> now wandering toward the far edge
  assert.equal(engine.state, 'wander');
  // tick()'s deltaSeconds is capped at 0.25s per frame, so give it one full capped frame
  const snap = engine.tick(300, cursor);
  assert.equal(snap.state, 'idle');
  const atEdge =
    Math.abs(snap.position.x - 24) < 1 || Math.abs(snap.position.x - (3000 - 24)) < 1 ||
    Math.abs(snap.position.y - 24) < 1 || Math.abs(snap.position.y - (2000 - 24)) < 1;
  assert.ok(atEdge, `expected to end up on a border, got ${JSON.stringify(snap.position)}`);
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
  engine.suggestMoveTo({ x: 800, y: 800 }, 0, 5000);
  assert.equal(engine.tick(10, null).state, 'ai_directed');
  // No longer "arrives the same tick": the cat has to steer onto the bearing before it can
  // travel along it, however fast it is. It still gets there, and promptly.
  let snap;
  for (let frame = 1; frame <= 120 && engine.state === 'ai_directed'; frame += 1) {
    snap = engine.tick(10 + frame * (1000 / 60), null);
  }
  assert.ok(distance(engine.position, { x: 800, y: 800 }) < 10, `expected arrival, got ${JSON.stringify(engine.position)}`);
  assert.ok(snap);
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

// --- toys -------------------------------------------------------------------------------

test('a toy outranks autonomous behavior: the cat goes to it and swats it', () => {
  const engine = createLifeEngine({
    bounds: { width: 1600, height: 1000 },
    position: { x: 200, y: 500 },
    toyReach: 34,
  });
  engine.setToy('yarn', { x: 900, y: 500 });
  const first = engine.tick(0, null);
  assert.equal(first.state, 'play_toy');
  // A new ball arrives in your hand, so the cat stalks it but will not bat at your fingers.
  assert.equal(first.toy.held, true);
  // Let it go (a zero-power throw) and it becomes a loose ball the cat can actually play with.
  engine.throwToy({ x: 0, y: 0 });
  assert.equal(engine.toy.held, false);

  // Run until it reaches the ball and swats it.
  let batted = false;
  for (let frame = 1; frame <= 240 && !batted; frame += 1) {
    batted = engine.tick(frame * (1000 / 60), null).batted;
  }
  assert.ok(batted, 'the cat should reach the ball and bat it');
  // A swat launches the ball - that is what keeps the rally going without the user.
  assert.ok(Math.hypot(engine.toy.velocity.x, engine.toy.velocity.y) > 100);
});

test('the yarn ball rolls, slows down, and never leaves the work area', () => {
  const engine = createLifeEngine({
    bounds: { width: 1000, height: 800 },
    position: { x: 50, y: 50 },
    margin: 20,
    speed: 0, // park the cat: this test is about the ball's own physics, not the rally
  });
  engine.setToy('yarn', { x: 500, y: 400 });
  engine.throwToy({ x: 1400, y: 900 }); // releases it from the hand and sends it off hard
  engine.tick(0, null);
  const initialSpeed = Math.hypot(engine.toy.velocity.x, engine.toy.velocity.y);
  for (let frame = 1; frame <= 240; frame += 1) {
    engine.tick(frame * (1000 / 60), null);
    const { position } = engine.toy;
    assert.ok(position.x >= 20 - 1e-6 && position.x <= 1000 - 20 + 1e-6, `ball left bounds horizontally on frame ${frame}`);
    assert.ok(position.y >= 20 - 1e-6 && position.y <= 800 - 20 + 1e-6, `ball left bounds vertically on frame ${frame}`);
  }
  // Friction plus the energy lost bouncing: four seconds later it is well under way, and the
  // rest threshold has snapped it to a dead stop.
  assert.ok(Math.hypot(engine.toy.velocity.x, engine.toy.velocity.y) < initialSpeed);
  assert.deepEqual(engine.toy.velocity, { x: 0, y: 0 });
});

test('the wand trails the cursor instead of snapping to it, and the laser is pinned to it', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 800 }, position: { x: 500, y: 400 } });
  engine.setToy('feather', { x: 100, y: 100 });
  engine.tick(0, { x: 900, y: 700 });
  const afterOneFrame = engine.tick(1000 / 60, { x: 900, y: 700 }).toy.position;
  assert.ok(afterOneFrame.x > 100 && afterOneFrame.x < 900, 'the wand tip lags the hand');

  engine.setToy('laser', { x: 100, y: 100 });
  const laser = engine.tick(100, { x: 640, y: 480 }).toy.position;
  assert.deepEqual(laser, { x: 640, y: 480 });
});

test('swatting the laser never moves it - it is the one toy that cannot be caught', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 800 }, position: { x: 500, y: 400 } });
  engine.setToy('laser', { x: 505, y: 400 }); // already within reach
  const snap = engine.tick(0, { x: 505, y: 400 });
  assert.equal(snap.batted, true, 'the cat still swats at it');
  assert.deepEqual(engine.toy.velocity, { x: 0, y: 0 }, 'but the dot does not move');
});

test('clearing the toy hands the cat straight back to autonomous behavior', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 800 }, position: { x: 500, y: 400 } });
  engine.setToy('yarn', { x: 200, y: 200 });
  assert.equal(engine.tick(0, null).state, 'play_toy');
  engine.clearToy();
  const snap = engine.tick(16, null);
  assert.equal(snap.toy, null);
  assert.notEqual(snap.state, 'play_toy');
});

test('a drag still outranks a toy - the user\'s hand always wins', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 800 }, position: { x: 500, y: 400 } });
  engine.setToy('yarn', { x: 200, y: 200 });
  engine.beginDrag({ x: 500, y: 400 });
  engine.updateDrag({ x: 600, y: 300 });
  const snap = engine.tick(16, null);
  assert.equal(snap.state, 'dragged');
  assert.deepEqual(snap.position, { x: 600, y: 300 });
});

// --- steering ---------------------------------------------------------------------------

test('a destination behind the cat is reached by turning around, not by reversing', () => {
  const engine = createLifeEngine({
    bounds: { width: 2000, height: 2000 },
    position: { x: 1000, y: 1000 },
    speed: 120,
  });
  // Point it firmly to the right, then ask for somewhere to the left.
  engine.tick(0, null);
  engine.suggestMoveTo({ x: 1900, y: 1000 }, 0, 4000);
  for (let f = 1; f <= 60; f += 1) engine.tick(f * (1000 / 60), null);
  const headingBefore = engine.tick(1100, null).heading;
  assert.ok(Math.abs(headingBefore) < 0.3, `expected to be heading right, got ${headingBefore.toFixed(2)}`);

  engine.suggestMoveTo({ x: 200, y: 1000 }, 1100, 12000);
  const headings = [];
  const positions = [];
  for (let f = 1; f <= 240; f += 1) {
    const snap = engine.tick(1100 + f * (1000 / 60), null);
    headings.push(snap.heading);
    positions.push(snap.position);
  }
  // It ends up heading the other way...
  const final = headings[headings.length - 1];
  assert.ok(Math.abs(Math.abs(final) - Math.PI) < 0.5, `expected to end up heading left, got ${final.toFixed(2)}`);
  // ...and it got there by sweeping through the angles in between, not by flipping. A pivot
  // would show one enormous single-frame jump; a turn shows many small ones.
  let biggestStep = 0;
  for (let i = 1; i < headings.length; i += 1) {
    const step = Math.atan2(Math.sin(headings[i] - headings[i - 1]), Math.cos(headings[i] - headings[i - 1]));
    biggestStep = Math.max(biggestStep, Math.abs(step));
  }
  assert.ok(biggestStep < 0.12, `turn should be swept, not snapped; biggest frame step ${biggestStep.toFixed(3)}`);
  // And the turn is a real arc through space: it swings off the line it was travelling along.
  const lateral = Math.max(...positions.map((p) => Math.abs(p.y - 1000)));
  assert.ok(lateral > 12, `expected the turn to carve an arc, max lateral excursion was ${lateral.toFixed(1)}`);
});

test('the cat only ever travels along its own heading - it never slides sideways', () => {
  const engine = createLifeEngine({
    bounds: { width: 2000, height: 2000 },
    position: { x: 1000, y: 1000 },
    speed: 140,
  });
  engine.setInteractionMode('play');
  let previous = engine.position;
  let worst = 0;
  for (let f = 1; f <= 300; f += 1) {
    // A cursor whipping around forces constant re-steering - the hardest case for this.
    const t = f / 60;
    const snap = engine.tick(f * (1000 / 60), { x: 1000 + Math.cos(t * 2.1) * 500, y: 1000 + Math.sin(t * 2.1) * 400 });
    const dx = snap.position.x - previous.x;
    const dy = snap.position.y - previous.y;
    previous = snap.position;
    const moved = Math.hypot(dx, dy);
    if (moved < 0.05) continue;
    // The angle between where it went and where it was pointing must be ~0.
    const drift = Math.atan2(Math.sin(Math.atan2(dy, dx) - snap.heading), Math.cos(Math.atan2(dy, dx) - snap.heading));
    worst = Math.max(worst, Math.abs(drift));
  }
  assert.ok(worst < 0.02, `travel must follow the heading; worst mismatch was ${worst.toFixed(4)} rad`);
});

test('hold() keeps the cat still so an action clip can finish, then autonomy resumes', () => {
  const engine = createLifeEngine({
    bounds: { width: 1000, height: 1000 },
    position: { x: 500, y: 500 },
    idleDurationMsRange: [1, 1], // would otherwise start wandering immediately
    speed: 300,
  });
  engine.tick(0, null);
  engine.hold(2000, 0);
  const start = engine.position;
  for (let f = 1; f <= 100; f += 1) {
    const snap = engine.tick(f * (1000 / 60), null);
    assert.notEqual(snap.state, 'wander', `should not wander during a hold (frame ${f})`);
  }
  assert.deepEqual(engine.position, start, 'a held cat must not move at all');

  // Once it expires, normal behaviour comes straight back.
  let resumed = false;
  for (let f = 1; f <= 400 && !resumed; f += 1) {
    if (engine.tick(2100 + f * (1000 / 60), null).state === 'wander') resumed = true;
  }
  assert.ok(resumed, 'autonomy should resume after the hold expires');
});

test('a hold never blocks a drag, a toy, or an explicit AI intent', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 1000 }, position: { x: 500, y: 500 } });
  engine.tick(0, null);

  engine.hold(5000, 0);
  engine.beginDrag({ x: 500, y: 500 });
  engine.updateDrag({ x: 600, y: 600 });
  assert.equal(engine.tick(16, null).state, 'dragged');
  engine.endDrag(32);

  engine.hold(5000, 32);
  engine.setToy('yarn', { x: 200, y: 200 });
  assert.equal(engine.tick(48, null).state, 'play_toy');
  engine.clearToy();

  engine.hold(5000, 64);
  engine.suggestMoveTo({ x: 900, y: 100 }, 64, 3000);
  assert.equal(engine.tick(80, null).state, 'ai_directed');
});

test('the yarn ball comes to hand while charging, then launches harder the longer you held it', () => {
  const engine = createLifeEngine({ bounds: { width: 2000, height: 2000 }, position: { x: 1000, y: 1500 } });
  engine.setToy('yarn', { x: 300, y: 300 });
  assert.equal(engine.toy.held, true, 'a fresh ball arrives on the pointer');
  engine.beginCharge(0);
  // While held it tracks the cursor exactly and does not roll.
  const held = engine.tick(16, { x: 640, y: 480 });
  assert.deepEqual(held.toy.position, { x: 640, y: 480 });
  assert.deepEqual(held.toy.velocity, { x: 0, y: 0 });
  assert.ok(held.toy.charge > 0 && held.toy.charge < 0.1, 'charge should have only just started');

  // A brief tap throws it gently...
  engine.releaseCharge(120, { x: 1, y: 0 });
  const soft = Math.hypot(engine.toy.velocity.x, engine.toy.velocity.y);

  engine.setToy('yarn', { x: 300, y: 300 });
  engine.beginCharge(1000);
  engine.tick(1016, { x: 640, y: 480 });
  // ...a long hold throws it hard, and never harder than the cap.
  engine.releaseCharge(4000, { x: 1, y: 0 });
  const hard = Math.hypot(engine.toy.velocity.x, engine.toy.velocity.y);
  assert.ok(hard > soft * 2, `a full charge should clearly out-throw a tap (${hard.toFixed(0)} vs ${soft.toFixed(0)})`);
  assert.ok(hard <= 1250 + 1e-6, 'and it must not exceed the cap however long you hold');
});

test('the cat stalks a charged ball instead of batting it out of your hand', () => {
  const engine = createLifeEngine({ bounds: { width: 2000, height: 2000 }, position: { x: 1000, y: 1000 } });
  engine.setToy('yarn', { x: 1010, y: 1000 }); // already well within reach, and in hand
  engine.beginCharge(0);
  for (let f = 1; f <= 60; f += 1) {
    assert.equal(engine.tick(f * (1000 / 60), { x: 1010, y: 1000 }).batted, false);
  }
  // Release and it goes back to playing normally.
  engine.releaseCharge(1100, { x: 1, y: 0 });
  assert.ok(Math.hypot(engine.toy.velocity.x, engine.toy.velocity.y) > 0);
});

// --- one mode: free roaming that keeps clear of the pointer -------------------------------

test('there is only one mode, and the cursor never makes the cat chase it', () => {
  const engine = createLifeEngine({ bounds: { width: 2000, height: 2000 }, position: { x: 1000, y: 1000 } });
  assert.deepEqual([...INTERACTION_MODES], ['free']);
  assert.equal(engine.mode, 'free');
  // The old "play" mode is gone; asking for it is ignored rather than throwing, and the cat
  // still never seeks the cursor out. Chasing the pointer is the laser toy's job now.
  engine.setInteractionMode('play');
  assert.equal(engine.mode, 'free');
  for (let f = 0; f < 600; f += 1) {
    const snap = engine.tick(f * (1000 / 60), { x: 400, y: 400 });
    assert.notEqual(snap.state, 'follow_cursor');
    assert.ok(distance(snap.position, { x: 400, y: 400 }) > 60, `walked onto the pointer on frame ${f}`);
  }
});

test('a rest target is never chosen near the pointer, and the cat leaves if the pointer arrives', () => {
  const engine = createLifeEngine({
    bounds: { width: 2000, height: 1400 },
    position: { x: 1000, y: 700 },
    avoidRadius: 150,
    cursorKeepOut: 220,
  });
  // Deliberately parked ON a border, which is exactly where the cat wants to rest - so a
  // naive edge pick would put its destination right under the pointer.
  const cursor = { x: 1000, y: 1376 };
  let everClose = 0;
  let targets = 0;
  for (let f = 0; f < 3000; f += 1) {
    const snap = engine.tick(f * (1000 / 60), cursor);
    if (snap.target) {
      targets += 1;
      if (distance(snap.target, cursor) < 220) everClose += 1;
    }
  }
  assert.ok(targets > 100, 'sanity: the cat should have been picking destinations');
  assert.equal(everClose, 0, 'no rest target may be picked inside the pointer keep-out');
  assert.ok(distance(engine.position, cursor) > 150, 'and it should have stayed well clear');
});

test('the laser is what chases the cursor now, and it never drags the cat off-screen', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 800 }, position: { x: 500, y: 400 }, margin: 20 });
  engine.setToy('laser');
  // A cursor reported far outside the work area (a second monitor, or a bad reading).
  for (let f = 0; f < 400; f += 1) {
    const snap = engine.tick(f * 16, { x: 5000, y: -3000 });
    assert.equal(snap.state, 'play_toy');
    assert.ok(snap.position.x >= 20 - 1e-6 && snap.position.x <= 1000 - 20 + 1e-6, `x off-screen on frame ${f}`);
    assert.ok(snap.position.y >= 20 - 1e-6 && snap.position.y <= 800 - 20 + 1e-6, `y off-screen on frame ${f}`);
  }
});

// The cat's anchor is its FEET, so the body extends a long way above it and barely below. A
// single margin therefore cannot frame all four edges: 24px from the top leaves the cat drawn
// entirely off the screen. setMargins is how the host, which is the only thing that knows how
// tall the character currently draws, corrects for that.
test('per-edge margins keep the cat inside a box that is not symmetric', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 800 }, position: { x: 500, y: 400 } });
  engine.setMargins({ top: 300, bottom: 40, left: 24, right: 24 });

  for (let f = 0; f < 4000; f += 1) {
    const snap = engine.tick(f * 16, null);
    assert.ok(snap.position.y >= 300 - 1e-6, `crossed the top limit on frame ${f}: ${snap.position.y}`);
    assert.ok(snap.position.y <= 760 + 1e-6, `crossed the bottom limit on frame ${f}: ${snap.position.y}`);
    assert.ok(snap.position.x >= 24 - 1e-6 && snap.position.x <= 976 + 1e-6, `x off-screen on frame ${f}`);
  }
});

test('setMargins pulls a cat that is already out of the new bounds back inside', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 800 }, position: { x: 500, y: 30 } });
  engine.setMargins({ top: 300 });
  assert.equal(engine.position.y, 300);
});

test('a margin can be negative, letting the anchor cross the edge', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 800 }, position: { x: 500, y: 400 } });
  engine.setMargins({ bottom: -50 });
  for (let f = 0; f < 2000; f += 1) {
    const snap = engine.tick(f * 16, null);
    assert.ok(snap.position.y <= 850 + 1e-6, `overshot the extended bottom on frame ${f}`);
  }
});

test('margins left unspecified keep their current value', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 800 }, position: { x: 500, y: 400 } });
  engine.setMargins({ top: 300 });
  engine.setMargins({ left: 90 });
  engine.setMargins({ top: Number.NaN, right: 'nonsense' });
  for (let f = 0; f < 2000; f += 1) {
    const snap = engine.tick(f * 16, null);
    assert.ok(snap.position.y >= 300 - 1e-6, `top margin was lost on frame ${f}`);
    assert.ok(snap.position.x >= 90 - 1e-6, `left margin was lost on frame ${f}`);
    assert.ok(snap.position.x <= 976 + 1e-6, `right margin was corrupted on frame ${f}`);
  }
});

// Two boxes, because "how far may it go" and "how far does it choose to go" are different
// questions. The hard limit lets half the cat leave the screen for extreme moments; the roam
// box is where it puts itself when nothing is happening, and has to keep it visible.
test('the cat roams inside the roam box, not out to the hard limit', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 800 }, position: { x: 500, y: 600 } });
  engine.setMargins({
    top: -100, bottom: -100, left: -60, right: -60,
    roam: { top: 380, bottom: 30, left: 24, right: 24 },
  });

  let minY = Infinity;
  let maxY = -Infinity;
  for (let f = 0; f < 20000; f += 1) {
    const snap = engine.tick(f * 16, null);
    minY = Math.min(minY, snap.position.y);
    maxY = Math.max(maxY, snap.position.y);
  }
  // The roam box bounds the DESTINATIONS the cat picks, not every intermediate pixel: it travels
  // along a heading with a real turning circle, so an arc that ends on the border can bulge a
  // little past it first. The overshoot is bounded by that turning radius, and the alternative -
  // clamping mid-travel to the roam box - would snap the position of a cat that had been dragged
  // outside, which is a far worse artefact than a few pixels of arc.
  const arc = 28; // cfg.minTurnRadius
  assert.ok(minY >= 380 - arc, `roamed well above the roam box: ${minY}`);
  assert.ok(maxY <= 770 + arc, `roamed well below the roam box: ${maxY}`);
  // And it must actually use the room it has, or the box is just a cage.
  assert.ok(maxY - minY > 200, `barely moved vertically at all (${(maxY - minY).toFixed(0)}px)`);
});

test('a drag can still take the cat out to the hard limit, past the roam box', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 800 }, position: { x: 500, y: 600 } });
  engine.setMargins({
    top: -100, bottom: -100, left: -60, right: -60,
    roam: { top: 380, bottom: 30, left: 24, right: 24 },
  });
  engine.beginDrag({ x: 500, y: 600 });
  engine.updateDrag({ x: 500, y: -500 });
  assert.equal(engine.position.y, -100, 'the drag should reach the hard limit, not stop at the roam box');
});

test('a roam box wider than the hard limit is clipped to it, never the other way round', () => {
  const engine = createLifeEngine({ bounds: { width: 1000, height: 800 }, position: { x: 500, y: 400 } });
  engine.setMargins({ top: 200, bottom: 100, left: 50, right: 50, roam: { top: 10, bottom: 10, left: 10, right: 10 } });
  for (let f = 0; f < 6000; f += 1) {
    const snap = engine.tick(f * 16, null);
    assert.ok(snap.position.y >= 200 - 1e-6, `escaped the hard limit via the roam box on frame ${f}`);
    assert.ok(snap.position.y <= 700 + 1e-6, `escaped the hard limit via the roam box on frame ${f}`);
    assert.ok(snap.position.x >= 50 - 1e-6 && snap.position.x <= 950 + 1e-6, `x escaped on frame ${f}`);
  }
});

// The cat used to have only two answers to the pointer: pick a destination away from it, or bolt
// once it was already on top of you. Neither covers a perfectly good destination on the far side
// of the pointer, so it walked straight over the user's cursor to get there.
test('the cat walks around the pointer instead of over it', () => {
  const engine = createLifeEngine({ bounds: { width: 1400, height: 900 }, position: { x: 100, y: 450 } });
  engine.setMargins({ top: 0, bottom: 0, left: 0, right: 0 });
  const cursor = { x: 700, y: 450 }; // dead centre, squarely on the route
  engine.suggestMoveTo({ x: 1300, y: 450 }, 0);

  let closest = Infinity;
  for (let f = 0; f < 3000; f += 1) {
    const snap = engine.tick(f * 16, cursor);
    closest = Math.min(closest, Math.hypot(snap.position.x - cursor.x, snap.position.y - cursor.y));
    if (snap.position.x > 1200) break;
  }
  // It does not have to clear the full keep-out radius - it is committed to a destination on the
  // other side - but it must visibly go round rather than straight through.
  assert.ok(closest > 90, `cut through the pointer, closest approach was ${closest.toFixed(0)}px`);
});

test('going around the pointer does not make the cat vibrate', () => {
  const engine = createLifeEngine({ bounds: { width: 1400, height: 900 }, position: { x: 100, y: 450 } });
  engine.setMargins({ top: 0, bottom: 0, left: 0, right: 0 });
  const cursor = { x: 700, y: 450 };

  let previous = engine.tick(0, cursor);
  let reversals = 0;
  let lastTurnSign = 0;
  for (let f = 1; f < 2000; f += 1) {
    const snap = engine.tick(f * 16, cursor);
    const sign = Math.sign(Math.round(snap.turning * 100));
    if (sign !== 0 && lastTurnSign !== 0 && sign !== lastTurnSign) reversals += 1;
    if (sign !== 0) lastTurnSign = sign;
    previous = snap;
  }
  assert.ok(previous, 'engine kept ticking');
  // A committed detour sweeps one way. Frame-by-frame re-deciding is what the old reactive
  // avoidance did, and it showed up as exactly this: the turn direction flipping constantly.
  assert.ok(reversals < 120, `turn direction flipped ${reversals} times - the detour is chattering`);
});
