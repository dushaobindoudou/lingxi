# hosts/ — 每个宿主一个专用插件

`integrations/plugins/` 里的通用插件为了同时服务多个宿主做了取舍；`hosts/` 下的每个目录
只为一个宿主负责，按那个宿主的真实形态来做，不做通用化折衷。

**`hosts/` 是现在的首选路径。** `integrations/README.md`、`install-skills.sh` 与
`src-tauri/src/lib.rs` 的部分注释还指向 `plugins/`；以本表为准，`plugins/` 的去留待定
（见 `RELEASE-READINESS-2026-09-24.md` 的 S17）。

| 目录 | 宿主 | 形态 | 关键取舍 |
|---|---|---|---|
| `claude/` | Claude Code | 标准 Claude 插件（plugin.json + hooks + skill + MCP） | hooks 用纯 `curl` 直发 `/task-event`，Rust 桥接原生映射 Claude 载荷——零 node 依赖，插件目录拷走也能用；hook 命令与 app 一键安装逐字相同，`remove_our_hook_entries` 能认出并接管卸载 |
| `codex/` | Codex | 安装器 + fanout 脚本 + skill | Codex 没有插件清单格式，它的"插件"是一段 config.toml 与一个脚本；安装器保留既有 notify（fanout 合并而不是覆盖），身份用 `LINGXI_AGENT=codex` 而不是机器身份文件 |
| `dsh/` | DeepSeek Harness (DSH) | 动态 Cordis 插件源码 | DSH 没有进程外插件机制——能力以动态 Cordis 插件注册为 model Tools；源码入库、`cordis_define` 加载，会话级生效 |
| `workbuddy/` | WorkBuddy | 安装器 + MCP 配置 + skill 软链 + 身份注册 | **两层都是建议性的**：WorkBuddy 的会话事件不外露（没有 hooks，也没有 notify），所以没有"确定性的一半"，`mood` 只能靠模型自己报；身份不能用宿主 `env`（信任按配置哈希记账），只能走机器级文件 |

## 与通用插件的关系

`integrations/plugins/claude-code` 走 node 适配器（`${CLAUDE_PLUGIN_ROOT}` 相对路径引用仓库内
`adapters/`），署名是机器身份 `claude-code`。`hosts/claude` 走纯 curl 裸载荷路径，署名是
Rust 桥接给的 `claude`。两条路径会在事件流里出现两个署名——**别同时装**，装一个就够。

## 验收基线

每个目录的 README 里有自己的验收命令。共同底线：桥接 `/health` 通、token 权限 0600、
事件在 `lingxi events`（或 `/debug/events`）里署名正确、卸载后不再产生事件。

新宿主接入还必须完成以下检查，详细要求见[气泡配置与每轮任务总结](../../docs/19-agent-integration.md#接入时必须检查并更新气泡配置)：

- 根据应用场景读取并更新 `assets/bubble.json`，默认气泡配置不适合所有应用；修改共享配置后检查其他宿主的显示效果。
- 确认气泡和文字是否需要居中、icon 的位置与间距，并检查短句、多行文本和无图标场景。当前居中与 icon 位置没有配置字段，需要在渲染实现中优化。
- 检查正文色 `text` 与强调色 `accentText` 的显示和可读性；任意片段多色作为后续优化需求。
- 每轮根据最新对话更新任务 `summary`，结束时总结结果或阻塞原因；用一轮改变任务范围的追问验证展示内容会刷新，不沿用过时标题。
