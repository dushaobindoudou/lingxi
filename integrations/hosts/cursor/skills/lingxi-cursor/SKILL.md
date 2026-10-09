---
name: lingxi-cursor
description: Cursor-only rules for the 灵犀 desktop cat - the identity to speak as, what the user-level hooks already report (session start, each prompt, each turn end), why Cursor's turn end carries no content without your report, and MCP trust on first use. Read alongside the lingxi skill whenever you drive the cat from Cursor. Triggers - 灵犀, 桌宠, desktop cat, "让猫", "cat react", "remind me", "提醒我".
---

# 灵犀 · 只在 Cursor 上成立的事

这是宿主层，是 `lingxi` 那份系统层的**补充**。什么时候通知、`summary` 怎么写、心情、提醒、记忆、
预算——都在 `lingxi` 里，两份都要读。这里只写换个宿主就不成立的事。

## 一、身份和入口

- **MCP**（`lingxi_task` 等 13 个工具）：配置里已带 `LINGXI_AGENT=cursor`，直接用。Cursor 第一次拉起
  这个 MCP 时会问是否信任，用户允许之后工具才会出现——没看到工具不是坏了，是还没被信任。
- **CLI**：终端里没有替你固定身份的东西，每条命令都带 `LINGXI_AGENT=cursor`，否则会顶着
  `~/.lingxi/agent.json` 里别的宿主说话。

```bash
LINGXI_AGENT=cursor LINGXI_TASK_ID=fix-login lingxi task running test focused "修复登录测试并检查失败原因"
LINGXI_AGENT=cursor LINGXI_TASK_ID=fix-login lingxi task completed test proud "登录测试已修复；18 项用例通过，可以继续发布"
```

## 二、hooks 已经自动报了什么

用户级 hooks（`~/.cursor/hooks.json`）在三个时刻必触发，不经过你：

| 时刻 | 猫知道的 |
|---|---|
| 会话开始 | 会话开了；猫没在跑时顺手在后台拉起（`LINGXI_AUTOSTART=0` 时不拉） |
| 你收到用户的一条消息 | 新一轮开始（不带用户说了什么） |
| 一轮结束 | 这一轮结束了——**不带任何内容**，Cursor 的这个事件里没有你的回复 |

所以在 Cursor 上，**这一轮做成了什么只有你报了猫才知道**。你没报时只更新状态，不播空的「回复结束」；
你报过时直接展示具体结果。每轮结束前报终态和 `summary`：任务名、结果、下一步或原样的问题。

已知真实会话 id 时，CLI 用 `LINGXI_SESSION`，MCP 的 `lingxi_task` 用可选 `session`，
这样能和 hooks 对齐；不知道时省略，不要拿别的会话 id 来填。

## 三、应用的安装和启动

- 会话开始的 hook 已经负责拉起；中途猫没开时 `LINGXI_AGENT=cursor lingxi up` 在后台拉起并等它就绪。
- 拉不起来（没装应用、`LINGXI_AUTOSTART=0`）时它会说原因——照实告诉用户，不要假装做了。
- 接入由仓库里的 `integrations/hosts/cursor/install.sh` 完成。不要自己改 `~/.cursor/hooks.json`：
  `beforeSubmitPrompt` 的输出写错一个字，就会拦住用户发消息。
