# lingxi-cursor — 灵犀的 Cursor 专用插件

Cursor 的接入是三件套：用户级 hooks（确定性）、skill（心情）、MCP（带类型的工具）。

| 装出的东西 | 位置 | 作用 |
|---|---|---|
| hooks | `~/.cursor/hooks.json` + `~/.cursor/hooks/lingxi-cursor.sh` | 会话开始、提交、回合结束必报给猫 |
| MCP | `~/.cursor/mcp.json` 的 `mcpServers.lingxi` | 13 个工具；`LINGXI_AGENT=cursor`。气泡角标是 `cursor-mark.svg`（Cursor 方块标志），文字徽章只在图标画不出来时兜底 |
| skill | `~/.cursor/skills/lingxi`（符号链接） | 教模型报 `mood` |

`stop` 只代表这一轮 Agent 回复结束，不证明用户的任务已经完成。会话名是打开聊天时起的，后面的话题会离开它，所以 hook **不用会话名当摘要**。

提交时的摘要是这一轮用户刚说的话。结束时的那句结果由模型在回复结束前用 `lingxi task` 写：这一轮刚做成什么，或卡在哪。随后到来的「本轮回复结束」不会盖掉这句。模型没写时，猫才只说结束了。

身份**不写** `~/.lingxi/agent.json`。那个文件是机器级的，这台机器上可能已经签给别的宿主。Cursor 的 MCP 和 hook 各自带 `LINGXI_AGENT=cursor`，env 优先于那个文件。

## 安装

```bash
./integrations/hosts/cursor/install.sh --dry-run
./integrations/hosts/cursor/install.sh
```

装完新开一个 Agent 会话。Cursor 第一次拉起这个 MCP 时会问是否信任，允许之后工具才会出现。`SessionStart` 在猫没开时会后台 `open -g` 拉起；`LINGXI_AUTOSTART=0` 可关。

## 验收

```bash
~/.cursor/hooks/lingxi-cursor.sh stop <<'EOF'
{"conversation_id":"cursor-e2e","status":"completed"}
EOF
lingxi events
```

最新一条应是 `provider=cursor`，摘要是「本轮回复结束」。这一句只表示回合结束；这一轮实际做成了什么，由模型的 `lingxi task` 另报，而且不会被这句盖掉。`beforeSubmitPrompt` 的 stdout 必须是 `{"continue":true}`，否则会拦住用户发消息。

## 卸载

```bash
./integrations/hosts/cursor/install.sh --uninstall
```
