---
name: lingxi-claude
description: Claude Code-only rules for the 灵犀 desktop cat - what the plugin's hooks already report (permission prompts, questions, turn ends, todos), the lingxi command that always speaks as Claude, and why installing or starting the app is not your job. Read alongside the lingxi skill whenever you drive the cat from Claude Code. Triggers - 灵犀, 桌宠, desktop cat, "让猫", "cat react", "remind me", "提醒我".
---

# 灵犀 · 只在 Claude Code 上成立的事

这是宿主层，是 `lingxi` 那份系统层的**补充**。什么时候通知、`summary` 怎么写、心情、提醒、记忆、
预算——都在 `lingxi` 里，两份都要读。这里只写换个宿主就不成立的事。

## 一、身份和入口：直接用 `lingxi`

装了插件时 `lingxi` 就在你的 PATH 上（插件的 `bin/`）；没装插件时用
`"$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bin/lingxi"`。两种情况下它在 Claude Code
里都**固定以 Claude 的身份说话**——气泡上带 Claude 的图标和会话名——并自动带上这个会话的 id
（`CLAUDE_CODE_SESSION_ID`），所以你报的任务和 hooks 落在主界面同一行。不用设 `LINGXI_AGENT`，也不用管
`~/.lingxi/agent.json`。

插件也带 MCP，但**优先用 CLI**：它是超集，不用逐工具授权，而且知道自己在哪个会话里。

```bash
LINGXI_TASK_ID=fix-login lingxi task running test focused "修复登录测试并检查失败原因"
LINGXI_TASK_ID=fix-login lingxi task completed test proud "登录测试已修复；18 项用例通过，可以继续发布"
```

## 二、hooks 已经自动报了什么

hooks 来自插件，或来自灵犀主界面「Agent 接入 → Claude Code → 一键接入」写进 `~/.claude/settings.json` 的那几行，
两者报的一样（插件发现一键接入的 hooks 在时会自动让路，不会重复）。

| 时刻 | hooks 让猫做的事 | 你还要不要报 |
|---|---|---|
| 弹出授权、选择题（AskUserQuestion）、计划审批 | **当场**叫用户，说清要批什么：想跑哪条命令、想改哪个文件、问的是什么 | **不要**再报一遍 |
| 你的待办完成一项 | 更新主界面这个会话的状态，不说话 | 不用 |
| 一轮结束 | 你报过这一轮的结果就不再念；没报时说出你回复的第一句 | 这是你的主通道：结束前报终态和 `summary` |
| 回复以问句结尾 | 当成「等用户回答」来叫他，不说「做完了」 | 问题放在最后一行、用问句结尾 |

hooks 看不到的等待才需要你报：在等一个外部流程、被挡住（`blocked`）。不要为了让猫动而虚构任务。

回复第一句点名任务和结论，别以「好的」「我来看看」开头——你的主动报告没发出去时，猫说的就是这句。

## 三、应用的安装和启动不归你管

会话开始时 hook 已经检查过：插件会在没装时后台安装、没开时后台打开；一键接入的 hooks 会在没开时后台打开。所以：

- 会话开头的上下文说灵犀**正在安装**或**没有安装**时，这个会话里别调 `lingxi`，除非用户问起；用户问起
  就提 `/lingxi:setup`（安装、修复、升级）和 `/lingxi:status`（看状态）——没装插件时这两个命令不存在，
  改说「灵犀主界面 → Agent 接入」。
- 不要自己下载、安装、`open` 应用，也不要改 `~/.claude/settings.json`。
- `lingxi` 报连不上时照实说一句，然后继续干正事，不要重试到底。

## 四、内容去哪儿

- hooks 从你回复里截的那句只在本机用于气泡和主界面，不写进任务事件日志。
- 你主动报的 `summary` 会进本地任务历史；用户配置了通知渠道（Slack、飞书等）时也会发到那里。
  所以 `summary` 里别写密钥、密码、别人的私事。
