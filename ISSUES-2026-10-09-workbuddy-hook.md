# 实测问题记录：WorkBuddy 宿主的 hook 不产生有效通知（2026-10-09）

> **只测试与读码，未改任何业务代码。** 所有条目都是在本机运行中的灵犀上实测复现，  
> 或带行号引用源码。每条都附了可直接重跑的复现命令。

## 现象

用户在 WorkBuddy 里干活时，桌上的猫**几乎从不说话**：表情会动，但没有气泡。  
同一台机器上的 dsh / codex agent 说话正常、摘要写得很满，所以用户感知是  
"WorkBuddy 那只猫坏了"。

## 总览

| # | 级别    | 问题                                                                                     | 性质   |
| - | ----- | -------------------------------------------------------------------------------------- | ---- |
| 1 | **高** | `Stop` hook 拿不到回复文本，应用剪不出话 → 一轮结束静默                                                    | 能力缺口 |
| 2 | **高** | 四个 hook 全部写成 `--host claude`，而 emit 没有 `workbuddy` 分支                                  | 错误配置 |
| 3 | 中高    | `Notification` / `PermissionRequest` 依赖 Claude 专有字段，WorkBuddy payload 里没有 → 权限弹窗、提问也无声 | 静默失败 |
| 4 | 中     | 宿主层未定义 hook payload 契约（README 里零字段说明）                                                  | 可维护性 |
| 5 | 低-中   | hook 事件的 `summary` 是应用占位句 `chat: running` / `chat: completed`，排障时极易误判成"已经通知过了"         | 可观测性 |
| 6 | —     | （非代码 bug）WorkBuddy 这个 agent 没有自己报任务终态，而 hook 按设计不替它念                                   | 使用侧  |

## 环境

| 项       | 值                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------- |
| 应用      | 运行中，`lingxi state` → `power: active`、`petState: wander`                                              |
| CLI     | `~/Library/Application Support/com.dushaobin.lingxi-desktop/bin/lingxi`                              |
| 身份      | `~/.lingxi/agent.json` → `id: workbuddy` / `badge: 🐧` / `#0AC89F`                                   |
| hook 配置 | `~/.workbuddy/settings.json`，四个事件：`UserPromptSubmit` / `Stop` / `Notification` / `PermissionRequest` |
| emit 脚本 | `integrations/adapters/lingxi-emit.mjs`（18.9 KB，2026-10-09 13:59）                                    |
| 宿主目录    | `integrations/hosts/workbuddy/`（有 README、install.sh、plugin、skills、配额守卫）                              |

## 证据

### 证据 1 · 九条事件，一条有内容的都没有

```bash
lingxi events | python3 -c "…过滤 provider=='workbuddy'…"
```

```
running   | chat | focused | chat: running
completed | chat | focused | chat: completed
running   | chat | focused | chat: running
…（共 9 条，全部如此）
```

对照同一份事件流里 dsh agent **自己报**的那条：

```
running | chat | frustrated | 揪出插件不生效的双重根因：宿主要求入口导出 inject 声明、且 pnpm 严格
                            node_modules 下 link 的包要自装 typert-protocol 依赖，两包都已修复并全绿…
```

差别不在"猫坏没坏"，而在**谁写的这句话**：dsh 是自己报的，workbuddy 侧只有 hook 的占位句。

### 证据 2 · 四个 hook 全部 `--host claude`

```bash
grep -o -- "--host [a-z]*" ~/.workbuddy/settings.json | sort | uniq -c
#    4 --host claude
```

四条 emit 命令（UserPromptSubmit / Stop / Notification / PermissionRequest）无一例外，  
全指向 claude。而 `install.sh` 里搜不到任何 `workbuddy` 字样。

### 证据 3 · emit 根本没有 workbuddy 分支

`lingxi-emit.mjs:337-356`：

```js
const host = hostIndex >= 0 ? args[hostIndex + 1] : 'generic';   // :338
const mapped = host === 'claude' ? withClaudeSession(fromClaude(raw), raw)   // :353
  : host === 'codex' ? fromCodex(raw)                                        // :354
  : host === 'cursor' ? fromCursor(raw)                                      // :355
  : raw;                                                                     // :356  ← generic
```

