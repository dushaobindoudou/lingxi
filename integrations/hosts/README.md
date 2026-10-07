# hosts/ — 每个宿主一个专用插件

这里每个目录只为一个宿主负责，按那个宿主的真实形态来做，不做通用化折衷。**这是现在唯一的接入路径。**

> 曾经有一个 `integrations/plugins/` 通用插件目录，为了同时服务多个宿主做了取舍
> （Claude 的 hooks 走 node 适配器，署名 `claude-code`）。它已删除：两套并存意味着装错一套
> 就会在事件流里出现两个署名，而两边的文档各自推荐自己那套。
> **如果你之前装的是 `plugins/claude-code`，重装一次**：
> `claude plugin marketplace add dushaobindoudou/lingxi && claude plugin install lingxi@lingxi`。
>
> 每个宿主插件要达到的标准（装应用、复用数据、不阻塞宿主、不重复上报……）和现状审查见
> [`PLUGIN-STANDARD.md`](PLUGIN-STANDARD.md)；参照实现是 [`claude/`](claude/)。

| 目录 | 宿主 | 形态 | 关键取舍 |
|---|---|---|---|
| `claude/` | Claude Code | 标准 Claude 插件（plugin.json + hooks + skill + MCP） | hooks 用纯 `curl` 直发 `/task-event`，Rust 桥接原生映射 Claude 载荷——零 node 依赖，插件目录拷走也能用；hook 命令与 app 一键安装逐字相同，`remove_our_hook_entries` 能认出并接管卸载 |
| `codex/` | Codex | **原生插件** `plugin/`（`.codex-plugin` + hooks + skill + MCP，市场清单在仓库根 `.agents/plugins/`）；或安装器 + fanout 脚本 + skill | 插件 hooks 的载荷与 Claude 同形，但原始载荷会被桥接记成 claude，所以 `event.sh` 改写成通用事件、署名 codex；`notify` 已指向灵犀时插件把回合事件让给它。安装器保留既有 notify（fanout 合并而不是覆盖） |
| `dsh/` | DeepSeek Harness (DSH) | 动态 Cordis 插件源码 | DSH 没有进程外插件机制——能力以动态 Cordis 插件注册为 model Tools；源码入库、`cordis_define` 加载，会话级生效 |
| `doubao/` | 豆包（Doubao） | 安装器 + skill 软链 + CLI 包装器 + 身份注册 + 回合监听 | 豆包没有 hooks，「确定性的一半」由回合监听（LaunchAgent 读豆包日志的开始/结束/提问三种行）补上；MCP 对豆包返回空工具列表（它的 tools/call 从不送达）；身份不用机器级 `agent.json`，用 `bin/lingxi` 包装器每次调用钉住 `doubao` |
| `workbuddy/` | WorkBuddy | 插件包 `plugin/`（CodeBuddy 市场，含 SessionStart 自动安装）；安装器 + hooks + MCP 配置 + skill 软链 + 身份注册 | **5.6+ 已有确定性的一半**：`~/.workbuddy/settings.json` 的 hooks（载荷与 Claude Code 兼容，实时生效）承担 UserPromptSubmit/Stop；身份不能用宿主 `env`（信任按配置哈希记账），只能走机器级文件 |
| `cursor/` | Cursor | 安装器 + 用户级 hooks + MCP + skill 软链 | hooks 是确定性的一半（会话开始 / 提交 / 回合结束）；身份用 `LINGXI_AGENT=cursor` 写在 MCP 与 hook 里，**不改**机器级 `~/.lingxi/agent.json` |

## 应用没装时

每一条路径都会自己把灵犀装上（[PLUGIN-STANDARD](PLUGIN-STANDARD.md) A1），用的是同一个安装器
[`../shared/install-app.sh`](../shared/README.md)：插件在会话开始时、MCP server 在宿主连上时、
`lingxi up` 被调用时、各 `install.sh` 在第 0 步。

## 验收基线

每个目录的 README 里有自己的验收命令。共同底线：桥接 `/health` 通、token 权限 0600、
事件在 `lingxi events`（或 `/debug/events`）里署名正确、卸载后不再产生事件。

新宿主接入还必须完成以下检查，详细要求见[气泡配置与每轮任务总结](../../docs/19-agent-integration.md#接入时必须检查并更新气泡配置)：

- 根据应用场景读取并更新 `assets/bubble.json`，默认气泡配置不适合所有应用；修改共享配置后检查其他宿主的显示效果。
- 确认气泡和文字是否需要居中、icon 的位置与间距，并检查短句、多行文本和无图标场景。当前居中与 icon 位置没有配置字段，需要在渲染实现中优化。
- 检查正文色 `text` 与强调色 `accentText` 的显示和可读性；任意片段多色作为后续优化需求。
- 每轮根据最新对话更新任务 `summary`，结束时总结结果或阻塞原因；用一轮改变任务范围的追问验证展示内容会刷新，不沿用过时标题。
