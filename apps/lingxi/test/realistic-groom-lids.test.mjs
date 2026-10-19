import test from 'node:test';
import assert from 'node:assert/strict';
import { continueCoatOntoLids } from '../src/realistic-groom.ts';

// An eye at the origin looking down +z. The face's coat round it: red on its -x side, blue on its +x side, in a ring
// just outside the lids. Two points a strand.
function strands(roots, colour) {
  const positions = new Float32Array(roots.length * 6), colors = new Float32Array(roots.length * 6), normals = new Float32Array(roots.length * 3);
  roots.forEach(([x, y, z], s) => {
    positions.set([x, y, z, x, y, z + 0.002], s * 6);
    colors.set([...colour(x, y), ...colour(x, y)], s * 6);
    normals.set([0, 0, 1], s * 3);
  });
  return { positions, colors, normals, strands: roots.length, points: 2 };
}
const ring = [];
for (let k = 0; k < 256; k++) {
  const a = (k / 256) * Math.PI * 2;
  ring.push([0.044 * Math.cos(a), 0.044 * Math.sin(a), 0]);
}
const face = strands(ring, (x) => (x < 0 ? [1, 0, 0] : [0, 0, 1]));
const across = [];
for (let x = -0.036; x <= 0.0361; x += 0.004) for (let y = -0.036; y <= 0.0361; y += 0.004) if (Math.hypot(x, y) < 0.04) across.push([x, y, 0.01]);
const colourAt = (colors, s) => [colors[s * 6], colors[s * 6 + 1], colors[s * 6 + 2]];
const nearest = (roots, x, y) => roots.reduce((best, r, i) => (Math.hypot(r[0] - x, r[1] - y) < Math.hypot(roots[best][0] - x, roots[best][1] - y) ? i : best), 0);

test('a lid takes the face coat beside it at its edge and a mix across the middle', () => {
  const lid = { ...strands(across, () => [0.5, 0.5, 0.5]), name: 'LX_Fur_guard_LX_LidUpper.L', blink: null };
  const colors = continueCoatOntoLids(face, [lid]).get(lid.name);
  assert.ok(colors, 'coloured');
  const [lr, , lb] = colourAt(colors, nearest(across, -0.036, 0));
  const [rr, , rb] = colourAt(colors, nearest(across, 0.036, 0));
  const [mr, , mb] = colourAt(colors, nearest(across, 0, 0));
  assert.ok(lr > 3 * lb, `red beside the red side (${lr}, ${lb})`);
  assert.ok(rb > 3 * rr, `blue beside the blue side (${rr}, ${rb})`);
  assert.ok(Math.abs(mr - mb) < 0.1 && mr > 0.2, `an even mix in the middle (${mr}, ${mb})`);
});

test('a lid strand is coloured where it lies with the eye shut, not open', () => {
  // open, the strand is folded up over the eye's top; its Blink key brings it down to the red side
  const lid = { ...strands([...across, [0, 0.035, 0.01]], () => [0.5, 0.5, 0.5]), name: 'LX_Fur_guard_LX_LidUpper.L', blink: null };
  lid.blink = new Float32Array(lid.strands * 3);
  lid.blink.set([-0.035, -0.035, 0], (lid.strands - 1) * 3);
  const colors = continueCoatOntoLids(face, [lid]).get(lid.name);
  const [r, , b] = colourAt(colors, lid.strands - 1);
  assert.ok(r > 3 * b, `red (${r}, ${b})`);
});

test('a lid with no face coat round its eye keeps its own colours (no entry)', () => {
  const far = strands(ring.map(([x, y]) => [x + 1, y, 0]), () => [1, 1, 1]);
  const lid = { ...strands(across, () => [0.5, 0.5, 0.5]), name: 'LX_Fur_guard_LX_LidLower.R', blink: null };
  assert.equal(continueCoatOntoLids(far, [lid]).size, 0);
});
