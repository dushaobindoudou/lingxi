// The 灵犀 WorkBuddy integration, held to what it promises.
//
// WorkBuddy is the one host where a wrong config fails *silently*: a third-party MCP server it
// has not seen is refused before the process starts, so nothing inside the server logs, and the
// only symptom is "the cat stopped reacting". Two of these tests exist because that failure was
// actually shipped:
//
//   - `workbuddy-mark.svg` once began with an HTML comment. The app's logo check requires the
//     document to *start* with `<svg`, so `register` answered 400, and `set -e` killed the
//     installer mid-way: the user saw step 4 and no error, and the hooks were never installed.
//   - the hook command once baked an absolute managed-node version path. WorkBuddy shipping a
//     different node leaves it pointing at nothing, and a dead hook is indistinguishable from
//     any other "the cat is quiet" from the host's point of view.
//
// The installer runs against a temp HOME with LINGXI_WORKBUDDY_DIR / LINGXI_AGENT_FILE pointed
// into it, so nothing on the machine is touched. HOME is redirected too, which is what keeps the
// real `lingxi` CLI (and therefore the live cat) out of the registration step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, statSync, rmSync, readlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every host installer's step 0 starts the real app, or installs it from GitHub. A test run must
// never do either - the installers report and carry on when both are switched off.
process.env.LINGXI_AUTOSTART = '0';
process.env.LINGXI_AUTOINSTALL = '0';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const HOST = join(REPO, 'integrations/hosts/workbuddy');
const PLUGIN = join(HOST, 'plugin');
const INSTALLER = join(HOST, 'install.sh');
const MARK = join(HOST, 'workbuddy-mark.svg');
const read = (p) => readFileSync(p, 'utf8');
const isExec = (p) => existsSync(p) && Boolean(statSync(p).mode & 0o111);

// --- structure --------------------------------------------------------------------------------

test('the WorkBuddy host ships every piece it promises', () => {
  for (const [rel, kind] of [
    ['README.md', 'file'],
    ['install.sh', 'exec'],
    ['workbuddy-mark.svg', 'file'],
    ['plugin/.codebuddy-plugin/plugin.json', 'file'],
    ['plugin/hooks/hooks.json', 'file'],
    ['bin/lingxi-quota-guard.mjs', 'exec'],
    ['plugin/bin/lingxi-emit.mjs', 'exec'],
    ['plugin/bin/lingxi-quota-guard.mjs', 'exec'],
    ['skills/lingxi-workbuddy/SKILL.md', 'file'],
    ['plugin/skills/lingxi/SKILL.md', 'file'],
    ['plugin/skills/lingxi-authoring/SKILL.md', 'file'],
    ['plugin/skills/lingxi-workbuddy/SKILL.md', 'file'],
  ]) {
    const p = join(HOST, rel);
    assert.ok(existsSync(p), `${rel} missing`);
    if (kind === 'exec') assert.ok(isExec(p), `${rel} is not executable`);
  }
});

// The regression: a leading comment made the app answer "not an SVG document", which aborted the
// installer before the hooks were written.
test('the mark starts with <svg, or register rejects it', () => {
  const body = read(MARK);
  assert.ok(body.startsWith('<svg'), 'workbuddy-mark.svg must begin with <svg - comments go inside');
  assert.ok(body.includes('viewBox'), 'the mark needs a viewBox to scale to 22px');
});

// --- plugin package ---------------------------------------------------------------------------

