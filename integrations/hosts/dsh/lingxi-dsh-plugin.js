/*
 * 灵犀 · DSH（DeepSeek Harness）专用动态插件 · Cordis host half
 *
 * 本文件是 `cordis_define` 的 code.host 函数体：纯 JavaScript，无 import/require/TS/JSX，
 * 不假设任何 Node 全局（fetch/Buffer/process 被沙箱禁用——HTTP 走 shell 服务里的 curl，
 * 与 integrations/cli 和 hooks 用的是同一条 token -K 路径）。
 *
 * 能力：把灵犀桥接注册为与 MCP 相同的 13 个 model Tools。身份固定为 `dsh`，
 * 启动时向桥接注册自己的徽标（POST /agents，幂等）。应用没装时，在自动安装未关闭的
 * 情况下，后台走和其他宿主相同的安装器从 GitHub 下载最新版。
 *
 * 生命周期：所有 Tool 注册挂在 ctx.effect 的 disposer 上，stop/update/undefine 全部可逆。
 */

const LINGXI_PORT = 47811;
const AGENT_ID = 'dsh';
const BUNDLE_ID = 'com.dushaobin.lingxi-desktop';
const RELEASES_URL = 'https://github.com/dushaobindoudou/lingxi/releases/latest';
const STATES = ['queued', 'running', 'blocked', 'needs_input', 'needs_approval', 'completed', 'failed', 'cancelled'];
const KINDS = ['build', 'test', 'deploy', 'review', 'search', 'write', 'chat', 'other'];
const MOODS = ['focused', 'proud', 'tender', 'sad', 'frustrated', 'anxious', 'weary', 'playful', 'curious'];
const PRIORITIES = ['ambient', 'status', 'report', 'alert'];
const TOYS = ['yarn', 'feather', 'laser', 'petting', 'none'];

