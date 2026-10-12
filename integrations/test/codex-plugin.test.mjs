import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Every host installer's step 0 starts the real app, or installs it from GitHub. A test run must
// never do either - the installers report and carry on when both are switched off.
process.env.LINGXI_AUTOSTART = '0';
process.env.LINGXI_AUTOINSTALL = '0';

test('Codex installer preserves a wrapped notify and unrelated MCP servers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-codex-'));
  try {
    const config = join(dir, 'config.toml');
    writeFileSync(config, `notify = ["/bin/echo", "turn-ended", "--previous-notify", "[\\"${dir}/notify-fanout.sh\\"]"]
# >>> lingxi plugin >>>
[mcp_servers.lingxi]
command = "node"
[mcp_servers.lingxi.env]
LINGXI_AGENT = "codex"
[mcp_servers.other]
command = "other"
# <<< lingxi plugin <<<
`);
    writeFileSync(join(dir, 'notify-fanout.sh'), '#!/bin/sh\nnode lingxi-emit.mjs --host codex "$1" &\nwait\n');
    const installer = new URL('../hosts/codex/install.sh', import.meta.url).pathname;
    execFileSync('bash', [installer], { env: { ...process.env, LINGXI_CODEX_DIR: dir } });
    const updated = readFileSync(config, 'utf8');
    assert.match(updated, /notify = \["\/bin\/echo", "turn-ended"/);
    assert.match(updated, /# <<< lingxi plugin <<<\s+\[mcp_servers.other\]/);
    assert.match(updated, /\[mcp_servers.other\]\s+command = "other"/);
    execFileSync('bash', [installer], { env: { ...process.env, LINGXI_CODEX_DIR: dir } });
    assert.equal(readFileSync(config, 'utf8'), updated);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a fanout that also calls the notify wrapper is rewritten so the wrapper runs once per turn', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-codex-'));
  try {
    const config = join(dir, 'config.toml');
    // Written before the wrapper arrived, when it WAS the previous notifier. Now the wrapper runs
    // itself and then hands the payload to this fanout, which ran it a second time.
    writeFileSync(config, `notify = ["/bin/echo", "turn-ended", "--previous-notify", "[\\"${dir}/notify-fanout.sh\\"]"]\n`);
    writeFileSync(join(dir, 'notify-fanout.sh'),
      '#!/bin/sh\n"/bin/echo" "turn-ended" "$1" &\nnode lingxi-emit.mjs --host codex "$1" &\nwait\n');
    const installer = new URL('../hosts/codex/install.sh', import.meta.url).pathname;
    execFileSync('bash', [installer], { env: { ...process.env, LINGXI_CODEX_DIR: dir } });
    const fanout = readFileSync(join(dir, 'notify-fanout.sh'), 'utf8');
    assert.ok(!fanout.includes('/bin/echo'), `wrapper still called from the fanout:\n${fanout}`);
    assert.match(fanout, /lingxi-emit\.mjs/);
    assert.match(readFileSync(config, 'utf8'), /notify = \["\/bin\/echo", "turn-ended"/, 'the wrapper itself stays');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Codex gets both skill layers: the shared lingxi skill and its own lingxi-codex', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-codex-'));
  try {
    writeFileSync(join(dir, 'config.toml'), 'model = "x"\n');
    // A copy the app's one-click install wrote, untouched since: the installer may replace it.
    mkdirSync(join(dir, 'skills/lingxi'), { recursive: true });
    writeFileSync(join(dir, 'skills/lingxi/SKILL.md'), 'old');
    writeFileSync(join(dir, 'skills/lingxi/.lingxi-installed'), 'old');
    const installer = new URL('../hosts/codex/install.sh', import.meta.url).pathname;
    execFileSync('bash', [installer], { env: { ...process.env, LINGXI_CODEX_DIR: dir } });
    const repo = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
    assert.equal(readlinkSync(join(dir, 'skills/lingxi')), join(repo, 'integrations/skills/lingxi'));
    assert.equal(readlinkSync(join(dir, 'skills/lingxi-authoring')), join(repo, 'integrations/skills/lingxi-authoring'));
    assert.equal(readlinkSync(join(dir, 'skills/lingxi-codex')), join(repo, 'integrations/hosts/codex/skills/lingxi-codex'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('notify fanout resolves Node at runtime and upgrades old fanouts without dropping the previous notifier', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-codex-node-'));
  try {
    writeFileSync(join(dir, 'config.toml'), `notify = ["${dir}/notify-fanout.sh"]\n`);
    writeFileSync(join(dir, 'notify-fanout.sh'), '#!/bin/sh\n/bin/true "$PAYLOAD" & # 你原来的通知器\nnode /old/lingxi-emit.mjs --host codex "$PAYLOAD" &\nwait\n');
    const installer = new URL('../hosts/codex/install.sh', import.meta.url).pathname;
    execFileSync('bash', [installer], { env: { ...process.env, HOME: dir, LINGXI_CODEX_DIR: dir } });
    const fake = join(dir, 'managed-node');
    const record = join(dir, 'called');
    writeFileSync(fake, `#!/bin/sh\nprintf '%s\\n' "$LINGXI_AGENT" "$@" > '${record}'\ncat >> '${record}'\n`);
    chmodSync(fake, 0o755);
    execFileSync('sh', [join(dir, 'notify-fanout.sh'), '{"type":"agent-turn-complete"}'], {
      env: { HOME: dir, PATH: '/usr/bin:/bin', LINGXI_NODE: fake },
    });
    const called = readFileSync(record, 'utf8');
    assert.match(called, /^codex\n/);
    assert.match(called, /--host\ncodex\n/);
    assert.match(called, /agent-turn-complete/);
    assert.ok(readFileSync(join(dir, 'notify-fanout.sh'), 'utf8').includes('/bin/true'), 'previous notifier lost on upgrade');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
