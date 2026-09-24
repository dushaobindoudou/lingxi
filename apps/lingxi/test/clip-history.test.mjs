// A custom actions.json must not freeze the built-in clips it copied.
//
// The machine this was found on had an assets/actions.json that was the 2026-09-19 library, all
// 49 built-ins unchanged, plus four WorkBuddy clips. It REPLACES the bundled library, so every
// fix made to a built-in since - the jump retune included - had never played there once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { clipFingerprint, followBundled, SUPERSEDED } from '../src/anim/clip-history.ts';
import { loadCustomAssets } from '../src/rig/custom-assets.ts';
import { POSES } from '../src/anim/poses.ts';
import { historicalLibraries, supersededFrom } from '../../../scripts/superseded-clips.mjs';

const read = (path) => JSON.parse(readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'));
const bundled = read('../src/data/actions.json').actions;
const skeleton = read('../src/data/skeleton.json');
const byId = Object.fromEntries(bundled.map((clip) => [clip.id, clip]));

/** An "older bundled version" of a clip, and a history that says the app once shipped it. */
function staleCopyOf(id) {
  const old = structuredClone(byId[id]);
  old.duration += 0.5;
  old.tracks.at(-1).keys.at(-1)[0] = old.duration;
  return { old, history: { [id]: [clipFingerprint(old)] } };
}

test('an unedited copy of an old bundled clip follows the current one', () => {
  const { old, history } = staleCopyOf('hop-catch');
  const { actions, upgraded } = followBundled([old], bundled, history);
  assert.deepEqual(upgraded, ['hop-catch']);
  assert.deepEqual(actions[0], byId['hop-catch']);
});

test('an edited built-in is the user\'s, and is left exactly as written', () => {
  const { old, history } = staleCopyOf('hop-catch');
  old.priority = 12; // one number changed
  const { actions, upgraded } = followBundled([old], bundled, history);
  assert.deepEqual(upgraded, []);
  assert.equal(actions[0], old);
});

test('custom clips, current built-ins and omissions all come through untouched', () => {
  const { old, history } = staleCopyOf('pounce');
  const mine = { ...structuredClone(byId['sit']), id: 'wb-deploy', name: '部署' };
  const custom = [mine, byId['sit'], old];
  const { actions, upgraded } = followBundled(custom, bundled, history);
  assert.deepEqual(actions.map((c) => c.id), ['wb-deploy', 'sit', 'pounce'], 'order kept, nothing added back');
  assert.equal(actions[0], mine);
  assert.deepEqual(upgraded, ['pounce']);
});

test('a fingerprint is about content, not key order', () => {
  const clip = byId['hop-catch'];
  const shuffled = Object.fromEntries(Object.entries(clip).reverse());
  assert.equal(clipFingerprint(shuffled), clipFingerprint(clip));
  assert.notEqual(clipFingerprint({ ...clip, priority: clip.priority + 1 }), clipFingerprint(clip));
});

const libraries = historicalLibraries();

test('superseded-clips.json covers every version git has ever held', { skip: !libraries && 'no git history' }, () => {
  // Retune a built-in without regenerating the list and anyone with a custom library keeps the
  // old version forever - the exact failure this module exists to prevent.
  const expected = supersededFrom(bundled, libraries);
  for (const [id, prints] of Object.entries(expected)) {
    for (const print of prints) {
      assert.ok(
        SUPERSEDED[id]?.includes(print),
        `${id} changed and its old fingerprint ${print} is not listed - run: ` +
          'node --experimental-strip-types scripts/superseded-clips.mjs',
      );
    }
  }
});

const september19 = libraries?.find(({ commit }) => commit.startsWith('d61850d'));

test('the real case: a 09-19 library plus WorkBuddy clips now plays today\'s jumps', { skip: !september19 && 'd61850d is not in this clone (shallow?)' }, () => {
  const custom = {
    schemaVersion: 2,
    actions: [...september19.actions, { ...structuredClone(byId['sit']), id: 'wb-deploy', name: '部署' }],
  };
  const loaded = loadCustomAssets(
    { available: true, actions: custom },
    { nodeIds: skeleton.nodes.map((n) => n.id), poseNames: Object.keys(POSES), rigId: skeleton.id },
  );
  assert.deepEqual(loaded.errors, []);
  const now = Object.fromEntries(loaded.actions.map((c) => [c.id, c]));
  for (const id of ['hop-catch', 'pounce', 'claw-screen', 'rear-up', 'kiss-nuzzle']) {
    assert.deepEqual(now[id], byId[id], `${id} should play as bundled today`);
    assert.ok(loaded.upgradedActions.includes(id), `${id} should be reported as followed`);
  }
  assert.ok(now['wb-deploy'], 'the custom clip must survive');
});
