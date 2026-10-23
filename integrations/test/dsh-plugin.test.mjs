// The DSH plugin is one pasted file: it cannot import the MCP server, so the tool list and the
// installer invocation are easy to let drift. These checks hold the 13 names to the MCP catalogue
// and run the ensure-app shell against a fake machine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { catalogue } from '../../packages/mcp-server/src/catalogue.mjs';

const execFileAsync = promisify(execFile);
const REPO = fileURLToPath(new URL('../../', import.meta.url));
const PLUGIN = join(REPO, 'integrations/hosts/dsh/lingxi-dsh-plugin.js');
const source = readFileSync(PLUGIN, 'utf8');

function loadPlugin() {
  const tools = [];
  const harness = {
    defineTool(spec) { return spec; },
    registerTool(_ctx, spec) { tools.push(spec); return function off() {}; },
  };
  const plugin = new Function('harness', source)(harness);
  return { plugin, tools, harness };
}

function bash(script, env) {
  return execFileAsync('bash', ['-c', script], {
    env: {
      HOME: env.HOME,
      PATH: env.PATH,
      LINGXI_AUTOSTART: env.LINGXI_AUTOSTART ?? '1',
      LINGXI_AUTOINSTALL: env.LINGXI_AUTOINSTALL ?? '1',
      LINGXI_APP_PATH: env.LINGXI_APP_PATH ?? '',
      // Empty means "search nowhere", so a developer machine's /Applications copy
      // does not make the missing-app cases look installed.
      LINGXI_APP_DIRS: env.LINGXI_APP_DIRS ?? '',
      LINGXI_INSTALLER: env.LINGXI_INSTALLER ?? '',
      LINGXI_FAKE_HEALTH: env.LINGXI_FAKE_HEALTH ?? '0',
    },
    timeout: 8000,
  }).then(
    (out) => ({ code: 0, stdout: out.stdout, stderr: out.stderr }),
    (err) => ({
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
    }),
  );
}

