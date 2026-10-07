// The 灵犀 Claude Code plugin, exercised for real: its scripts run under bash against a fake
// machine. `curl`, `open` and (for SessionStart) the installer are replaced on PATH by scripts
// that record what they were asked, and the "app" is up or down as each test decides.
//
// What the plugin promises, and what these tests hold it to:
//   - a session start is never slowed down: installs and launches run detached
//   - not installed -> installed in the background (unless turned off); installed -> reused
//   - the app's data directory survives install, update and reinstall untouched
//   - with the app's own "一键接入" hooks present, the cat hears each event once, not twice
//   - it speaks only when there is something to say, and says a lasting problem once a day
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync, cpSync, statSync,
} from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const PLUGIN = join(REPO, 'integrations/hosts/claude');
const read = (path) => readFileSync(path, 'utf8');
const json = (path) => JSON.parse(read(path));
const onMac = platform() === 'darwin';
const BUNDLE_ID = 'com.dushaobin.lingxi-desktop';

// --- structure --------------------------------------------------------------------------------

test('the manifest, the marketplace and every hook point at things that exist', () => {
  const manifest = json(join(PLUGIN, '.claude-plugin/plugin.json'));
  assert.equal(manifest.name, 'lingxi', 'commands are /lingxi:… only while the plugin is named lingxi');
  for (const key of ['auto_install', 'auto_open', 'reactions']) {
    assert.ok(manifest.userConfig?.[key]?.title, `userConfig.${key} needs a title - it is what /plugin shows`);
  }
  assert.deepEqual(manifest.userConfig.reactions.options, ['all', 'important', 'off']);

  const market = json(join(REPO, '.claude-plugin/marketplace.json'));
  const entry = market.plugins.find((p) => p.name === 'lingxi');
  assert.ok(entry, 'marketplace must list the plugin');
  assert.ok(existsSync(join(REPO, entry.source, '.claude-plugin/plugin.json')), `${entry.source} is not the plugin`);

  const hooks = json(join(PLUGIN, 'hooks/hooks.json')).hooks;
  for (const event of ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'StopFailure']) {
    assert.ok(hooks[event], `${event} is not subscribed`);
    for (const group of hooks[event]) {
      for (const hook of group.hooks) {
        const script = hook.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/)?.[1];
        assert.ok(script, `${event}: command does not run a plugin script: ${hook.command}`);
        const path = join(PLUGIN, script);
        assert.ok(existsSync(path), `${event}: ${script} does not exist`);
        assert.ok(statSync(path).mode & 0o111, `${script} is not executable`);
      }
    }
  }
  // Only SessionStart may hold the session, and only briefly: every other hook runs async.
  for (const [event, groups] of Object.entries(hooks)) {
    if (event === 'SessionStart') continue;
    for (const group of groups) for (const hook of group.hooks) assert.equal(hook.async, true, `${event} must be async`);
  }
});

test('every script parses, and every command says what it is for', () => {
  const scripts = [...readdirSync(join(PLUGIN, 'scripts')).map((f) => join(PLUGIN, 'scripts', f)),
    ...readdirSync(join(PLUGIN, 'bin')).map((f) => join(PLUGIN, 'bin', f))];
  for (const script of scripts) {
    const run = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
    assert.equal(run.status, 0, `${script}: ${run.stderr}`);
  }
  for (const file of readdirSync(join(PLUGIN, 'commands'))) {
    const body = read(join(PLUGIN, 'commands', file));
    assert.match(body, /^---\n[\s\S]*?description: .+[\s\S]*?\n---/, `${file} needs a description`);
    assert.match(body, /allowed-tools: .*Bash\(lingxi-claude:\*\)/, `${file} must pre-approve the command it runs`);
  }
});

