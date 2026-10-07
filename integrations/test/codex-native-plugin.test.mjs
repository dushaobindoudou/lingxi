// The Codex plugin (integrations/hosts/codex/plugin), exercised for real: its scripts run under bash
// against a fake machine whose `curl` and `open` record what they were asked.
//
// What it promises:
//   - Codex lists it from this repository's own marketplace (.agents/plugins/marketplace.json),
//     not the Claude plugin it would otherwise pick up from .claude-plugin/marketplace.json
//   - every event reaches the cat credited to codex - a raw hook payload would be credited to claude
//   - a turn is heard once: with `notify` already pointed at the cat, the plugin leaves turns to it
//   - not installed -> installed from GitHub in the background; installed -> started and reported
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync, statSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const PLUGIN = join(REPO, 'integrations/hosts/codex/plugin');
const read = (path) => readFileSync(path, 'utf8');
const json = (path) => JSON.parse(read(path));

test('Codex finds the Codex plugin in this repository, and every file it names exists', () => {
  const market = json(join(REPO, '.agents/plugins/marketplace.json'));
  const entry = market.plugins.find((p) => p.name === 'lingxi');
  assert.ok(entry, 'the Codex marketplace must list lingxi');
  assert.equal(entry.source.source, 'local');
  assert.equal(join(REPO, entry.source.path), PLUGIN, 'it must point at the Codex plugin');

  const manifest = json(join(PLUGIN, '.codex-plugin/plugin.json'));
  assert.equal(manifest.name, 'lingxi');
  for (const skill of ['lingxi', 'lingxi-authoring', 'lingxi-codex']) {
    assert.ok(existsSync(join(PLUGIN, manifest.skills, skill, 'SKILL.md')), `skill ${skill} missing`);
  }
  const server = json(join(PLUGIN, manifest.mcpServers)).mcpServers.lingxi;
  assert.equal(server.env.LINGXI_AGENT, 'codex');
  assert.ok(statSync(join(PLUGIN, server.command)).mode & 0o111, `${server.command} must be executable`);

  const hooks = manifest.hooks.hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ['PermissionRequest', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  for (const [event, groups] of Object.entries(hooks)) {
    for (const hook of groups.flatMap((g) => g.hooks)) {
      // Codex has no async hooks: anything slow must detach inside the script, never in the host.
      assert.equal(hook.async, undefined, `${event}: Codex does not know "async"`);
      const script = hook.command.match(/\$\{PLUGIN_ROOT\}\/([^"]+)/)?.[1];
      assert.ok(script, `${event}: not a plugin script: ${hook.command}`);
      assert.ok(statSync(join(PLUGIN, script)).mode & 0o111, `${script} must be executable`);
    }
  }
  for (const file of readdirSync(join(PLUGIN, 'scripts'))) {
    if (file.endsWith('.sh') || file === 'lingxi-mcp') {
      const r = spawnSync('bash', ['-n', join(PLUGIN, 'scripts', file)], { encoding: 'utf8' });
      assert.equal(r.status, 0, `${file}: ${r.stderr}`);
    }
  }
});

// --- a fake machine ---------------------------------------------------------------------------

function machine({ installed = true, up = true, notify = '' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lingxi-codex-plugin-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const log = join(root, 'log');
  const config = join(root, 'config');
  const codex = join(home, '.codex');
  const app = join(root, 'Applications', '灵犀.app');
  for (const dir of [home, bin, log, config, codex]) mkdirSync(dir, { recursive: true });
  if (installed) mkdirSync(join(app, 'Contents'), { recursive: true });
  writeFileSync(join(config, 'bridge-token'), 't'.repeat(40));
  if (up) writeFileSync(join(log, 'up'), '');
  writeFileSync(join(codex, 'config.toml'), notify ? `notify = ["${codex}/notify-fanout.sh"]\n` : 'model = "x"\n');
  if (notify) writeFileSync(join(codex, 'notify-fanout.sh'), notify);
  const script = (name, body) => { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  script('open', `printf '%s\\n' "$*" >> '${log}/open'; touch '${log}/up'`);
  script('curl', `
url=""; cfg=""
while [ $# -gt 0 ]; do case "$1" in -K) cfg="$2"; shift ;; http*) url="$1" ;; esac; shift; done
[ -e '${log}/up' ] || exit 7
case "$url" in
  */health) exit 0 ;;
  *) n=$(ls '${log}' | grep -c '^post'); cat > '${log}/post.tmp'; cat "$cfg" > "${log}/auth$n"; mv '${log}/post.tmp' "${log}/post$n"; printf 200 ;;
esac`);
  const env = {
    PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, CODEX_HOME: codex,
    LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8',
    LINGXI_APP_PATH: app, LINGXI_CONFIG_DIR: config, LINGXI_STATE_DIR: join(root, 'state'),
    LINGXI_INSTALL_LOCK: join(root, 'install.lock'), CLAUDE_PLUGIN_ROOT: PLUGIN,
  };
  const posts = () => readdirSync(log).filter((f) => /^post\d+$/.test(f)).sort().map((f) => JSON.parse(read(join(log, f))));
  return { root, log, env, posts, opened: () => (existsSync(join(log, 'open')) ? read(join(log, 'open')).trim().split('\n') : []) };
}

const payload = (event, extra = {}) => JSON.stringify({
  session_id: '01a115d0-eac1-7983', turn_id: 't1', cwd: '/Users/me/work/灵犀', hook_event_name: event, model: 'm', ...extra,
});
function run(box, script, input, env = {}) {
  const r = spawnSync('bash', [join(box.env.CLAUDE_PLUGIN_ROOT, 'scripts', script)], {
    input, env: { ...box.env, ...env }, encoding: 'utf8', timeout: 10000,
  });
  return { status: r.status, out: r.stdout.trim(), stderr: r.stderr };
}
const until = async (predicate, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (predicate()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return predicate();
};

// --- events -----------------------------------------------------------------------------------

test('every event reaches the cat as Codex, in the shape the bridge maps for Codex', () => {
  const box = machine();
  const reply = '登录测试已修复，18 项通过。\n\n要我顺手发布吗？';
  for (const [event, extra] of [['SessionStart', { source: 'startup' }], ['UserPromptSubmit', { prompt: 'hi' }],
    ['PermissionRequest', { tool_name: 'shell' }], ['Stop', { last_assistant_message: reply, stop_hook_active: false }]]) {
    assert.equal(run(box, 'event.sh', payload(event, extra)).status, 0);
  }
  const posts = box.posts();
  assert.deepEqual(posts.map((p) => p.state), ['queued', 'running', 'needs_approval', 'completed']);
  for (const post of posts) {
    assert.equal(post.provider, 'codex', 'a raw hook payload would be credited to claude');
    assert.equal(post.agent, 'codex');
    assert.equal(post.taskId, '01a115d0-eac1-7983', 'one row per Codex session');
    assert.equal(post.label, '灵犀', 'the session is named after its folder');
    assert.equal(post.origin, 'hook');
  }
  assert.match(posts[2].summary, /shell/, 'an approval says what Codex wants to run');
  assert.equal(posts[3].result, reply, 'the reply travels as result, intact - newlines and all');
  assert.equal(posts[3].last_assistant_message, undefined);
  assert.equal(posts[3].turn_id, 't1', 'the rest of the payload is kept as it was');
  assert.match(read(join(box.log, 'auth0')), /X-Lingxi-Agent: codex/);
});

test('with notify already reporting turns, the plugin reports only what notify cannot', () => {
  const box = machine({ notify: '#!/bin/sh\nnode /x/integrations/adapters/lingxi-emit.mjs --host codex "$1" &\nwait\n' });
  for (const event of ['UserPromptSubmit', 'Stop', 'PermissionRequest']) run(box, 'event.sh', payload(event));
  assert.deepEqual(box.posts().map((p) => p.state), ['needs_approval'], 'notify already reports the prompt and the turn end');
});

test('a closed app is left closed by turn events, and nothing fails', () => {
  const box = machine({ up: false });
  assert.equal(run(box, 'event.sh', payload('Stop', { last_assistant_message: 'ok' })).status, 0);
  assert.deepEqual(box.posts(), []);
  assert.deepEqual(box.opened(), [], 'only the session boundary may start the app');
});

// --- session start ----------------------------------------------------------------------------

test('session start, app running: the session is reported before the hook returns, silently', () => {
  const box = machine();
  const r = run(box, 'session-start.sh', payload('SessionStart', { source: 'startup' }));
  assert.equal(r.status, 0);
  assert.equal(r.out, '');
  // Synchronous on purpose: delivered detached, it lost the race to the first prompt and the row
  // went running -> queued.
  assert.deepEqual(box.posts().map((p) => [p.provider, p.state]), [['codex', 'queued']]);
});

test('session start, app closed: started in the background, then told', async () => {
  const box = machine({ up: false });
  assert.equal(run(box, 'session-start.sh', payload('SessionStart', { source: 'startup' })).status, 0);
  assert.ok(await until(() => box.posts().length === 1), 'the session was never reported');
  assert.equal(box.opened()[0].split(' ')[0], '-g', 'opened without taking focus');
});

test('session start, not installed: installed from GitHub in the background, and Codex is told', async () => {
  const box = machine({ installed: false, up: false });
  const plugin = join(box.root, 'plugin');
  cpSync(PLUGIN, plugin, { recursive: true });
  writeFileSync(join(plugin, 'scripts/install-app.sh'), `#!/bin/bash\nprintf '%s %s\\n' "$LINGXI_HOST" "$*" > '${box.log}/installer'\n`);
  chmodSync(join(plugin, 'scripts/install-app.sh'), 0o755);
  const started = Date.now();
  const r = run({ env: { ...box.env, CLAUDE_PLUGIN_ROOT: plugin } }, 'session-start.sh', payload('SessionStart', { source: 'startup' }));
  assert.equal(r.status, 0);
  assert.ok(Date.now() - started < 2500, 'the download must not hold the session');
  const out = JSON.parse(r.out);
  assert.match(out.systemMessage, /GitHub/);
  assert.match(out.hookSpecificOutput.additionalContext, /being installed/);
  assert.ok(await until(() => existsSync(join(box.log, 'installer'))), 'the installer was never started');
  assert.equal(read(join(box.log, 'installer')).trim(), 'codex --open', 'as Codex, opened afterwards');
});

test('session start, not installed and installs off: said once a day, nothing downloaded', () => {
  const box = machine({ installed: false, up: false });
  const first = run(box, 'session-start.sh', payload('SessionStart', { source: 'startup' }), { LINGXI_AUTOINSTALL: '0' });
  assert.match(JSON.parse(first.out).systemMessage, /releases/);
  const second = run(box, 'session-start.sh', payload('SessionStart', { source: 'startup' }), { LINGXI_AUTOINSTALL: '0' });
  assert.equal(second.out, '');
});
