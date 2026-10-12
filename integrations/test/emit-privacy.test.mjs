// What the user types stays with the user: no host mapping may forward prompt text to the cat.
// docs/09 - "不采集任务正文". Cursor's first mapping sent the raw prompt as the event summary.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EMIT = fileURLToPath(new URL('../adapters/lingxi-emit.mjs', import.meta.url));
const SECRET = 'rotate the prod database password to hunter2';

async function emit(host, payload, { args = [], env = {} } = {}) {
  const bodies = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => { bodies.push(body); res.end('{"ok":true}'); });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const tokenFile = join(mkdtempSync(join(tmpdir(), 'lingxi-emit-')), 'token');
  writeFileSync(tokenFile, 'x'.repeat(40));
  const child = spawn(process.execPath, [EMIT, '--host', host, ...args], {
    env: { ...process.env, LINGXI_PORT: String(server.address().port), LINGXI_TOKEN_FILE: tokenFile, ...env },
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  child.stdin.end(JSON.stringify(payload));
  await new Promise((resolve) => child.on('exit', resolve));
  server.close();
  rmSync(join(tokenFile, '..'), { recursive: true, force: true });
  return bodies;
}

test('a Cursor prompt is reported as "a turn started", never as what was typed', async () => {
  const bodies = await emit('cursor', { hook_event_name: 'beforeSubmitPrompt', session_id: 's', prompt: SECRET });
  assert.equal(bodies.length, 1, 'the event should still be delivered');
  assert.ok(!bodies[0].includes('hunter2'), `prompt text leaked: ${bodies[0]}`);
  assert.match(bodies[0], /新一轮对话开始/);
  assert.equal(JSON.parse(bodies[0]).session, 's', 'parallel Cursor conversations must keep separate activity rows');
});

test('Cursor final responses carry text from afterAgentResponse instead of the content-free stop hook', async () => {
  const bodies = await emit('cursor', { hook_event_name: 'afterAgentResponse', conversation_id: 'cursor', text: '登录检查修好了。要发布吗？' });
  assert.equal(bodies.length, 1);
  const event = JSON.parse(bodies[0]);
  assert.equal(event.state, 'completed');
  assert.equal(event.origin, 'hook');
  assert.equal(event.result, '登录检查修好了。要发布吗？');
  assert.equal(event.session, 'cursor');
  assert.ok(!event.summary.includes('登录检查'));
  assert.equal((await emit('cursor', { hook_event_name: 'stop', conversation_id: 'cursor', status: 'completed', response_hook_enabled: true })).length, 0,
    'the later empty stop must not erase needs_input derived from the reply');
  const failure = JSON.parse((await emit('cursor', { hook_event_name: 'stop', conversation_id: 'cursor', status: 'error', response_hook_enabled: true }))[0]);
  assert.equal(failure.state, 'failed');
});

test('neither does Claude\'s', async () => {
  const bodies = await emit('claude', { hook_event_name: 'UserPromptSubmit', session_id: 's', prompt: SECRET });
  for (const body of bodies) assert.ok(!body.includes('hunter2'), `prompt text leaked: ${body}`);
});

test('WorkBuddy Stop without reply text still delivers an audible, observable fallback', async () => {
  const bodies = await emit('workbuddy', { hook_event_name: 'Stop', session_id: 'wb' });
  assert.equal(bodies.length, 1, 'WorkBuddy turn end must reach the app');
  const event = JSON.parse(bodies[0]);
  assert.equal(event.origin, 'hook');
  assert.equal(event.state, 'completed');
  assert.equal(event.session, 'wb');
  assert.equal(event.result, '这一轮结束了');
  assert.match(event.summary, /无可用回复文本/);
});

test('WorkBuddy permission dialog without Claude tool fields must reach the cat', async () => {
  const bodies = await emit('workbuddy', { hook_event_name: 'PermissionRequest', session_id: 'wb' });
  assert.equal(bodies.length, 1);
  const event = JSON.parse(bodies[0]);
  assert.equal(event.state, 'needs_approval');
  assert.ok(event.result);
});

test('WorkBuddy uses the installed event and identity even with missing event and another machine identity', async () => {
  const home = mkdtempSync(join(tmpdir(), 'lingxi-wb-identity-'));
  try {
    mkdirSync(join(home, '.lingxi'));
    writeFileSync(join(home, '.lingxi', 'agent.json'), JSON.stringify({ id: 'claude' }));
    const bodies = await emit('workbuddy', { session_id: 'wb', prompt: SECRET }, {
      args: ['--event', 'UserPromptSubmit'], env: { HOME: home, LINGXI_AGENT: '' },
    });
    const event = JSON.parse(bodies[0]);
    assert.equal(event.provider, 'workbuddy');
    assert.equal(event.agent, 'workbuddy');
    assert.equal(event.state, 'running');
    assert.equal(event.result, undefined);
    assert.ok(!bodies[0].includes(SECRET));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('WorkBuddy plugin steps aside per event only when settings already delivers the new mapping', async () => {
  const home = mkdtempSync(join(tmpdir(), 'lingxi-wb-duplicate-'));
  try {
    mkdirSync(join(home, '.workbuddy'));
    const settings = join(home, '.workbuddy/settings.json');
    const opts = { args: ['--event', 'Stop', '--skip-if-installed'], env: { HOME: home, LINGXI_AGENT: '' } };
    writeFileSync(settings, JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node lingxi-emit.mjs --host workbuddy --event Stop' }] }] } }));
    assert.equal((await emit('workbuddy', { session_id: 'wb' }, opts)).length, 0);
    writeFileSync(settings, JSON.stringify({ hooks: { Stop: [{ hooks: [{ command: 'node lingxi-emit.mjs --host claude' }] }] } }));
    assert.equal((await emit('workbuddy', { session_id: 'wb' }, opts)).length, 1, 'legacy silent hooks must not disable the plugin');
    writeFileSync(settings, '{}');
    assert.equal((await emit('workbuddy', { session_id: 'wb' }, opts)).length, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('WorkBuddy Stop reads only final native output_text from its transcript', async () => {
  const home = mkdtempSync(join(tmpdir(), 'lingxi-wb-transcript-'));
  const path = join(home, 'turn.jsonl');
  const final = { type: 'message', role: 'assistant', status: 'completed', sessionId: 'wb',
    providerData: { conversationRequestId: 'generation' },
    content: [{ type: 'output_text', text: '通知适配已修复。要现在发布吗？' }, { type: 'reasoning', text: SECRET }] };
  const stop = { hook_event_name: 'Stop', session_id: 'wb', generation_id: 'generation', transcript_path: path };
  try {
    writeFileSync(path, [
      { type: 'message', role: 'user', sessionId: 'wb', content: [{ type: 'input_text', text: SECRET }] },
      { type: 'function_call_result', sessionId: 'wb', output: SECRET }, final,
    ].map(JSON.stringify).join('\n') + '\n');
    const event = JSON.parse((await emit('workbuddy', stop))[0]);
    assert.equal(event.result, '通知适配已修复。要现在发布吗？');
    assert.ok(!JSON.stringify(event).includes(SECRET));
    assert.ok(!event.summary.includes('通知适配已修复'), 'reply content must stay out of persisted summaries');
    assert.equal(event.session, 'wb');
    for (const extra of [
      { ...final, status: 'in_progress' },
      { ...final, providerData: { conversationRequestId: 'old-generation' } },
      { type: 'message', role: 'user', sessionId: 'wb', content: [{ type: 'input_text', text: SECRET }] },
    ]) {
      writeFileSync(path, [final, extra].map(JSON.stringify).join('\n') + '\n');
      const degraded = JSON.parse((await emit('workbuddy', stop))[0]);
      assert.equal(degraded.result, '这一轮结束了', 'must not repeat an old or incomplete reply');
    }
    const unavailable = JSON.parse((await emit('workbuddy', { ...stop, transcript_path: join(home, 'missing.jsonl') }))[0]);
    assert.equal(unavailable.result, '这一轮结束了');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('WorkBuddy direct reply, waiting notifications, questions and failures survive optional fields', async () => {
  for (const [payload, state, result] of [
    [{ hook_event_name: 'Stop', last_assistant_message: '修好了' }, 'completed', '修好了'],
    [{ hook_event_name: 'Notification' }, 'needs_input', 'WorkBuddy 有问题等你回答，请查看会话'],
    [{ hook_event_name: 'Notification', notification_type: 'permission_prompt' }, 'needs_approval', 'WorkBuddy 需要你确认，请查看会话中的请求'],
    [{ hook_event_name: 'PermissionRequest', tool_input: { questions: [{ question: '上午还是下午？' }] } }, 'needs_input', '上午还是下午？'],
    [{ hook_event_name: 'StopFailure' }, 'failed', '这一轮出错了，请查看 WorkBuddy 会话中的错误详情'],
  ]) {
    const event = JSON.parse((await emit('workbuddy', { ...payload, session_id: 'wb' }))[0]);
    assert.equal(event.state, state);
    assert.equal(event.result, result);
    assert.equal(event.origin, 'hook');
  }
  assert.equal((await emit('workbuddy', { hook_event_name: 'Notification', notification_type: 'auth_success' })).length, 0);
});

test('hook notification preserves echo semantics and the actual tool request', async () => {
  const bodies = await emit('claude', {
    hook_event_name: 'Notification', session_id: 's', notification_type: 'permission_prompt',
    message: 'CodeBuddy needs your permission to use Bash',
  });
  const event = JSON.parse(bodies[0]);
  assert.equal(event.origin, 'hook');
  assert.equal(event.echo, true);
  assert.equal(event.session, 's');
  assert.equal(event.state, 'needs_approval');
  assert.equal(event.result, '想用 Bash，等你批一下');
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

// Codex names each new task in a throwaway thread of its own, and that thread's end fires
// `notify` too. The cat used to say "Codex 回复结束" for it and read the title - JSON, in one
// version of the prompt - out loud. Mirrors lib.rs's is_codex_title_turn.
test('Codex naming a task is not a turn: nothing is sent, in either version of the prompt', async () => {
  const json = await emit('codex', {
    type: 'agent-turn-complete', 'thread-id': 'title-thread',
    'input-messages': ['You are a helpful assistant. You will be presented with a user prompt, and your job is to provide a short title for a task that will be created from that prompt.'],
    'last-assistant-message': '{"title":"修复猫的气泡","description":"lingxi codex notify"}',
  });
  assert.equal(json.length, 0, `a title turn was reported: ${json[0]}`);
  const plain = await emit('codex', {
    type: 'agent-turn-complete', 'thread-id': 'title-thread-2',
    'input-messages': ['Generate a concise, single-line task title of at most 36 characters. Do not answer the request.\n\nUser prompt:\n修一下气泡'],
    'last-assistant-message': '修复气泡显示',
  });
  assert.equal(plain.length, 0, `a plain-text title turn was reported: ${plain[0]}`);
  const jsonOnly = await emit('codex', { type: 'agent-turn-complete', 'thread-id': 't', 'last-assistant-message': '{"title": "x"}' });
  assert.equal(jsonOnly.length, 0);
});

test('a user asking Codex for a title of their own is still a turn', async () => {
  const bodies = await emit('codex', {
    type: 'agent-turn-complete', 'thread-id': 'real',
    'input-messages': ['Generate a title for my blog post about cats'],
    'last-assistant-message': '可以叫「猫的一天」。',
  });
  assert.equal(bodies.length, 1);
  assert.match(JSON.parse(bodies[0]).result, /猫的一天/);
});
