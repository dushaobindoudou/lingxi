# 接入灵犀

## 先看这一条：skill 会不会被调用？

**不一定。** skill 是**建议性**的——模型读到了，然后自己决定要不要用。大多数会话里它想不起来。

所以接入分两层，两层都要装：

| | 谁触发 | 会漏吗 | 知道 `state` | 知道 `mood` |
|---|---|---|---|---|
| **插件 / hook** | 宿主，确定性 | **不会** | ✅ | ❌ 看不到内容 |
| **skill / MCP** | 模型自己 | 会 | ✅ | ✅ **核心价值** |

> **插件是下限，skill 是上限。**
> 插件保证"有事发生猫就有反应"；skill 让那个反应**知道这件事是关于什么的**。

适配器**故意不猜** `mood`——插件编一个出来，就是在瞎编整个设计赖以成立的那一个字段，
而且会在没人看得见的地方错。它留空，应用按 `focused` 处理，模型真有话说时再覆盖。

```sh
# Claude Code：hooks + skill + MCP 一起装
claude plugin install <repo>/integrations/plugins/claude-code

# Codex：一行（注意 notify 只能有一个，见 plugins/codex/README.md）
notify = ["node", "<repo>/integrations/adapters/lingxi-emit.mjs", "--host", "codex"]
```

事件的**契约**是 [`schema/task-event.schema.json`](schema/task-event.schema.json)。
所有接入——hook、notify、MCP、curl——都只产出这一个对象。
**再接一个新宿主 = 写一个适配器，不需要动应用。**

---

## 下面是手动的三条路，按摩擦成本从低到高

规范见 [`docs/19-agent-integration.md`](../docs/19-agent-integration.md)；
运行中的应用会用 `GET /integration` 把契约原样吐出来，**以它为准**。

---

## 一、Skill + CLI（推荐）

```sh
./integrations/install-skills.sh
export PATH="$PATH:$(pwd)/integrations/cli"   # 可选，见下
lingxi health
```

**不加 PATH 也能用,连仓库都不用有**——应用每次启动会把 CLI 写到:

```
~/Library/Application Support/com.dushaobin.lingxi-desktop/bin/lingxi
```

`curl -s localhost:47811/health` 返回里的 `cli` 字段就是它的绝对路径(这个接口免鉴权)。
依赖只有 `curl` + `python3`(或 `node`),**不需要 jq**。

### 能力对比:CLI 是 MCP 的超集

| | MCP | CLI |
|---|---|---|
| 说话/表情/动作/特效/玩具/视角 | ✅ | ✅ |
| 报告任务(含 `mood`)、记忆、提醒、重载资源 | ✅ | ✅ |
| `activity` 谁在干什么 | ❌ | ✅ |
| `events` 事件历史 | ❌ | ✅ |
| `unremind` 取消提醒 | ❌ | ✅ |
| `raw` 任何未包装接口 | ❌ | ✅ |

**所以只用 skill 就能驱动全部能力。** MCP 仍然有用(带类型的 schema、逐工具权限),
但不是必需的。

装好之后 **Claude Code 和 Codex 都能用**——两者都读 `<目录>/<技能名>/SKILL.md`，
所以是同一份 skill，只是目录不同：

| Agent | 位置 |
|---|---|
| Claude Code（用户级） | `~/.claude/skills/` |
| Codex（用户级） | `~/.codex/skills/` |
| 本仓库（项目级） | `./.claude/skills/`（加 `--project`） |

默认是**软链**，所以 `git pull` 一次，所有 agent 同时更新，不存在"哪份是最新的"。
要独立副本用 `--copy`。

### 为什么优先这条

MCP 的每个工具调用都是一次**授权面**——不少宿主会逐个工具弹确认，一轮里改三次表情就要过三次。
脚本只有一次。而且 `lingxi` 自己读 token，**没有任何要配置的东西**。

---

## 二、MCP server

宿主想要带类型的 schema、想逐工具控制权限时更合适。13 个工具。

