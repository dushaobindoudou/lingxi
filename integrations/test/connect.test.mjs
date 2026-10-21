// `lingxi connect`: 灵犀 arrives through one host, and the other AI apps on the same Mac should be
// connected too without the user reading five READMEs. These tests run the real CLI in a throwaway
// HOME with fake `claude` / `codex` commands and a fake source tree, and check the three promises:
// the scan only reads, a no is remembered, and connecting goes through each host's own route.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const CLI = join(REPO, 'integrations/cli/lingxi');

function machine() {
  const root = mkdtempSync(join(tmpdir(), 'lingxi-connect-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const apps = join(root, 'Applications');
  const src = join(root, 'src');
  const log = join(root, 'calls');
  for (const dir of [home, bin, apps]) mkdirSync(dir, { recursive: true });
  const exe = (path, body) => { writeFileSync(path, `#!/bin/bash\n${body}\n`); chmodSync(path, 0o755); };
  // Each fake records how it was called; the host installers also write the mark a real one would.
  exe(join(bin, 'claude'), `echo "claude $*" >> '${log}'
[ "$2" = install ] && mkdir -p "$HOME/.claude/plugins" && echo '{"plugins":{"lingxi@lingxi":[]}}' > "$HOME/.claude/plugins/installed_plugins.json"; exit 0`);
  for (const host of ['cursor', 'workbuddy', 'doubao']) {
    mkdirSync(join(src, 'integrations/hosts', host), { recursive: true });
    exe(join(src, 'integrations/hosts', host, 'install.sh'), `echo "install ${host}" >> '${log}'
case ${host} in cursor) mkdir -p "$HOME/.cursor"; echo '{"hooks":"lingxi"}' > "$HOME/.cursor/hooks.json" ;; esac`);
  }
  const env = {
    PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8',
    LINGXI_APPS_DIR: apps, LINGXI_SOURCE_DIR: src,
  };
  const run = (...args) => spawnSync('bash', [CLI, 'connect', ...args], { env, encoding: 'utf8', timeout: 20000 });
  const calls = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []);
  return { home, apps, run, calls };
}

const offer = (out) => out.trim().split('\n').at(-1);

test('the scan lists every host, connects nothing, and offers only what is present and unconnected', () => {
  const box = machine();
  mkdirSync(join(box.home, '.claude'));                 // Claude Code: present, not connected
  mkdirSync(join(box.apps, 'Cursor.app'));               // Cursor: present, not connected
  mkdirSync(join(box.home, '.workbuddy'));               // WorkBuddy: present and connected
  writeFileSync(join(box.home, '.workbuddy/settings.json'), '{"hooks":{"Stop":"node lingxi-emit.mjs"}}');
  const r = box.run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /○ Claude Code {2}已安装，未接入/);
  assert.match(r.stdout, /✓ WorkBuddy {2}已接入/);
  assert.match(r.stdout, /· 豆包 {2}未安装/);
  assert.equal(offer(r.stdout), 'OFFER: yes claude cursor');
  assert.deepEqual(box.calls(), [], 'scanning must not run anything');
});

test('a declined offer is not repeated, until a new host appears', () => {
  const box = machine();
  mkdirSync(join(box.home, '.claude'));
  assert.equal(box.run('--decline').status, 0);
  assert.equal(offer(box.run().stdout), 'OFFER: no', 'no means no for 30 days');
  mkdirSync(join(box.apps, 'Doubao.app'));
  assert.equal(offer(box.run().stdout), 'OFFER: yes claude doubao', 'a host that was not there when they said no is new');
});

test('--all connects each present host through its own route, and skips the connected ones', () => {
  const box = machine();
  mkdirSync(join(box.home, '.claude'));
  mkdirSync(join(box.apps, 'Cursor.app'));
  mkdirSync(join(box.home, '.workbuddy'));
  writeFileSync(join(box.home, '.workbuddy/settings.json'), 'lingxi-emit.mjs');
  const r = box.run('--all');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(box.calls(), [
    'claude plugin marketplace add dushaobindoudou/lingxi',
    'claude plugin install lingxi@lingxi',
    'install cursor',
  ]);
  assert.match(r.stdout, /✓ Claude Code 已接入/);
  assert.match(r.stdout, /✓ Cursor 已接入/);
  assert.equal(offer(box.run().stdout), 'OFFER: no', 'once connected there is nothing left to offer');
});

test('--dry-run says what it would do and does nothing', () => {
  const box = machine();
  mkdirSync(join(box.home, '.claude'));
  const r = box.run('--all', '--dry-run');
  assert.equal(r.status, 0);
  assert.match(r.stdout, /claude plugin install lingxi@lingxi/);
  assert.deepEqual(box.calls(), []);
});

test('a host without its command line gets a step the user can follow, and a failing exit', () => {
  const box = machine();
  mkdirSync(join(box.home, '.codex'));                   // Codex present, but no codex binary on PATH
  const r = box.run('codex');
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /找不到 codex 命令/);
});
