# WorkBuddy · MCP + skill + hooks + 一道信任闸门

`hosts/` 下每个目录只为一个宿主负责。WorkBuddy 的形态和另外三个都不一样，值得先说清楚。

| | 谁触发 | 会漏吗 | 能带 `mood` 吗 |
|---|---|---|---|
| hooks（5.6+） | 宿主，确定性 | **不会** | ❌ |
| skill | 模型自己决定 | **会** | ✅ |
| MCP | 模型自己决定 | **会** | ✅ |

**WorkBuddy 5.6+ 已经暴露 hooks，本目录的「没有确定性的一半」结论已过时。**
实测（2026-09，WorkBuddy 5.6.2）：

- hooks 配置在 `~/.workbuddy/settings.json` 的 `hooks` 键，格式与 Claude Code 兼容
  （`UserPromptSubmit` / `Stop` / `PreToolUse` / `PostToolUse` / `SubagentStop` 等），
  **配置实时生效，不需要重启会话**。
- 载荷与 Claude Code 同形：`hook_event_name` / `session_id` / `cwd` / `transcript_path` /
  `tool_name` / `tool_input`——所以适配器直接走 `--host claude` 适配臂，零改动。
- 事件是**全局**的：所有会话（含并行会话与子代理）都会触发。
- 因此只装两条生命周期事件：`UserPromptSubmit`→running、`Stop`→completed。
  `PostToolUse` 每次工具调用都触发，会让猫变成通知轰炸，不要装。
- 没有观察到 `SessionStart` / `Notification` 事件（与 Claude Code 的事件集不同）；
  会话开始由 `UserPromptSubmit` 兜底。
- hooks 报不出 `mood`——它们是对话生命周期事件。**想要猫真的懂在发生什么，
  让模型自己发 task event**，这正是 skill 教它做的事。

---

## 装什么

```sh
./install.sh              # 幂等；已存在的东西不重复写
./install.sh --dry-run    # 只打印将要做的变更
./install.sh --set-identity   # 允许改写机器级署名（见下「署名」）
./install.sh --no-quota-guard # 只装生命周期 hooks，不装额度守卫（守卫默认装）
```

五件事：

| # | 写哪里 | 做什么 |
|---|---|---|
| 1 | `~/.workbuddy/mcp.json` | 合并一个 `mcpServers.lingxi`（`command` + `args`，**没有 `env`**） |
| 2 | `~/.workbuddy/skills/` | 软链**两份** skill：`lingxi`（共享基础能力 + `lingxi-authoring`）与 `lingxi-workbuddy`（本宿主定制，见下） |
| 3 | `~/.lingxi/agent.json` | 机器级署名 → `workbuddy` |
| 4 | `POST /agents` | 用 `workbuddy-mark.svg` 注册身份与徽章 |
| 5 | `~/.workbuddy/settings.json` | 合并 hooks 的**四个**事件（确定性的一半）：`UserPromptSubmit`→running、`Stop`→completed、`Notification`/`PermissionRequest`→弹权限框或提问时提醒，外加额度守卫（生命周期两事件上各多一个独立 group） |

⚠️ `workbuddy-mark.svg` **必须以 `<svg` 开头**。应用的 logo 校验是"以 `<svg` 开头，或是
`data:image/svg+xml|png|webp`"，所以在文件顶上写一段 HTML 注释（哪怕是说明出处的）会被判成
"not an SVG document" 并回 400。注释要放进 `<svg>` **里面**。

### 为什么 skill 分成两份

| skill | 放哪 | 内容 | 谁能看到 |
|---|---|---|---|
| `lingxi`（+ `lingxi-authoring`） | `integrations/skills/`，**各宿主共享** | 怎么调用、`mood`、任务进度、提醒、记忆、预算、别做的事 | Claude / Cursor / WorkBuddy / … 都软链它 |
| `lingxi-workbuddy` | `integrations/hosts/workbuddy/skills/`，**宿主私有** | 信任闸门、env 毒药、hooks 与额度守卫已经装好、哪些权限只能由人给 | 只有 WorkBuddy |