可选值只有 `claude` / `codex` / `cursor` / `generic`（脚本头部注释 :25-28 也是这四个）。  
WorkBuddy 走了 `fromClaude(raw)`，也就是**按 Claude Code 的字段约定解析 WorkBuddy 的 JSON**。

`provider` 之所以还显示 `workbuddy`，只是因为 :360 优先取 `configuredAgent()`（读 `agent.json`）；  
字段解析本身仍然是 Claude 那套。

### 证据 4 · Stop 的有效载荷是 `last_assistant_message`

`lingxi-emit.mjs:165-169`：

```js
case 'Stop':
  // The reply itself goes to the local app, which cuts one line from it for the bubble - or
  // turns the event into needs_input when the reply ends on a question - and keeps none of it.
  return { state: 'completed', kind: 'chat', taskId: session, result: raw.last_assistant_message };
```

设计是清楚的：hook 把"这一轮最后一句回复原文"塞进 `result`，**由应用从里面剪一句当气泡**。  
所以只要 WorkBuddy 的 Stop payload 里没有 `last_assistant_message`，这个字段就是 `undefined`，  
应用无从裁剪，最后只剩占位句——**这就是"猫不说话"的直接根因**。

同时 `lingxi-emit.mjs:363-365`：

```js
// A host's own lifecycle event, not an agent's report: the app never reads its summary aloud
// as a task result, and lets it stand down when the agent already reported the turn itself.
if (host !== 'generic') event.origin = 'hook';
```

说明 hook 事件的 `summary` **本来就不会被当任务结果朗读**（`chat: completed` 只是占位），  
能出声的那句是应用从 `result` 剪出来的。两条合起来解释了全部现象。

### 证据 5 · 会说话的那两条也依赖 Claude 字段

- `Notification`（:143-163）：要 `notification_type`，或从 `raw.message` 正则猜；  
  匹配不上 `permission|approve|授权|批准|允许` 就退化成 `needs_input`。
- `PermissionRequest`（:170-…）：要 `tool_name` / `tool_input`，  
  靠 `AskUserQuestion` / `ExitPlanMode` / `Bash` 这些 **Claude 工具名**来写文案。

WorkBuddy 的 payload 若不含这些字段，走 `default: return null`（:224 前后）→ **直接丢弃，什么都不发**。  
这与用户"权限框弹出来猫也没反应"的观察一致（宿主层文档声称这两条后加过）。

### 证据 6 · 宿主层没有定义 payload 契约

`integrations/hosts/workbuddy/README.md`（14 KB）里检索  
`hook_event_name` / `last_assistant` / `payload` / `stdin` / `session_id` / `transcript_path`  
—— **零命中**。也就是说"WorkBuddy 的 hook JSON 长什么样"这件事，代码里没有一处说清楚，  
install.sh 只能沿用 `--host claude` 的约定。

## 根因链

```
install.sh 给 WorkBuddy 装 hook 时用了 --host claude
        ↓
emit 走 fromClaude()，按 Claude 的字段解析 WorkBuddy 的 JSON
        ↓
Stop 分支要 raw.last_assistant_message —— WorkBuddy payload 没有 → result 为空
        ↓
应用剪不出话；而 hook 事件（origin=hook）的 summary 按设计不朗读
        ↓
只剩占位句 chat: completed，用户看到的就是"猫不说话"
```

叠加两个放大因素：

- **没有 workbuddy 宿主分支**（#2/#3）：不只是字段缺失，整条映射关系是借来的。
- **agent 侧不自报**（#6）：按设计，只有当 agent 自己报过终态时 hook 才让位；  
  workbuddy 这个 agent 一次都没报，于是唯一的兜底（从回复剪一句）又因为 #1 拿不到文本，  
  两条路同时断掉。

## 复现

