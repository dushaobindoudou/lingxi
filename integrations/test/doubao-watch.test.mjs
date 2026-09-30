// 豆包 has no hooks. bin/lingxi-doubao-watch reads 豆包's own log for the two lines it writes when
// a task starts and ends, and reports the turn the way a hook would. This drives the real script
// against a fake 豆包 log and a fake 灵犀 bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WATCH = fileURLToPath(new URL('../hosts/doubao/bin/lingxi-doubao-watch', import.meta.url));
const until = async (check, ms = 6000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) {
    if (check()) return true;
  }
  return false;
};
const logLine = (what, conversation) =>
  `[5206:1:0930/173037.797348:INFO:aha/saman/chrome/browser/module/exit_intercept/exit_intercept_service.cc(61)] ` +
  `[exit_intercept] ${what}. scope_id=local-task-conversation, intercept_id=7__rfh__1:${conversation}, priority=0\n`;

test('a 豆包 turn is reported as it starts, waits on the user, and ends - and nothing earlier is replayed', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lingxi-doubao-watch-'));
  const doubao = join(root, 'Doubao');
  const log = join(doubao, 'sdk_storage/log/saman_2026.0930.0.log');
  mkdirSync(join(doubao, 'sdk_storage/log'), { recursive: true });
  // Already in the log when the watcher starts: history, not news.
  writeFileSync(log, logLine('Register added blocker', '111'));
  const system = join(doubao, 'Default/.doubao/agent_mode/workspace/.sessions/222/agents/m_x/system');
  mkdirSync(system, { recursive: true });
  writeFileSync(join(system, 'assignment.md'), '## [2026-09-30T09:30:37Z] 需求\n你好\n## [2026-09-30T09:31:24Z] 需求\n@lingxi 帮我检查一下系统是否接入了 lingxi\n');
  writeFileSync(join(root, 'token'), 'x'.repeat(40));

  const events = [];
  const registrations = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url === '/task-event') events.push(JSON.parse(body));
      if (req.url === '/agents') registrations.push(JSON.parse(body));
      res.setHeader('Content-Type', 'application/json');
      res.end(req.url === '/health' ? '{"ok":true,"startedAt":42}' : '{"ok":true}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const state = join(root, 'state');
  const child = spawn('python3', [WATCH], {
    env: {
      // TMPDIR too: /usr/bin/python3 is the xcrun shim, which without its cache takes seconds to start.
      PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, HOME: root, LINGXI_DOUBAO_DIR: doubao, LINGXI_PORT: String(server.address().port),
      LINGXI_TOKEN_FILE: join(root, 'token'), LINGXI_DOUBAO_STATE: state, LINGXI_DOUBAO_WATCH_POLL: '0.05',
      LINGXI_DOUBAO_WATCH_DEBUG: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    // Whatever is in the log when the watcher starts is history; wait until it has started.
    assert.ok(await until(() => stderr.includes('watching'), 15000), `the watcher never started: ${stderr}`);
    appendFileSync(log, logLine('Register added blocker', '222'));
    assert.ok(await until(() => events.length >= 1), 'turn start never reported');
    assert.equal(events[0].taskId, '222', 'the line already in the log was replayed');
    assert.equal(events[0].state, 'running');
    assert.equal(events[0].origin, 'hook', 'a watcher event is the host speaking, not the model');
    assert.equal(events[0].session, '222');
    assert.equal(events[0].label, '帮我检查一下系统是否接入了 lingxi', 'the latest request names the bubble');
    assert.equal(readFileSync(join(state, 'active-conversation'), 'utf8'), '222');

    appendFileSync(log, '[x:INFO:CONSOLE(0)] [neotix] [agent-task] "{"event":"toolcall","data":{"agent_id":"a","name":"interaction.ask","sandbox_id":"s","seq":84,"status":"received"}}"\n');
    assert.ok(await until(() => events.length >= 2), 'a question to the user was not reported');
    assert.equal(events[1].state, 'needs_input');

    appendFileSync(log, logLine('Unregister blocker', '222'));
    assert.ok(await until(() => events.length >= 3), 'turn end never reported');
    assert.equal(events[2].state, 'completed');
    assert.ok(!existsSync(join(state, 'active-conversation')), 'the finished conversation is still marked active');
    // 豆包's face is registered once for this app instance, not on every event.
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].id, 'doubao');
  } finally {
    child.kill();
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
