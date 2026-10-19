import assert from 'node:assert/strict';
import { test } from 'node:test';
import { expressionValues } from '../src/realistic-face.ts';

test('cat smiles keep the centre of the upper and lower lips together', () => {
  const spec = {
    expressions: Object.fromEntries(['安然', '陶醉', '开心', '喵喵'].map((name) => [name, {
      eye: 'calm', brow: 'none', mouth: 'cat', ear: 'neutral',
    }])),
    layers: {
      eye: { calm: {} }, brow: { none: {} }, ear: { neutral: {} },
      mouth: { cat: { 'MouthCornerUp.L': 1.4, 'MouthCornerUp.R': 1.4 } },
    },
    expression_extras: {
      陶醉: { 'MouthCornerUp.L': 0.5, 'MouthCornerUp.R': 0.5 },
      开心: { 'MouthCornerUp.L': 0.35, 'MouthCornerUp.R': 0.35 },
      喵喵: { JawOpen: 0.24, MouthO: 1 },
    },
  };
  for (const name of Object.keys(spec.expressions)) {
    const values = expressionValues(spec, name);
    assert.ok(values['MouthCornerUp.L'] <= 0.9, `${name}: upper lip separates from lower lip`);
    assert.equal(values['MouthCornerUp.L'], values['MouthCornerUp.R']);
  }
  assert.ok(expressionValues(spec, '陶醉')['MouthCornerUp.L'] > expressionValues(spec, '安然')['MouthCornerUp.L']);
  assert.equal(expressionValues(spec, '喵喵').JawOpen, 0.24);
  assert.equal(expressionValues(spec, '喵喵').MouthO, 1);
});
