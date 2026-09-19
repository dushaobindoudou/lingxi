// 验证 MCP 这条路径对 WorkBuddy 的归属是否完整。
//
// 为什么单独立一个探针：这条链路修过一次（agent / priority 没透传，所有反应都落成
// anonymous），而"修好了"和"看起来修好了"在这里是同一件事——除非有人真的读一遍
// GET /agents。归属出错的失败模式是静默的：猫仍然有反应，只是徽章不对。
//
// 它跑的是真实路径：启动 packages/mcp-server 的 stdio server，走 JSON-RPC 握手，
// 调用真实的工具，然后回读应用端的注册表。
//
//   node .workbuddy/probes/verify-workbuddy-mcp.mjs
//
// 需要灵犀在运行。会真的让猫反应一次（绿灯 + 摇旗）。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REPO = '/Users/dushaobin/workspace/dsh-lingxi';
const SERVER = join(REPO, 'packages/mcp-server/src/index.mjs');
const PORT = Number(process.env.LINGXI_PORT ?? 47811);
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN_FILE =
  process.env.LINGXI_TOKEN_FILE
  ?? join(homedir(), 'Library', 'Application Support', 'com.dushaobin.lingxi-desktop', 'bridge-token');

// 这份身份现在**不通过 mcp.json 的 env 传**，而是读 ~/.lingxi/agent.json —— 见下面「接入
// 闸门」。探针默认也不注入任何 LINGXI_AGENT_*，走的就是 WorkBuddy 真实的启动形态：一个只有
// command + args 的 server 配置，身份从机器级文件解析。
//
// （`LINGXI_AGENT` 优先级仍然高于文件，供单个宿主临时覆盖；那条支路只有 3 行 pick()，不在此
// 重复测——真正会静默坏掉的是文件那条。）
const PROFILE = {};

// ---------------------------------------------------------------- 接入闸门
//
// WorkBuddy 把第三方 MCP server 的授权按**配置哈希**记账。stdio 的哈希算法是：
//
//   sha256(`${command}|${sorted(args)}|${sorted(env 的 KEY 名字)}`)
//
// 注意最后一项是**键名**，不是值。所以往 env 里加一个键、改一个键名，都会换出一个新哈希，
// 存量的授权记录（~/.workbuddy/mcp-approvals.json 里的 `<hash>::lingxi`）就不再匹配，
// WorkBuddy 从而拒绝启动这个 server，它提供的 `mcp__lingxi__*` 工具在会话里凭空消失。
//
// 这个失败**在 server 内部完全不可见**：进程根本没被拉起来，所以 bridge.mjs 里任何一行日志
// 都不会执行，探针之外的任何自检也都跑不到。表象只是"猫突然不反应了"，看起来像桌宠坏了，
// 而不是配置坏了。2026-09-19 就是这么踩的一次：给 mcp.json 加了 4 个 LINGXI_AGENT_* 环境变量，
// 猫当场失去全部反应，排查绕了一大圈才发现根因在宿主侧的信任闸门。
//
// 所以这里显式复算哈希并对账，放在最前面——门都进不去，后面所有检查都没有意义。
// 顺带把"身份文件在不在"也一起验了：身份现在依赖它，它缺失同样会静默退化成 anonymous。
const MCP_JSON = join(homedir(), '.workbuddy', 'mcp.json');
const MCP_APPROVALS = join(homedir(), '.workbuddy', 'mcp-approvals.json');
const AGENT_FILE = join(homedir(), '.lingxi', 'agent.json');

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** 复刻 WorkBuddy `calculateConfigHash` 的 stdio 分支，一行都不能差。 */
function workbuddyConfigHash(entry) {
  const input = `${entry.command ?? ''}|`
    + `${(entry.args ?? []).map(String).sort().join(',')}|`
    + `${Object.keys(entry.env ?? {}).sort().join(',')}`;
  return createHash('sha256').update(input).digest('hex');
}

let failures = 0;
const check = (label, pass, detail = '') => {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!pass) failures += 1;
};

const token = readFileSync(TOKEN_FILE, 'utf8').trim();
const bridge = async (path, init) => {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  return response.json();
};

const agents = async () => (await bridge('/agents')).agents ?? [];

// ---------------------------------------------------------------- stdio 握手
// 手写而不是引入 SDK：这个 server 本身就是零依赖的，探针也该能直接跑。
function session(env) {
  const child = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message);
        pending.delete(message.id);
      }
    }
  });
  let nextId = 1;
  const send = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const notify = (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  return { send, notify, kill: () => child.kill() };
}

const { send, notify, kill } = session(PROFILE);
const call = async (name, args) => {
  const reply = await send('tools/call', { name, arguments: args ?? {} });
  const text = reply.result?.content?.[0]?.text ?? '';
  return { text, isError: reply.result?.isError === true, raw: reply.result };
};

