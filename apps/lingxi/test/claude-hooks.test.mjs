// The "一键接入" hooks, run for real under sh: their SessionStart is the check that brings the cat up.
//
// The commands are read out of lib.rs - CLAUDE_SESSION_START_COMMAND and CLAUDE_HOOK_COMMAND, the
// exact strings the app writes into ~/.claude/settings.json - so what runs here is what runs on a
// user's machine. (The Claude Code plugin has its own scripts; integrations/test covers those.)
// `curl` and `open` are replaced on PATH by scripts that simulate the app: /health refuses until
// `open` has "launched" it, and launching it is what creates the token file, exactly as on a
// machine where the app has never run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIB_RS = readFileSync(fileURLToPath(new URL('../src-tauri/src/lib.rs', import.meta.url)), 'utf8');
/** A `const NAME: &str = concat!("...", "...");` from lib.rs, as the string it compiles to. */
function rustConst(name) {
  const body = LIB_RS.match(new RegExp(`const ${name}: &str = concat!\\(([\\s\\S]*?)\\n\\);`))?.[1];
  assert.ok(body, `${name} not found in lib.rs`);
  return [...body.matchAll(/^\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)].map((m) => JSON.parse(`"${m[1]}"`)).join('');
}
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'Notification', 'Stop', 'StopFailure'];
const commandFor = (event) => rustConst(event === 'SessionStart' ? 'CLAUDE_SESSION_START_COMMAND' : 'CLAUDE_HOOK_COMMAND');

const PAYLOAD = JSON.stringify({ hook_event_name: 'SessionStart', session_id: 'abc', source: 'startup' });
const TOKEN = 'x'.repeat(40);

function machine({ appUp = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'lingxi-hooks-'));
  const bin = join(home, 'bin');
  const state = join(home, 'state');
  const support = join(home, 'Library', 'Application Support', 'com.dushaobin.lingxi-desktop');
  mkdirSync(bin);
  mkdirSync(state);
  mkdirSync(support, { recursive: true });
  const script = (name, body) => {
    writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  // The app: launching it binds the bridge and writes the token.
  script('open', `printf '%s\\n' "$*" >> '${state}/open.log'; touch '${state}/up'; printf '${TOKEN}' > '${support}/bridge-token'`);
  script('curl', `
proxy=no; cfg=
while [ $# -gt 0 ]; do
  case "$1" in --noproxy) proxy=yes; shift ;; -K) cfg="$2"; shift ;; esac
  case "$1" in *"/health") url=health ;; *"/task-event") url=event ;; esac
  shift
done
[ "$proxy" = yes ] || { echo "no --noproxy" >> '${state}/errors'; }
if [ "$url" = health ]; then [ -e '${state}/up' ] && exit 0 || exit 7; fi
if [ "$url" = event ]; then
  [ -e '${state}/up' ] || exit 7
  cat "$cfg" > '${state}/auth.txt'; cat > '${state}/posted.tmp'; mv '${state}/posted.tmp' '${state}/posted.json'; exit 0
fi`);
  if (appUp) {
    writeFileSync(join(state, 'up'), '');
    writeFileSync(join(support, 'bridge-token'), TOKEN);
  }
  return { home, bin, state };
}

function runHook(event, box, env = {}) {
  const started = Date.now();
  const run = spawnSync('sh', ['-c', commandFor(event)], {
    input: PAYLOAD,
    env: { PATH: `${box.bin}:/usr/bin:/bin`, HOME: box.home, ...env },
    timeout: 5000,
  });
  return { status: run.status, ms: Date.now() - started };
}

const waitFor = async (path, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until && !existsSync(path)) await new Promise((r) => setTimeout(r, 50));
  return existsSync(path);
};

test('a session starting with the cat closed starts it, then delivers the event it would have lost', async () => {
  const box = machine();
  const { status, ms } = runHook('SessionStart', box);
  assert.equal(status, 0, 'a hook must never fail the session');
  // The check has to run detached - a SessionStart hook blocks the session. The bound is a
  // wall-clock sanity floor, not a precise budget: on a loaded machine (test runner + builds in
  // parallel) spawning bash + curl can pass 1000ms, while a hook that genuinely fails to detach
  // holds for many seconds (download / app boot / the 20s bridge wait).
  assert.ok(ms < 2500, `the hook held the session for ${ms}ms - the check has to run detached`);
  assert.ok(await waitFor(join(box.state, 'posted.json'), 5000), 'the SessionStart event never arrived');
  assert.deepEqual(readFileSync(join(box.state, 'open.log'), 'utf8').trim().split('\n'), ['-g -b com.dushaobin.lingxi-desktop']);
  assert.equal(readFileSync(join(box.state, 'posted.json'), 'utf8'), PAYLOAD, 'the payload must arrive untouched');
  // The token only exists once the app has run; it has to be read after the start, not before.
  assert.match(readFileSync(join(box.state, 'auth.txt'), 'utf8'), new RegExp(`Bearer ${TOKEN}`));
  assert.ok(!existsSync(join(box.state, 'errors')), readFileSync(join(box.state, 'errors'), { encoding: 'utf8', flag: 'a+' }));
});

test('a session starting with the cat already up just reports', async () => {
  const box = machine({ appUp: true });
  assert.equal(runHook('SessionStart', box).status, 0);
  assert.ok(await waitFor(join(box.state, 'posted.json'), 3000));
  assert.ok(!existsSync(join(box.state, 'open.log')), 'a running app must not be launched again');
});

test('LINGXI_AUTOSTART=0 leaves a closed cat closed', async () => {
  for (const value of ['0', 'false', 'no']) {
    const box = machine();
    assert.equal(runHook('SessionStart', box, { LINGXI_AUTOSTART: value }).status, 0);
    await new Promise((r) => setTimeout(r, 800));
    assert.ok(!existsSync(join(box.state, 'open.log')), `LINGXI_AUTOSTART=${value} was ignored`);
    assert.ok(!existsSync(join(box.state, 'posted.json')));
  }
});

test('no other hook starts the app - only the session boundary may', async () => {
  for (const event of EVENTS.filter((e) => e !== 'SessionStart')) {
    const box = machine();
    assert.equal(runHook(event, box).status, 0, `${event} must exit 0 with the app closed`);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(!existsSync(join(box.state, 'open.log')), `${event} launched the app`);
  }
});