拆开的理由不是整理癖：**宿主专属的坑以前根本到不了模型那里**。它们只写在 README 里，
而 README 是给人看的——模型读不到。于是模型在 WorkBuddy 上会去改 `mcp.json` 的 `env`
试图"修好"不出现的 MCP 工具，而那一下恰好会把用户点过的信任吊销。

基础那份对所有宿主都一样，所以留在共享目录，`git pull` 一次所有宿主同时更新；
`lingxi-workbuddy` 是宿主私有的，别的宿主不该看到 WorkBuddy 的授权模型。

两份都要读，不是二选一：定制层开头就写了它是 `lingxi` 的补充。

### 额度守卫（`bin/lingxi-quota-guard.mjs`）

第 5 件事装的其实是**两条** hook：emit 那条管生命周期，守卫这条管额度。它是独立进程，不是
emit 那条命令的后半段——后者以 `exec` 结尾，同一条 shell 里排在它后面的东西永远不会执行。

它读的是 WorkBuddy 自己的 `~/.workbuddy/workbuddy.db`，`session_usage` 表：

| 字段 | 含义 | 能不能提醒 |
|---|---|---|
| `used` / `size` | 这个会话吃掉的上下文窗口（实测当前会话 5.9 万 / 30 万） | ✅ 跨过 60% / 70% / 90% 各说一次 |
| `credit_json` | 每次请求扣的 credits，求和就是本会话花掉的 | ✅ 自己设预算：`LINGXI_QUOTA_CREDIT_BUDGET=150` |
| 账号剩余额度 | **不在本地** | ❌ 做不到 |

⚠️ 第三行是硬边界。WorkBuddy 只把"额度用完"的静态文案和升级链接下发到本地
（`credit 额度已用完，立即升级订阅` + `codebuddy.cn/profile/plan`），**余额本身始终在服务端**。
所以猫能告诉你"这个会话快满了""这轮烧掉多少"，但**说不出"你还剩 12 credits"**——别承诺这个。

几条设计约束：

- **阈值不是拍的**：60/70/90% 来自服务端下发的 `tokenUsageThresholds.inputTokens`
  （warning .6 / critical .7 / emergency .9）。想更早被提醒就 `LINGXI_QUOTA_STEPS="0.4,0.55,0.75"`。
- **每档只说一次**，状态在 `~/.lingxi/quota-guard-state.json`；compact 或换会话后自动重新武装。
- **优先级最高只到 `report`，不用 `alert`**：一只比 agent 自己的汇报还横的猫会被人关掉。
- **读不到就闭嘴**。这张表是未公开结构，WorkBuddy 哪天改了它，守卫必须变成无害的空转，
  而不是往宿主输出里抛异常——所有失败路径都 `exit 0` 且默认不打印。排障时开
  `LINGXI_QUOTA_DEBUG=1`。
- **python3 先跑，node:sqlite 兜底**。反直觉但必要：`node:sqlite` 是实验特性，node 会
  **无条件**往 stderr 打 `ExperimentalWarning: SQLite is an experimental feature`——装了
  warning 监听器也拦不住，脚本内部压不掉。python 的 `sqlite3` 没这问题，所以默认路径根本
  不碰 node:sqlite。（hook 命令仍带 `--no-warnings`，那是给兜底路径用的。）

### 替代路径：marketplace 插件包

不想跑安装器的用户可以走 marketplace 安装自包含插件包（`plugin/`，含 hooks + 两份 skill）：

```sh
/plugin marketplace add <owner>/lingxi
/plugin install lingxi@lingxi
```

插件不带 MCP（避免与用户级 `mcp.json` 撞 server id + 信任哈希问题），也不写机器级署名——
要完整体验再跑一次 `./install.sh`（幂等，两者共存不冲突；hooks 语义相同，重复投递幂等）。
同步与注意事项见 `plugin/README.md`。

---

## ⚠️ 第一件事：信任闸门