test('no variable runs straight into a Chinese character', () => {
  // "$APP（" - under a UTF-8 locale bash takes the first byte of （ as part of the name, expands an
  // unset variable, and `set -u` kills the script. It passed every test run in the C locale and
  // failed the first time Claude Code ran it. Brace them: "${APP}（".
  const files = [...readdirSync(join(PLUGIN, 'scripts')).filter((f) => f.endsWith('.sh')).map((f) => join(PLUGIN, 'scripts', f)),
    join(PLUGIN, 'bin/lingxi-claude'), join(REPO, 'integrations/cli/lingxi')];
  for (const file of files) {
    read(file).split('\n').forEach((line, i) => {
      if (/^\s*#/.test(line)) return;
      const bad = line.match(/\$[A-Za-z_][A-Za-z0-9_]*(?=[^\x00-\x7F])/);
      assert.ok(!bad, `${file}:${i + 1}: ${bad?.[0]} is followed by a non-ASCII character - write \${${bad?.[0].slice(1)}}`);
    });
  }
});

test('the plugin ships the same shell client the app does', () => {
  // bin/lingxi runs scripts/lingxi-cli. A stale copy would give Claude an older client than the
  // app it is talking to - so the copy is held to the source byte for byte.
  assert.equal(read(join(PLUGIN, 'scripts/lingxi-cli')), read(join(REPO, 'integrations/cli/lingxi')),
    'run: cp integrations/cli/lingxi integrations/hosts/claude/scripts/lingxi-cli');
  assert.match(read(join(PLUGIN, 'bin/lingxi')), /export LINGXI_AGENT="\$\{LINGXI_CLAUDE_AGENT:-claude\}"/,
    'inside Claude Code the client must speak as Claude, whatever ~/.lingxi/agent.json says');
});

test('every place that names the app agrees on its bundle identifier', () => {
  // The identifier IS the data directory: ~/Library/Application Support/<identifier>. Change it in
  // one place and a reinstall starts from an empty cat - settings, memory and reminders gone.
  assert.equal(json(join(REPO, 'apps/lingxi/src-tauri/tauri.conf.json')).identifier, BUNDLE_ID);
  for (const file of ['integrations/shared/lib.sh', 'integrations/cli/lingxi',
    'packages/mcp-server/src/launch.mjs', 'apps/lingxi/src-tauri/src/lib.rs']) {
    assert.ok(read(join(REPO, file)).includes(BUNDLE_ID), `${file} does not name ${BUNDLE_ID}`);
  }
});

// --- a fake machine ---------------------------------------------------------------------------

function machine({ installed = true, up = false, oneClick = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lingxi-plugin-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const log = join(root, 'log');
  const state = join(root, 'state');
  const config = join(root, 'config');
  const app = join(root, 'Applications', '灵犀.app');
  for (const dir of [home, bin, log, state, config]) mkdirSync(dir, { recursive: true });
  if (installed) mkdirSync(join(app, 'Contents'), { recursive: true });
  writeFileSync(join(config, 'bridge-token'), 't'.repeat(40));
  if (up) writeFileSync(join(log, 'up'), '');
  if (oneClick) {
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude/settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command',
      command: 'curl -s -m 2 --noproxy "*" -X POST http://127.0.0.1:47811/task-event' }] }] } }));
  }
  const script = (name, body) => { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  script('open', `printf '%s\\n' "$*" >> '${log}/open'; touch '${log}/up'`);
  script('curl', `
url=""; cfg=""
while [ $# -gt 0 ]; do case "$1" in -K) cfg="$2"; shift ;; http*) url="$1" ;; esac; shift; done
[ -e '${log}/up' ] || exit 7
case "$url" in
  */health) exit 0 ;;
  *) n=$(ls '${log}' | grep -c '^post'); cat > '${log}/post.tmp'; mv '${log}/post.tmp' "${log}/post$n"
     echo "$url" > "${log}/url$n"; cat "$cfg" > "${log}/auth$n"; printf 200 ;;
esac`);
  const env = {
    PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: home,
    // Claude Code runs hooks in the user's locale, and under UTF-8 bash reads "$VAR」" as one
    // (unset) variable name - which is how the first version of /lingxi:status died.
    LANG: 'zh_CN.UTF-8',
    LC_ALL: 'zh_CN.UTF-8',
    LINGXI_APP_PATH: app,
    LINGXI_CONFIG_DIR: config,
    LINGXI_CLAUDE_STATE_DIR: state,
    CLAUDE_PLUGIN_ROOT: PLUGIN,
  };
  const posts = () => readdirSync(log).filter((f) => /^post\d+$/.test(f)).sort().map((f) => read(join(log, f)));
  return { root, home, log, state, config, app, env, posts, opened: () => existsSync(join(log, 'open')) ? read(join(log, 'open')).trim().split('\n') : [] };
}

const payload = (event, extra = {}) => JSON.stringify({ hook_event_name: event, session_id: 's1', ...extra });

