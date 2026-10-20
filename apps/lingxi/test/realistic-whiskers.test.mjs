import test from 'node:test';
import assert from 'node:assert/strict';
import { WHISKER, stepWhiskerSpring, whiskerMood } from '../src/realistic-whiskers.ts';

const still = () => ({ position: [0, 0, 0], velocity: [0, 0, 0] });

test('a whisker tip trails a turn, overshoots lightly, and returns to rest', () => {
  let spring = still();
  spring = stepWhiskerSpring(spring, [0, 0, -0.016], 1 / 60);
  assert.ok(spring.position[2] < 0 && spring.position[2] > -0.016);
  for (let i = 0; i < 14; i++) spring = stepWhiskerSpring(spring, [0, 0, -0.016], 1 / 60);
  assert.ok(spring.position[2] < -0.009);
  let crossed = false;
  for (let i = 0; i < 100; i++) {
    spring = stepWhiskerSpring(spring, [0, 0, 0], 1 / 60);
    crossed ||= spring.position[2] > 0;
  }
  assert.ok(crossed, 'elastic recovery passes rest briefly');
  assert.ok(Math.abs(spring.position[2]) < 1e-5);
});

test('large frame stalls snap and hard bends stay bounded', () => {
  const recovered = stepWhiskerSpring({ position: [0, 0, -0.02], velocity: [0, 0, -4] }, [0, 0, 0], 0.4);
  assert.deepEqual(recovered, still());
  let spring = still();
  for (let i = 0; i < 120; i++) spring = stepWhiskerSpring(spring, [1, -1, 1], 1 / 60);
  assert.ok(spring.position.every(v => Math.abs(v) <= WHISKER.maxBend));
});

test('curious and alarmed faces fan forward while fearful and relaxed faces lay back', () => {
  assert.ok(whiskerMood('好奇') > 0);
  assert.ok(whiskerMood('警觉') > 0);
  assert.ok(whiskerMood('惊吓') < whiskerMood('放松'));
  assert.equal(whiskerMood('安然'), 0);
});
