import test from 'node:test';
import assert from 'node:assert/strict';
import { createFurWind, FUR_WIND } from '../src/realistic-wind.ts';

const still = { x: 0, y: 0, z: 0 };
const size = (w) => Math.hypot(...w);

test('a still cat in still room air: a soft breeze that never stops, now and then a gust', () => {
  const air = createFurWind();
  let least = Infinity, most = 0, gusting = 0, frames = 0;
  for (let t = 0; t < 120; t += 1 / 60, frames++) {
    const s = air.update(1 / 60, still, null);
    least = Math.min(least, size(s.wind)); most = Math.max(most, size(s.wind));
    if (s.gust > 0.5) gusting++;
    assert.equal(s.stroke.amount, 0);
  }
  assert.ok(least > 0.02, `the coat is never frozen (${least})`);
  assert.ok(most <= FUR_WIND.breeze * 1.05 + FUR_WIND.gust + 0.02, `a gust stays a gust, not a gale (${most})`);
  assert.ok(gusting > 0, 'two minutes bring at least one gust');
  assert.ok(gusting / frames < 0.3, `gusts are occasional (${(gusting / frames).toFixed(2)} of the time)`);
});

test('the coat trails a walking cat, swings on past when it stops, then settles', () => {
  const air = createFurWind({ ...FUR_WIND, breeze: 0, gust: 0 });
  let s;
  for (let t = 0; t < 2; t += 1 / 60) s = air.update(1 / 60, { x: 1, y: 0, z: 0 }, null);
  assert.ok(Math.abs(s.wind[0] + FUR_WIND.drag) < 0.01, `trails behind at the drag share (${s.wind[0]})`);
  let swing = -Infinity;
  for (let t = 0; t < 0.6; t += 1 / 60) swing = Math.max(swing, air.update(1 / 60, still, null).wind[0]);
  assert.ok(swing > 0.005, `swings forward past rest after the stop (${swing})`);
  for (let t = 0; t < 1.5; t += 1 / 60) s = air.update(1 / 60, still, null);
  assert.ok(Math.abs(s.wind[0]) < 0.005, `and settles (${s.wind[0]})`);
});

test('a pointer run over the cat pushes the fur along with it, and it springs back after', () => {
  const air = createFurWind({ ...FUR_WIND, breeze: 0, gust: 0 });
  let s, x = 100;
  for (let t = 0; t < 0.4; t += 1 / 60) { x += 900 / 60; s = air.update(1 / 60, still, { x, y: 200, over: true }); }
  assert.ok(s.stroke.amount > FUR_WIND.strokeMax * 0.7, `a full stroke pushes (${s.stroke.amount})`);
  assert.ok(s.stroke.dx > 0.95 && Math.abs(s.stroke.dy) < 0.1, 'along the hand');
  assert.equal(s.stroke.x, x);
  for (let t = 0; t < 1.2; t += 1 / 60) s = air.update(1 / 60, still, { x, y: 200, over: true });
  assert.ok(Math.abs(s.stroke.amount) < 0.03, `a resting hand lets the fur back (${s.stroke.amount})`);

  const beside = createFurWind({ ...FUR_WIND, breeze: 0, gust: 0 });
  x = 100;
  for (let t = 0; t < 0.4; t += 1 / 60) { x += 900 / 60; s = beside.update(1 / 60, still, { x, y: 200, over: false }); }
  assert.equal(s.stroke.amount, 0, 'a pointer passing beside the cat touches nothing');
});