function run(script, box, input, env = {}) {
  const started = Date.now();
  const result = spawnSync('bash', [join(box.env.CLAUDE_PLUGIN_ROOT, 'scripts', script)], {
    input, env: { ...box.env, ...env }, encoding: 'utf8', timeout: 10000,
  });
  const out = result.stdout.trim();
  return { status: result.status, ms: Date.now() - started, out, json: out ? JSON.parse(out) : null, stderr: result.stderr };
}

const settle = (ms = 1500) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, ms = 5000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (predicate()) return true; await settle(50); }
  return predicate();
}

// --- SessionStart -----------------------------------------------------------------------------

test('installed and running: the event is delivered and nothing is printed', async () => {
  const box = machine({ up: true });
  const r = run('session-start.sh', box, payload('SessionStart', { source: 'startup' }));
  assert.equal(r.status, 0);
  assert.equal(r.out, '', 'a session where everything works should print nothing');
  assert.ok(await until(() => box.posts().length === 1), 'the SessionStart event was not delivered');
  assert.match(box.posts()[0], /"hook_event_name":"SessionStart"/);
  // The fake curl writes the body and the header file separately; wait for the header rather
  // than racing it (this failed intermittently under a loaded test run).
  const speaksAsClaude = () => {
    try { return /X-Lingxi-Agent: claude/.test(read(join(box.log, 'auth0'))); } catch { return false; }
  };
  assert.ok(await until(speaksAsClaude), 'the plugin speaks as claude');
  assert.deepEqual(box.opened(), [], 'a running app is not opened again');
});

test('installed but closed: opened without taking focus, then told the session began', async () => {
  const box = machine();
  const r = run('session-start.sh', box, payload('SessionStart', { source: 'startup' }));
  assert.equal(r.status, 0);
  // Wall-clock floor, not a precise budget: opening the app is detached, and a genuine
  // non-detached hold runs for seconds. Under a loaded test run the shell can take ~1.6s.
  assert.ok(r.ms < 2500, `SessionStart held the session for ${r.ms}ms`);
  assert.ok(await until(() => box.posts().length === 1), 'the event never arrived after the start');
  assert.deepEqual(box.opened(), [`-g ${box.app}`], 'opened by its resolved path, in the background');
});

test('auto_open off, or LINGXI_AUTOSTART=0: a closed app stays closed', async () => {
  for (const env of [{ CLAUDE_PLUGIN_OPTION_AUTO_OPEN: 'false' }, { LINGXI_AUTOSTART: '0' }]) {
    const box = machine();
    assert.equal(run('session-start.sh', box, payload('SessionStart', { source: 'startup' }), env).status, 0);
    await settle(800);
    assert.deepEqual(box.opened(), [], `opened despite ${JSON.stringify(env)}`);
  }
});

test('not installed: installed in the background, and the user and Claude are both told', async () => {
  const box = machine({ installed: false });
  // A stand-in installer, so the test observes the call rather than downloading anything.
  const plugin = join(box.root, 'plugin');
  cpSync(PLUGIN, plugin, { recursive: true });
  writeFileSync(join(plugin, 'scripts/install-app.sh'), `#!/bin/bash\nprintf '%s\\n' "$*" > '${box.log}/installer'\n`);
  chmodSync(join(plugin, 'scripts/install-app.sh'), 0o755);
  const r = run('session-start.sh', { ...box, env: { ...box.env, CLAUDE_PLUGIN_ROOT: plugin } },
    payload('SessionStart', { source: 'startup' }));
  assert.equal(r.status, 0);
  // Same wall-clock floor as the other SessionStart tests: the work is detached, and only a
  // genuinely non-detached hold (seconds) is a failure, not a loaded machine's ~1.6s shell.
  assert.ok(r.ms < 2500, `the install must not hold the session (${r.ms}ms)`);
  assert.match(r.json.systemMessage, /正在后台下载安装/);
  assert.match(r.json.hookSpecificOutput.additionalContext, /being installed/);
  assert.ok(await until(() => existsSync(join(box.log, 'installer'))), 'the installer was never started');
  const args = read(join(box.log, 'installer'));
  assert.match(args, /--open/, 'a first install opens the app in front');
  assert.match(args, /--replay .*pending-session-start\.json/, 'and delivers this session\'s event once it is up');
});

test('not installed with auto_install off: said once, not every session', () => {
  const box = machine({ installed: false });
  const env = { CLAUDE_PLUGIN_OPTION_AUTO_INSTALL: 'false' };
  const first = run('session-start.sh', box, payload('SessionStart', { source: 'startup' }), env);
  assert.match(first.json.systemMessage, /\/lingxi:setup/);
  const second = run('session-start.sh', box, payload('SessionStart', { source: 'startup' }), env);
  assert.equal(second.out, '', 'the same condition must not be repeated within a day');
});

