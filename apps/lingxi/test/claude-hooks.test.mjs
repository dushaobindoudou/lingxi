// The Claude Code hooks, run for real under sh: SessionStart is the check that brings the cat up.
//
// The commands are taken verbatim from integrations/hosts/claude/hooks/hooks.json, which a Rust
// test pins to the strings "一键接入" writes - so this exercises both install paths at once.
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

const hooks = JSON.parse(readFileSync(fileURLToPath(new URL('../../../integrations/hosts/claude/hooks/hooks.json', import.meta.url)), 'utf8')).hooks;
const commandFor = (event) => hooks[event][0].hooks[0].command;

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
  assert.ok(ms < 1000, `the hook held the session for ${ms}ms - the check has to run detached`);
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
  for (const event of Object.keys(hooks).filter((e) => e !== 'SessionStart')) {
    const box = machine();
    assert.equal(runHook(event, box).status, 0, `${event} must exit 0 with the app closed`);
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(!existsSync(join(box.state, 'open.log')), `${event} launched the app`);
  }
});
