import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPettingSession } from '../src/anim/petting.ts';

// Run the actual registered DOM handlers: a pure session test cannot catch a press
// dropped by the host before it ever reaches that session.
const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
function fixture(cursor, captured, coarseHit = true) {
  const session = createPettingSession(); session.setEnabled(true);
  const handlers = {};
  const domHandlers = source.slice(source.indexOf("  window.addEventListener('mousedown',"),
    source.indexOf('  // Double-click is'));
  const setup = new Function('window', 'petting', 'renderer', 'engineRecorder', 'cursor', 'isCaptured', 'performance', 'host', 'markInteresting', `
    let lastPettingPointerAt = -Infinity;
    let isMouseDown = false, isChargingToy = false;
    const engine = { toy: null };
    ${domHandlers}
    return { point: () => cursor };
  `);
  const state = setup({ addEventListener: (name, fn) => { handlers[name] = fn; } }, session,
    { hitTest: p => coarseHit && p?.x >= 90 && p?.x <= 150,
      pettingHitTest: p => p?.x >= 90 && p?.x <= 150 ? 'head' : null },
    { record() {} }, cursor, captured, { now: () => 500 },
    { setClickThrough: async () => {} }, () => {});
  return { session, handlers, state };
}

test('a delivered press uses its DOM position even when the native cursor relay is stale or absent', () => {
  for (const previous of [null, { x: 40, y: 100 }]) {
    const f = fixture(previous, false);
    f.handlers.mousedown({ button: 0, clientX: 100, clientY: 100 });
    assert.equal(f.session.pressed, true);
    assert.deepEqual(f.state.point(), { x: 100, y: 100 });
  }
});

test('a touchable anatomical surface does not have to hit the narrower bone capsule', () => {
  const f = fixture({ x: 100, y: 100 }, true, false);
  f.handlers.mousedown({ button: 0, clientX: 100, clientY: 100 });
  assert.equal(f.session.pressed, true);
});

test('held petting samples native DOM movement and earns the head reaction', () => {
  const f = fixture({ x: 100, y: 100 }, true);
  f.handlers.mousedown({ button: 0, clientX: 100, clientY: 100 });
  f.session.tick(f.state.point(), 'head', 500);
  let reaction;
  for (let i = 1; i <= 3; i++) {
    f.handlers.mousemove({ clientX: 100 + i * 10, clientY: 100 });
    reaction = f.session.tick(f.state.point(), 'head', 500 + i * 40);
  }
  assert.equal(reaction?.clip, 'pet-head');
});

test('a right press or an empty-space press never begins petting', () => {
  const f = fixture({ x: 100, y: 100 }, true);
  f.handlers.mousedown({ button: 2, clientX: 100, clientY: 100 });
  assert.equal(f.session.pressed, false);
  f.handlers.mousedown({ button: 0, clientX: 40, clientY: 100 });
  assert.equal(f.session.pressed, false);
});
