import test from 'node:test';
import assert from 'node:assert/strict';
import { tools } from '../src/tools.mjs';
import { bridge } from '../src/bridge.mjs';

test('MCP task reports carry only the explicitly known host session', async () => {
  const task = tools.find((tool) => tool.name === 'lingxi_task');
  assert.equal(task.inputSchema.properties.session.maxLength, 128);
  const posted = [];
  const original = bridge.taskEvent;
  bridge.taskEvent = async (event) => { posted.push(event); return { recorded: true }; };
  try {
    const report = { state: 'completed', taskId: 'fix-login', summary: '登录测试已修复', agent: 'codex' };
    await task.run({ ...report, session: 'thread-a' });
    await task.run(report);
    assert.equal(posted[0].session, 'thread-a');
    assert.equal(posted[0].taskId, 'fix-login');
    assert.equal(posted[0].provider, 'codex');
    assert.equal(posted[1].session, undefined, 'unknown session must not be guessed from another conversation');
  } finally {
    bridge.taskEvent = original;
  }
});
