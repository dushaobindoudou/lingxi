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
    "lingxi": { "command": "node", "args": ["<repo>/packages/mcp-server/src/index.mjs"] }
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
