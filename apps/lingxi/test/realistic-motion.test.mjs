import test from 'node:test';
import assert from 'node:assert/strict';
import { locomotionRate, locomotionClip, comfortableWalkPace } from '../src/realistic-motion.ts';

// Distances and durations read from the integrated ZZZ3 GLB's Root translation channels.
const walk = { stride: .15789473, seconds: 1.95833337 };
const run = { stride: .93333334, seconds: 1.29166663 };

test('desktop displacement sets the clip clock at small and large sizes, including slow arrival', () => {
  for (const scale of [.32, .63, 1.26, 3.0]) {
    for (const groundSpeed of [0, .005, .08, .7, 2]) {
      const clip = locomotionClip(groundSpeed, walk.stride * scale / walk.seconds, false, true) === 'Run' ? run : walk;
      const dt = 1 / 60;
      const rate = locomotionRate(groundSpeed * dt, dt, clip.stride, scale, clip.seconds);
      const animatedDistance = rate * dt / clip.seconds * clip.stride * scale;
      assert.ok(Math.abs(animatedDistance - groundSpeed * dt) < 1e-8, `sliding at scale ${scale}, speed ${groundSpeed}`);
    }
  }
});

test('a stopped cat does not keep stepping and a fast small cat uses its run stride', () => {
  assert.equal(locomotionRate(0, 1 / 60, walk.stride, .63, walk.seconds), 0);
  assert.equal(locomotionClip(.54, walk.stride * .63 / walk.seconds, false, true), 'Run');
  assert.equal(locomotionClip(.08, .05, true, true), 'Run');
  assert.equal(locomotionClip(.08, .05, false, true), 'Walk');
});

test('preferred wander speed scales with the cat and the projected direction', () => {
  const front = comfortableWalkPace(walk.stride, walk.seconds, .63, .006, .015, 0);
  const side = comfortableWalkPace(walk.stride, walk.seconds, .63, .006, .015, Math.PI / 2);
  assert.ok(Math.abs(side / front - 2.5) < 1e-8);
  assert.ok(Math.abs(comfortableWalkPace(walk.stride, walk.seconds, 1.26, .006, .015, 0) / front - 2) < 1e-8);
  assert.equal(comfortableWalkPace(0, 1, 1, .006, .015, 0), null);
});