test('a compaction is not a new session', async () => {
  const box = machine({ up: true });
  assert.equal(run('session-start.sh', box, payload('SessionStart', { source: 'compact' })).out, '');
  await settle(600);
  assert.deepEqual(box.posts(), []);
});

test('with the app\'s own "一键接入" hooks installed, the plugin does not post a second copy', async () => {
  const box = machine({ oneClick: true });
  run('session-start.sh', box, payload('SessionStart', { source: 'startup' }));
  assert.ok(await until(() => box.opened().length === 1), 'it still makes sure the app is running');
  run('event.sh', box, payload('Stop'));
  await settle(600);
  assert.deepEqual(box.posts(), [], 'the settings.json hooks already report these');
});

// --- the rest of the lifecycle ----------------------------------------------------------------

test('lifecycle events are delivered when the cat is up, and never start it', () => {
  const up = machine({ up: true });
  for (const event of ['UserPromptSubmit', 'Notification', 'Stop', 'StopFailure']) {
    assert.equal(run('event.sh', up, payload(event)).status, 0);
  }
  assert.equal(up.posts().length, 4);
  const down = machine();
  assert.equal(run('event.sh', down, payload('Stop')).status, 0, 'a closed app is not an error');
  assert.deepEqual(down.opened(), [], 'only the session boundary may start the app');
});

test('reactions: important drops the per-prompt event, off drops everything', () => {
  const important = machine({ up: true });
  const env = { CLAUDE_PLUGIN_OPTION_REACTIONS: 'important' };
  run('event.sh', important, payload('UserPromptSubmit'), env);
  run('event.sh', important, payload('Notification', { message: 'Claude needs your permission to use Bash' }), env);
  assert.equal(important.posts().length, 1);
  assert.match(important.posts()[0], /Notification/);
  const off = machine({ up: true });
  run('event.sh', off, payload('Stop'), { CLAUDE_PLUGIN_OPTION_REACTIONS: 'off' });
  assert.deepEqual(off.posts(), []);
});

// --- installing the app (macOS: builds and mounts a real disk image) ---------------------------