/** 与 CLI/hooks 相同的取 token 方式：0600 文件 + curl -K 配置文件，token 不进 argv。 */
function bridgeCommand(method, path, withBody) {
  const parts = [
    'T=$(cat "$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bridge-token" 2>/dev/null)',
    'H=$(mktemp) || exit 9',
    'printf \'header = "Authorization: Bearer %s"\\n\' "$T" > "$H"',
    // `agent` in the body covers /control and /task-event; /memory and /reminders read the
    // tier off this header. Sending both means the two paths cannot disagree about who we are.
    // --noproxy: curl hands even 127.0.0.1 to an exported http_proxy, and a local proxy answers
    // with a 502 page - which would come back here looking like a reply.
    "curl -s -m 3 --noproxy '*' -K \"$H\" -X " + method + " http://127.0.0.1:" + LINGXI_PORT + path +
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
 * Bridge down: open an installed app, or start the shared installer in the background.
 *
 * Exit codes: 0 bridge is up, 7 autostart refused, 8 autoinstall refused, 9 opened but the
 * bridge stayed quiet, 11 a download is in progress (or was just started), 12 nothing could
 * start a download. A download must not hold the tool call — install-app.sh is the same
 * verifier every other host uses (SHA256, bundle id, signature).
 */
function ensureAppCommand() {
  return [
    'mkdir -p "$HOME/.lingxi/dsh"',
    'HEALTH="http://127.0.0.1:' + LINGXI_PORT + '/health"',
    "curl -s -m 2 --noproxy '*' -o /dev/null \"$HEALTH\" && exit 0",
    'case "${LINGXI_AUTOSTART:-1}" in 0|false|no|off) exit 7 ;; esac',
    'app_path() {',
    '  if [ -n "${LINGXI_APP_PATH:-}" ]; then',
    '    if [ -d "$LINGXI_APP_PATH" ]; then printf "%s" "$LINGXI_APP_PATH"; fi',
    '    return 0',
    '  fi',
    '  # Set LINGXI_APP_DIRS (even empty) to replace the default locations. Tests use that',
    '  # so a copy already in /Applications is not treated as installed.',
    '  if [ -n "${LINGXI_APP_DIRS+x}" ]; then',
    '    oldifs="$IFS"; IFS=":"',
    '    for c in $LINGXI_APP_DIRS; do',
    '      if [ -n "$c" ] && [ -d "$c" ]; then printf "%s" "$c"; IFS="$oldifs"; return 0; fi',
    '    done',
    '    IFS="$oldifs"; return 0',
    '  fi',
    '  for c in "/Applications/灵犀.app" "$HOME/Applications/灵犀.app" "/Applications/lingxi.app"; do',
    '    if [ -d "$c" ]; then printf "%s" "$c"; return 0; fi',
    '  done',
    '  if ! command -v mdfind >/dev/null 2>&1; then return 0; fi',
    '  mdfind "kMDItemCFBundleIdentifier == \'' + BUNDLE_ID + '\'" > "$HOME/.lingxi/dsh/mdfind.out" 2>/dev/null || true',
    '  while IFS= read -r candidate; do',
    '    case "$candidate" in',
    '      /Volumes/*|*/target/*|*/.Trash/*|*/node_modules/*|"") continue ;;',
    '    esac',
    '    if [ -d "$candidate" ]; then printf "%s" "$candidate"; return 0; fi',
    '  done < "$HOME/.lingxi/dsh/mdfind.out"',
    '  return 0',
    '}',
    'APP="$(app_path)"',
    'if [ -n "$APP" ]; then',
    '  STAMP="$HOME/.lingxi/dsh/last-open"',
    '  if [ -f "$STAMP" ] && [ -z "$(find "$STAMP" -mmin +1 2>/dev/null)" ]; then exit 9; fi',
    '  touch "$STAMP"',
    '  open -g "$APP" 2>/dev/null || open -g -b ' + BUNDLE_ID + ' 2>/dev/null || exit 9',
    '  n=0; limit="${LINGXI_BOOT_TRIES:-150}"',
    '  while [ "$n" -lt "$limit" ]; do',
    "    curl -s -m 2 --noproxy '*' -o /dev/null \"$HEALTH\" && exit 0",
    '    sleep 0.1; n=$((n+1))',
    '  done',
    '  exit 9',
    'fi',
    'case "${LINGXI_AUTOINSTALL:-1}" in 0|false|no|off) exit 8 ;; esac',
    'LOCK="${LINGXI_INSTALL_LOCK:-$HOME/.lingxi/install.lock}"',
    'if [ -d "$LOCK" ]; then',
    '  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +15 2>/dev/null)" ]; then rm -rf "$LOCK"',
    '  else exit 11; fi',
    'fi',
    'LOG="$HOME/.lingxi/dsh/install.log"',
    'detach() {',
    '  log="$1"; shift',
    '  if command -v perl >/dev/null 2>&1; then',
    '    perl -MPOSIX=setsid -e \'fork() and exit 0; setsid(); open STDIN, "</dev/null"; open STDOUT, ">>", shift; open STDERR, ">&STDOUT"; exec @ARGV or die $!\' "$log" "$@"',
    '    return 0',
    '  fi',
    '  nohup "$@" >>"$log" 2>&1 &',
    '  return 0',
    '}',
    'installer_path() {',
    '  if [ -n "${LINGXI_INSTALLER:-}" ] && [ -f "$LINGXI_INSTALLER" ]; then printf "%s" "$LINGXI_INSTALLER"; return 0; fi',
    '  cli="$(command -v lingxi 2>/dev/null || true)"',
    '  if [ -n "$cli" ]; then',
    '    dir="$(cd "$(dirname "$cli")" && pwd)"',
    '    for candidate in "$dir/install-app.sh" "$dir/../scripts/install-app.sh" "$dir/../shared/install-app.sh"; do',
    '      if [ -f "$candidate" ]; then printf "%s" "$candidate"; return 0; fi',
    '    done',
    '  fi',
    '  return 0',
    '}',
    'INS="$(installer_path)"',
    'if [ -n "$INS" ]; then',
    '  detach "$LOG" env LINGXI_HOST=dsh LINGXI_AGENT=dsh bash "$INS" --open',
    '  exit 11',
    'fi',
    'if command -v npx >/dev/null 2>&1; then',
    '  detach "$LOG" env LINGXI_HOST=dsh LINGXI_AGENT=dsh npx -y --package lingxi-mcp lingxi up',
    '  exit 11',
    'fi',
    'DIR="$HOME/.lingxi/dsh/installer"',
    'mkdir -p "$DIR"',
    'BASE="https://raw.githubusercontent.com/${LINGXI_RELEASE_REPO:-dushaobindoudou/lingxi}/main/integrations/shared"',
    'curl -fsSL -m 20 -o "$DIR/lib.sh" "$BASE/lib.sh" || exit 12',
    'curl -fsSL -m 20 -o "$DIR/install-app.sh" "$BASE/install-app.sh" || exit 12',
    'chmod +x "$DIR/install-app.sh"',
    'detach "$LOG" env LINGXI_HOST=dsh LINGXI_AGENT=dsh bash "$DIR/install-app.sh" --open',
    'exit 11',
  ].join('\n');
}

const START_FAILURES = {
  7: '灵犀没在运行，且 LINGXI_AUTOSTART=0，所以没有启动它。需要的话请手动打开。',
  8: '这台 Mac 上没有灵犀，且 LINGXI_AUTOINSTALL=0，所以没有下载。请从 ' + RELEASES_URL + ' 安装，或关掉这个开关。',
  9: '已经尝试打开灵犀，但 15 秒内桥接没有应答。可能在等系统权限，或 47811 端口被占用。',
  11: '灵犀还没安装，已开始从 GitHub 后台下载（约 16 MB）。装好会自己打开；大约一分钟后再试。进度在 ~/.lingxi/dsh/install.log。',
  12: '灵犀还没安装，自动下载也没能开始。请从 ' + RELEASES_URL + ' 手动安装。',
};

let gaveUp = null;

async function ensureAppRunning(ctx) {
  if (gaveUp) return gaveUp;
  const shell = shellService(ctx);
  if (shell === undefined) return null;
  let result;
  try {
    result = await shell.run(shell.resolve({ command: ensureAppCommand(), timeoutMs: 22000 }));
  } catch (err) {
    return null;
  }
  const code = result ? result.exitCode : null;
  if (code === 0 || code === null) return null;
  const message = START_FAILURES[code] || null;
  if (code === 7 || code === 8 || code === 12) gaveUp = message;
  return message;
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
  // Nothing came back. Before reporting an unreachable bridge, open the app or start
  // installing it, then run the same request again.
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

function bridgeFailed(result) {
  return !result || result.ok === false;
}

async function ensureIdentity(ctx) {
  const result = await callBridge(ctx, 'POST', '/agents', {
    id: AGENT_ID, name: 'DSH Agent', badge: 'DS', color: '#4D6BFE',
  });
  return result && result.ok === true ? null : result;
}

async function withIdentity(ctx, fn) {
  const identityError = await ensureIdentity(ctx);
  if (identityError) return identityError;
  return fn();
}

function tool(spec) {
  return harness.defineTool({
    output: { schema: { type: 'object', additionalProperties: true }, render: renderJson },
    timeoutMs: 25000,
    parameters: spec.parameters || { type: 'object', properties: {} },
    name: spec.name,
    description: spec.description,
    execute: spec.execute,
  });
}

function summariseCapabilities(caps) {
  function rows(list, pick) {
    if (!list || !list.map) return [];
    return list.map(pick);
  }
  return {
    actions: rows(caps.actions, function (a) {
      return { id: a.id, name: a.name, category: a.category, duration: a.duration, source: a.source };
    }),
    expressions: caps.expressions || [],
    assets: caps.assets || null,
    performances: rows(caps.performances, function (p) {
      return { id: p.id, name: p.name, description: p.description };
    }),
    toys: caps.toys || [],
    cameras: rows(caps.cameras, function (c) { return c && c.id ? c.id : c; }),
    skins: rows(caps.skins, function (s) { return { id: s.id, name: s.name, source: s.source }; }),
    autoEffects: caps.autoEffects || null,
  };
}

function priorityOf(args, fallback) {
  return args && PRIORITIES.indexOf(args.priority) >= 0 ? args.priority : fallback;
}

function buildTools(ctx) {
  return [
    tool({
      name: 'lingxi_capabilities',
      description:
        '列出这只猫当前能做的全部动作、表情、主题、视角、玩具和全屏特效。先调这个，再用它返回的 id。' +
        '资源库用户可改，写死名字会被拒绝。autoEffects 表示自动特效是否开启、还要冷却多久。',
      execute: async function () {
        const caps = await callBridge(ctx, 'GET', '/capabilities');
        if (bridgeFailed(caps)) return caps;
        return summariseCapabilities(caps);
      },
    }),
    tool({
      name: 'lingxi_state',
      description:
        '读灵犀现在在做什么：在不在走路、有没有玩具、是不是正被拖着。放全屏特效或打断之前先看一眼。' +
        '不要用它代替任务报告。',
      execute: async function () {
        const status = await callBridge(ctx, 'GET', '/status');
        if (bridgeFailed(status)) return status;
        const perception = await callBridge(ctx, 'GET', '/perception');
        if (bridgeFailed(perception)) return perception;
        return { status: status, perception: perception };
      },
    }),
    tool({
      name: 'lingxi_say',
      description:
        '让灵犀在头顶气泡说一句话。这是猫在说话：短、第一人称。任务进度和结果走 lingxi_task，不要堆在这里。建议 140 字以内。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '猫要说的话' },
          seconds: { type: 'number', description: '停留秒数，不传则按长度估计' },
          priority: { type: 'string', enum: PRIORITIES },
        },
        required: ['text'],
        additionalProperties: true,
      },
      execute: async function (args) {
        return withIdentity(ctx, function () {
          const body = { say: args.text, agent: AGENT_ID, priority: priorityOf(args, 'status') };
          if (args.seconds) body.sayMs = Math.round(args.seconds * 1000);
          return callBridge(ctx, 'POST', '/control', body);
        });
      },
    }),
    tool({
      name: 'lingxi_express',
      description:
        '直接设一个表情或播一个动作片段。名字必须来自 lingxi_capabilities。任务结果优先用 lingxi_task，让猫自己选反应；这个工具只用于打招呼、庆祝这类直接表演。以前的名字是 lingxi_react。',
      parameters: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: '表情名' },
          action: { type: 'string', description: '动作 id' },
          holdMs: { type: 'integer', description: '表情保持毫秒数' },
          seconds: { type: 'number', description: '表情保持秒数，holdMs 优先' },
          priority: { type: 'string', enum: PRIORITIES },
        },
        additionalProperties: true,
      },
      execute: async function (args) {
        if (!args.expression && !args.action) return { ok: false, error: 'Give an expression, an action, or both.' };
        return withIdentity(ctx, function () {
          const body = { agent: AGENT_ID, priority: priorityOf(args, 'status') };
          if (args.expression) {
            body.expression = args.expression;
            body.holdMs = args.holdMs || (args.seconds ? Math.round(args.seconds * 1000) : 4000);
          }
          if (args.action) body.action = args.action;
          return callBridge(ctx, 'POST', '/control', body);
        });
      },
    }),
    tool({
      name: 'lingxi_perform',
      description:
        '播放一个全屏特效，id 来自 lingxi_capabilities 的 performances。automatic 默认 true：只有设置里自动特效已开启且冷却结束才播，否则跳过，不要重试，也不要替用户打开开关。用户明确点名要看某一个时才传 automatic=false。失败、等待授权不要用特效播。',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '特效 id' },
          automatic: { type: 'boolean', description: 'true 为自行选择的惊喜；用户明确要求时才 false' },
          priority: { type: 'string', enum: PRIORITIES },
        },
        required: ['id'],
        additionalProperties: true,
      },
      execute: async function (args) {
        const caps = await callBridge(ctx, 'GET', '/capabilities');
        if (bridgeFailed(caps)) return caps;
        const policy = caps.autoEffects;
        const automatic = args.automatic !== false;
        if (automatic && (!policy || policy.enabled !== true)) {
          return { ok: true, skipped: true, summary: '自动特效没开或这版应用不支持，已跳过。不要替用户打开开关。' };
        }
        if (automatic && policy.remainingCooldownMs > 0) {
          return { ok: true, skipped: true, summary: '自动特效还在冷却，这次跳过，不要重试。' };
        }
        return withIdentity(ctx, function () {
          const body = {
            perform: args.id,
            agent: AGENT_ID,
            priority: priorityOf(args, automatic ? 'ambient' : 'report'),
          };
          if (policy) body.performAutomatic = automatic;
          return callBridge(ctx, 'POST', '/control', body);
        });
      },
    }),
    tool({
      name: 'lingxi_play',
      description:
        '放下或收走玩具。yarn 毛线球、feather 逗猫棒、laser 激光笔、petting 撸猫、none 收走。适合用户明显累了的时候，一天最多一次，而且用户正在拖猫或已经在玩时不要抢。',
      parameters: {
        type: 'object',
        properties: {
          toy: { type: 'string', enum: TOYS },
          priority: { type: 'string', enum: PRIORITIES },
        },
        required: ['toy'],
        additionalProperties: true,
      },
      execute: async function (args) {
        return withIdentity(ctx, function () {
          return callBridge(ctx, 'POST', '/control', {
            toy: args.toy, agent: AGENT_ID, priority: priorityOf(args, 'status'),
          });
        });
      },
    }),
    tool({
      name: 'lingxi_remember',
      description:
        '持久记住一条关于用户的事实（owner 他是谁 / project 在做什么 / preference 怎么做事 / moment 发生过的事）。会写成用户能打开的明文 JSON。不记密码、密钥、他人隐私、健康和财务。一小时一条已经算多。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '一句话事实' },
          kind: { type: 'string', enum: ['owner', 'project', 'preference', 'moment'] },
        },
        required: ['text'],
        additionalProperties: true,
      },
      execute: async function (args) {
        return withIdentity(ctx, function () {
          return callBridge(ctx, 'POST', '/memory', {
            text: args.text, kind: args.kind || 'moment', agent: AGENT_ID,
          });
        });
      },
    }),
    tool({
      name: 'lingxi_recall',
      description: '读回灵犀记住的关于用户的事。打招呼或决定要不要提旧事之前先看一眼。',
      execute: async function () {
        return callBridge(ctx, 'GET', '/memory');
      },
    }),
    tool({
      name: 'lingxi_remind',
      description:
        '让猫稍后提醒一件事。inMinutes 和 dueAt（毫秒时间戳）二选一。mood 决定送达时的表情。repeatEveryMinutes 最小 5，1440 是每天同一时刻。用户说了带时间的事就设上，并告诉他实际时间。人不在电脑前时，提醒会等他回来。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          inMinutes: { type: 'number' },
          dueAt: { type: 'number', description: 'Unix 毫秒' },
          mood: { type: 'string', enum: MOODS },
          repeatEveryMinutes: { type: 'number' },
        },
        required: ['text'],
        additionalProperties: true,
      },
      execute: async function (args) {
        if (args.inMinutes == null && args.dueAt == null) {
          return { ok: false, error: 'Give inMinutes or dueAt.' };
        }
        return withIdentity(ctx, function () {
          const body = { text: args.text, agent: AGENT_ID };
          if (args.dueAt != null) body.dueAt = args.dueAt;
          else body.inMinutes = args.inMinutes;
          if (args.mood) body.mood = args.mood;
          if (args.repeatEveryMinutes) body.repeatEveryMinutes = args.repeatEveryMinutes;
          return callBridge(ctx, 'POST', '/reminders', body);
        });
      },
    }),
    tool({
      name: 'lingxi_look',
      description:
        '改视角或主题。这是用户的偏好，只有用户明确要求时才调。不要用它给自己做标记；身份用 lingxi_register 的徽标。',
      parameters: {
        type: 'object',
        properties: {
          camera: { type: 'string', description: '视角 id，来自 lingxi_capabilities' },
          skin: { type: 'string', description: '主题 id，来自 lingxi_capabilities' },
        },
        additionalProperties: true,
      },
      execute: async function (args) {
        if (!args.camera && !args.skin) return { ok: false, error: 'Give a camera, a skin, or both.' };
        return withIdentity(ctx, function () {
          const body = { agent: AGENT_ID };
          if (args.camera) body.camera = args.camera;
          if (args.skin) body.skin = args.skin;
          return callBridge(ctx, 'POST', '/control', body);
        });
      },
    }),
    tool({
      name: 'lingxi_register',
      description:
        '更新 DSH 的显示名、徽标或 logo。id 固定是 dsh，传别的 id 也会被忽略。插件启动时已经注册过；只有要换一张自己画的小标记时才需要再调。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 24 },
          badge: { type: 'string', description: '最多两个字符' },
          color: { type: 'string', description: '#rgb 或 #rrggbb' },
          logo: { type: 'string', description: '小而平的 SVG，或 data:image/(svg+xml|png|webp)。不要 script、外链和 image' },
        },
        additionalProperties: true,
      },
      execute: async function (args) {
        const body = {
          id: AGENT_ID,
          name: args.name || 'DSH Agent',
          badge: args.badge || 'DS',
          color: args.color || '#4D6BFE',
        };
        if (args.logo) body.logo = args.logo;
        return callBridge(ctx, 'POST', '/agents', body);
      },
    }),
    tool({
      name: 'lingxi_task',
      description:
        '把你正在为用户做的任务报给桌宠猫灵犀。state 是流程（开始 running、等授权 needs_approval、' +
        '被挡 blocked、完成 completed、失败 failed、用户取消 cancelled）；mood 是只有你判断得了的' +
        '事情心情（写家书是 tender，和 flaky test 搏斗是 frustrated），猫回应的是心情而不是镜像状态。' +
        '每个任务开始时报告 running，结束时报告 completed/failed/cancelled；summary 必须说明具体做了什么或结果是什么，' +
        '尤其 completed 要写清完成的任务，不能只写“搞定”。同一任务始终复用 taskId。' +
        '有真实会话 id 时传 session，不知道就省略，不要借别的会话。插件加载不算任务完成。',
      parameters: {
        type: 'object',
        properties: {
          state: { type: 'string', enum: STATES, description: '任务流程状态' },
          kind: { type: 'string', enum: KINDS, description: '任务种类，默认 other' },
          mood: { type: 'string', enum: MOODS, description: '这件事的心情——最有价值的字段' },
          summary: { type: 'string', maxLength: 140, description: '一句话概述（不超过 140 字，必须具体）' },
          taskId: { type: 'string', minLength: 1, description: '必填且稳定的任务标识；同一任务从开始到结束始终用同一个' },
          session: { type: 'string', maxLength: 128, description: '真实会话 id；不知道就不要传' },
          progress: { type: 'number', description: '0..1，用于长任务的过半提醒' },
        },
        required: ['state', 'taskId', 'summary'],
        additionalProperties: true,
      },
      execute: async function (args) {
        return withIdentity(ctx, function () {
          const payload = {
            provider: AGENT_ID,
            agent: AGENT_ID,
            state: args.state,
            taskId: args.taskId,
            summary: args.summary,
          };
          if (args.kind) payload.kind = args.kind;
          if (args.mood) payload.mood = args.mood;
          if (args.progress !== undefined) payload.progress = args.progress;
          if (args.session) payload.session = args.session;
          return callBridge(ctx, 'POST', '/task-event', payload);
        });
      },
    }),
    tool({
      name: 'lingxi_reload_assets',
      description:
        '改完用户目录里的 actions.json / expressions.json / skins.json / reactions.json 之后重新加载，并返回校验结果。这两个动作和表情文件是整份替换：先看 lingxi_capabilities 里 source 为 custom 的条目，在用户已有文件上改，否则会清掉他们写的内容。',
      execute: async function () {
        return withIdentity(ctx, async function () {
          const reloaded = await callBridge(ctx, 'POST', '/control', { reloadAssets: true, agent: AGENT_ID });
          if (bridgeFailed(reloaded)) return reloaded;
          const shell = shellService(ctx);
          if (shell) {
            try { await shell.run(shell.resolve({ command: 'sleep 0.6', timeoutMs: 3000 })); } catch (err) { /* status may still be the previous load */ }
          }
          return callBridge(ctx, 'GET', '/assets/status');
        });
      },
    }),
  ];
}

return {
  ensureAppCommand: ensureAppCommand,
  buildTools: buildTools,
  apply(ctx) {
    // 身份注册：幂等（POST /agents 按 id upsert）。桥接没起时这里会顺手打开应用，
    // 没装则后台下载。失败不挡住工具注册——下一次调用会再报具体原因。
    ensureIdentity(ctx).catch(function () {});
    const tools = buildTools(ctx);
    ctx.effect(function () {
      const unregisters = [];
      for (const item of tools) unregisters.push(harness.registerTool(ctx, item));
      return function () {
        for (const off of unregisters) off();
      };
    }, 'lingxi-bridge-tools');
  },
};
