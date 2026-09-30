// The machine-wide ~/.lingxi/agent.json is written by whichever host installed last. It once said
// "workbuddy" while Claude's MCP server ran with LINGXI_AGENT=claude-code - and the server
// registered claude-code wearing WorkBuddy's name and penguin logo, so the cat spoke for Claude
// under the wrong face. These tests run the real bridge against a fake app and read what it
// registers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'bridge.mjs');
const WORKBUDDY = { id: 'workbuddy', name: 'WorkBuddy', badge: '🐧', color: '#0AC89F', logo: 'data:image/png;base64,AAAA' };

/** Registration body the bridge sends, for a given environment and agent.json. */
async function registration(env, agentFile) {
  const registered = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (req.url === '/agents') registered.push(JSON.parse(body));
      res.setHeader('Content-Type', 'application/json');
      res.end('{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const home = mkdtempSync(join(tmpdir(), 'lingxi-identity-'));
  if (agentFile) {
    mkdirSync(join(home, '.lingxi'));
    writeFileSync(join(home, '.lingxi', 'agent.json'), JSON.stringify(agentFile));
  }
  const script = `import { bridge } from ${JSON.stringify(BRIDGE)}; await bridge.control({ say: 'hi' });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      PATH: process.env.PATH, HOME: home, LINGXI_AUTOSTART: '0', LINGXI_TOKEN: 'x'.repeat(40),
      LINGXI_PORT: String(server.address().port), ...env,
    },
    stdio: 'ignore',
  });
  await new Promise((resolve) => child.on('exit', resolve));
  server.close();
  return registered[0];
}

test('a host that names itself does not wear another host\'s look from the machine file', async () => {
  const body = await registration({ LINGXI_AGENT: 'claude-code' }, WORKBUDDY);
  assert.equal(body.id, 'claude-code');
  assert.notEqual(body.name, 'WorkBuddy');
  assert.equal(body.logo, undefined, 'the penguin logo belongs to workbuddy');
});

test('the machine file still dresses its own identity', async () => {
  const body = await registration({}, WORKBUDDY);
  assert.equal(body.id, 'workbuddy');
  assert.equal(body.name, 'WorkBuddy');
  assert.equal(body.logo, WORKBUDDY.logo);
});

test('豆包 is recognised by the node it runs under, since it starts connectors with no environment', async () => {
  const { hostFromRuntime } = await import(BRIDGE);
  const doubaoNode = '/Users/u/Library/Application Support/Doubao/sandbox_runtime/bases/abc/bin/node';
  assert.equal(hostFromRuntime(doubaoNode)?.id, 'doubao');
  assert.equal(hostFromRuntime('/opt/homebrew/bin/node'), null);
  assert.equal(hostFromRuntime(undefined), null);
});

test('豆包 is offered no tools: its runtime never delivers a call, and its model fakes the results', async () => {
  const INDEX = join(dirname(BRIDGE), 'index.mjs');
  const list = (env) => new Promise((resolve) => {
    const child = spawn(process.execPath, [INDEX], {
      env: { PATH: process.env.PATH, HOME: mkdtempSync(join(tmpdir(), 'lingxi-tools-')), LINGXI_AUTOSTART: '0', LINGXI_MCP_LOG: '0', ...env },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
      const line = out.split('\n').find((l) => l.includes('"id":1'));
      if (line) { child.kill(); resolve(JSON.parse(line).result.tools.length); }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
  });
  assert.equal(await list({ LINGXI_AGENT: 'doubao' }), 0);
  assert.ok(await list({ LINGXI_AGENT: 'doubao', LINGXI_DOUBAO_MCP: '1' }) >= 13, 'the override brings them back');
  assert.ok(await list({ LINGXI_AGENT: 'codex' }) >= 13, 'every other host keeps them');
});