try {
  await send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'verify', version: '1' } });
  notify('notifications/initialized');

  console.log('\n— 接入闸门（WorkBuddy）');
  const configured = readJson(MCP_JSON)?.mcpServers?.lingxi ?? null;
  if (!configured) {
    check('~/.workbuddy/mcp.json 里配了 lingxi', false, '没配 → WorkBuddy 会话里不会有 mcp__lingxi__* 工具');
  } else {
    const hash = workbuddyConfigHash(configured);
    const approvals = readJson(MCP_APPROVALS) ?? {};
    const approved = Object.prototype.hasOwnProperty.call(approvals, `${hash}::lingxi`);
    check('lingxi 的配置哈希已被信任', approved,
      approved ? hash.slice(0, 16) : `未信任 ${hash.slice(0, 16)} → 打开连接器管理页给 lingxi 点「信任」`);
    const envKeys = Object.keys(configured.env ?? {});
    check('mcp.json 里没有 env（哈希才稳定）', envKeys.length === 0,
      envKeys.length ? `有 ${envKeys.join(', ')} → 每次增删键都会让上面那条失效` : '身份走 ~/.lingxi/agent.json');
  }

  const fileAgent = readJson(AGENT_FILE);
  check('~/.lingxi/agent.json 存在且带 id', Boolean(fileAgent?.id),
    fileAgent?.id ? `${fileAgent.badge ?? ''} ${fileAgent.name ?? ''} (${fileAgent.id})`.trim() : `缺 ${AGENT_FILE}`);
  if (fileAgent?.id) {
    check('文件里的 id 是 workbuddy', fileAgent.id === 'workbuddy', `实际 ${fileAgent.id}`);
  }

  console.log('\n— 工具契约');
  const list = await send('tools/list', {});
  const tools = list.result.tools;
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  check('13 个工具', tools.length === 13, `实际 ${tools.length}`);
  check('lingxi_task 暴露 mood', 'mood' in (byName.lingxi_task?.inputSchema.properties ?? {}));
  check('lingxi_task 的 mood 是枚举', Array.isArray(byName.lingxi_task?.inputSchema.properties?.mood?.enum),
    `${byName.lingxi_task?.inputSchema.properties?.mood?.enum?.length ?? 0} 个取值`);
  for (const name of ['lingxi_say', 'lingxi_express', 'lingxi_play', 'lingxi_perform']) {
    check(`${name} 暴露 priority`, 'priority' in (byName[name]?.inputSchema.properties ?? {}));
  }

  console.log('\n— 归属');
  const before = Object.fromEntries((await agents()).map((a) => [a.id, a]));

  const express = await call('lingxi_express', { expression: '绿灯', action: 'wb-wave-flag', priority: 'report' });
  check('lingxi_express 成功', !express.isError && /Applied/.test(express.text), express.text);

  const after = await agents();
  const me = after.find((a) => a.id === 'workbuddy');

  console.log('\n— 注册表');
  for (const agent of after) {
    console.log(`    ${agent.id.padEnd(12)} ${agent.badge.padEnd(4)} ${agent.name.padEnd(12)} ${agent.color}  claims=${agent.claims}`);
  }

  check('workbuddy 已注册', Boolean(me));
  if (me) {
    check('徽章是 🐧', me.badge === '🐧', `实际 ${JSON.stringify(me.badge)}`);
    check('名称是 WorkBuddy', me.name === 'WorkBuddy', `实际 ${me.name}`);
    check('颜色是品牌色 #0AC89F', me.color.toUpperCase() === '#0AC89F', `实际 ${me.color}`);
    check('claims 递增（这次调用被记到它名下）', me.claims > (before.workbuddy?.claims ?? 0),
      `${before.workbuddy?.claims ?? 0} → ${me.claims}`);
  }
  // 真正的回归点：以前这次调用会新建/增加一个 anonymous 条目。
  const anonBefore = before.anonymous?.claims ?? 0;
  const anonAfter = after.find((a) => a.id === 'anonymous')?.claims ?? 0;
  check('没有落成 anonymous', anonAfter === anonBefore, `anonymous claims ${anonBefore} → ${anonAfter}`);

  console.log('\n— 事件上报（mood 端到端）');
  const task = await call('lingxi_task', {
    state: 'completed', kind: 'test', mood: 'weary', taskId: 'verify-mcp', summary: '验证 MCP 归属',
  });
  check('lingxi_task 接受 mood', !task.isError, task.text);
} finally {
  kill();
}

console.log(`\n${failures === 0 ? '全部通过' : `${failures} 项失败`}\n`);
process.exit(failures === 0 ? 0 : 1);
