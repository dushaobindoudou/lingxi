---
name: lingxi-doubao
description: 豆包 (Doubao)-only rules for the 灵犀 desktop cat - Doubao has no hooks, a turn watcher reports only that a turn started or ended, so the result is yours to report; the lingxi command on PATH always speaks as 豆包; MCP offers no tools here. Read alongside the lingxi skill whenever you drive the cat from 豆包. Triggers - 灵犀, 桌宠, desktop cat, "让猫", "cat react", "remind me", "提醒我".
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

**只用 CLI。** 豆包任务里的 MCP 调用从没送达过本机，所以灵犀的连接器在豆包里不提供任何工具；
看到别处写着 `lingxi_task` 之类的工具名，在这里一律换成对应的 `lingxi` 命令。

## 二、豆包没有 hook，插件用回合监听补上了一半

豆包本身不会告诉猫任何事。插件装了一个回合监听，读豆包自己的日志，在三个时刻自动报给猫：

| 时刻 | 猫知道的 |
|---|---|
| 你收到用户的一条消息 | 这个会话开始了一轮（气泡上用用户这句话当会话名） |
| 你用提问工具问用户 | 在等用户回答 |
| 这一轮结束 | 豆包回复结束——**不知道你做成了什么** |

所以**这一轮做成了什么只有你报了猫才知道**：任务开始报 `running`，结束报终态，点名任务、结果、
还要不要用户继续；需要回答时把问题原样写进 `summary`。你报过，这一轮结束时监听就不再重复念；
你没报，猫只能说一句「豆包回复结束，请查看结果」。失败、被挡住时报 `failed` / `blocked`，写清卡在哪。

## 三、应用的安装和启动

- 应用没开：`lingxi up` 在后台拉起（不抢焦点）并等它就绪；其它子命令遇到猫没开也会自己拉起一次。
- `lingxi` 找不到或气泡署名不是「豆」：插件没装好，告诉用户跑插件目录里的 `install.sh`（或 README 里的接入向导），
  不要自己改 PATH 或 `~/.lingxi/agent.json`。
- 拉不起来（没装应用、`LINGXI_AUTOSTART=0`）时它会说原因——照实告诉用户，不要假装做了。
