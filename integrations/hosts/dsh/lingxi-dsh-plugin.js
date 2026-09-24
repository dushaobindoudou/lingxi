/*
 * 灵犀 · DSH（DeepSeek Harness）专用动态插件 · Cordis host half
 *
 * 本文件是 `cordis_define` 的 code.host 函数体：纯 JavaScript，无 import/require/TS/JSX，
 * 不假设任何 Node 全局（fetch/Buffer/process 被沙箱禁用——HTTP 走 shell 服务里的 curl，
 * 与 integrations/cli 和 hooks 用的是同一条 token -K 路径）。
 *
 * 能力：把灵犀桥接注册为 5 个 model Tools——lingxi_task / lingxi_say / lingxi_react /
 * lingxi_state / lingxi_remember——DSH 会话里的模型从此可以直接让桌上的猫有反应。
 * 身份固定为 `dsh`，启动时向桥接注册自己的徽标（POST /agents，幂等）。
 *
 * 生命周期：所有 Tool 注册挂在 ctx.effect 的 disposer 上，stop/update/undefine 全部可逆。
 */

const LINGXI_PORT = 47811;
const AGENT_ID = 'dsh';
const BUNDLE_ID = 'com.dushaobin.lingxi-desktop';
const STATES = ['queued', 'running', 'blocked', 'needs_input', 'needs_approval', 'completed', 'failed', 'cancelled'];
const KINDS = ['build', 'test', 'deploy', 'review', 'search', 'write', 'chat', 'other'];
const MOODS = ['focused', 'proud', 'tender', 'sad', 'frustrated', 'anxious', 'weary', 'playful', 'curious'];

/** 与 CLI/hooks 相同的取 token 方式：0600 文件 + curl -K 配置文件，token 不进 argv。 */
function bridgeCommand(method, path, withBody) {
  const parts = [
    'T=$(cat "$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bridge-token" 2>/dev/null)',
    'H=$(mktemp) || exit 9',
    'printf \'header = "Authorization: Bearer %s"\\n\' "$T" > "$H"',
    // `agent` in the body covers /control and /task-event; /memory and /reminders read the
    // tier off this header. Sending both means the two paths cannot disagree about who we are.
    "curl -s -m 3 -K \"$H\" -X " + method + " http://127.0.0.1:" + LINGXI_PORT + path +
      " -H 'Content-Type: application/json' -H 'X-Lingxi-Agent: " + AGENT_ID + "'",
  ];
  // 必须跟在同一段 curl 里：拼成独立语句会变成 `curl; --data-binary @-`，curl 发空 body。
  if (withBody) parts[parts.length - 1] += ' --data-binary @-';
  parts.push('rc=$?', 'rm -f "$H"', 'exit $rc');
  return parts.join('; ');
}

function shellService(ctx) {
  return ctx.get('shell') !== undefined ? ctx.get('shell') : ctx.get('bash');
}

/**
 * Start the app if the bridge is not answering, and wait for it.
 *
 * The bridge only exists while the app does, and until this the plugin's answer to a closed app
 * was "bridge unreachable - is the cat running?" - true, and not something a model can act on.
 * `open -g` does not steal focus. Opt out with LINGXI_AUTOSTART=0 in the host's environment.
 */
function startAppCommand() {
  return [
    '[ "${LINGXI_AUTOSTART:-1}" = "0" ] && exit 7',
    'curl -s -m 2 -o /dev/null http://127.0.0.1:' + LINGXI_PORT + '/health && exit 0',
    'open -g -b ' + BUNDLE_ID + ' 2>/dev/null || exit 8',
    'n=0; while [ $n -lt 150 ]; do',
    '  curl -s -m 2 -o /dev/null http://127.0.0.1:' + LINGXI_PORT + '/health && exit 0',
    '  sleep 0.1; n=$((n+1))',
    'done',
    'exit 9',
  ].join('; ');
}