function machine() {
  const home = mkdtempSync(join(tmpdir(), 'lingxi-dsh-'));
  const bin = join(home, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'curl'), `#!/bin/bash
printf '%s\\n' "$*" >> "$HOME/curl-args"
if [ "\${LINGXI_FAKE_HEALTH:-0}" = 1 ]; then
  case "$*" in *health*) exit 0 ;; esac
fi
exit 1
`);
  writeFileSync(join(bin, 'open'), `#!/bin/bash
printf '%s\\n' "$*" >> "$HOME/open-args"
exit 0
`);
  writeFileSync(join(bin, 'mdfind'), `#!/bin/bash
exit 0
`);
  writeFileSync(join(bin, 'npx'), `#!/bin/bash
printf '%s\\n' "$*" > "$HOME/npx-args"
printf '%s\\n' "$LINGXI_HOST" > "$HOME/npx-host"
exit 0
`);
  for (const name of ['curl', 'open', 'mdfind', 'npx']) chmodSync(join(bin, name), 0o755);
  return { home, bin, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test('DSH registers the same 13 tools as the MCP catalogue, in the same order', () => {
  const { plugin } = loadPlugin();
  const names = plugin.buildTools({}).map((item) => item.name);
  assert.deepEqual(names, catalogue.map((item) => item.name));
  const express = plugin.buildTools({}).find((item) => item.name === 'lingxi_express');
  assert.match(express.description, /lingxi_react/);
});

test('a task event is posted as dsh', async () => {
  const { plugin } = loadPlugin();
  let body = null;
  const shell = {
    resolve(request) { return request; },
    async run(request) {
      if (request.stdin) body = JSON.parse(request.stdin);
      return { exitCode: 0, stdout: { text: '{"ok":true}' } };
    },
  };
  const tools = plugin.buildTools({ get() { return shell; } });
  const task = tools.find((item) => item.name === 'lingxi_task');
  const result = await task.execute({
    state: 'completed',
    taskId: 'fix-login',
    summary: '登录已修好，相关测试通过',
    agent: 'claude',
    session: 'sess-1',
    kind: 'build',
  });
  assert.equal(result.ok, true);
  assert.equal(body.agent, 'dsh');
  assert.equal(body.provider, 'dsh');
  assert.equal(body.session, 'sess-1');
  assert.equal(body.taskId, 'fix-login');
});

test('bridge already up does not open or install', async () => {
  const { plugin } = loadPlugin();
  const box = machine();
  try {
    const result = await bash(plugin.ensureAppCommand(), {
      HOME: box.home,
      PATH: `${box.bin}:/usr/bin:/bin`,
      LINGXI_FAKE_HEALTH: '1',
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(existsSync(join(box.home, 'open-args')), false);
  } finally {
    // open-args is absent when open was not called; the assertion above throws if the file exists.
    box.cleanup();
  }
});

test('autostart off does not download a missing app', async () => {
  const { plugin } = loadPlugin();
  const box = machine();
  try {
    const result = await bash(plugin.ensureAppCommand(), {
      HOME: box.home,
      PATH: `${box.bin}:/usr/bin:/bin`,
      LINGXI_AUTOSTART: '0',
    });
    assert.equal(result.code, 7);
  } finally {
    box.cleanup();
  }
});

test('autoinstall off reports a missing app instead of downloading', async () => {
  const { plugin } = loadPlugin();
  const box = machine();
  try {
    const result = await bash(plugin.ensureAppCommand(), {
      HOME: box.home,
      PATH: `${box.bin}:/usr/bin:/bin`,
      LINGXI_AUTOINSTALL: '0',
    });
    assert.equal(result.code, 8, result.stderr);
  } finally {
    box.cleanup();
  }
});

test('a missing app starts the shared installer in the background', async () => {
  const { plugin } = loadPlugin();
  const box = machine();
  const installer = join(box.home, 'install-app.sh');
  writeFileSync(installer, `#!/bin/bash
printf '%s\\n' "$*" > "$HOME/install-args"
printf '%s\\n' "$LINGXI_HOST" > "$HOME/install-host"
`);
  chmodSync(installer, 0o755);
  try {
    const result = await bash(plugin.ensureAppCommand(), {
      HOME: box.home,
      PATH: `${box.bin}:/usr/bin:/bin`,
      LINGXI_INSTALLER: installer,
    });
    assert.equal(result.code, 11, result.stderr);
    const args = await waitFor(() => readFileSync(join(box.home, 'install-args'), 'utf8'));
    assert.match(args, /--open/);
    assert.equal(readFileSync(join(box.home, 'install-host'), 'utf8').trim(), 'dsh');
  } finally {
    box.cleanup();
  }
});

test('without a local installer, npx lingxi-mcp is the download path', async () => {
  const { plugin } = loadPlugin();
  const box = machine();
  try {
    const result = await bash(plugin.ensureAppCommand(), {
      HOME: box.home,
      PATH: `${box.bin}:/usr/bin:/bin`,
    });
    assert.equal(result.code, 11, result.stderr);
    const args = await waitFor(() => readFileSync(join(box.home, 'npx-args'), 'utf8'));
    assert.match(args, /--package lingxi-mcp/);
    assert.match(args, /lingxi up/);
    assert.equal(readFileSync(join(box.home, 'npx-host'), 'utf8').trim(), 'dsh');
  } finally {
    box.cleanup();
  }
});

test('an install already holding the machine lock is not started twice', async () => {
  const { plugin } = loadPlugin();
  const box = machine();
  mkdirSync(join(box.home, '.lingxi', 'install.lock'), { recursive: true });
  try {
    const result = await bash(plugin.ensureAppCommand(), {
      HOME: box.home,
      PATH: `${box.bin}:/usr/bin:/bin`,
    });
    assert.equal(result.code, 11, result.stderr);
    assert.throws(() => readFileSync(join(box.home, 'npx-args'), 'utf8'));
  } finally {
    box.cleanup();
  }
});

// The installer runs in the background: under the full suite's parallel load it took over a second to start, and a
// one-second wait failed the release's test run now and then.
function waitFor(read, attempts = 100) {
  return new Promise((resolve, reject) => {
    const tick = (left) => {
      try {
        resolve(read());
      } catch (err) {
        if (left <= 0) reject(err);
        else setTimeout(() => tick(left - 1), 50);
      }
    };
    tick(attempts);
  });
}
