# hosts/ — 每个宿主一个专用插件

`integrations/plugins/` 里的通用插件为了同时服务多个宿主做了取舍；`hosts/` 下的每个目录
只为一个宿主负责，按那个宿主的真实形态来做，不做通用化折衷。

| 目录 | 宿主 | 形态 | 关键取舍 |
|---|---|---|---|
| `claude/` | Claude Code | 标准 Claude 插件（plugin.json + hooks + skill + MCP） | hooks 用纯 `curl` 直发 `/task-event`，Rust 桥接原生映射 Claude 载荷——零 node 依赖，插件目录拷走也能用；hook 命令与 app 一键安装逐字相同，`remove_our_hook_entries` 能认出并接管卸载 |
| `codex/` | Codex | 安装器 + fanout 脚本 + skill | Codex 没有插件清单格式，它的"插件"是一段 config.toml 与一个脚本；安装器保留既有 notify（fanout 合并而不是覆盖），身份用 `LINGXI_AGENT=codex` 而不是机器身份文件 |
| `dsh/` | DeepSeek Harness (DSH) | 动态 Cordis 插件源码 | DSH 没有进程外插件机制——能力以动态 Cordis 插件注册为 model Tools；源码入库、`cordis_define` 加载，会话级生效 |

## 与通用插件的关系

`integrations/plugins/claude-code` 走 node 适配器（`${CLAUDE_PLUGIN_ROOT}` 相对路径引用仓库内
`adapters/`），署名是机器身份 `claude-code`。`hosts/claude` 走纯 curl 裸载荷路径，署名是
Rust 桥接给的 `claude`。两条路径会在事件流里出现两个署名——**别同时装**，装一个就够。

## 验收基线

每个目录的 README 里有自己的验收命令。共同底线：桥接 `/health` 通、token 权限 0600、
事件在 `lingxi events`（或 `/debug/events`）里署名正确、卸载后不再产生事件。
