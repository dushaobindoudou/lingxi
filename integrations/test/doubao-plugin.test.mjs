// The 灵犀 Doubao plugin, exercised for real: its installer runs against a fake HOME with the
// Doubao skill root pointed at a temp directory and PATH stripped of the real `lingxi`, so the
// run touches nothing on the user's machine.
//
// What the plugin promises, and what these tests hold it to:
//   - the Doubao skill root gets the doubao-customised `lingxi` skill and the shared
//     `lingxi-authoring` skill, as symlinks into the repo (git pull updates them)
//   - the wrapper on PATH always speaks as doubao (never the machine-level agent.json name)
//   - scripts/lingxi-cli is byte-for-byte the repo CLI, so the plugin is self-contained
//   - the skill body keeps every substantive section of the shared skill
//   - install is idempotent; uninstall restores whatever was there before
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, symlinkSync, readlinkSync, statSync, readdirSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const PLUGIN = join(REPO, 'integrations/hosts/doubao');
const SHARED_SKILL = join(REPO, 'integrations/skills/lingxi/SKILL.md');
const CLI_SOURCE = join(REPO, 'integrations/cli/lingxi');
const read = (path) => readFileSync(path, 'utf8');
const onMac = platform() === 'darwin';

// --- structure --------------------------------------------------------------------------------

test('the doubao plugin ships every piece it promises', () => {
  for (const [rel, kind] of [
    ['README.md', 'file'],
    ['install.sh', 'exec'],
    ['bin/lingxi', 'exec'],
    ['bin/lingxi-doubao-watch', 'exec'],
    ['scripts/lingxi-cli', 'exec'],
    ['skills/lingxi/SKILL.md', 'file'],
    ['skills/lingxi-doubao/SKILL.md', 'file'],
    ['doubao-logo', 'file'],
  ]) {
    const p = join(PLUGIN, rel);
    assert.ok(existsSync(p), `${rel} missing`);
    if (kind === 'exec') assert.ok(statSync(p).mode & 0o111, `${rel} is not executable`);
  }
  assert.ok(read(join(PLUGIN, 'doubao-logo')).startsWith('data:image/png;base64,'),
    'logo must be a data: PNG URI of the official icon');
});

test('scripts/lingxi-cli is byte-for-byte the repo CLI (self-contained plugin)', () => {
  assert.equal(
    readFileSync(join(PLUGIN, 'scripts/lingxi-cli')).equals(readFileSync(CLI_SOURCE)),
    true,
    'lingxi-cli drifted from integrations/cli/lingxi',
  );
});

test('the wrapper always speaks as doubao and execs the bundled client', () => {
  const wrapper = read(join(PLUGIN, 'bin/lingxi'));
  for (const [varName, value] of [
    ['LINGXI_AGENT', 'doubao'],
    ['LINGXI_AGENT_NAME', '豆包'],
    ['LINGXI_AGENT_BADGE', '豆'],
    ['LINGXI_AGENT_COLOR', '#E6EEFF'],
  ]) {
    assert.match(wrapper, new RegExp(`${varName}="\\$\\{LINGXI_DOUBAO_AGENT[-A-Z_]*:-${value.replace('#', '\\#')}}"`),
      `${varName} default must be ${value} and overridable by LINGXI_DOUBAO_AGENT*`);
  }
  // The app's agent registry is in-memory and auto-registration carries no logo, so the wrapper
  // must re-register the logo whenever the bridge is up (health never starts the app).
  assert.match(wrapper, /CLI="\$\{PLUGIN_DIR\}\/scripts\/lingxi-cli"/, 'wrapper must point CLI at the bundled client');
  assert.match(wrapper, /curl -s -m 1 --noproxy '\*' "http:\/\/127\.0\.0\.1:\$\{LINGXI_PORT:-47811\}\/health"/,
    'wrapper must check health (without starting the app, and never through a proxy) before registering');
  assert.match(wrapper, /registered-for/, 'the logo is registered once per app instance, not on every call');
  assert.match(wrapper, /register "\$\{LINGXI_AGENT\}" --logo "\$\{PLUGIN_DIR\}\/doubao-logo"/,
    'wrapper must re-register the logo');
  assert.match(wrapper, /exec "\$\{CLI\}" "\$@"/, 'wrapper must exec with original args');
});

test('the doubao skills are the shared system layer plus a doubao host layer', () => {
  // The system layer ships inside the plugin (the folder is uploaded to 豆包 as is), so it is a
  // copy - held to the shared source byte for byte, never a fork.
  assert.equal(read(join(PLUGIN, 'skills/lingxi/SKILL.md')), read(SHARED_SKILL),
    'run: cp integrations/skills/lingxi/SKILL.md integrations/hosts/doubao/skills/lingxi/SKILL.md');
  const host = read(join(PLUGIN, 'skills/lingxi-doubao/SKILL.md'));
  assert.match(host, /^---\nname: lingxi-doubao\n/, 'host layer must be named lingxi-doubao');
  assert.match(host, /固定以豆包的身份说话/, 'must pin the doubao identity');
  assert.match(host, /豆包没有 hook/, 'must not promise hooks Doubao does not have');
  const script = read(join(PLUGIN, 'install.sh'));
  assert.match(script, /register "\$\{AGENT_ID\}"/, 'installer must register the identity with the CLI');
});

// --- behaviour in a fake HOME -----------------------------------------------------------------

const runInstaller = (env, args = []) => spawnSync('bash', [join(PLUGIN, 'install.sh'), ...args], {
  encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', ...env },
});

