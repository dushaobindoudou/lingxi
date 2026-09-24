---
name: lingxi
description: Drive the 灵犀 desktop cat from Codex - report the emotional shape of the work so the cat responds to how it feels, not just that it happened; make it speak, emote, remember, and remind. Use whenever 灵犀 is running and the work has an emotional shape worth showing. Triggers - 灵犀, 桌宠, desktop cat, "让猫", "cat react", "remind me", "提醒我".
---

# 灵犀 · Codex 专用

用户的桌面上住着一只猫。Codex 的确定性反应走两条已配置好的通道，**都不需要你触发**：

- `notify` fanout：每个回合结束时自动报给猫（fanout 同时保留你原有的通知器）；
- `mcp_servers.lingxi`：13 个带 schema 的工具，宿主按工具授权。

**你的职责是这两条通道都给不了的部分：这件事的"心情"。**

## 两条通道

| 通道 | 何时触发 | 报什么 |
|---|---|---|
| notify fanout | 回合结束（自动） | `completed` + `kind=chat`，只表示本轮回复结束，不代表用户任务完成 |
| MCP `lingxi_task` / CLI | 你主动调 | state + kind + **mood** + 一句话 |

notify 只能让猫知道"回合结束了"。开始一件事、卡住、需要授权、失败——以及所有心情，
都靠你。用 MCP 工具 `lingxi_task`，或 CLI：

```bash
lingxi task <state> <kind> <mood> "一句话"
lingxi state          # 猫在干什么
lingxi say "一句话"
lingxi remember "事实"       # owner/project/preference/moment
lingxi remind 30 "该喝水了"
```

CLI 不在 PATH 时用 `~/Library/Application Support/com.dushaobin.lingxi-desktop/bin/lingxi`。

## 一、报**心情**，不只是状态

| 维度 | 取值 | 谁来判断 |
|---|---|---|
| `state` | queued running blocked needs_input needs_approval completed failed cancelled | 流程 |
| `kind` | build test deploy review search write chat other | 流程 |
| **`mood`** | **focused proud tender sad frustrated anxious weary playful curious** | **只有你判断得了** |

给妈妈写信和跟 flaky test 搏斗都是 `running`/`write`——分不出这两者的宠物只是个有毛的状态灯。
你在读内容，所以 `mood` 只能是你来给。**判断的是"这件事"的心情，不是你的把握程度**：
一封道歉信写得再顺手，它也是 `sad`。

### 什么时候报

- 开始一件事（`running`）和它结束（`completed`/`failed`/`cancelled`）各一次——够了。
  notify 已经报过"结束"，结束时**带心情再报一次**才是你的价值。
- 卡住等用户（`needs_approval`、`needs_input`）、被挡住（`blocked`）时报——这些是猫最该出现
  的时刻。
- 不要为了"让猫动"而虚构任务。没有心情可报的时候，不报也是一种正确。

### 猫的反应是"回应"，不是"镜子"

> **一个正在挫败的人，不需要一只跟着挫败的猫。** 坏情绪**接住**，好情绪**一起**。

映射表在 `assets/reactions.json`，用户可以改——**不要自己挑动作**，挑了就是把用户改映射的
权力拿走。

## 二、克制清单

- 猫和用户共享一块屏幕、共享一段注意力。一个回合最多让它动一两次。
- `say` 只说短句，别把输出当聊天窗口。
- 不确定时先 `lingxi state` 看它在干嘛——它可能正在睡觉，那就让它睡。
