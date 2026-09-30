// What the user types stays with the user: no host mapping may forward prompt text to the cat.
// docs/09 - "不采集任务正文". Cursor's first mapping sent the raw prompt as the event summary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EMIT = fileURLToPath(new URL('../adapters/lingxi-emit.mjs', import.meta.url));
const SECRET = 'rotate the prod database password to hunter2';

async function emit(host, payload) {
  const bodies = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { bodies.push(body); res.end('{"ok":true}'); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const tokenFile = join(mkdtempSync(join(tmpdir(), 'lingxi-emit-')), 'token');
  writeFileSync(tokenFile, 'x'.repeat(40));
  const child = spawn(process.execPath, [EMIT, '--host', host], {
    env: { ...process.env, LINGXI_PORT: String(server.address().port), LINGXI_TOKEN_FILE: tokenFile },
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  child.stdin.end(JSON.stringify(payload));
  await new Promise((resolve) => child.on('exit', resolve));
  server.close();
  return bodies;
}

test('a Cursor prompt is reported as "a turn started", never as what was typed', async () => {
  const bodies = await emit('cursor', { hook_event_name: 'beforeSubmitPrompt', session_id: 's', prompt: SECRET });
  assert.equal(bodies.length, 1, 'the event should still be delivered');
  assert.ok(!bodies[0].includes('hunter2'), `prompt text leaked: ${bodies[0]}`);
  assert.match(bodies[0], /新一轮对话开始/);
});

test('neither does Claude\'s', async () => {
  const bodies = await emit('claude', { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: SECRET });
  for (const body of bodies) assert.ok(!body.includes('hunter2'), `prompt text leaked: ${body}`);
});

test('Codex turn end carries the result without displaying an id or directory', async () => {
  const bodies = await emit('codex', {
    type: 'agent-turn-complete', 'thread-id': 'abc123456', cwd: '/work/lingxi',
    'last-assistant-message': '登录测试修好了。接下来可以继续。',
  });
  assert.equal(bodies.length, 1);
  const event = JSON.parse(bodies[0]);
  assert.equal(event.summary, 'Codex 回复结束');
  assert.equal(event.session, 'abc123456');
  assert.equal(event.label, undefined);
  assert.match(event.result, /登录测试修好了/);
});

test('Codex turn end forwards the exact question for the cat to show', async () => {
  const bodies = await emit('codex', {
    type: 'agent-turn-complete', 'thread-id': 'thread',
    'last-assistant-message': '方案已整理。你希望周五上午还是下午提醒？',
  });
  const event = JSON.parse(bodies[0]);
  assert.match(event.result, /你希望周五上午还是下午提醒？/);
  assert.equal(event.label, undefined);
});
