// The session-start check: a host connecting is enough to bring the cat up.
//
// Until this, the server only tried to start the app when a tool call had already failed - so a
// session in which the model never called a tool left the cat closed throughout, and the one that
// did call paid the whole boot on its first request. `initialize` is the moment every MCP host
// shares, so the check runs there, and must not hold the handshake while it does.
//
// Nothing is really launched: `open` and `mdfind` are replaced on PATH by scripts that log what
// they were asked, so this proves the decision and the exact command without a window appearing
// on the machine running the tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const SERVER = fileURLToPath(new URL('../src/index.mjs', import.meta.url));

/** A port nothing is listening on, so the bridge is genuinely "down". */
async function deadPort() {
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function fakeMachine() {
  const dir = mkdtempSync(join(tmpdir(), 'lingxi-session-'));
  const bin = join(dir, 'bin');
  const log = join(dir, 'open.log');
  const script = (name, body) => {
    const path = join(bin, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
  };
  mkdirSync(bin);
  script('open', `printf '%s\\n' "$*" >> '${log}'`);
  script('mdfind', `echo '/Applications/灵犀.app'`);
  return { dir, bin, log };
}

async function connect(env) {
  const child = spawn(process.execPath, [SERVER], { env, stdio: ['pipe', 'pipe', 'ignore'] });
  const replies = [];
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      replies.push(JSON.parse(buffer.slice(0, at)));
      buffer = buffer.slice(at + 1);
    }
  });
  const sentAt = Date.now();
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
  while (!replies.length && Date.now() - sentAt < 3000) await new Promise((r) => setTimeout(r, 20));
  return { child, replies, handshakeMs: Date.now() - sentAt };
}

const waitFor = async (predicate, ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
};

const onMac = platform() === 'darwin';

test('a host connecting starts the cat, without making the handshake wait for it', { skip: !onMac && 'launching is macOS-only' }, async () => {
  const machine = fakeMachine();
  const env = { ...process.env, PATH: `${machine.bin}:${process.env.PATH}`, LINGXI_PORT: String(await deadPort()), HOME: machine.dir };
  delete env.LINGXI_AUTOSTART;
  const { child, replies, handshakeMs } = await connect(env);
  try {
    assert.equal(replies[0]?.id, 1, 'initialize must be answered');
    assert.ok(handshakeMs < 1500, `the handshake took ${handshakeMs}ms - it must not wait for the app to boot`);
    assert.ok(await waitFor(() => existsSync(machine.log), 3000), 'the app was never asked to start');
    const calls = readFileSync(machine.log, 'utf8').trim().split('\n');
    assert.deepEqual(calls, ['-g /Applications/灵犀.app'], 'exactly one start, in the background (-g), by the installed path - never whichever copy Launch Services prefers');
  } finally {
    child.kill();
  }
});

test('LINGXI_AUTOSTART=0 means a connecting host leaves the cat closed', { skip: !onMac && 'launching is macOS-only' }, async () => {
  const machine = fakeMachine();
  const env = { ...process.env, PATH: `${machine.bin}:${process.env.PATH}`, LINGXI_PORT: String(await deadPort()), HOME: machine.dir, LINGXI_AUTOSTART: '0' };
  const { child, replies } = await connect(env);
  try {
    assert.equal(replies[0]?.id, 1);
    await new Promise((r) => setTimeout(r, 1200));
    assert.ok(!existsSync(machine.log), 'the opt-out was ignored');
  } finally {
    child.kill();
  }
});
