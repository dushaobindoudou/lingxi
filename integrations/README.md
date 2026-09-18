# 接入 Agent

灵犀对 Agent 只暴露一个东西：**本机 HTTP 桥**（`127.0.0.1:47811`，只监听回环，不对外）。
所有接入方式——MCP、hooks、你自己写的脚本——都是这个桥的客户端。

这样做是有意的：桥是稳定的，客户端可以随便换；任何能发 HTTP 的东西都能驱动猫，不需要
知道 Tauri、Rust 或者渲染器的存在；而且没有任何一个客户端能把应用弄崩。

## 三种接法

| 方式 | 适合 | 位置 |
|---|---|---|
| **MCP server** | Claude Code / Codex / 任何会说 MCP 的 Agent | [`packages/mcp-server`](../packages/mcp-server) |
| **Hooks** | Claude Code（任务生命周期事件） | 主界面 → Agent 接入 → 一键接入 |
| **直接 HTTP** | DeepSeek Harness、脚本、CI | 见下面的接口表 |

---

## 1. MCP server

零依赖、单文件、stdio。任何 MCP 客户端都能用：

```jsonc
// Claude Code: ~/.claude/settings.json 的 mcpServers 里
{
  "mcpServers": {
    "lingxi": {
      "command": "node",
      "args": ["/绝对路径/dsh-lingxi/packages/mcp-server/src/index.mjs"]
    }
  }
}
```

Codex / 其它客户端同理，配置格式按各自的文档来，命令是一样的。
换了端口就设 `LINGXI_PORT` 环境变量。

**十个工具**（详细说明在工具自己的 description 里，模型看得到）：

| 工具 | 作用 |
|---|---|
| `lingxi_capabilities` | 列出全部动作 / 表情 / 主题 / 视角 / 玩具 / 特效。**先调这个** |
| `lingxi_state` | 猫现在在哪、在干嘛、用户最近多活跃 |
| `lingxi_say` | 头顶漫画气泡说一句话 |
| `lingxi_express` | 换表情 / 播一个动作 |
| `lingxi_perform` | 播一段全屏特效（几秒钟，慎用） |
| `lingxi_play` | 放一个玩具 / 收起来 |
| `lingxi_remember` | 记住一件关于主人的事 |
| `lingxi_recall` | 读回全部记忆 + 一起完成了多少任务 |
| `lingxi_remind` | 过一会儿让猫提醒你一件事 |
| `lingxi_look` | 换视角 / 换主题 |

> 动作和表情库是**用户可编辑的**（见「自定义资源」），所以 id 因人而异。
> 不要硬编码 id，先 `lingxi_capabilities`。

---

## 2. Claude Code hooks

主界面 →「Agent 接入」→「一键接入」。会把三个 hook 合并写进 `~/.claude/settings.json`
（原文件先备份成 `.lingxi-backup`，只往数组里追加，不覆盖你已有的 hooks）：

- `UserPromptSubmit` → 新一轮开始
- `Stop` → 本轮完成
- `StopFailure` → 本轮出错

猫会**立刻有反应**，不需要 Agent 额外做任何事：

| 事件 | 表情 | 动作 | 说话 |
|---|---|---|---|
| 完成 | 开心 | 举爪招呼 | 「搞定啦～」 |
| 失败 | 不爽 | 摇头 | 「这次没成…」 |
| 等你 | 好奇 | 注意到你 | 「在等你哦」 |
| 进行中 | 认真 | — | — |

每完成一件事都会记一笔；到第 10 / 50 / 100 / 250 / 500 / 1000 件时它会专门说一句。

---

## 3. 直接 HTTP

```bash
BASE=http://127.0.0.1:47811

curl -s $BASE/capabilities            # 全部能力清单
curl -s $BASE/status                  # 大小、显隐、主题、视角
curl -s $BASE/perception              # 实时：位置、状态、正在播的动作、玩具、活跃度
curl -s $BASE/memory                  # 记忆
curl -s $BASE/reminders               # 待提醒事项

# 一个端点做所有控制，字段可任意组合
curl -s -X POST $BASE/control -H 'Content-Type: application/json' \
  -d '{"expression":"开心","action":"paw-wave","say":"测试通过啦"}'

curl -s -X POST $BASE/memory    -d '{"text":"习惯先量数据再改代码","kind":"preference"}'
curl -s -X POST $BASE/reminders -d '{"text":"该站起来走走啦","inMinutes":45}'

# 建议它走到某处（会自己过期，不是接管）
curl -s -X POST $BASE/intent -d '{"targetPoint":{"x":400,"y":300},"holdMs":4000}'
```

`/control` 对未知 id **会明确报错**而不是静默忽略：

```json
{"ok":false,"rejected":["perform: unknown performance \"nope\" (see GET /capabilities)"]}
```

---

## 写给 Agent 作者的几句

- **先读能力再动手。** 库是用户可编辑的。
- **克制。** 猫和一个正在干活的人共用一块屏幕。表情和短句可以随便用；全屏特效留给真正
  值得的时刻（长构建终于绿了，不是每次写文件）。
- **记忆是给人看的。** `memory.json` 是纯文本，用户随时会打开看。一句一条事实，
  不要写任何密钥、凭证，或者用户不希望落到磁盘上的东西。
- **先看状态再打断。** 用户正拖着猫玩的时候，不要抢过来演特效。
