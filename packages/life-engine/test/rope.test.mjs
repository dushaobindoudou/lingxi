// The rope is what makes the wand feel like a wand, so its defining behaviours get asserted
// rather than eyeballed: the tip lags the hand, it keeps moving after the hand stops, it
// settles, it does not stretch, and it responds to being hit.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../../apps/lingxi/node_modules/three/build/three.module.js';
import { createRope } from '../../../apps/lingxi/src/rig/rope.ts';

const step = 1 / 60;
function settle(rope, anchor, frames = 240) {
  for (let i = 0; i < frames; i += 1) rope.update(anchor, step);
}

test('the tip hangs below the hand once it settles, and does not stretch', () => {
  const rope = createRope({ points: 6, segmentLength: 1.5, gravity: 55, damping: 0.35 });
  const hand = new THREE.Vector3(0, 0, 0);
  rope.reset(hand);
  settle(rope, hand);
  const tip = rope.points[5];
  assert.ok(Math.abs(tip.x) < 0.05 && Math.abs(tip.z) < 0.05, 'should hang straight down');
  const span = hand.distanceTo(tip);
  assert.ok(Math.abs(span - 1.5 * 5) < 0.3, `should hang its full length, got ${span.toFixed(2)}`);
  // No link may be stretched beyond its rest length by any meaningful amount.
  for (let i = 0; i < 5; i += 1) {
    const link = rope.points[i].distanceTo(rope.points[i + 1]);
    assert.ok(Math.abs(link - 1.5) < 0.12, `link ${i} is ${link.toFixed(2)}, should be ~1.5`);
  }
});

test('the tip LAGS the hand - which is the whole point of a cat wand', () => {
  const rope = createRope({ points: 6, segmentLength: 1.5, gravity: 55, damping: 0.35 });
  const hand = new THREE.Vector3(0, 0, 0);
  rope.reset(hand);
  settle(rope, hand);
  // Yank the hand sideways over a few frames.
  let worstLag = 0;
  for (let i = 1; i <= 12; i += 1) {
    hand.set(i * 1.2, 0, 0);
    rope.update(hand, step);
    worstLag = Math.max(worstLag, hand.x - rope.points[5].x);
  }
  assert.ok(worstLag > 2, `the tip should trail well behind the hand, lagged only ${worstLag.toFixed(2)}`);
});

test('it keeps swinging after the hand stops, then comes to rest', () => {
  const rope = createRope({ points: 6, segmentLength: 1.5, gravity: 55, damping: 0.35 });
  const hand = new THREE.Vector3(0, 0, 0);
  rope.reset(hand);
  settle(rope, hand);
  for (let i = 1; i <= 12; i += 1) {
    hand.set(i * 1.2, 0, 0);
    rope.update(hand, step);
  }
  // Hand now still. The tip must not be still with it.
  const before = rope.points[5].clone();
  for (let i = 0; i < 8; i += 1) rope.update(hand, step);
  assert.ok(before.distanceTo(rope.points[5]) > 0.3, 'the tip should carry its own momentum');

  settle(rope, hand, 600);
  const restA = rope.points[5].clone();
  for (let i = 0; i < 30; i += 1) rope.update(hand, step);
  assert.ok(restA.distanceTo(rope.points[5]) < 0.02, 'and eventually come to rest');
});

test('being struck actually throws the feather', () => {
  const rope = createRope({ points: 6, segmentLength: 1.5, gravity: 55, damping: 0.35 });
  const hand = new THREE.Vector3(0, 0, 0);
  rope.reset(hand);
  settle(rope, hand);
  const before = rope.points[5].clone();
  // Up and sideways, as the cat's paw would. Note a purely vertical shove would NOT lift a
  // hanging chain - it buckles instead, which is correct physics and why `struck()` always
  // includes a lateral component.
  rope.impulse(new THREE.Vector3(0.45, 0.8, 0.2), 2);
  let travelled = 0;
  for (let i = 0; i < 10; i += 1) {
    rope.update(hand, step);
    travelled = Math.max(travelled, before.distanceTo(rope.points[5]));
  }
  assert.ok(travelled > 0.8, `a hit should visibly throw the tip, moved only ${travelled.toFixed(2)}`);

  // And it comes back to hanging afterwards rather than staying flung out.
  settle(rope, hand, 900);
  assert.ok(before.distanceTo(rope.points[5]) < 0.15, 'then settles back under the hand');
});

test('a long stalled frame cannot fling the rope across the scene', () => {
  const rope = createRope({ points: 6, segmentLength: 1.5, gravity: 55, damping: 0.35 });
  const hand = new THREE.Vector3(0, 0, 0);
  rope.reset(hand);
  settle(rope, hand);
  // Five seconds in one step - what a compositor stall or a resumed tab looks like.
  rope.update(hand, 5);
  for (const point of rope.points) {
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
    assert.ok(hand.distanceTo(point) < 1.5 * 5 + 1, 'the rope must stay within its own length');
  }
});
