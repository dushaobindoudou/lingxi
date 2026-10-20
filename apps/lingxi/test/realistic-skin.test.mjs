import test from 'node:test';
import assert from 'node:assert/strict';
import { rebalanceLimbWeights } from '../src/realistic-skin.ts';

// one hind leg on the cat's left: hip at x -0.12, y 0.30; knee 0.12 below it
const bones = ['Pelvis', 'Loin', 'RearUpper.L', 'RearLower.L'];
const at = { 'RearUpper.L': [-0.12, 0.30, -0.2], 'RearLower.L': [-0.12, 0.18, -0.2] };
const position = (name) => at[name];
const limbs = [{ upper: 'RearUpper.L', lower: 'RearLower.L', trunk: ['Pelvis', 'Loin'] }];
const share = (joints, weights, p, bone) => [0, 1, 2, 3].reduce((t, c) => t + (joints[p * 4 + c] === bones.indexOf(bone) ? weights[p * 4 + c] : 0), 0);

function skin(points) {
  const joints = new Uint16Array(points.length * 4), weights = new Float32Array(points.length * 4);
  points.forEach(([, , , w], p) => {
    joints.set([0, 1, 2, 3], p * 4);
    weights.set(w, p * 4);
  });
  return { flat: new Float32Array(points.flatMap(([x, y, z]) => [x, y, z])), joints, weights };
}

test('thigh skin below the hip follows the leg; the hip itself and the belly stay with the trunk', () => {
  const { flat, joints, weights } = skin([
    [-0.15, 0.21, -0.2, [0.40, 0.05, 0.45, 0.10]], // mid thigh, out at the leg
    [-0.15, 0.31, -0.2, [0.60, 0.05, 0.35, 0.00]], // at the hip joint
    [-0.03, 0.21, -0.2, [0.55, 0.05, 0.40, 0.00]], // the belly between the legs
    [-0.15, 0.21, -0.2, [0.85, 0.10, 0.05, 0.00]], // barely the leg's (the flank's fold)
  ]);
  rebalanceLimbWeights(flat, joints, weights, bones, position, limbs);
  assert.ok(share(joints, weights, 0, 'Pelvis') < 0.15, `mid thigh mostly off the pelvis (${share(joints, weights, 0, 'Pelvis')})`);
  assert.ok(share(joints, weights, 0, 'RearUpper.L') > 0.7, 'and onto the femur');
  assert.ok(Math.abs(share(joints, weights, 1, 'Pelvis') - 0.60) < 1e-6, 'the hip joint unchanged');
  assert.ok(Math.abs(share(joints, weights, 2, 'Pelvis') - 0.55) < 1e-6, 'the belly unchanged');
  assert.ok(Math.abs(share(joints, weights, 3, 'Pelvis') - 0.85) < 1e-6, 'skin that is hardly the leg\'s unchanged');
  for (let p = 0; p < 4; p++) {
    const total = [0, 1, 2, 3].reduce((t, c) => t + weights[p * 4 + c], 0);
    assert.ok(Math.abs(total - 1) < 1e-5, `weights still sum to 1 (${total})`);
  }
});

test('below the knee the moved share goes to the lower leg', () => {
  const { flat, joints, weights } = skin([[-0.15, 0.16, -0.2, [0.30, 0.00, 0.20, 0.50]]]);
  rebalanceLimbWeights(flat, joints, weights, bones, position, limbs);
  assert.ok(share(joints, weights, 0, 'RearLower.L') > 0.7, `${share(joints, weights, 0, 'RearLower.L')}`);
  assert.ok(Math.abs(share(joints, weights, 0, 'RearUpper.L') - 0.20) < 0.02, 'the thigh keeps its own share');
});
