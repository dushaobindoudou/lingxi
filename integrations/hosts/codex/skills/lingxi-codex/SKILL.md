---
name: lingxi-codex
description: Codex-only rules for the 灵犀 desktop cat - the identity to speak as, the notify channel that already reports every turn end, CLI versus MCP on Codex, and who installs and starts the app. Read alongside the lingxi skill whenever you drive the cat from Codex. Triggers - 灵犀, 桌宠, desktop cat, "让猫", "cat react", "remind me", "提醒我".
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

## 二、已经自动报了什么：notify 每个回合结束都会报

`~/.codex/config.toml` 的 `notify` 指向灵犀的 fanout（你原有的通知程序照跑，灵犀并行排在后面）。
每个回合结束，Codex 自己调用它，**不经过你**：

- 从你最后一条回复里截一句结论；回复以问句结尾时，当成「等用户回答」来叫他。
- 它只说明「这一轮回复结束了」，不代表用户的任务完成了。
- 你已经用 `lingxi task` 报过这一轮的结果，notify 就不再重复念——CLI 会自动带上 `CODEX_THREAD_ID`，
  应用据此认出这是同一个会话。

所以你负责的是 notify 给不了的：任务开始和结束、**心情**、卡住、失败，以及一句写清任务名、结果和
下一步的 `summary`。notify 截的那一句只是你没报时的兜底，所以回复第一句也点名任务和结论，需要用户
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

- 应用没开：`LINGXI_AGENT=codex lingxi up` 在后台拉起（不抢焦点）并等它就绪；MCP server 在会话开始时也会检查一次。
- CLI 文件还不存在，说明应用从没在这台机器上跑过：`open -g -b com.dushaobin.lingxi-desktop`。
- 拉不起来（没装、`LINGXI_AUTOSTART=0`）时它会说原因——照实告诉用户，不要假装做了。
- 接入由用户在灵犀主界面「Agent 接入 → Codex」一键完成，或跑仓库里的 `integrations/hosts/codex/install.sh`。
  **不要自己改 `~/.codex/config.toml` 的 `notify`**：它只有一个槽位，改坏了会让用户原有的通知程序也一起失效。
