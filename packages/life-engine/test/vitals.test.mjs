// The life system: energy, sleepiness, the day/night weight, and the sleep loop they close.
//
// These are the assertions that separate "a cat that plays a sleep clip sometimes" from "a cat
// that gets tired, lies down, sleeps it off and wakes up" - the difference the behaviour was
// missing. They run on simulated hours, not real ones, because the engine takes `now` as an
// argument and derives the clock from it: nothing here waits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLifeEngine, PERSONALITY_TRAITS } from '../src/index.mjs';

const HOUR = 3600000;
/** A timestamp at a given local hour, so circadian assertions do not depend on when CI runs. */
function at(hour, dayOffset = 0) {
  const d = new Date(2026, 8, 22 + dayOffset, hour, 0, 0, 0);
  return d.getTime();
}

/** Run the engine forward in `stepMs` slices, so vitals accumulate the way they do live. */
function run(engine, from, durationMs, stepMs = 60000, cursor = null) {
  let t = from;
  const end = from + durationMs;
  let snap = engine.tick(t, cursor);
  while (t < end) {
    t = Math.min(end, t + stepMs);
    snap = engine.tick(t, cursor);
  }
  return snap;
}

/**
 * Run until `done(snapshot)` holds, and return { snap, at } - or throw naming what never
 * happened.
 *
 * Asserting on where a long run ENDS is the trap these tests fell into first: ten hours after
 * the cat got sleepy it has long since slept it off and woken up, so the end state is `idle`
 * and "it never slept" and "it slept and recovered" look identical. Watching for the
 * transition is the only way to tell those apart.
 */
function runUntil(engine, from, done, { stepMs = 60000, limitMs = 24 * HOUR, cursor = null, label = 'condition' } = {}) {
  let t = from;
  const end = from + limitMs;
  while (t <= end) {
    const snap = engine.tick(t, cursor);
    if (done(snap)) return { snap, at: t };
    t += stepMs;
  }
  throw new Error(`${label} never happened within ${limitMs / HOUR}h`);
}

test('energy drains while the cat is awake, and faster while it is walking', () => {
  // Same elapsed time, same start, same seed - the only difference is whether it moved.
  const resting = createLifeEngine({ idleDurationMsRange: [1e9, 1e9] }); // never sets off
  const walking = createLifeEngine({ idleDurationMsRange: [1, 1] }); // sets off immediately

  const a = run(resting, at(10), 3 * HOUR);
  const b = run(walking, at(10), 3 * HOUR);

  assert.ok(a.vitals.energy < 0.85, 'sitting still should still cost something');
  assert.ok(b.vitals.energy < a.vitals.energy, 'walking should cost more than resting');
});

test('sleepiness rises faster at 3am than at 3pm', () => {
  const night = createLifeEngine({ idleDurationMsRange: [1e9, 1e9] });
  const day = createLifeEngine({ idleDurationMsRange: [1e9, 1e9] });

  const n = run(night, at(3), 2 * HOUR).vitals.sleepiness;
  const d = run(day, at(15), 2 * HOUR).vitals.sleepiness;

  assert.ok(n > d, `night sleepiness ${n} should exceed day ${d}`);
  // And the weight itself is reported, so a reader can see WHY.
  assert.ok(night.tick(at(3), null).vitals.nightness > 0.9);
  assert.ok(day.tick(at(15), null).vitals.nightness < 0.1);
});

test('a settled cat that gets sleepy enough lies down, and sleeping restores it', () => {
  const engine = createLifeEngine({ idleDurationMsRange: [1e9, 1e9] });
  // Overnight: sleepiness climbs past the threshold while the cat sits.
  const { snap: asleep, at: sleptAt } = runUntil(engine, at(22), (s) => s.state === 'sleep', {
    label: 'falling asleep',
  });
  assert.ok(asleep.vitals.sleepiness >= asleep.vitals.sleepThreshold);
  assert.ok(asleep.vitals.sleptAt != null);
  const lowest = asleep.vitals.energy;

  // Left alone it wakes by itself, and only once it is actually rested.
  const { snap: awake } = runUntil(engine, sleptAt, (s) => s.state !== 'sleep', {
    label: 'waking up',
  });
  assert.equal(awake.state, 'idle');
  assert.ok(awake.vitals.energy > lowest, 'sleep should restore energy');
  assert.ok(awake.vitals.energy >= 0.85, 'and it should not wake before it is rested');
  assert.ok(awake.vitals.sleepiness <= 0.25);
});

test('the cat will not fall asleep mid-walk - it has to have settled first', () => {
  const engine = createLifeEngine({ idleDurationMsRange: [1, 1], sleepSettleMs: 60000 });
  // Force the conditions except for having settled: walk continuously through the night.
  const snap = run(engine, at(2), 6 * HOUR, 500);
  assert.notEqual(snap.state, 'sleep');
});

test('a disturbance wakes the cat, and keeps it awake while it lasts', () => {
  const engine = createLifeEngine({ idleDurationMsRange: [1e9, 1e9] });
  const { at: sleptAt } = runUntil(engine, at(22), (s) => s.state === 'sleep', { label: 'falling asleep' });

  // A toy appearing is not negotiable - the cat is up.
  engine.setToy('yarn', { x: 100, y: 100 });
  const woken = engine.tick(sleptAt + 60000, null);
  assert.notEqual(woken.state, 'sleep', 'a toy should wake the cat');

  engine.clearToy();
  // And it does not drop straight back to sleep on the next tick: it has to settle again.
  const justAfter = engine.tick(sleptAt + 60100, null);
  assert.notEqual(justAfter.state, 'sleep');
});