test('the hooks cover the lifecycle AND the moments the agent is waiting on the user', () => {
  const manifest = JSON.parse(read(join(PLUGIN, '.codebuddy-plugin/plugin.json')));
  assert.equal(manifest.name, 'lingxi');
  assert.equal(manifest.hooks, './hooks/hooks.json');
  assert.ok(existsSync(join(PLUGIN, manifest.hooks)), 'plugin.json points at a missing hooks file');

  const events = Object.keys(JSON.parse(read(join(PLUGIN, 'hooks/hooks.json'))).hooks);
  // Notification / PermissionRequest are the "WorkBuddy popped a dialog and the cat said
  // nothing" fix: lifecycle hooks alone never fire for a permission prompt or a question.
  assert.deepEqual(events.sort(), ['Notification', 'PermissionRequest', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  // The tool-level events fire on every single tool call - they turn the cat into a firehose.
  assert.ok(!events.includes('PostToolUse'), 'PostToolUse would spam the cat');
  assert.ok(!events.includes('PreToolUse'), 'PreToolUse would spam the cat');
});

test('hook commands resolve node at run time, never a baked version path', () => {
  const files = [join(PLUGIN, 'hooks/hooks.json')];
  for (const f of files) {
    const commands = Object.values(JSON.parse(read(f)).hooks).flat().flatMap((group) => group.hooks.map((h) => h.command));
    // SessionStart runs the shared bash check (scripts/session-start.sh) and needs no node.
    const nodeCommands = commands.filter((cmd) => /\.mjs/.test(cmd));
    assert.ok(nodeCommands.length >= 4, 'the emitter and the quota guard run under node');
    for (const cmd of nodeCommands) {
      assert.match(cmd, /command -v node/, `${f}: node must be looked up when the hook runs`);
      assert.doesNotMatch(cmd, /versions\/\d+\.\d+\.\d+-\d+\/bin\/node/,
        `${f}: a baked node version path dies when WorkBuddy ships a different node`);
    }
  }
});

// The plugin is a copy, not a symlink - it has to be publishable on its own. That makes drift
// the failure mode, so hold it byte-for-byte.
test('the self-contained plugin copies are byte-identical to the repo sources', () => {
  for (const [copy, source] of [
    ['plugin/skills/lingxi/SKILL.md', 'integrations/skills/lingxi/SKILL.md'],
    ['plugin/skills/lingxi-authoring/SKILL.md', 'integrations/skills/lingxi-authoring/SKILL.md'],
    ['plugin/bin/lingxi-emit.mjs', 'integrations/adapters/lingxi-emit.mjs'],
    ['plugin/bin/lingxi-quota-guard.mjs', 'integrations/hosts/workbuddy/bin/lingxi-quota-guard.mjs'],
    ['plugin/skills/lingxi-workbuddy/SKILL.md', 'integrations/hosts/workbuddy/skills/lingxi-workbuddy/SKILL.md'],
  ]) {
    assert.equal(read(join(HOST, copy)), read(join(REPO, source)),
      `${copy} has drifted from ${source}`);
  }
});

// --- installer, run for real against a temp home ----------------------------------------------

function tempHome() {
  const home = mkdtempSync(join(tmpdir(), 'lingxi-wb-'));
  const wb = join(home, '.workbuddy');
  mkdirSync(join(wb, 'skills'), { recursive: true });
  return { home, wb, agent: join(home, '.lingxi', 'agent.json') };
}

function runInstaller(home, wb, agent, ...args) {
  const r = spawnSync('bash', [INSTALLER, ...args], {
    env: {
      ...process.env,
      HOME: home,
      LINGXI_WORKBUDDY_DIR: wb,
      LINGXI_AGENT_FILE: agent,
    },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `install.sh ${args.join(' ')} exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  return r.stdout + r.stderr;
}

test('install writes an env-free MCP entry, the hooks, and leaves other servers alone', () => {
  const { home, wb, agent } = tempHome();
  try {
    const mcp = join(wb, 'mcp.json');
    const settings = join(wb, 'settings.json');
    writeFileSync(mcp, JSON.stringify({ mcpServers: { other: { command: 'other', args: ['x'] } } }));
    writeFileSync(settings, JSON.stringify({ theme: 'dark' }));

    runInstaller(home, wb, agent);

    const servers = JSON.parse(read(mcp)).mcpServers;
    assert.ok(servers.lingxi, 'lingxi entry missing');
    assert.equal(servers.lingxi.command, 'node');
    // env keys are part of WorkBuddy's trust hash: adding one silently revokes the approval the
    // user already granted, and the host then refuses to start the server at all.
    assert.ok(!servers.lingxi.env, 'lingxi must carry no env - it would change the trust hash');
    assert.deepEqual(servers.other, { command: 'other', args: ['x'] }, 'an unrelated server moved');

    const hooks = JSON.parse(read(settings)).hooks;
    assert.deepEqual(Object.keys(hooks).sort(),
      ['Notification', 'PermissionRequest', 'Stop', 'UserPromptSubmit']);
    // The two dialog events only need the emitter; the quota guard reads whole-session usage
    // and has nothing to say about a permission prompt.
    for (const ev of ['Notification', 'PermissionRequest']) {
      assert.equal(hooks[ev].length, 1, `${ev} should carry only the emitter`);
      assert.match(hooks[ev][0].hooks[0].command, /lingxi-emit\.mjs/);
      assert.equal(hooks[ev][0].hooks[0].async, true, `${ev} must not block the host`);
    }
    for (const ev of ['UserPromptSubmit', 'Stop']) {
      const cmd = hooks[ev][0].hooks[0].command;
      assert.match(cmd, /lingxi-emit\.mjs/, `${ev} hook does not call the emit adapter`);
      assert.match(cmd, /command -v node/, `${ev} hook bakes a node path`);
      assert.equal(hooks[ev][0].hooks[0].async, true, `${ev} hook must not block the host`);

      // The quota guard is a second group, not a second entry in the first one: the emitter's
      // command ends in `exec`, so anything after it in the same shell never runs.
      assert.equal(hooks[ev].length, 2, `${ev} should carry the emitter and the quota guard`);
      const guard = hooks[ev][1].hooks[0];
      assert.match(guard.command, /lingxi-quota-guard\.mjs/, `${ev} is missing the quota guard`);
      // node:sqlite prints an ExperimentalWarning that would land in the host's hook output.
      assert.match(guard.command, /--no-warnings/, `${ev} guard would leak a node warning`);
      assert.equal(guard.async, true, `${ev} guard must not block the host`);
    }
    assert.equal(JSON.parse(read(settings)).theme, 'dark', 'unrelated settings were clobbered');

    // Two skills, not one. The base one is shared with every host; the WorkBuddy layer must
    // point at the HOST directory - the whole point of splitting it out is that Claude, Cursor
    // and the rest never see WorkBuddy's trust gate.
    const skills = join(wb, 'skills');
    for (const s of ['lingxi', 'lingxi-authoring', 'lingxi-workbuddy']) {
      assert.ok(existsSync(join(skills, s)), `${s} skill was not installed`);
    }
    assert.equal(readlinkSync(join(skills, 'lingxi')), join(REPO, 'integrations/skills/lingxi'),
      'the base skill must come from the shared source');
    assert.equal(readlinkSync(join(skills, 'lingxi-workbuddy')),
      join(REPO, 'integrations/hosts/workbuddy/skills/lingxi-workbuddy'),
      'the host skill must come from the host directory, not the shared one');

    // identity, and the logo the app put there must survive a re-run
    const identity = JSON.parse(read(agent));
    assert.equal(identity.id, 'workbuddy');
    assert.equal(identity.badge, '🐧');

    // idempotent
    const after = read(settings);
    runInstaller(home, wb, agent);
    assert.equal(read(settings), after, 'a second install changed settings.json');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('uninstall takes the hooks back out and keeps everything else', () => {
  const { home, wb, agent } = tempHome();
  try {
    const mcp = join(wb, 'mcp.json');
    const settings = join(wb, 'settings.json');
    writeFileSync(mcp, JSON.stringify({ mcpServers: { other: { command: 'other' } } }));
    // a hook of the user's own must survive a lingxi uninstall
    writeFileSync(settings, JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: '/bin/echo mine' }] }] },
    }));
    runInstaller(home, wb, agent);
    runInstaller(home, wb, agent, '--uninstall');

    assert.equal(JSON.parse(read(mcp)).mcpServers.lingxi, undefined, 'lingxi entry survived');
    assert.ok(JSON.parse(read(mcp)).mcpServers.other, 'uninstall removed an unrelated server');
    // All three, including the host-only one: leaving lingxi-workbuddy behind would ship
    // WorkBuddy's rules to a machine that no longer has the rest of the integration.
    for (const s of ['lingxi', 'lingxi-authoring', 'lingxi-workbuddy']) {
      assert.ok(!existsSync(join(wb, 'skills', s)), `${s} skill survived uninstall`);
    }
    const hooks = JSON.parse(read(settings)).hooks;
    assert.equal(hooks.UserPromptSubmit, undefined, 'lingxi hook survived');
    assert.deepEqual(hooks.Stop, [{ hooks: [{ type: 'command', command: '/bin/echo mine' }] }],
      'uninstall removed a hook that was not ours');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('--no-quota-guard installs the lifecycle hooks and nothing else', () => {
  const { home, wb, agent } = tempHome();
  try {
    const settings = join(wb, 'settings.json');
    writeFileSync(settings, JSON.stringify({ theme: 'dark' }));

    runInstaller(home, wb, agent, '--no-quota-guard');

    const hooks = JSON.parse(read(settings)).hooks;
    for (const ev of ['UserPromptSubmit', 'Stop']) {
      assert.equal(hooks[ev].length, 1, `${ev} should carry only the emitter`);
      assert.match(hooks[ev][0].hooks[0].command, /lingxi-emit\.mjs/);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
