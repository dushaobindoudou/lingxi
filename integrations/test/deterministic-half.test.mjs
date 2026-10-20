// Hosts differ in whether a deterministic half exists at all: Claude/Codex/WorkBuddy get it from a
// plugin, Cursor from install.sh, 豆包 from a LaunchAgent watcher, DSH not at all. The rule is
// therefore per-host: default to saying nothing, check only when asked, mention one path once, and
// never install or edit host config. DSH must not be nudged toward something it cannot have.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(REPO, rel), 'utf8');

const SYSTEM = 'integrations/skills/lingxi/SKILL.md';
const layer = (host) => `integrations/hosts/${host}/skills/lingxi-${host}/SKILL.md`;
const DETECTING = ['claude', 'codex', 'cursor', 'doubao', 'workbuddy'];

test('the system layer states the check-first, mention-once, never-install rule', () => {
  const body = read(SYSTEM);
  assert.match(body, /确定性的一半/);
  assert.match(body, /默认不去查/);
  assert.match(body, /一场对话最多提一次/);
  assert.match(body, /不替用户安装/);
});

test('every host that can have the half documents a check that prints installed or absent', () => {
  for (const host of DETECTING) {
    const body = read(layer(host));
    assert.match(body, /installed/, `${host}: no check command`);
    assert.match(body, /absent/, `${host}: check must say what absence looks like`);
    assert.match(body, /echo absent/, `${host}: check should be runnable as written`);
  }
});

test('the checks are read-only: no install, no config writes', () => {
  for (const host of DETECTING) {
    const body = read(layer(host));
    for (const forbidden of ['launchctl bootstrap', 'sed -i', 'tee ']) {
      assert.ok(!body.includes(forbidden), `${host}: host layer must not install (found "${forbidden}")`);
    }
    // 豆包 has to name `launchctl load` in order to forbid it; anywhere else is an invitation.
    if (body.includes('launchctl load')) {
      assert.match(body, /不要自己 `launchctl load`/, `${host}: launchctl load must only appear as a warning`);
    }
  }
});

test('DSH is told plainly that the half does not exist, and is not nudged to install it', () => {
  const body = read(layer('dsh'));
  assert.match(body, /没有宿主级的会话事件/);
  assert.match(body, /不要向用户承诺/);
  assert.ok(!/echo absent/.test(body), 'DSH must not offer a check for something it cannot have');
  assert.ok(!/install\.sh/.test(body), 'DSH must not point at an installer that would not add hooks');
});

test('checks are macOS-safe: no recursive grep, no \\| alternation', () => {
  for (const host of DETECTING) {
    const body = read(layer(host));
    // Only the runnable snippets matter: prose may explain why these are forbidden.
    const code = body.split('```').filter((_, i) => i % 2 === 1).join('\n');
    // ~/.workbuddy/plugins is 458 MB on a real machine; grep -r there gets killed.
    assert.ok(!/grep\s+-[a-z]*r[a-z]*\s/.test(code),
      `${host}: recursive grep over plugin dirs will be killed - read fixed files instead`);
    // macOS ships BSD grep, where \| is a literal in BRE, not alternation.
    assert.ok(!code.includes('\\|'),
      `${host}: BSD grep does not support \\| - use two -e patterns`);
  }
});

test('host layers stay short enough to be a supplement, not a second system layer', () => {
  for (const host of [...DETECTING, 'dsh']) {
    const lines = read(layer(host)).split('\n').length;
    assert.ok(lines < 120, `${host} host layer grew to ${lines} lines`);
  }
});