const START_FAILURES = {
  7: 'the cat is not running and LINGXI_AUTOSTART=0 asked me not to start it',
  8: 'the cat is not running and 灵犀.app does not appear to be installed',
  9: 'the cat was asked to start but its bridge did not answer within 15s',
};

let startAttempted = false;

async function ensureAppRunning(ctx) {
  if (startAttempted) return null;
  startAttempted = true;
  const shell = shellService(ctx);
  if (shell === undefined) return null;
  try {
    const result = await shell.run(shell.resolve({ command: startAppCommand(), timeoutMs: 20000 }));
    const code = result ? result.exitCode : null;
    return code === 0 ? null : (START_FAILURES[code] || null);
  } catch (err) {
    return null; // the real call below will report the real failure
  }
}

async function callBridge(ctx, method, path, body, retried) {
  const shell = shellService(ctx);
  if (shell === undefined) return { ok: false, error: 'neither shell nor bash service is mounted in this host' };
  const request = { command: bridgeCommand(method, path, body !== undefined), timeoutMs: 6000, stdoutMaxBytes: 65536 };
  if (body !== undefined) request.stdin = JSON.stringify(body);
  let result;
  try {
    result = await shell.run(shell.resolve(request));
  } catch (err) {
    return { ok: false, error: 'shell.run failed: ' + String(err && err.message ? err.message : err) };
  }
  const text = result && result.stdout && typeof result.stdout.text === 'string' ? result.stdout.text : '';
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (err) { parsed = null; }
  if (parsed !== null && typeof parsed === 'object') return parsed;
  if (result && result.exitCode === 0) return { ok: true, raw: text.slice(0, 400) };
  // Nothing came back. Before reporting an unreachable bridge, try starting the app - once per
  // plugin instance - and run the same request again against it.
  const startError = await ensureAppRunning(ctx);
  if (startError === null && !retried) return callBridge(ctx, method, path, body, true);
  const errText = result && result.stderr && typeof result.stderr.text === 'string' ? result.stderr.text : '';
  return {
    ok: false,
    exitCode: result ? result.exitCode : null,
    error: (startError || errText || 'bridge unreachable - is the cat running?').slice(0, 300),
  };
}

function renderJson(args, value) {
  return [{ type: 'text', text: JSON.stringify(value) }];
}

async function ensureIdentity(ctx) {
  const result = await callBridge(ctx, 'POST', '/agents', {
    id: AGENT_ID, name: 'DSH Agent', badge: 'DS', color: '#4D6BFE',
  });
  return result && result.ok === true ? null : result;
}

