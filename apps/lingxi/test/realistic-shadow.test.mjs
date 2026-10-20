import test from 'node:test';
import assert from 'node:assert/strict';
import { pawContactShadow, bodyContactShadow, CONTACT_SHADOW } from '../src/realistic-shadow.ts';

test('paw contact fades and broadens smoothly between landing and full lift', () => {
  const planted = pawContactShadow(0);
  const rising = pawContactShadow(CONTACT_SHADOW.pawFadeHeight / 2);
  const lifted = pawContactShadow(CONTACT_SHADOW.pawFadeHeight);
  assert.equal(planted.opacity, 0.96);
  assert.equal(planted.spread, 1);
  assert.ok(planted.opacity > rising.opacity && rising.opacity > lifted.opacity);
  assert.ok(planted.spread < rising.spread && rising.spread < lifted.spread);
  assert.equal(lifted.opacity, 0);
  assert.deepEqual(pawContactShadow(-0.1), planted);
  assert.deepEqual(pawContactShadow(1), lifted);
});

test('the torso shadow gains coverage as the body settles onto the floor', () => {
  const standing = bodyContactShadow(0);
  const sitting = bodyContactShadow(CONTACT_SHADOW.bodyDownRange / 2);
  const lying = bodyContactShadow(CONTACT_SHADOW.bodyDownRange);
  for (const key of ['opacity', 'length', 'width']) {
    assert.ok(standing[key] < sitting[key] && sitting[key] < lying[key], key);
  }
  assert.deepEqual(bodyContactShadow(-1), standing);
  assert.deepEqual(bodyContactShadow(1), lying);
});
