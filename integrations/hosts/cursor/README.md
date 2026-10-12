# lingxi-cursor — 灵犀的 Cursor 专用插件

Cursor 的接入是三件套：用户级 hooks（确定性）、skill（心情）、MCP（带类型的工具）。

| 装出的东西 | 位置 | 作用 |
|---|---|---|
| hooks | `~/.cursor/hooks.json` + `~/.cursor/hooks/lingxi-cursor.sh` | 会话开始、提交、回合结束必报给猫 |
| MCP | `~/.cursor/mcp.json` 的 `mcpServers.lingxi` | 13 个工具；`LINGXI_AGENT=cursor`。气泡角标是 `cursor-mark.svg`（Cursor 方块标志），文字徽章只在图标画不出来时兜底 |
| skill | `~/.cursor/skills/{lingxi,lingxi-authoring,lingxi-cursor}`（符号链接） | 系统层 `lingxi` 教模型什么时候通知、报什么、报 `mood`；宿主层 `lingxi-cursor` 写 Cursor 才成立的事（身份、hooks 报了什么、MCP 信任） |

`stop` 只代表这一轮 Agent 回复结束，不证明用户的任务已经完成。会话名是打开聊天时起的，后面的话题会离开它，所以 hook **不用会话名当摘要**。

提交事件只传达「新一轮开始」，不发送用户正文。`afterAgentResponse` 携带回复 `text`，
应用从中截一句结论，末尾问题则转为 `needs_input`；模型的具体 task 报告仍优先。
`stop` 本身只有状态，新安装的完成 stop 会让位于回复事件，避免把等待回答覆盖成 completed。
失败或取消仍由 stop 更新；旧的 stop-only 配置继续只更新状态。

输入契约依据 [Cursor 官方 Hooks 文档](https://cursor.com/docs/hooks)：公共字段
`conversation_id` / `session_id` 标识会话；`afterAgentResponse.text` 是回复正文；
`stop.status` 为 `completed` / `error` / `aborted`。命令参数补 `hook_event_name`，
回复只放在不落盘的 `result`，`summary` 保持生命周期描述。没有订阅工具调用前 hooks：
它们表示即将调用工具，不能据此判断宿主真的弹了权限框。当前公开事件中没有通用授权弹窗通知。

身份**不写** `~/.lingxi/agent.json`。那个文件是机器级的，这台机器上可能已经签给别的宿主。Cursor 的 MCP 和 hook 各自带 `LINGXI_AGENT=cursor`，env 优先于那个文件。

## 安装

```bash
./integrations/hosts/cursor/install.sh --dry-run
./integrations/hosts/cursor/install.sh
```

装完新开一个 Agent 会话。Cursor 第一次拉起这个 MCP 时会问是否信任，允许之后工具才会出现。`SessionStart` 在猫没开时会后台 `open -g` 拉起；`LINGXI_AUTOSTART=0` 可关。

## 验收

```bash
~/.cursor/hooks/lingxi-cursor.sh afterAgentResponse <<'EOF'
{"conversation_id":"cursor-e2e","text":"Cursor 通知链路检查通过。"}
EOF
lingxi events
```

最新一条应是 `provider=cursor`，摘要是「本轮回复结束」，实际气泡来自回复文本。
`beforeSubmitPrompt` 的 stdout 必须是 `{"continue":true}`，否则会拦住用户发消息。
Node 在每次执行时从 `LINGXI_NODE`、PATH、Homebrew 或 nvm 查找，支持从 Dock 启动的有限 PATH。

## 卸载

```bash
./integrations/hosts/cursor/install.sh --uninstall
```
