---
name: lingxi-doubao
description: 豆包 (Doubao)-only rules for the 灵犀 desktop cat - Doubao has no lifecycle hooks, so the cat knows only what you report; the lingxi command on PATH always speaks as 豆包; MCP does not reach the app from Doubao tasks yet. Read alongside the lingxi skill whenever you drive the cat from 豆包. Triggers - 灵犀, 桌宠, desktop cat, "让猫", "cat react", "remind me", "提醒我".
---

# 灵犀 · 只在豆包上成立的事

这是宿主层，是 `lingxi` 那份系统层的**补充**。什么时候通知、`summary` 怎么写、心情、提醒、记忆、
预算——都在 `lingxi` 里，两份都要读。这里只写换个宿主就不成立的事。

## 一、身份和入口：PATH 上的 `lingxi` 就是豆包

插件把包装器装在 `~/.local/bin/lingxi`，每次调用都**固定以豆包的身份说话**，气泡上带豆包的头像；
桥通时它还会顺手补注册头像，应用重启也不丢。不用设 `LINGXI_AGENT`，也不用管 `~/.lingxi/agent.json`。

```bash
LINGXI_TASK_ID=weekly-report lingxi task running write focused "整理本周周报，汇总三个项目的进展"
LINGXI_TASK_ID=weekly-report lingxi task completed write proud "周报已整理好，三个项目各一段；还差你补一句下周计划"
```

**只用 CLI。** 豆包任务里的 MCP 调用目前到不了本机（工具能列出来，调用帧从没送达），
模型以为「调用成功」其实什么都没发生。

## 二、豆包没有 hook：猫只知道你报的事

别的宿主会在回合结束、等授权时自动告诉猫；豆包不会。**你不报，猫就什么都不知道。** 所以系统层里
那几类消息全靠你：

- 一件事开始报 `running`，结束报终态——每一轮结束都要报，点名任务、做成了什么、还要不要用户继续。
- 需要用户回答、授权、补信息时报 `needs_input` / `needs_approval`，把问题原样写进 `summary`。
- 失败、被挡住时报 `failed` / `blocked`，写清卡在哪、下一步是什么。

没有 hook 兜底，所以也没有「重复念一遍」的问题——报一次就是一次。

## 三、应用的安装和启动

- 应用没开：`lingxi up` 在后台拉起（不抢焦点）并等它就绪；其它子命令遇到猫没开也会自己拉起一次。
- `lingxi` 找不到或气泡署名不是「豆」：插件没装好，告诉用户跑插件目录里的 `install.sh`（或 README 里的接入向导），
  不要自己改 PATH 或 `~/.lingxi/agent.json`。
- 拉不起来（没装应用、`LINGXI_AUTOSTART=0`）时它会说原因——照实告诉用户，不要假装做了。
