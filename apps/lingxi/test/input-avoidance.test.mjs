import test from 'node:test';
import assert from 'node:assert/strict';
import { inputProtectedRegions } from '../src/input-avoidance.ts';
import { createLifeEngine } from '../../../packages/life-engine/src/index.mjs';
const area = { x: 0, y: 50, width: 2000, height: 1400, scaleFactor: 2 };
const body = { above: 120, below: 20, halfWidth: 80 };

test('input bounds use work-area origin, Retina scale and the whole body, including above the feet', () => {
  const [r] = inputProtectedRegions({ field: { x: 800, y: 650, width: 400, height: 200 }, caret: null }, area, body);
  assert.deepEqual(r, { x: 304, y: 264, width: 392, height: 272 });
  const engine = createLifeEngine({ bounds: { width: 1000, height: 700 }, position: { x: 500, y: 510 }, protectedRegions: [r] });
  // Feet are below the field, but the cat's head still covers it.
  assert.equal(engine.tick(0, null).inputAvoidance.overlapping, true);
});
test('large editors protect the active row, ordinary chat inputs protect the entire field', () => {
  const input = { field: { x: 100, y: 100, width: 1800, height: 1300 }, caret: { x: 500, y: 700, width: 0, height: 40 } };
  const [row] = inputProtectedRegions(input, area, body);
  assert.equal(row.height, 216);
  input.field.height = 400;
  input.caret.y = 200;
  const [field] = inputProtectedRegions(input, area, body);
  assert.equal(field.height, 372);
});
test('unknown or out-of-field caret falls back to the field; other-monitor geometry is ignored', () => {
  const field = { x: 100, y: 100, width: 1800, height: 1300 };
  const fallback = inputProtectedRegions({ field, caret: null }, area, body);
  assert.deepEqual(inputProtectedRegions({ field, caret: { x: -8000, y: -8000, width: 0, height: 30 } }, area, body), fallback);
  assert.deepEqual(inputProtectedRegions({ field: { ...field, x: -3000 }, caret: null }, area, body), []);
  assert.deepEqual(inputProtectedRegions(null, area, body), []);
});