test('a dragged cat is never asleep', () => {
  const engine = createLifeEngine({ idleDurationMsRange: [1e9, 1e9] });
  const { at: sleptAt } = runUntil(engine, at(22), (s) => s.state === 'sleep', { label: 'falling asleep' });
  engine.beginDrag({ x: 300, y: 300 });
  const dragged = engine.tick(sleptAt + 60000, { x: 300, y: 300 });
  assert.equal(dragged.state, 'dragged');
});

test('a high sleepiness trait lowers the bar for lying down; a low one raises it', () => {
  const sleepy = createLifeEngine({ idleDurationMsRange: [1e9, 1e9] });
  const wired = createLifeEngine({ idleDurationMsRange: [1e9, 1e9] });
  sleepy.setPersonality({ sleepiness: 1 });
  wired.setPersonality({ sleepiness: 0 });

  const a = sleepy.tick(at(12), null);
  const b = wired.tick(at(12), null);
  assert.ok(
    a.vitals.sleepThreshold < b.vitals.sleepThreshold,
    'a sleepy cat should need less sleepiness to lie down than a wired one',
  );

  // And it shows up in behaviour, not just in the number.
  const s = run(sleepy, at(20), 6 * HOUR);
  const w = run(wired, at(20), 6 * HOUR);
  assert.equal(s.state, 'sleep');
  assert.notEqual(w.state, 'sleep');
});

test('a neutral personality leaves the tuned defaults exactly where they were', () => {
  // The guard against traits quietly re-tuning measured behaviour: 0.5 must be identity.
  const engine = createLifeEngine({});
  assert.deepEqual(engine.personality, {
    independence: 0.5, curiosity: 0.5, gentleness: 0.5, playfulness: 0.5, sleepiness: 0.5,
  });
  const snap = engine.tick(at(12), null);
  assert.equal(snap.vitals.sleepThreshold, 0.78, 'the neutral threshold is the configured one');
});

test('setPersonality ignores junk and keeps the traits it was not told about', () => {
  const engine = createLifeEngine({});
  engine.setPersonality({ curiosity: 0.9, playfulness: NaN, nonsense: 5 });
  assert.equal(engine.personality.curiosity, 0.9);
  assert.equal(engine.personality.playfulness, 0.5, 'NaN must not land in the traits');
  assert.equal(engine.personality.independence, 0.5, 'untouched traits keep their value');
  assert.ok(!('nonsense' in engine.personality));
  engine.setPersonality(null);
  assert.equal(engine.personality.curiosity, 0.9, 'a null update is a no-op, not a reset');
  for (const trait of PERSONALITY_TRAITS) assert.ok(Number.isFinite(engine.personality[trait]));
});

test('a curious cat sets off sooner than an independent one', () => {
  // Same seed, so the two runs make the same random draws and the only difference is the trait.
  const seed = () => 0.5;
  const curious = createLifeEngine({ random: seed });
  const content = createLifeEngine({ random: seed });
  curious.setPersonality({ curiosity: 1, independence: 0 });
  content.setPersonality({ curiosity: 0, independence: 1 });

  let cur = 0;
  let con = 0;
  for (let t = 0; t < 10 * 60000; t += 250) {
    if (curious.tick(at(12) + t, null).state === 'wander') cur += 1;
    if (content.tick(at(12) + t, null).state === 'wander') con += 1;
  }
  assert.ok(cur > con, `curious spent ${cur} ticks walking, content ${con}`);
});

test('closing the laptop for eight hours does not age the cat eight hours', () => {
  const engine = createLifeEngine({ idleDurationMsRange: [1e9, 1e9] });
  engine.tick(at(9), null);
  const start = engine.tick(at(9) + 1000, null).vitals;

  // One tick, eight hours later: the gap the OS hands back after a sleep/wake.
  const after = engine.tick(at(9) + 8 * HOUR, null).vitals;

  const drop = start.energy - after.energy;
  // The cap is fifteen minutes, so the drain must be far closer to that than to eight hours.
  assert.ok(drop > 0, 'some time should pass - the cap is a cap, not a freeze');
  assert.ok(drop < 0.1 * 8, `an eight-hour gap drained ${drop}, which is more than the cap allows`);
});

test('a full day closes the loop: awake, tired, asleep, rested, awake again', () => {
  // Stepped at 250ms rather than a minute: the engine caps one tick's movement at 0.25s, so a
  // minute-long step walks the cat a quarter-second's distance and it never finishes a trip,
  // never settles, and therefore never sleeps. That is a measurement artefact, not behaviour.
  // 16 simulated hours at this rate is 230k ticks and runs in well under a tenth of a second.
  const engine = createLifeEngine({ random: () => 0.5 });
  const seen = new Set();
  let t = at(20);
  const end = t + 16 * HOUR;
  while (t < end) {
    seen.add(engine.tick(t, null).state);
    t += 250;
  }
  assert.ok(seen.has('sleep'), 'a cat that never sleeps in sixteen hours is not living a day');
  assert.ok(seen.has('wander'), 'nor is one that never goes anywhere');
  assert.ok(seen.has('idle'));
  // And it ends the day in a representable state, not stuck.
  assert.ok(['idle', 'wander', 'sleep'].includes(engine.state));
});
