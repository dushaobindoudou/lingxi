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
  mkdtempSync, mkdirSync, readFileSync, existsSync, symlinkSync, readlinkSync, statSync, readdirSync,
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
    ['scripts/lingxi-cli', 'exec'],
    ['skills/lingxi/SKILL.md', 'file'],
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
    ['LINGXI_AGENT_COLOR', '#2F54EB'],
  ]) {
    assert.match(wrapper, new RegExp(`${varName}="\\$\\{LINGXI_DOUBAO_AGENT[-A-Z_]*:-${value.replace('#', '\\#')}}"`),
      `${varName} default must be ${value} and overridable by LINGXI_DOUBAO_AGENT*`);
  }
  // The app's agent registry is in-memory and auto-registration carries no logo, so the wrapper
  // must re-register the logo whenever the bridge is up (health never starts the app).
  assert.match(wrapper, /CLI="\$\{PLUGIN_DIR\}\/scripts\/lingxi-cli"/, 'wrapper must point CLI at the bundled client');
  assert.match(wrapper, /if "\$\{CLI\}" health/, 'wrapper must check health before registering');
  assert.match(wrapper, /register "\$\{LINGXI_AGENT\}" --logo "\$\{PLUGIN_DIR\}\/doubao-logo"/,
    'wrapper must re-register the logo');
  assert.match(wrapper, /exec "\$\{CLI\}" "\$@"/, 'wrapper must exec with original args');
});

test('the doubao skill keeps every substantive section of the shared skill', () => {
  const shared = read(SHARED_SKILL);
  const doubao = read(join(PLUGIN, 'skills/lingxi/SKILL.md'));
  for (const marker of [
    '## 一、最重要的一件事：报告**心情**，不只是状态',
    '## 二、任务进度：大部分时候应该是安静的',
    '## 三、提醒：猫记得，而不是你记得',
    '## 四、让猫更懂他',
    '## 五、预算：安静是默认值',
    '## 六、其他场景（不默认集成，按需自己接）',
    '## 七、自证生效',
    '## 别做的事',
    '| **`mood`** | **focused proud tender sad frustrated anxious weary playful curious** | **只有你能判断** |',
    'LINGXI_PRIORITY=alert lingxi express 惊吓',
    'lingxi remind 1440 "明天记得回复那封邮件" --mood anxious',
  ]) {
    assert.ok(doubao.includes(marker), `doubao skill lost shared section: ${marker}`);
  }
  // It is not just the shared file: the identity and the hook difference are both adapted.
  assert.match(doubao, /灵犀 · 豆包专用/, 'title must say Doubao');
  assert.match(doubao, /固定以豆包的身份说话/, 'must pin the doubao identity');
  assert.match(doubao, /豆包没有会话生命周期 hook/, 'must not promise hooks Doubao does not have');
  // And it must not have silently grown into a different file: same line budget as the shared one.
  const lines = (s) => s.split('\n').length;
  assert.ok(Math.abs(lines(doubao) - lines(shared)) < 10, 'doubao skill drifted in size');
});

test('the installer parses, has the expected options, and tolerates a moved Doubao skills root', () => {
  const script = read(join(PLUGIN, 'install.sh'));
  const run = spawnSync('bash', ['-n', join(PLUGIN, 'install.sh')], { encoding: 'utf8' });
  assert.equal(run.status, 0, `install.sh: ${run.stderr}`);
  for (const flag of ['--dry-run', '--uninstall']) assert.ok(script.includes(flag), `${flag} missing`);
  assert.match(script, /LINGXI_DOUBAO_SKILLS/, 'must allow overriding the Doubao skills root');
  assert.match(script, /AGENT_ID="doubao"/, 'installer must register the doubao identity');
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
  const env = { HOME: home, LINGXI_DOUBAO_SKILLS: skillsRoot };

  // install
  const first = runInstaller(env);
  assert.equal(first.status, 0, `install failed:\n${first.stdout}\n${first.stderr}`);
  assert.equal(readlinkSync(join(cliDir, 'lingxi')), join(PLUGIN, 'bin/lingxi'), 'PATH lingxi must be our wrapper');
  assert.equal(readlinkSync(join(skillsRoot, 'lingxi')), join(PLUGIN, 'skills/lingxi'), 'lingxi skill not symlinked');
  assert.equal(
    readlinkSync(join(skillsRoot, 'lingxi-authoring')),
    join(REPO, 'integrations/skills/lingxi-authoring'),
    'lingxi-authoring not symlinked',
  );
  assert.ok(first.stdout.includes('已备份'), 'pre-lingxi CLI must be backed up');
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
  assert.ok(!existsSync(join(skillsRoot, 'lingxi-authoring')), 'lingxi-authoring must be removed');
  assert.equal(readlinkSync(join(cliDir, 'lingxi')), '/fake/pre-lingxi-cli', 'original CLI must be restored');
});