function fakeRelease(root, { version, bundleId = BUNDLE_ID, tamper = false }) {
  const stage = join(root, `stage-${version}`);
  const app = join(stage, '灵犀.app');
  mkdirSync(join(app, 'Contents/MacOS'), { recursive: true });
  writeFileSync(join(app, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleExecutable</key><string>lingxi</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`);
  writeFileSync(join(app, 'Contents/MacOS/lingxi'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(app, 'Contents/MacOS/lingxi'), 0o755);
  assert.equal(spawnSync('codesign', ['--force', '--deep', '--sign', '-', app]).status, 0, 'codesign failed');
  const out = join(root, `release-${version}`);
  mkdirSync(out);
  const dmg = join(out, `Lingxi-${version}-universal.dmg`);
  const made = spawnSync('hdiutil', ['create', '-quiet', '-fs', 'HFS+', '-srcfolder', stage, '-volname', 'Lingxi', dmg]);
  assert.equal(made.status, 0, String(made.stderr));
  const sum = spawnSync('shasum', ['-a', '256', dmg], { encoding: 'utf8' }).stdout.split(' ')[0];
  writeFileSync(join(out, 'SHA256SUMS.txt'), `${tamper ? '0'.repeat(64) : sum}  Lingxi-${version}-universal.dmg\n`);
  return out;
}

function install(box, args) {
  return spawnSync('bash', [join(PLUGIN, 'scripts/install-app.sh'), ...args], {
    env: { ...box.env, LINGXI_APP_PATH: box.app }, encoding: 'utf8', timeout: 120000,
  });
}

const version = (app) => spawnSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString',
  join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).stdout.trim();

test('install, update and reinstall keep the user\'s data exactly as it was', { skip: !onMac && 'macOS only' }, () => {
  const box = machine({ installed: false });
  const dest = join(box.root, 'Applications');
  // Data from an earlier install: this is what must survive everything below.
  writeFileSync(join(box.config, 'memory.json'), '{"items":[{"text":"喜欢喝乌龙"}]}');
  writeFileSync(join(box.config, 'settings.json'), '{"skin":"silver-cloud"}');
  const before = { memory: read(join(box.config, 'memory.json')), settings: read(join(box.config, 'settings.json')) };

  const first = install(box, ['--from', fakeRelease(box.root, { version: '9.9.0' }), '--dest', dest]);
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(version(box.app), '9.9.0');
  assert.match(first.stdout, /沿用已有的配置和数据/, 'the user is told their data was kept');
  assert.equal(read(join(box.state, 'install.state')).split('\t')[0], 'installed');

  const again = install(box, ['--from', fakeRelease(box.root, { version: '9.9.1' }), '--dest', dest]);
  assert.equal(again.status, 0);
  assert.equal(version(box.app), '9.9.0', 'without --update an installed app is reused, not replaced');

  const update = install(box, ['--update', '--from', join(box.root, 'release-9.9.1'), '--dest', dest]);
  assert.equal(update.status, 0, update.stdout + update.stderr);
  assert.equal(version(box.app), '9.9.1');

  assert.equal(read(join(box.config, 'memory.json')), before.memory, 'memory changed');
  assert.equal(read(join(box.config, 'settings.json')), before.settings, 'settings changed');
  assert.ok(existsSync(join(box.config, 'bridge-token')), 'the token (and with it every connected agent) survived');
});

test('a download that does not match its checksum, or is not 灵犀, is never installed', { skip: !onMac && 'macOS only' }, () => {
  const box = machine({ installed: false });
  const dest = join(box.root, 'Applications');
  const tampered = install(box, ['--from', fakeRelease(box.root, { version: '9.9.2', tamper: true }), '--dest', dest]);
  assert.notEqual(tampered.status, 0);
  assert.match(tampered.stdout, /校验和不匹配/);
  assert.ok(!existsSync(box.app), 'nothing may be installed from a mismatched download');
  assert.equal(read(join(box.state, 'install.state')).split('\t')[0], 'failed', '/lingxi:status can say why');

  const impostor = install(box, ['--from', fakeRelease(box.root, { version: '9.9.3', bundleId: 'com.example.other' }), '--dest', dest]);
  assert.notEqual(impostor.status, 0);
  assert.match(impostor.stdout, /不是灵犀/);
  assert.ok(!existsSync(box.app));
});

test('a copy already running keeps the stage: no second cat is opened', { skip: !onMac && 'macOS only' }, () => {
  // A developer's machine often has a build from src-tauri/target running. Opening the new install
  // beside it would fail to bind the port and put two cats on screen.
  const box = machine({ installed: false, up: true });
  const r = install(box, ['--open', '--from', fakeRelease(box.root, { version: '9.9.5' }), '--dest', join(box.root, 'Applications')]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(box.app), 'still installed');
  assert.deepEqual(box.opened(), [], 'but not opened beside the running copy');
  assert.match(r.stdout, /已经有一个灵犀在运行/);
});

test('two sessions starting together do not install twice', { skip: !onMac && 'macOS only' }, () => {
  const box = machine({ installed: false });
  // The lock is machine-wide (~/.lingxi/install.lock), not per host: Codex starting its first
  // session beside Claude's must not download a second copy either.
  mkdirSync(join(box.home, '.lingxi', 'install.lock'), { recursive: true });
  const blocked = install(box, ['--from', fakeRelease(box.root, { version: '9.9.4' }), '--dest', join(box.root, 'Applications')]);
  assert.equal(blocked.status, 3);
  assert.match(blocked.stdout, /另一个安装正在进行/);
});

test('an install never overwrites the app already at the target, even when the lookup missed it', { skip: !onMac && 'macOS only' }, () => {
  // LINGXI_APP_PATH pointing somewhere else (or Spotlight still indexing) once made the lookup come
  // back empty, and the installer downloaded the release and swapped it in over the running app.
  const box = machine({ installed: false });
  const dest = join(box.root, 'Applications');
  assert.equal(install(box, ['--from', fakeRelease(box.root, { version: '9.9.6' }), '--dest', dest]).status, 0);
  const missed = spawnSync('bash', [join(PLUGIN, 'scripts/install-app.sh'), '--from', fakeRelease(box.root, { version: '9.9.7' }), '--dest', dest], {
    env: { ...box.env, LINGXI_APP_PATH: join(box.root, 'elsewhere', '灵犀.app') }, encoding: 'utf8', timeout: 120000,
  });
  assert.equal(missed.status, 0, missed.stdout + missed.stderr);
  assert.match(missed.stdout, /已安装/);
  assert.equal(version(box.app), '9.9.6', 'only --update may replace an installed app');
});
