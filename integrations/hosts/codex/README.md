# lingxi-codex — 灵犀的 Codex 专用插件

这里的“插件”是 Codex 宿主接入：一个幂等安装器 + 它装出来的三样东西：

| 装出的东西 | 位置 | 作用 |
|---|---|---|
| notify fanout 脚本 | `~/.codex/notify-fanout.sh` | 回合结束自动报给猫；**你原有的通知器保留在前** |
| MCP 服务段 | `~/.codex/config.toml` `[mcp_servers.lingxi]` | 13 个带 schema 的工具；`LINGXI_AGENT=codex` 署名 |
| skill | `~/.codex/skills/lingxi`（符号链接） | 教模型报 `mood`、克制地用猫 |

`notify` 只代表 Codex 一轮回复结束，不证明用户任务已经完成；主界面会把这类事件标成“本轮回复结束”。真正的任务完成、失败和具体任务名应由 `lingxi_task` 报告。

## 安装

```bash
./integrations/hosts/codex/install.sh --dry-run   # 先看要改什么
./integrations/hosts/codex/install.sh
```

安装器承诺：

- **从不覆盖式写入 notify**——先把 config.toml 备份到 `config.toml.bak-lingxi-<时间戳>`，
  再把 notify 指向生成的 fanout 脚本，原通知程序作为第一条命令保留在 fanout 里；
- MCP 段用 `# >>> lingxi plugin >>>` 标记包裹，重复安装整体替换、不留垃圾；
- skill 是符号链接，`git pull` 即更新所有机器。

## 与已有手工配置的关系

如果之前按 `integrations/README.md` 手工配过（fanout 脚本 + `[mcp_servers.lingxi]`），
重跑本安装器会保留已有 fanout，并把无标记的 MCP 段原位替换成有标记的段，不会产生重复 TOML 表。
安装器会把 fanout 写成与手工版相同的语义（原通知器在前、`LINGXI_AGENT=codex` 发射在后）。

## 验收

```bash
grep -A3 'mcp_servers.lingxi' ~/.codex/config.toml   # 段存在、LINGXI_AGENT=codex
grep notify ~/.codex/config.toml                     # 指向 notify-fanout.sh
~/.codex/notify-fanout.sh '{"type":"agent-turn-complete","thread-id":"e2e","last-assistant-message":"验收"}'
lingxi events                                        # 最新一条 provider=codex
```

## 卸载

```bash
# 1. notify 换回 fanout 脚本里 "# 你原来的通知器" 那行（或安装前备份里的 notify 行）
# 2. 删掉 config.toml 里 >>> lingxi plugin <<< 标记段
# 3. rm ~/.codex/skills/lingxi ~/.codex/notify-fanout.sh
```
