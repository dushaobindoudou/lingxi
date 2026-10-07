---
name: lingxi-codex
description: Codex-only rules for the 灵犀 desktop cat - the identity to speak as, the plugin hooks or notify channel that already report every turn end, CLI versus MCP on Codex, and who installs and starts the app. Read alongside the lingxi skill whenever you drive the cat from Codex. Triggers - 灵犀, 桌宠, desktop cat, "让猫", "cat react", "remind me", "提醒我".
---

# 灵犀 · 只在 Codex 上成立的事

这是宿主层，是 `lingxi` 那份系统层的**补充**。什么时候通知、`summary` 怎么写、心情、提醒、记忆、
预算——都在 `lingxi` 里，两份都要读。这里只写换个宿主就不成立的事。

## 一、身份：每条命令都带 `LINGXI_AGENT=codex`

Codex 的 shell 里没有替你固定身份的包装器。不带这个变量，CLI 会退回 `~/.lingxi/agent.json`——那是
机器级文件，常常写着别的宿主，猫就会顶着别人的头像替你说话。

```bash
LINGXI_AGENT=codex LINGXI_TASK_ID=fix-login lingxi task running test focused "修复登录测试，并检查失败原因"
LINGXI_AGENT=codex LINGXI_TASK_ID=fix-login lingxi task completed test proud "登录测试已修复；18 项相关用例通过，可以继续发布"
LINGXI_AGENT=codex lingxi remind 09:50 "十分钟后站会，准备加入" --mood focused --every 1440
```

`lingxi` 不在 PATH 上时用 `"$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bin/lingxi"`。
MCP server 的配置里已经写了 `LINGXI_AGENT=codex`，走 MCP 不用再带。

## 二、已经自动报了什么：每个回合结束都会报

接入方式有两种，效果一样，**不经过你**：

- **灵犀 Codex 插件**（`codex plugin add lingxi@lingxi`）：hooks 在会话开始、用户提交消息、等授权、
  回合结束时报给猫。
- **notify**（主界面一键接入，或 `integrations/hosts/codex/install.sh`）：`~/.codex/config.toml` 的
  `notify` 指向灵犀（用户原有的通知程序照跑），每个回合结束报一次。两种都装时插件自动让路，不会念两遍。

回合结束那一条：

- 从你最后一条回复里截一句结论；回复以问句结尾时，当成「等用户回答」来叫他。
- 它只说明「这一轮回复结束了」，不代表用户的任务完成了。
- 你已经用 `lingxi task` 报过这一轮的结果，就不再重复念——CLI 会自动带上 `CODEX_THREAD_ID`，
  应用据此认出这是同一个会话。

所以你负责的是自动上报给不了的：任务开始和结束、**心情**、卡住、失败，以及一句写清任务名、结果和
下一步的 `summary`。截的那一句只是你没报时的兜底，所以回复第一句也点名任务和结论，需要用户
回答时把问题放在最后一行。

## 三、CLI 还是 MCP

| | CLI（`lingxi task …`） | MCP（`lingxi_task` 等 13 个工具） |
|---|---|---|
| 会话 | 自动带上 `CODEX_THREAD_ID`，和 notify 落在主界面同一行，不会被念两遍 | 不知道会话；notify 可能在你之后再念一句 |
| 授权 | 跟普通 shell 命令一样 | 宿主按工具授权 |
| 能力 | 超集（还有 `activity`、`events`、`unremind`、`raw`） | 13 个带 schema 的工具 |

**优先用 CLI。** 沙箱禁网、CLI 报连不上 `127.0.0.1:47811` 时，改用 MCP 的 `lingxi_task`（它要求
`taskId` 和 `summary`，和 CLI 同一份契约）。

## 四、应用的安装和启动

不归你管，也不需要你做：

- 插件在会话开始时检查：没装就从 GitHub 下载最新版、校验后安装并打开；装了没开就在后台拉起。
  MCP server 连上时也做同一个检查。下载期间这个会话别调 `lingxi`，除非用户要求。
- 应用没开而你确实需要它：`LINGXI_AGENT=codex lingxi up`（没装时它也会从 GitHub 装）。
- 拉不起来（没装且关了自动安装、`LINGXI_AUTOSTART=0`）时它会说原因——照实告诉用户，不要假装做了。
- **不要自己改 `~/.codex/config.toml` 的 `notify`**：它只有一个槽位，改坏了会让用户原有的通知程序也一起失效。
