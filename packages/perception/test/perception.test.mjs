import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityRecorder } from '../src/index.mjs';

test('idleMs is null until the first event, then counts up from the last one', () => {
  const rec = createActivityRecorder();
  // Null, not Infinity: the summary crosses the Tauri IPC as JSON, which has no Infinity -
  // consumers received null while the contract claimed a number. Null is the contract now.
  assert.equal(rec.summary(1000).idleMs, null);
  rec.record({ type: 'click_on_pet', at: 1000, position: { x: 0, y: 0 } });
  assert.equal(rec.summary(1500).idleMs, 500);
});

test('cursor near/left pairs accumulate dwell time, including a still-open interval', () => {
  const rec = createActivityRecorder();
  rec.record({ type: 'cursor_entered_pet', at: 0 });
  rec.record({ type: 'cursor_left_pet', at: 300 });
  rec.record({ type: 'cursor_entered_pet', at: 1000 });
  // still "inside" at query time 1400 -> the open interval counts too
  assert.equal(rec.summary(1400).cursorNearPetMs, 300 + 400);
});

test('clicks and completed drags both count toward lifetime interactions and engagement', () => {
  const rec = createActivityRecorder();
  rec.record({ type: 'click_on_pet', at: 0, position: { x: 0, y: 0 } });
  rec.record({ type: 'drag_start', at: 10, position: { x: 0, y: 0 } });
  rec.record({ type: 'drag_end', at: 210, position: { x: 5, y: 5 }, durationMs: 200 });
  const summary = rec.summary(300);
  assert.equal(summary.clicksOnPet, 1);
  assert.equal(summary.dragCount, 1);
  assert.equal(summary.totalDragMs, 200);
  const growth = rec.growth();
  assert.equal(growth.lifetimeInteractionCount, 2);
  assert.ok(growth.engagementScore > 0);
});

test('engagement score is capped at 100 no matter how many interactions pile up', () => {
  const rec = createActivityRecorder();
  for (let i = 0; i < 200; i += 1) {
    rec.record({ type: 'click_on_pet', at: i, position: { x: 0, y: 0 } });
  }
  assert.equal(rec.growth().engagementScore, 100);
});
