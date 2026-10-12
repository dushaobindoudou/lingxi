import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = fileURLToPath(new URL('../hosts/cursor/', import.meta.url));

test('Cursor installs response hooks, preserves other hooks and survives reinstall', async () => {
  const home = mkdtempSync(join(tmpdir(), 'lingxi-cursor-'));
  const dir = join(home, '.cursor');
  mkdirSync(dir);
  writeFileSync(join(dir, 'hooks.json'), JSON.stringify({ version: 1, hooks: { stop: [{ command: 'echo mine' }] } }));
  const env = { ...process.env, HOME: home, LINGXI_CURSOR_DIR: dir, LINGXI_AUTOSTART: '0', LINGXI_AUTOINSTALL: '0' };
  const install = (...args) => {
    const r = spawnSync('bash', [join(HOST, 'install.sh'), ...args], { env, encoding: 'utf8', timeout: 15000 });
    assert.equal(r.status, 0, r.stderr + r.stdout);
  };
  try {
    install();
    const first = readFileSync(join(dir, 'hooks.json'), 'utf8');
    const hooks = JSON.parse(first).hooks;
    assert.ok(hooks.afterAgentResponse[0].command.endsWith('afterAgentResponse'));
    assert.ok(hooks.stop[1].command.endsWith('stop --response-hook'));
    assert.equal(hooks.stop[0].command, 'echo mine');
    install();
    assert.equal(readFileSync(join(dir, 'hooks.json'), 'utf8'), first);
    install('--uninstall');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'hooks.json'), 'utf8')).hooks, { stop: [{ command: 'echo mine' }] });
    install();
    assert.equal(readFileSync(join(dir, 'hooks.json'), 'utf8'), first);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('Cursor wrapper returns valid stdout and sends large responses over stdin without erasing a question', async () => {
  const home = mkdtempSync(join(tmpdir(), 'lingxi-cursor-hook-'));
  const token = join(home, 'token');
  writeFileSync(token, 'x'.repeat(40));
  const events = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { events.push(JSON.parse(body)); res.end('{"ok":true}'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const env = { ...process.env, HOME: home, PATH: '/usr/bin:/bin', LINGXI_NODE: process.execPath,
    LINGXI_PORT: String(server.address().port), LINGXI_TOKEN_FILE: token };
  async function hook(event, payload, ...args) {
    const child = spawn('sh', [join(HOST, 'lingxi-cursor.sh'), event, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stdin.end(JSON.stringify({ conversation_id: 'cursor-smoke', ...payload }));
    await new Promise((r) => child.on('close', r));
    assert.deepEqual(JSON.parse(stdout), event === 'beforeSubmitPrompt' ? { continue: true } : {});
  }
  const until = async (count) => {
    for (const end = Date.now() + 5000; Date.now() < end; await new Promise((r) => setTimeout(r, 30))) {
      if (events.length >= count) return;
    }
    assert.fail(`only ${events.length} of ${count} events delivered`);
  };
  try {
    await hook('beforeSubmitPrompt', { prompt: '用户正文不能转发' });
    await until(1);
    assert.ok(!JSON.stringify(events[0]).includes('用户正文不能转发'));
    await hook('afterAgentResponse', { text: '修好了。\n' + 'x'.repeat(200000) + '\n要发布吗？' });
    await until(2);
    assert.match(events[1].result, /修好了/);
    assert.ok(events[1].result.endsWith('要发布吗？'), 'long replies must retain the closing question');
    await hook('stop', { status: 'completed' }, '--response-hook');
    await hook('stop', { status: 'error' }, '--response-hook');
    await until(3);
    assert.equal(events[2].state, 'failed', 'empty completed stop must not replace the response or its question');
  } finally {
    server.closeAllConnections();
    server.close();
    rmSync(home, { recursive: true, force: true });
  }
});