**写完 `mcp.json` 不会自动生效。** WorkBuddy 把第三方 MCP server 的授权按配置哈希记账，
一个从没见过的 server 会被挡在门外——`mcp__lingxi__*` 这些工具在会话里**根本不出现**。

安装器会打印这次的哈希。要放行：

> 连接器管理页右上角 → 自定义连接器 → 找到 `lingxi` → 点「信任」

没点之前：**skill 那条路照常能用**（CLI 自己读 token，不过宿主的闸门），
只是模型没有那 13 个带类型的工具。这正好是"插件是下限，skill 是上限"反过来的一次演示——
这里是**skill 是下限**。

## ⚠️ 第二件事：`env` 会让这道闸门重新关上

WorkBuddy 的哈希是：

```
sha256( command | sorted(args) | sorted(env 的【键名】) )
```

注意最后一项是**键名，不是值**。所以往 `lingxi` 的 `env` 里加一个键、改一个键名，
都会换出一个新哈希 → 存量的信任记录（`~/.workbuddy/mcp-approvals.json` 里的 `<hash>::lingxi`）
不再匹配 → **WorkBuddy 拒绝启动这个 server**。

这个失败在 server 内部完全不可见：进程根本没被拉起来，所以 `bridge.mjs` 里任何一行日志
都不会执行。表象只是"猫突然不反应了"，看起来像桌宠坏了，而不是配置坏了。

所以身份不放在宿主的 `env` 里，而是放在 `~/.lingxi/agent.json`——
一个所有宿主共用的机器级文件。`command` 和 `args` 从此再也不用改，哈希永远有效。

> 探针 `verify-workbuddy-mcp.mjs` 会在跑任何功能检查**之前**先复算这个哈希并对账。
> 门都进不去，后面的检查都没有意义。

## 为什么是裸 `node`

不是"没想过写绝对路径"。WorkBuddy 自己的产品文档就是用
`"command": "npx"` / `"command": "node"` 教用户配 MCP 的，说明宿主会给子进程准备
可用的 node——和 Claude Code 的配置形态一致（本机 `~/.claude.json` 里就是裸 `node`）。
写死 `~/.workbuddy/binaries/node/versions/22.22.2-3/bin/node` 反而更脆：
WorkBuddy 换一版 node，路径就变了，而改路径就是改哈希就是丢信任。

---

## 署名：一个文件，三个宿主

`~/.lingxi/agent.json` 是**机器级**的，MCP server 和 `lingxi` CLI 读的是同一份。
它现在写的是：

```json
{ "id": "workbuddy", "name": "WorkBuddy", "badge": "🐧", "color": "#0AC89F" }
```

**这台机器上不止一个 agent。** 同一个文件被所有宿主共用，所以改动它会影响别人：

| 宿主 | 署名从哪来 | 受这个文件影响吗 |
|---|---|---|
| WorkBuddy | MCP 读 `~/.lingxi/agent.json`（它**不能**用 env 覆盖） | ✅ 受 |
| Claude Code | `~/.claude.json` 里 `mcpServers.lingxi.env.LINGXI_AGENT` | ❌ 不受（env 优先于文件） |
| Codex | `LINGXI_AGENT=codex`（写在 config.toml 的 MCP env 里） | ❌ 不受 |
| Claude Code 的 hooks | Rust 桥从载荷里的 `provider` 认人 | ❌ 不受 |

所以安装器**默认不改**这个文件里已有的非空 id——静默把别人的署名换掉，是这套设计里
最不该干的事。它只会在发现冲突时停下来告诉你怎么办：

- 想让 WorkBuddy 用这个文件、同时不改变其他宿主 → 先把其他宿主的身份**显式**钉在它们自己的
  MCP `env` 里（Claude Code 就是这样，`LINGXI_AGENT=claude-code`），然后
  `./install.sh --set-identity`。
- 或者接受共享身份：WorkBuddy 和文件里那个宿主同名，用户分不清是谁在反应。

> 反过来也成立：**Codex / Claude Code 的 `env` 是安全的，WorkBuddy 的 `env` 是毒药。**
> 区别不在技术，在宿主自己有没有把信任挂钩在配置哈希上。

