// Starting the app is the one thing every integration could not do, so the decision of WHETHER
// to start it gets tested directly. The spawning itself does not: `open -g -b <bundle>` against
// a real Launch Services database is not something to assert against in a unit test, and a test
// that opened a window on the machine running it would be worse than no test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureRunning, launchBlockedReason, BUNDLE_ID, APP_NAME } from '../src/launch.mjs';

const withEnv = async (vars, body) => {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    return await body();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

test('an app that is already up is never started, and never claimed as started', async () => {
  const result = await ensureRunning(async () => true);
  assert.deepEqual(result, { ok: true, started: false, reason: null });
});

test('LINGXI_AUTOSTART=0 is honoured, and says so rather than failing silently', async () => {
  for (const value of ['0', 'false']) {
    await withEnv({ LINGXI_AUTOSTART: value }, async () => {
      const blocked = launchBlockedReason();
      assert.ok(blocked, `${value} should block a launch`);
      assert.match(blocked, /LINGXI_AUTOSTART/, 'the reason must name the variable that caused it');

      // And the decision is reached without ever touching the machine: a down app plus an
      // opt-out must not spawn anything.
      const result = await ensureRunning(async () => false);
      assert.equal(result.ok, false);
      assert.equal(result.started, false);
      assert.match(result.reason, /LINGXI_AUTOSTART/);
    });
  }
});

test('a blocked launch explains itself in terms of something the user can do', async () => {
  await withEnv({ LINGXI_AUTOSTART: '0' }, async () => {
    const reason = launchBlockedReason();
    // Not a status code, not a stack trace: the caller is a model relaying this to a person.
    assert.ok(reason.length > 30, 'a one-word reason is not a reason');
    assert.ok(reason.includes(APP_NAME), 'it should name the app the person would open');
  });
});

test('the bundle identifier matches the one the token path is built from', async () => {
  // These two are written in different files (launch.mjs and bridge.mjs) and a rename that
  // touched only one would leave `open -b` looking for an app that no longer answers to it,
  // with no error - Launch Services just reports "not found".
  const { default: bridgeSource } = await import('node:fs').then((fs) => ({
    default: fs.readFileSync(new URL('../src/bridge.mjs', import.meta.url), 'utf8'),
  }));
  assert.ok(
    bridgeSource.includes(BUNDLE_ID),
    `bridge.mjs should build its token path from ${BUNDLE_ID}`,
  );
});

test('a launch that never brings the bridge up gives up and says what to check', async () => {
  await withEnv({ LINGXI_AUTOSTART: '1' }, async () => {
    if (launchBlockedReason()) return; // no app installed on this machine - nothing to time out
    const result = await ensureRunning(async () => false, { timeoutMs: 600 });
    assert.equal(result.ok, false);
    assert.equal(result.started, false);
    assert.ok(result.reason, 'a timeout must produce a reason');
    // The one genuinely confusing cause gets named, because "it started but there is no bridge"
    // is what a port conflict looks like from here.
    assert.match(result.reason, /47811|could not start/);
  });
});