**Claude Code / 任何 JSON 配置的客户端：**

```jsonc
{
  "mcpServers": {
    "lingxi": {
      "command": "node",
      "args": ["<repo>/packages/mcp-server/src/index.mjs"]
    }
  }
}
```

**Codex**（`~/.codex/config.toml`，注意是 TOML 不是 JSON）：

```toml
[mcp_servers.lingxi]
command = "node"
args = ["<repo>/packages/mcp-server/src/index.mjs"]
```

token 由 server 自己从配置目录读，不用写进配置文件。
署名也不写在这里 —— 见下方「署名」，写进 `~/.lingxi/agent.json` 一次即可。

### 署名（`~/.lingxi/agent.json`，或 `LINGXI_AGENT`）

同一台机器上常常不止一个 agent 在驱同一只猫，而**猫只有一张脸**。应用按调用方自报的
`agent` 做仲裁并显示徽章，所以不报自己的调用会一律落成 `anonymous`（💻）——
用户分不清是谁在反应，`report` 也压不过 `anonymous` 的 `alert`。

**推荐做法：把身份写进机器级文件，一次配好，所有宿主共用。**

```json
// ~/.lingxi/agent.json
{ "id": "workbuddy", "name": "WorkBuddy", "badge": "🐧", "color": "#0AC89F" }
```

MCP server 与 `lingxi` CLI **读的是同一份文件**，所以两条路署名一致。
设了它，这个 server 的**每一次**调用都会带上这个 id，并在争夺舞台前自动
`POST /agents` 补注册（注册表是纯内存的，重启应用就没了，而 bridge token 是持久的
——所以"缓存一下已经注册过"这种优化在这里是错的）。

`LINGXI_AGENT` / `LINGXI_AGENT_NAME` / `LINGXI_AGENT_BADGE` / `LINGXI_AGENT_COLOR`
仍然有效，**优先级高于文件**，供单个宿主临时覆盖。

> ⚠️ **但不要把它们写进宿主的 MCP 配置里的 `env`。** 有些宿主（WorkBuddy 就是）
> 把第三方 MCP server 的授权按 `sha256(command|sorted(args)|sorted(env 的【键名】))` 记账，
> 往 `env` 里增删一个键就会换一个哈希、让已记录的信任失效，宿主于是**拒绝启动这个 server**
> ——工具在会话里凭空消失，而且因为进程没被拉起来，server 内部任何日志都不会执行，
> 从表象完全看不出是配置问题。身份放文件里，宿主的 `env` 就能一直留空，哈希永远有效。
> 细节见 `packages/mcp-server/src/bridge.mjs` 头部注释。

验证：

```sh
lingxi agents     # 应看到你的 id 带着你挑的徽章
```

---

## 三、直接 HTTP

```sh
TOKEN=$(cat "$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bridge-token")
curl -H "Authorization: Bearer $TOKEN" localhost:47811/integration
```

`GET /health` 是唯一免 token 的接口，它会告诉你 token 文件在哪。

---

## Claude Code hooks（可选，额外的自动反应）

让猫对**每一轮对话**的开始和结束自动有反应，不需要模型主动调用：

主界面 →「Agent 接入」→「安装 Claude Code hooks」，或者：

```sh
curl -X POST -H "Authorization: Bearer $TOKEN" localhost:47811/task-event \
  -H 'Content-Type: application/json' \
  -d '{"provider":"claude","state":"completed","kind":"chat","mood":"focused"}'
```

hook 走的是同一个 `/task-event`，只是形状不同（应用会自动识别两种）。

> hooks 报不出 `mood`——它们是对话生命周期事件，不知道内容。
> **想要猫真的懂在发生什么，让模型自己发 task event。** 这正是 skill 教它做的事。

---

## 装完检查

```sh
lingxi health          # 应用在不在、token 在哪
lingxi integration     # 完整契约
lingxi capabilities    # 全部动作 / 表情 / 主题，带 builtin/custom 来源标记
lingxi task completed test proud "接好了"    # 让猫反应一下
```
