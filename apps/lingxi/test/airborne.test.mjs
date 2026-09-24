// Every clip that leaves the floor, held to a parabola.
//
// The bug this pins down: `sampleMotion` smoothsteps every segment of every track, which is
// right for a pose settling into place and exactly backwards for a jump. Under smoothstep the
// cat leaves the ground at zero vertical speed, accelerates in mid-air, stops dead at the apex
// and is lowered back down - it reads as being lifted on a string. The implied gravity of
// `hop-catch` was 0.99 m/s², a tenth of Earth's, and `pounce` fell more slowly than it rose,
// which no ballistic arc does.
//
// So these tests measure the SHAPE of the arc rather than eyeballing keyframe numbers: speed
// must be highest leaving the floor and lowest at the apex, and the two halves must agree on
// one value of g. Retuning the height or the hang time is fine and will not fail anything here;
// making the cat float again will.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sampleMotion } from '../src/anim/motion.ts';

const library = JSON.parse(
  readFileSync(fileURLToPath(new URL('../src/data/actions.json', import.meta.url)), 'utf8'),
);
const byId = Object.fromEntries(library.actions.map((a) => [a.id, a]));

/** Clips whose root actually leaves the floor, and what each one is meant to be. */
const AIRBORNE = ['hop-catch', 'pounce'];

/** 1 voxel = 1.5 cm - skeleton.json's `units.voxelCm`, restated so a change there fails here. */
const VOXEL_CM = 1.5;
/** Shoulder height in voxels - skeleton.json's `reference.shoulderHeight`. */
const SHOULDER_VOXELS = 10;

const liftTrack = (clip) => clip.tracks.find((t) => t.channel === 'root.position.y');
const height = (clip, t) => sampleMotion(clip, t)['root.position.y'] ?? 0;

test('every airborne clip declares itself ballistic - the default would float it', () => {
  for (const id of AIRBORNE) {
    const track = liftTrack(byId[id]);
    assert.ok(track, `${id} should lift the root`);
    assert.equal(track.interp, 'ballistic', `${id}'s lift must not use the smoothstep default`);
  }
});

test('the cat leaves the floor fast and arrives at the apex slow, not the other way round', () => {
  for (const id of AIRBORNE) {
    const clip = byId[id];
    const keys = liftTrack(clip).keys;
    const apexKey = keys.reduce((a, b) => (b[1] > a[1] ? b : a));
    const takeoff = keys[keys.indexOf(apexKey) - 1][0];
    const apex = apexKey[0];

    // Sample the rise in equal slices and compare how far the cat travels in each.
    const slices = 8;
    const step = (apex - takeoff) / slices;
    const travelled = [];
    for (let i = 0; i < slices; i += 1) {
      travelled.push(height(clip, takeoff + (i + 1) * step) - height(clip, takeoff + i * step));
    }
    for (let i = 1; i < travelled.length; i += 1) {
      assert.ok(
        travelled[i] < travelled[i - 1],
        `${id}: slice ${i} of the rise (${travelled[i].toFixed(4)}) should be shorter than ` +
          `slice ${i - 1} (${travelled[i - 1].toFixed(4)}) - a rising body decelerates`,
      );
    }
    // The first slice off the floor is the fastest of the whole rise.
    assert.ok(travelled[0] > travelled[slices - 1] * 3, `${id}: the takeoff should be decisive`);
  }
});

test('the fall mirrors the rise, so both halves imply one gravity', () => {
  for (const id of AIRBORNE) {
    const keys = liftTrack(byId[id]).keys;
    const apexIndex = keys.indexOf(keys.reduce((a, b) => (b[1] > a[1] ? b : a)));
    const rise = keys[apexIndex][0] - keys[apexIndex - 1][0];
    const fall = keys[apexIndex + 1][0] - keys[apexIndex][0];
    assert.ok(
      Math.abs(rise - fall) < 0.02,
      `${id}: rise ${rise.toFixed(3)}s and fall ${fall.toFixed(3)}s must match - ` +
        'a body under gravity takes as long coming down as it took going up',
    );
  }
});

test('the implied gravity is in the same believable range for every airborne clip', () => {
  // g = 2h/t² with h in voxels and t the rise time, converted to m/s².
  // Not Earth's 9.81: at this scale a true 1g hop is airborne for 0.09s, which is five frames
  // and reads as a glitch rather than a jump. A stylised fraction is a deliberate choice - the
  // bound here is that it stays a fraction, and that the clips agree with each other, so the
  // cat never looks like it is on two different planets in two different moods.
  const implied = {};
  for (const id of AIRBORNE) {
    const keys = liftTrack(byId[id]).keys;
    const apexIndex = keys.indexOf(keys.reduce((a, b) => (b[1] > a[1] ? b : a)));
    const h = keys[apexIndex][1];
    const rise = keys[apexIndex][0] - keys[apexIndex - 1][0];
    implied[id] = ((2 * h) / (rise * rise)) * (VOXEL_CM / 100);
  }
  for (const [id, g] of Object.entries(implied)) {
    assert.ok(g > 1.5, `${id}: ${g.toFixed(2)} m/s² is floatier than the moon`);
    assert.ok(g < 9.81, `${id}: ${g.toFixed(2)} m/s² is above Earth gravity, which is not stylisation`);
  }
  const values = Object.values(implied);
  assert.ok(
    Math.max(...values) / Math.min(...values) < 2,
    `the clips disagree about gravity: ${JSON.stringify(implied)}`,
  );
});

