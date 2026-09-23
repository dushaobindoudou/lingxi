# Codex 接入

Codex 没有 Claude Code 那种多事件 hook 体系，但它有一个**确定性触发点**：`notify`。
这就是"skill 可能不被调用"的解法——`notify` 由 Codex 自己在回合结束时调用，
不经过模型的判断。

## 装法

> **最省事的一条：托盘 →「主界面」→ Agent 接入 → Codex →「一键接入」。**
>
> 它往 `~/.codex/config.toml` 写一条 `notify`（写之前先备份成 `.lingxi-backup`），
> 你的注释、模型设置和其他 MCP server 原样保留。写进去的是一条 `curl`，不是下面那个
> node 适配器——因为装了 `.app` 却没有仓库的人也得能用（和 Claude Code 的 hook 同理）。
>
> **配置里已经有别的 `notify` 时，按钮会消失**，并把占着那个键的命令原样显示出来。
> 它不会替你做决定，原因见下一节。
>
> MCP 那一半仍然要手工粘贴：它跑在这个仓库里，而按钮不能往一个你可能没有的目录写路径。

手工装的话，`~/.codex/config.toml`：

```toml
# 确定性的那一半：不管模型有没有想起来调 skill，回合结束猫都会有反应。
notify = ["node", "<repo>/integrations/adapters/lingxi-emit.mjs", "--host", "codex"]

# 有判断力的那一半：模型主动调用时，反应才知道这件事是关于什么的。
[mcp_servers.lingxi]
command = "node"
args = ["<repo>/packages/mcp-server/src/index.mjs"]

[mcp_servers.lingxi.env]
LINGXI_AGENT = "codex"
LINGXI_AGENT_NAME = "Codex"
```

skill 另外装（`./integrations/install-skills.sh` 会放进 `~/.codex/skills/`）。

## ⚠️ `notify` 只能有一个

这是 TOML 的一个键，不是数组的数组——**已经配了别的 `notify` 就会被顶掉**。
这台机器上现在就有一个：

```toml
notify = [".../SkyComputerUseClient", "turn-ended"]
```

要两个都要，写一个分发脚本，把 payload 同时转给两边：

```bash
#!/usr/bin/env bash
# ~/.codex/notify-fanout.sh
payload="$1"
"/path/to/existing/notifier" "$payload" &
node "<repo>/integrations/adapters/lingxi-emit.mjs" --host codex "$payload" &
wait
```

```toml
notify = ["/Users/you/.codex/notify-fanout.sh"]
```

**别直接覆盖用户已有的 `notify`。** 那是别人的功能，猫不值得。

## 这条路能给到什么、给不到什么

| | `notify`（确定性） | skill / MCP（模型主动） |
|---|---|---|
| 会不会漏 | 不会 | 会——模型没想起来就没有 |
| 知道 `state` | ✅ 回合开始/结束/失败/等输入 | ✅ |
| 知道 `kind` | ❌ 只能报 `chat` | ✅ |
| **知道 `mood`** | ❌ **看不到内容** | ✅ **这是核心价值** |

所以两个都装：**`notify` 是下限，skill 是上限。**
适配器**故意不猜** `mood`——插件编出来的心情会在没人看得见的地方错，
而那正是整个设计立足的那一个字段。

## 验证

```bash
# 直接喂一个 Codex 形状的事件，看猫有没有反应
echo '{"type":"agent-turn-complete","thread-id":"t1","last-assistant-message":"写完了"}' \
  | node <repo>/integrations/adapters/lingxi-emit.mjs --host codex

# 一键接入走的是另一条路：桥自己认识 Codex 的形状，不经过适配器
curl -s --noproxy '*' -X POST http://127.0.0.1:47811/task-event \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $(cat "$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bridge-token")" \
  -d '{"type":"agent-turn-complete","thread-id":"t1","last-assistant-message":"写完了"}'
lingxi state      # expression 应该变了
lingxi events     # 应该看到一条 provider=codex
```

适配器**永远 exit 0**：猫没启动、token 读不到、payload 不认识，都只是安静地什么都不做。
一个桌宠不该有能力把你的 agent 搞坏。

## 两份映射，钉在一起

Codex 的事件形状现在有两个地方在解析：这里的 node 适配器（`fromCodex`），和 Rust 桥里的
`normalize_codex_notify_event`（一键接入那条 curl 走的就是它）。

两份是有代价的，而这个代价这个仓库已经付过一次：Claude Code 的两个 mapper 漂移过，
一边认三个事件、另一边认五个，结果**权限提示在大多数人用的那条路上被静默丢掉了**。

所以 `normalize_codex_notify_event_matches_the_node_adapter` 逐个用例把两边钉住——
只给一边加事件，`cargo test` 会红。改这里的 `fromCodex` 时，那个测试就是清单。
