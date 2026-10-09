// The transport is the one layer where a single malformed frame used to be able to kill the
// whole server (one `null` line took down all thirteen tools for the life of the host
// session). These tests run the real process and feed it the frames hosts actually send,
// including the broken ones.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const SERVER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'index.mjs');

test('initialize reports the published package version rather than a stale protocol label', async () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const { code, frames } = await converse([JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })]);
  assert.equal(code, 0);
  const initialized = frames.find((frame) => frame.id === 1);
  assert.equal(initialized.result.serverInfo.version, pkg.version);
});

/** Feed raw lines to a fresh server process and collect every JSON frame it writes back. */
function converse(lines) {
  return new Promise((resolve, reject) => {
    // Never the real app: a test process must not open a window on the machine running it.
    const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, LINGXI_AUTOSTART: '0' } });
    const frames = [];
    let buffered = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`server did not exit; got: ${frames.map((f) => JSON.stringify(f)).join('\n')}`));
    }, 5000);
    child.stdout.on('data', (chunk) => {
      buffered += chunk.toString('utf8');
      let index;
      while ((index = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, index);
        buffered = buffered.slice(index + 1);
        if (line.trim()) frames.push(JSON.parse(line));
      }
    });
    child.stderr.on('data', () => {}); // stderr is allowed; nothing there is protocol
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, frames });
    });
    child.stdin.end(`${lines.join('\n')}\n`);
  });
}

test('a null line is answered as an invalid request and does NOT kill the server', async () => {
  const { code, frames } = await converse([
    'null',
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
  ]);
  // The server survived the null line and answered the NEXT frame - that is the whole point.
  assert.equal(code, 0);
  assert.equal(frames[0].error?.code, -32600);
  assert.equal(frames[0].id, null);
  assert.deepEqual(frames[1].result, {});
});

test('ping is answered with an empty result, not a method error', async () => {
  const { frames } = await converse([JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })]);
  assert.deepEqual(frames[0].result, {});
});

test('notifications and bare strings never produce a frame without an id member', async () => {
  const { frames } = await converse([
    JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    '"just a string"',
    JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'definitely/not/a/method' }),
  ]);
  // Exactly one reply: for the unknown METHOD. The notification gets nothing, the string
  // gets -32600 - and every frame that does go out carries an explicit id member.
  assert.equal(frames.length, 2);
  assert.equal(frames[0].id, null);
  assert.equal(frames[0].error?.code, -32600);
  assert.equal(frames[1].id, 3);
  assert.equal(frames[1].error?.code, -32601);
});

test('a batch is answered with a bare array; an all-notification batch with nothing', async () => {
  const { frames } = await converse([
    JSON.stringify([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
    ]),
    JSON.stringify([{ jsonrpc: '2.0', method: 'notifications/initialized' }]),
  ]);
  assert.ok(Array.isArray(frames[0]), 'batch reply must be a top-level array');
  assert.equal(frames[0].length, 1);
  assert.deepEqual(frames[0][0].result, {});
  assert.equal(frames.length, 1, 'all-notification batch gets no reply');
});

test('unknown notifications get no reply; tools/list still works end to end', async () => {
  const { frames } = await converse([
    JSON.stringify({ jsonrpc: '2.0', method: 'some/unknown/notification' }),
    JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }),
  ]);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].id, 9);
  assert.ok(Array.isArray(frames[0].result?.tools));
  assert.equal(frames[0].result.tools.length, 13);
});
