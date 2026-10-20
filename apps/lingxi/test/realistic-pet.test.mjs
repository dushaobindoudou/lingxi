import test from 'node:test';
import assert from 'node:assert/strict';
import { petWeights } from '../src/realistic-pet.ts';

const rig = {
  head: { x: 100, y: 40 }, chest: { x: 100, y: 70 }, spine: { x: 100, y: 100 },
  pelvis: { x: 100, y: 130 }, tailRoot: { x: 100, y: 150 },
};

test('a stroke by the cheek asks the head to meet the hand', () => {
  const w = petWeights({ x: 110, y: 40 }, rig, 160, 0.7);
  assert.ok(w.head > 0.85);
  assert.ok(w.head > w.back && w.head > w.rump);
  assert.ok(w.headX > 0 && w.headY === 0);
});

test('a hand along the spine moves its response toward the rump', () => {
  const shoulder = petWeights({ x: 100, y: 80 }, rig, 160, 0.7);
  const tail = petWeights({ x: 100, y: 150 }, rig, 160, 0.7);
  assert.ok(shoulder.back > shoulder.rump);
  assert.ok(tail.rump > shoulder.rump);
  assert.ok(tail.rump > tail.head);
});

test('a parked hand or a distant pointer gives no pose even near a bone', () => {
  assert.equal(petWeights(rig.head, rig, 160, 0).contact, 0);
  assert.equal(petWeights({ x: 300, y: 300 }, rig, 160, 0.8).contact, 0);
});

test('stroke strength and screen size scale smoothly', () => {
  const near = petWeights({ x: 120, y: 40 }, rig, 160, 0.55);
  const soft = petWeights({ x: 120, y: 40 }, rig, 160, 0.11);
  const small = petWeights({ x: 120, y: 40 }, rig, 80, 0.55);
  assert.ok(near.head > soft.head && soft.head > 0);
  assert.ok(near.head > small.head && small.head > 0);
});

test('a lying cat with a horizontal spine still responds under the hand', () => {
  const lying = {
    head: { x: 40, y: 90 }, chest: { x: 65, y: 105 }, spine: { x: 95, y: 105 },
    pelvis: { x: 125, y: 105 }, tailRoot: { x: 150, y: 105 },
  };
  const back = petWeights({ x: 95, y: 105 }, lying, 160, 0.32);
  const rump = petWeights({ x: 150, y: 105 }, lying, 160, 0.32);
  assert.ok(back.back > 0.95);
  assert.ok(rump.rump > 0.95);
  assert.equal(rump.head, 0);
});
