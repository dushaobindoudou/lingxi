# 接入灵犀

三条路，按摩擦成本从低到高。**推荐第一条。**

规范见 [`docs/19-agent-integration.md`](../docs/19-agent-integration.md)；
运行中的应用会用 `GET /integration` 把契约原样吐出来，**以它为准**。

---

## 一、Skill + CLI（推荐）

```sh
./integrations/install-skills.sh
export PATH="$PATH:$(pwd)/integrations/cli"   # 或软链到 /usr/local/bin
lingxi health
```

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