```bash
L="$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bin/lingxi"

# 1. 应用活着、但 workbuddy 侧没有任何一句自己写的话
LINGXI_AGENT=workbuddy "$L" state | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['power'], d['expression'])"
LINGXI_AGENT=workbuddy "$L" events | python3 -c "
import json,sys
d=json.load(sys.stdin); evs=d['events'] if 'events' in d else d
rows=[e for e in evs if e.get('provider')=='workbuddy']
print('workbuddy 事件数:', len(rows))
for e in rows[-6:]: print(' ', e['state'], '|', e.get('summary'))
"

# 2. 宿主配置：四条 hook 全是 claude
grep -o -- "--host [a-z]*" "$HOME/.workbuddy/settings.json" | sort | uniq -c

# 3. 控制组：agent 自己报一句，猫立刻有反应
LINGXI_AGENT=workbuddy LINGXI_TASK_ID=smoke "$L" task completed review curious "冒烟：这条路是通的"
LINGXI_AGENT=workbuddy "$L" state | grep expression     # 安然 → 开心（本次实测）
```

第 3 步是**排除法的关键**：桥、鉴权、应用、反应映射全部正常，  
坏的只有"hook 这条路"，不是"猫坏了"。

## 建议修法（按优先级）

1. **给 emit 加 `workbuddy` 宿主分支**（或新增 `fromWorkbuddy()`），并把 install.sh /  
   `settings.json` 里的 `--host claude` 改掉。
   - 至少要能识别：一轮开始、一轮结束、等待用户（权限/提问）、失败终止。
   - 不知道 WorkBuddy payload 字段时，先做**字段探测**：脚本拿到 JSON 后把未知结构的  
     关键候选（回复文本、事件名、会话 id）打进 `notify-log`，再据此定契约。
2. **定义 WorkBuddy 的 hook payload 契约**并写进 `hosts/workbuddy/README.md`：  
   事件名取值、`session_id`、以及**回复文本字段名**（现成的话直接复用  
   `last_assistant_message`，复用不了就让宿主侧补上）。这是 #1 的前置条件。
3. **Stop 兜底降级**：`result` 为空时不要只留占位句——至少念一句不含任务内容的  
   "这一轮结束了"，否则 hook 事件在 UI 上和静默无法区分。
4. **弹窗两条**（Notification / PermissionRequest）单独适配：WorkBuddy 的权限/提问  
   事件名与工具名和 Claude 不同，现在走 `default: return null` 全丢。  
   拿到"需要用户确认"这件事本身比拿到工具名重要，先保证 `needs_approval` / `needs_input`  
   能发出来。
5. **可观测性**：hook 事件在 `events` 里应能看出"这是 hook 兜底、且没有可用文本"  
   （例如 `origin`/`echo` 外再加一个 `fallback: true`），别让 `chat: completed`  
   看起来像一次成功通知。排障时这一条最容易被误读。
6. **（非代码）agent 侧**：宿主层 skill 已写明"心情和完整任务结果只有模型能写"，  
   需要在 WorkBuddy 侧真正执行——每轮有实质结果时，用固定 `taskId` 报  
   `completed/failed` + `mood` + 一句话结果。修好 #1 之前，这条路是唯一能出声的。

## 验收标准

- [ ] 在 WorkBuddy 里跑一轮普通任务，**不手动调任何 CLI**，猫应当出一次气泡
- [ ] `lingxi events` 里 `provider=workbuddy` 的事件，至少有一条 `summary` 不是  
  `chat: running` / `chat: completed`
- [ ] WorkBuddy 弹出权限确认时，`lingxi state` 的 `intent` 或事件流里出现 `needs_approval`
- [ ] `hosts/workbuddy/README.md` 写出 hook payload 的字段名清单
- [ ] 上述 4 条在**卸载重装**（`install.sh` 重跑）后依然成立——这次的 `--host claude`  
  说明问题出在安装产物，手改 `settings.json` 会在下次安装时被覆盖回去

## 附：本次实测的关键文件

| 文件                                              | 作用                                     |
| ----------------------------------------------- | -------------------------------------- |
| `~/.workbuddy/settings.json`                    | 四个 hook，4 处 `--host claude`            |
| `integrations/adapters/lingxi-emit.mjs:133-241` | `fromClaude()`，被 WorkBuddy 借用          |
| `integrations/adapters/lingxi-emit.mjs:353-365` | host 分支 + `origin='hook'`              |
| `integrations/hosts/workbuddy/README.md`        | 宿主文档，无 payload 字段说明                    |
| `~/.lingxi/notify-log.jsonl`                    | 原始通知日志（623 KB，可直接 grep 当天记录）           |
| `~/.lingxi/agent.json`                          | `id=workbuddy`，`configuredAgent()` 的来源 |