function buildTools(ctx) {
  return [
    harness.defineTool({
      name: 'lingxi_task',
      description:
        '把你正在为用户做的任务报给桌宠猫灵犀。state 是流程（开始 running、等授权 needs_approval、' +
        '被挡 blocked、完成 completed、失败 failed、用户取消 cancelled）；mood 是只有你判断得了的' +
        '事情心情（写家书是 tender，和 flaky test 搏斗是 frustrated），猫回应的是心情而不是镜像状态。' +
        '每个任务开始时报告 running，结束时报告 completed/failed/cancelled；summary 必须说明具体做了什么或结果是什么，' +
        '尤其 completed 要写清完成的任务，不能只写“搞定”。同一任务始终复用 taskId，不要刷屏；' +
        'mood 只有确实能判断时才传，没有心情可报时省略也是正确的。',
      parameters: {
        type: 'object',
        properties: {
          state: { type: 'string', enum: STATES, description: '任务流程状态' },
          kind: { type: 'string', enum: KINDS, description: '任务种类，默认 other' },
          mood: { type: 'string', enum: MOODS, description: '这件事的心情——最有价值的字段' },
          summary: { type: 'string', maxLength: 140, description: '一句话概述（不超过 140 字，必须具体）' },
          taskId: { type: 'string', minLength: 1, description: '必填且稳定的任务标识；同一任务从开始到结束始终用同一个' },
          progress: { type: 'number', description: '0..1，用于长任务的过半提醒' },
        },
        required: ['state', 'taskId', 'summary'],
        additionalProperties: true,
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
      timeoutMs: 8000,
      execute: async function (args) {
        const identityError = await ensureIdentity(ctx);
        if (identityError) return identityError;
        return callBridge(ctx, 'POST', '/task-event', Object.assign({ provider: AGENT_ID, agent: AGENT_ID }, args));
      },
    }),
    harness.defineTool({
      name: 'lingxi_say',
      description:
        '让灵犀说一句话（建议 140 字以内）。适合轻量的陪伴反馈；长内容和任务进度不要走这里' +
        '（那是 lingxi_task 的职责），一个回合最多让猫动一两次。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '猫要说的话' },
        },
        required: ['text'],
        additionalProperties: true,
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
      timeoutMs: 8000,
      execute: async function (args) {
        const identityError = await ensureIdentity(ctx);
        if (identityError) return identityError;
        return callBridge(ctx, 'POST', '/control', { say: args.text, agent: AGENT_ID, priority: 'status' });
      },
    }),
    harness.defineTool({
      name: 'lingxi_react',
      description:
        '让灵犀做一个表情/动作（可选保持毫秒数）。名字必须真实存在——先 lingxi_state 看 ' +
        'capabilities，或者用 lingxi_react 之前确认 /integration 里的库；用户可以自定义动作名，' +
        '猜名字会被拒绝。适合庆祝、打招呼这类直接反应。',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: '表情名，必须来自现有表情库' },
          action: { type: 'string', description: '可选动作名，必须来自现有动作库' },
          holdMs: { type: 'integer', description: '表情保持毫秒数' },
        },
        required: ['expression'],
        additionalProperties: true,
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
      timeoutMs: 8000,
      execute: async function (args) {
        const identityError = await ensureIdentity(ctx);
        if (identityError) return identityError;
        return callBridge(ctx, 'POST', '/control', Object.assign({ agent: AGENT_ID }, args));
      },
    }),
    harness.defineTool({
      name: 'lingxi_state',
      description:
        '读取灵犀的当前状态：petState、表情、活动统计、可见的玩具，以及完整的表情/动作库。' +
        '用于决定怎么反应，也用于确认桥接是否可用。',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
      timeoutMs: 8000,
      execute: async function () {
        return callBridge(ctx, 'GET', '/perception');
      },
    }),
    harness.defineTool({
      name: 'lingxi_remember',
      description:
        '让灵犀持久地记住一条关于用户的事实（owner/project/preference/moment）。跨会话有效，' +
        '用户会在 app 里看到并可以删除。只记值得跨会话的事，不要当草稿纸用。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '要记住的事实，一句话' },
          kind: { type: 'string', enum: ['owner', 'project', 'preference', 'moment'], description: '记忆类型' },
        },
        required: ['text'],
        additionalProperties: true,
      },
      output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
      timeoutMs: 8000,
      execute: async function (args) {
        // Registering first, like every other tool here. A memory is a persistent write, so the
        // bridge checks this id's tier - and an id the registry has never seen (it is pure
        // in-memory, so every app restart empties it) falls to the default tier and is refused.
        const identityError = await ensureIdentity(ctx);
        if (identityError) return identityError;
        return callBridge(ctx, 'POST', '/memory', Object.assign({ agent: AGENT_ID }, args));
      },
    }),
  ];
}

return {
  apply(ctx) {
    // 身份注册 + 上线播报：幂等（POST /agents 按 id upsert），失败静默——桥接没起时
    // 工具调用会如实报错，这里不必抢先失败。
    ensureIdentity(ctx)
      .catch(function () {});
    const tools = buildTools(ctx);
    ctx.effect(function () {
      const unregisters = [];
      for (const tool of tools) unregisters.push(harness.registerTool(ctx, tool));
      return function () {
        for (const off of unregisters) off();
      };
    }, 'lingxi-bridge-tools');
  },
};
