import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeckBlend, neckShellScale, neckStrandScale } from '../src/realistic-neck.ts';

test('neck blend follows a nearby shoulder and fades before the free cheek', () => {
  const shoulder = new Float32Array([
    0.12, 0.42, 0.20, 0.13, 0.43, 0.21,
    -0.12, 0.42, 0.20, -0.13, 0.43, 0.21,
  ]);
  const blend = createNeckBlend(shoulder);
  const junction = blend(0.12, 0.42, 0.20);
  assert.ok(junction > 0.7);
  assert.ok(Math.abs(blend(-0.12, 0.42, 0.20) - junction) < 1e-6);
  assert.ok(blend(0.12, 0.47, 0.20) < junction);
  assert.ok(blend(0.12, 0.42, 0.27) < junction);
  assert.equal(blend(0.12, 0.42, 0.36), 0); // muzzle
  assert.equal(blend(0.12, 0.55, 0.20), 0); // crown
  assert.equal(blend(0.02, 0.42, 0.20), 0); // chin centre
  assert.ok(blend(0.21, 0.42, 0.20) < 0.05); // away from the shoulder surface
});

test('neck scales retain an opaque undercoat and shorter guard tips', () => {
  assert.equal(neckShellScale(0), 1);
  assert.equal(neckStrandScale(0, true), 1);
  assert.ok(neckShellScale(1) > 0);
  assert.ok(neckStrandScale(1, true) < neckStrandScale(1, false));
  assert.ok(neckStrandScale(1, true) > 0.5);
});
