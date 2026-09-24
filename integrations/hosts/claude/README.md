# lingxi-claude — 灵犀的 Claude Code 专用插件

为 Claude Code 量身做的三件套：**hooks（确定性反应）+ skill（心情语义）+ MCP（直接操控）**。
自包含：hooks 是纯 `curl`，不依赖 node、不依赖仓库里其他目录——把整个 `lingxi-claude/`
目录拷到任何位置安装都成立。

## 安装

```bash
claude plugin install /Users/liepin/workspace/lingxi/integrations/hosts/claude
```

MCP 由插件内的 `.mcp.json` 注册（`mcp/index.mjs` 是 `packages/mcp-server/src/index.mjs`
的同步副本——**改了 MCP server 源码要重新拷贝**，这份副本只服务这个插件）。

## 分层：谁负责什么

| 层 | 文件 | 职责 | 依赖 |
|---|---|---|---|
| hooks | `hooks/hooks.json` | 会话开始/等你授权/回合结束→猫必然有反应 | 只有 curl |
| skill | `skills/lingxi/SKILL.md` | 教模型报 `mood`、克制地让猫说话/记事/提醒 | lingxi CLI |
| MCP | `.mcp.json` → `mcp/index.mjs` | 带类型 schema 的 13 个工具，宿主逐工具授权 | node |

hooks 是底线：**模型什么都不做猫也有反应**。skill 是增量：hooks 只知道"发生了什么"，
"这件事是什么感受"只有读过工作的模型知道。MCP 可选：想要带类型授权时才需要。

## 与 app 一键安装的关系

hook 命令与 app 主界面「Agent 接入」写入的命令**逐字相同**（同一路径 `/task-event`、
同一 token 文件读法），因此：

- 装了插件就不用再点一键安装（反之亦然，不会叠加）；
- app 的卸载逻辑 `remove_our_hook_entries` 按命令串识别，能把这个插件装的 hook 一并清掉。

事件署名是桥接给的 `claude`：裸载荷路径不读 `~/.lingxi/agent.json`，所以这半边的署名是固定的。
模型主动那半边（skill / MCP）仍然读机器身份文件——两边署名不同是有意的，你能在事件流里
分辨"宿主替你报的"和"模型自己报的"。

## 验收

```bash
# 1. hooks 生效：hook 载荷直发，事件落库
T=$(cat "$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bridge-token")
H=$(mktemp); printf 'header = "Authorization: Bearer %s"\n' "$T" > "$H"
printf '{"session_id":"plug-e2e","hook_event_name":"Notification","message":"Claude needs your permission to use Bash"}' \
  | curl -s -m 2 -K "$H" -X POST http://127.0.0.1:47811/task-event -H 'Content-Type: application/json' --data-binary @-
rm -f "$H"
# 期望 {"ok":true,"recorded":true}；lingxi events 里最新一条 state=needs_approval

# 2. MCP 注册：claude mcp list 应出现 lingxi 且 ✔ Connected
# 3. skill 可见：会话内 /skills 应列出 lingxi
```

## 卸载

```bash
claude plugin uninstall lingxi-claude
# hooks 随插件卸载自动移除；也可在 app 主界面点「断开 Claude Code」兜底
```
