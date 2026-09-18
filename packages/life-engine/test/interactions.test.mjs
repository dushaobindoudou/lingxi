// Reaction-picking is pure logic, so it gets tested directly rather than by watching a cat.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickToyReaction, pickPointerReaction, pickAffectionLine, AFFECTION_LINES, STROKE_THRESHOLD_PX }
  from '../../../apps/lingxi/src/anim/interactions.ts';

test('a wand held still just out of reach makes the cat set up rather than walk over', () => {
  for (const roll of [0.1, 0.9]) {
    const reaction = pickToyReaction({ kind: 'feather', distance: 200, toySpeed: 10, held: false }, () => roll);
    assert.ok(reaction, 'should react');
    assert.ok(['stalk-crouch', 'pounce'].includes(reaction.clip), `got ${reaction.clip}`);
  }
});

test('a wand within reach gets jumped at or reared up for, never merely tapped', () => {
  for (const roll of [0.1, 0.9]) {
    const reaction = pickToyReaction({ kind: 'feather', distance: 40, toySpeed: 30, held: false }, () => roll);
    assert.ok(reaction && ['hop-catch', 'rear-up'].includes(reaction.clip), `got ${reaction?.clip}`);
  }
});

test('a toy whipping past is chased, not posed at', () => {
  assert.equal(pickToyReaction({ kind: 'feather', distance: 40, toySpeed: 900, held: false }, () => 0.1), null);
  assert.equal(pickToyReaction({ kind: 'laser', distance: 600, toySpeed: 900, held: false }, () => 0.1), null);
});

test('a yarn ball held on the pointer is stretched for, not swatted out of your hand', () => {
  const reaction = pickToyReaction({ kind: 'yarn', distance: 40, toySpeed: 0, held: true }, () => 0.9);
  assert.equal(reaction?.clip, 'rear-up');
});

test('hovering is noticing; sustained travel over the cat is being stroked', () => {
  assert.equal(pickPointerReaction({ hovering: false, hoverMs: 9999, strokeDistance: 9999 }), null);
  // Just arrived - too soon to react at all.
  assert.equal(pickPointerReaction({ hovering: true, hoverMs: 100, strokeDistance: 0 }), null);
  // Parked on the cat: it looks up at you.
  assert.equal(pickPointerReaction({ hovering: true, hoverMs: 900, strokeDistance: 0 })?.kind, 'notice');
  // A hand moving back and forth: it settles and purrs. Travel is what distinguishes the two,
  // so a mouse parked for a long time must NOT count as stroking.
  assert.equal(pickPointerReaction({ hovering: true, hoverMs: 60000, strokeDistance: 10 })?.kind, 'notice');
  assert.equal(pickPointerReaction({ hovering: true, hoverMs: 400, strokeDistance: STROKE_THRESHOLD_PX })?.kind, 'stroke');
});

test('affection lines never repeat back to back', () => {
  let previous = null;
  for (let i = 0; i < 200; i += 1) {
    const line = pickAffectionLine(previous);
    assert.ok(AFFECTION_LINES.includes(line));
    assert.notEqual(line, previous);
    previous = line;
  }
});
