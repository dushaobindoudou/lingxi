# lingxi-codex — 灵犀的 Codex 专用插件

Codex 有两条接入路径，**选一条**：

| | 原生插件（推荐） | 安装器 `install.sh` |
|---|---|---|
| 怎么装 | `codex plugin marketplace add dushaobindoudou/lingxi && codex plugin add lingxi@lingxi` | `<repo>/integrations/hosts/codex/install.sh` |
| 确定性的一半 | hooks：会话开始、提交消息、等授权、回合结束 | `notify`：回合结束 |
| 应用没装 | 会话开始时从 GitHub 下载安装并打开 | 安装器第 0 步从 GitHub 安装 |
| 要不要仓库 | 不要，插件自包含 | 要，配置指向仓库路径 |
| 首次使用 | Codex 会提示审核插件 hooks（"hooks need review"），批准一次 | 无 |

两条都装了也不会重复：插件发现 `notify` 已经指向灵犀，就把回合事件让给它，只报 notify 报不了的
（会话开始、等授权）。

## 原生插件 `plugin/`

仓库根的 [`.agents/plugins/marketplace.json`](../../../.agents/plugins/marketplace.json) 是 Codex 的市场清单。
**它必须存在**：没有它时 Codex 会退回读 `.claude-plugin/marketplace.json`，把 Claude 插件装给 Codex 用户
——署名会变成 claude。

| 文件 | 作用 |
|---|---|
| `.codex-plugin/plugin.json` | 清单：skills、MCP、四个 hooks、展示信息 |
| `scripts/session-start.sh` | SessionStart：共享的 `ensure-app.sh`，以 codex 身份装/开灵犀，再报"会话开始" |
| `scripts/event.sh` | 把 Codex 的 hook 载荷改写成通用任务事件（provider/agent 都是 codex）。原始载荷会被桥接当成 Claude 的，所以不能直发 |
| `scripts/lingxi-mcp` | 找到这台 Mac 上的 node 再起 MCP server（从程序坞打开的 Codex 拿不到登录 shell 的 PATH） |
| `mcp/`、`scripts/{lib.sh,install-app.sh,ensure-app.sh,lingxi-cli}`、`skills/` | 逐字副本，测试守着 |

验收（临时环境，不动你的 `~/.codex`）：

```bash
T=$(mktemp -d); ln -s ~/.codex/auth.json "$T/auth.json"; export CODEX_HOME=$T
codex plugin marketplace add dushaobindoudou/lingxi && codex plugin add lingxi@lingxi
codex exec --dangerously-bypass-hook-trust --skip-git-repo-check "Reply with: ok"
lingxi events        # 应看到 provider=codex 的 queued / running / completed
```

## 安装器 `install.sh`

一个幂等安装器 + 它装出来的三样东西（第 0 步：灵犀没装就先从 GitHub 装上并打开）：

| 装出的东西 | 位置 | 作用 |
|---|---|---|
| notify fanout 脚本 | `~/.codex/notify-fanout.sh` | 回合结束自动报给猫；**你原有的通知器保留在前** |
| MCP 服务段 | `~/.codex/config.toml` `[mcp_servers.lingxi]` | 13 个带 schema 的工具；`LINGXI_AGENT=codex` 署名 |
| skill | `~/.codex/skills/{lingxi,lingxi-authoring,lingxi-codex}`（符号链接） | 系统层 `lingxi` 教模型什么时候通知、报什么、报 `mood`；宿主层 `lingxi-codex` 写 Codex 才成立的事（`LINGXI_AGENT=codex`、notify 报了什么、CLI 优先） |

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
# 3. rm ~/.codex/skills/lingxi ~/.codex/skills/lingxi-authoring ~/.codex/skills/lingxi-codex ~/.codex/notify-fanout.sh
```
