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

// --- installing a missing app -------------------------------------------------------------------
// The installer itself (download, checksum, signature, swap) is exercised for real in
// integrations/test/claude-plugin.test.mjs. Here: that a missing app STARTS it - detached, once,
// as this host - and that both opt-outs are honoured.

import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installBlockedReason, installerPath } from '../src/launch.mjs';

function fakeInstaller() {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-mcp-install-'));
  const script = join(dir, 'install-app.sh');
  writeFileSync(script, `#!/bin/bash\nprintf '%s %s\\n' "$LINGXI_HOST" "$*" >> '${dir}/calls'\n`);
  chmodSync(script, 0o755);
  return { dir, script, calls: () => (existsSync(join(dir, 'calls')) ? readFileSync(join(dir, 'calls'), 'utf8') : '') };
}
const waitFor = async (predicate, ms = 3000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (predicate()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return predicate();
};

test('the package ships the installer it would run', () => {
  assert.ok(installerPath(), 'packages/mcp-server/scripts/install-app.sh is missing - cp integrations/shared/install-app.sh');
});

test('a missing app is installed from GitHub in the background, as this host', { skip: process.platform !== 'darwin' && 'macOS only' }, async () => {
  const fake = fakeInstaller();
  await withEnv({
    LINGXI_AUTOSTART: '1', LINGXI_AUTOINSTALL: '1', LINGXI_APP_PATH: join(fake.dir, 'missing.app'),
    LINGXI_INSTALLER: fake.script, LINGXI_INSTALL_LOCK: join(fake.dir, 'install.lock'), LINGXI_HOST: 'codex',
  }, async () => {
    assert.equal(installBlockedReason(), null);
    const result = await ensureRunning(async () => false);
    assert.equal(result.ok, false);
    assert.equal(result.installing, true);
    assert.match(result.reason, /installing it from GitHub/);
    assert.ok(await waitFor(() => fake.calls().length > 0), 'the installer was never started');
    assert.equal(fake.calls().trim(), 'codex --open', 'opened afterwards, and on this host\'s page');

    // While another install holds the machine-wide lock, nothing is started a second time.
    mkdirSync(join(fake.dir, 'install.lock'));
    const again = await ensureRunning(async () => false);
    assert.match(again.reason, /being installed from GitHub right now/);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fake.calls().trim().split('\n').length, 1);
  });
});

test('LINGXI_AUTOINSTALL=0 leaves a missing app missing, and says where to get it', { skip: process.platform !== 'darwin' && 'macOS only' }, async () => {
  const fake = fakeInstaller();
  await withEnv({
    LINGXI_AUTOSTART: '1', LINGXI_AUTOINSTALL: '0', LINGXI_APP_PATH: join(fake.dir, 'missing.app'), LINGXI_INSTALLER: fake.script,
  }, async () => {
    assert.match(installBlockedReason(), /LINGXI_AUTOINSTALL/);
    const result = await ensureRunning(async () => false);
    assert.equal(result.ok, false);
    assert.ok(!result.installing);
    assert.match(result.reason, /github\.com\/dushaobindoudou\/lingxi\/releases/);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fake.calls(), '', 'nothing may be installed after an opt-out');
  });
});