---

## 验收

```sh
cd <repo> && ./integrations/hosts/workbuddy/install.sh

# 1. 闸门本身（哈希对账 + 身份文件 + 13 个工具 + 归属 + mood，端到端）
node --experimental-strip-types .workbuddy/probes/verify-workbuddy-mcp.mjs

# 2. 让猫真的反应一次
lingxi task completed test proud "WorkBuddy 接好了"
lingxi agents     # workbuddy 应带 🐧 徽章和 #0AC89F，claims 递增，且 anonymous 不涨
```

期望在第 1 步看到：

```
— 接入闸门（WorkBuddy）
  ✓ lingxi 的配置哈希已被信任        <hash 前 16 位>
  ✓ mcp.json 里没有 env（哈希才稳定）  身份走 ~/.lingxi/agent.json
  ✓ ~/.lingxi/agent.json 存在且带 id  🐧 WorkBuddy (workbuddy)
  ✓ 文件里的 id 是 workbuddy
```

`✗ lingxi 的配置哈希已被信任` 就是那份"还没点信任"——去连接器管理页点一下，再跑一次。

### 如果信任了、工具还是不出现

按可能性从高到低：

1. **会话没重启。** MCP server 是在会话启动时拉起来的，点完信任要开新一轮。
2. **`node` 没被解析到。** 宿主给子进程的 PATH 里没有 node（GUI 启动的 macOS 应用继承的是
   launchd 的 PATH，只有 `/usr/bin:/bin:/usr/sbin:/sbin`）。确认方式：看
   `~/.workbuddy/mcp-tool-list.json`——**它的键是 server 的配置哈希，不是名字**，
   要找的是 13 个 **`lingxi_` 开头**的工具名（`lingxi_capabilities`、`lingxi_task`…），
   文件里**不带** `mcp__lingxi__` 前缀，按前缀搜会一无所获。
   修法是把 `"command": "node"` 换成绝对路径——**但改 `command` 就是改哈希**，
   所以换完要重新点一次信任。见上文。

   同一个坑在 hooks 上的表现相反：hook 不走信任哈希，所以安装器现在把 node 解析
   **写在命令里运行时求**（PATH 优先，再退回托管 node 里最新的一个），不烤死版本号——
   烤死的那个路径会在 WorkBuddy 换 node 之后指向一个不存在的文件，hooks 静默空转，
   而宿主不会因为 hook 失败报错，表象只有"猫不反应了"。
3. **哈希对不上。** `install.sh` 会打印当前哈希；`~/.workbuddy/mcp-approvals.json` 里的键是
   `<hash>::lingxi`。两者不一致就是没被信任。


## 卸载

```sh
./install.sh --uninstall
```

删掉 `mcp.json` 里的 `lingxi` 条目、两个 skill 软链、`settings.json` 里命令含
`lingxi-emit.mjs` 的 hook，并撤销 `agent.json` 里的署名（只在这个文件仍然是 workbuddy 时撤，
不碰别人写的；你自己写的 hook 一律不动）。`~/.workbuddy/mcp-approvals.json`
里那条信任记录由 WorkBuddy 自己清理。

## 定制 WorkBuddy 皮肤

这一步不属于接入，走的是同一套资源机制，工具在仓库里：

```sh
node --experimental-strip-types .workbuddy/probes/build-workbuddy-assets.mjs   # 生成
node --experimental-strip-types .workbuddy/probes/verify-workbuddy-assets.mjs  # 用应用自己的 parser 预检
lingxi reload                                                                 # 重载，然后 lingxi assets 看 lastErrors
```

`build-workbuddy-assets.mjs` 会往资源目录写皮肤、表情、动作、气泡和 reactions 映射。
**它读现有的 `skins.json` 再增量追加**——自定义皮肤是"合并"，一份不读就写的
`skins.json` 会把用户已有的皮肤从盘上抹掉，这是这套机制里最容易造成不可逆损失的入口。