test('a hop clears a fraction of the cat, not a cat and a half', () => {
  for (const id of AIRBORNE) {
    const apex = Math.max(...liftTrack(byId[id]).keys.map((k) => k[1]));
    assert.ok(apex > 0.5, `${id}: ${apex} voxels is not a jump`);
    assert.ok(
      apex < SHOULDER_VOXELS * 0.35,
      `${id}: ${apex} voxels is over a third of the ${SHOULDER_VOXELS}-voxel shoulder height - ` +
        'a desktop pet batting at a toy does not launch itself',
    );
  }
});

test('the legs and the head still move with the arc, not with where it used to be', () => {
  // Retiming the lift without retiming everything else is the other half of this bug: the swipe
  // would land while the cat was already back on the floor. Every key that used to sit inside
  // the airborne window must still sit inside it.
  for (const id of AIRBORNE) {
    const clip = byId[id];
    const keys = liftTrack(clip).keys;
    const apexIndex = keys.indexOf(keys.reduce((a, b) => (b[1] > a[1] ? b : a)));
    const takeoff = keys[apexIndex - 1][0];
    const land = keys[apexIndex + 1][0];

    // Something other than the lift has to happen while the cat is off the floor, or the jump
    // is a bare translation of a standing pose.
    const companions = clip.tracks.filter((t) => t.channel !== 'root.position.y');
    assert.ok(
      companions.some((t) => t.keys.some(([t0]) => t0 > takeoff && t0 < land)),
      `${id}: nothing but the lift is keyed between ${takeoff}s and ${land}s`,
    );

    // `pounce` carries its shape in pose.crouch and has no explicit leg tracks; `hop-catch`
    // swings both front legs, and the extreme of that swing is the swipe. Where a leg track
    // exists, the swipe belongs in the air - that is the key that used to be left behind when
    // the lift was retimed without it.
    for (const leg of ['upperFL.rotation.x', 'upperFR.rotation.x']) {
      const reach = clip.tracks.find((t) => t.channel === leg);
      if (!reach) continue;
      const swipe = reach.keys.reduce((a, b) => (Math.abs(b[1]) > Math.abs(a[1]) ? b : a));
      assert.ok(
        swipe[0] >= takeoff && swipe[0] <= land + 0.1,
        `${id}: the ${leg} swipe at ${swipe[0]}s falls outside the airborne window ` +
          `${takeoff}s–${land}s - the cat is batting at the toy from the floor`,
      );
    }
  }
});

test('sampleMotion honours all three interpolations, and defaults to the old one', () => {
  const clip = (interp) => ({
    id: 'probe', name: 'probe', duration: 1, priority: 0, expression: 'x',
    tracks: [{ channel: 'root.position.y', keys: [[0, 0], [1, 1]], ...(interp ? { interp } : {}) }],
  });
  const at = (interp, t) => sampleMotion(clip(interp), t)['root.position.y'];

  assert.equal(at('linear', 0.25), 0.25, 'linear should be linear');
  // smoothstep(0.25) = 0.15625 - slower than linear at the start, which is what makes it wrong
  // for a takeoff and right for a head turn.
  assert.ok(Math.abs(at(undefined, 0.25) - 0.15625) < 1e-9, 'the default must still be smoothstep');
  assert.ok(Math.abs(at('smooth', 0.25) - 0.15625) < 1e-9, 'explicit smooth matches the default');
  // Rising ballistic: 0.25*(2-0.25) = 0.4375 - already past linear, because it left fast.
  assert.ok(Math.abs(at('ballistic', 0.25) - 0.4375) < 1e-9, 'a rising ballistic segment decelerates');

  const falling = {
    id: 'probe', name: 'probe', duration: 1, priority: 0, expression: 'x',
    tracks: [{ channel: 'root.position.y', keys: [[0, 1], [1, 0]], interp: 'ballistic' }],
  };
  // Falling: 1 - 0.25² = 0.9375 - barely moved, because it started from rest at the apex.
  assert.ok(
    Math.abs(sampleMotion(falling, 0.25)['root.position.y'] - 0.9375) < 1e-9,
    'a falling ballistic segment accelerates from rest',
  );
});