test('install → idempotent re-install → uninstall, all inside a fake HOME', { skip: !onMac }, () => {
  const home = mkdtempSync(join(tmpdir(), 'lingxi-doubao-test-'));
  const skillsRoot = join(home, 'doubao-skills');
  const cliDir = join(home, '.local', 'bin');
  mkdirSync(skillsRoot, { recursive: true });
  mkdirSync(cliDir, { recursive: true });

  // a "pre-lingxi" CLI the user had - uninstall must restore it
  symlinkSync('/fake/pre-lingxi-cli', join(cliDir, 'lingxi'));
  // A fake launchctl: the installer must never load a real LaunchAgent from a test.
  const launchctl = join(home, 'launchctl');
  writeFileSync(launchctl, `#!/bin/sh\necho "$*" >> "${join(home, 'launchctl.log')}"\n`, { mode: 0o755 });
  const env = { HOME: home, LINGXI_DOUBAO_SKILLS: skillsRoot, LINGXI_LAUNCHCTL: launchctl };
  const plist = join(home, 'Library/LaunchAgents/com.dushaobin.lingxi.doubao-watch.plist');

  // install
  const first = runInstaller(env);
  assert.equal(first.status, 0, `install failed:\n${first.stdout}\n${first.stderr}`);
  assert.equal(readlinkSync(join(cliDir, 'lingxi')), join(PLUGIN, 'bin/lingxi'), 'PATH lingxi must be our wrapper');
  assert.equal(readlinkSync(join(skillsRoot, 'lingxi')), join(PLUGIN, 'skills/lingxi'), 'lingxi skill not symlinked');
  assert.equal(readlinkSync(join(skillsRoot, 'lingxi-doubao')), join(PLUGIN, 'skills/lingxi-doubao'), 'host layer not symlinked');
  assert.equal(
    readlinkSync(join(skillsRoot, 'lingxi-authoring')),
    join(REPO, 'integrations/skills/lingxi-authoring'),
    'lingxi-authoring not symlinked',
  );
  assert.ok(first.stdout.includes('已备份'), 'pre-lingxi CLI must be backed up');
  // The turn watcher stands in for the hooks 豆包 does not have.
  assert.ok(existsSync(plist), 'the watcher LaunchAgent was not installed');
  assert.match(read(plist), /bin\/lingxi-doubao-watch<\/string>/);
  assert.match(read(join(home, 'launchctl.log')), /^bootstrap gui\/\d+ /m);
  const backups = readdirSync(cliDir).filter((f) => f.startsWith('lingxi.bak-lingxi-doubao-'));
  assert.equal(backups.length, 1, `expected exactly one backup, got ${backups.length}`);

  // idempotent: no new backup, wrapper untouched, exit 0
  const second = runInstaller(env);
  assert.equal(second.status, 0, `re-install failed:\n${second.stdout}\n${second.stderr}`);
  assert.ok(!second.stdout.includes('已备份'), 'second install must not re-backup');
  assert.equal(readlinkSync(join(cliDir, 'lingxi')), join(PLUGIN, 'bin/lingxi'), 'wrapper must survive re-install');

  // uninstall restores the original CLI and removes the skills
  const undo = runInstaller(env, ['--uninstall']);
  assert.equal(undo.status, 0, `uninstall failed:\n${undo.stdout}\n${undo.stderr}`);
  assert.ok(!existsSync(join(skillsRoot, 'lingxi')), 'lingxi skill must be removed');
  assert.ok(!existsSync(join(skillsRoot, 'lingxi-doubao')), 'lingxi-doubao must be removed');
  assert.ok(!existsSync(plist), 'the watcher LaunchAgent must be removed');
  assert.ok(!existsSync(join(skillsRoot, 'lingxi-authoring')), 'lingxi-authoring must be removed');
  assert.equal(readlinkSync(join(cliDir, 'lingxi')), '/fake/pre-lingxi-cli', 'original CLI must be restored');
});

test('the wrapper claims Doubao only when no other host has: ~/.local/bin is on every shell', () => {
  // A copy of the wrapper beside a fake client that just says who it would speak as.
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-doubao-wrapper-'));
  mkdirSync(join(dir, 'bin'));
  mkdirSync(join(dir, 'scripts'));
  writeFileSync(join(dir, 'bin/lingxi'), read(join(PLUGIN, 'bin/lingxi')), { mode: 0o755 });
  writeFileSync(join(dir, 'scripts/lingxi-cli'),
    '#!/bin/sh\n[ "$1" = health ] && exit 1\nprintf "%s" "${LINGXI_AGENT:-<client decides>}"\n', { mode: 0o755 });
  const speaksAs = (env) => spawnSync('bash', [join(dir, 'bin/lingxi'), 'task'], {
    encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: dir, LINGXI_PORT: '9', ...env },
  }).stdout;
  try {
    assert.equal(speaksAs({}), 'doubao', 'inside Doubao it speaks as Doubao');
    assert.equal(speaksAs({ LINGXI_AGENT: 'codex' }), 'codex', 'an explicit identity is kept');
    assert.equal(speaksAs({ CLAUDECODE: '1' }), '<client decides>', 'Claude Code shells pass through');
    assert.equal(speaksAs({ CODEX_THREAD_ID: 't' }), '<client decides>', 'Codex shells pass through');
    assert.equal(speaksAs({ LINGXI_DOUBAO_AGENT: 'doubao-2', LINGXI_AGENT: 'codex' }), 'doubao-2');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
