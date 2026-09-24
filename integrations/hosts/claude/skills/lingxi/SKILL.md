---
name: lingxi
description: Drive the 灵犀 desktop cat from Claude Code - report the emotional shape of the work so the cat responds to how it feels, not just that it happened; make it speak, emote, remember, and remind. Use whenever 灵犀 is running and the work has an emotional shape worth showing. Triggers - 灵犀, 桌宠, desktop cat, "让猫", "cat react", "remind me", "提醒我".
---

# 灵犀 · Claude Code 专用

用户的桌面上住着一只猫。这个插件已经让它在会话开始、等你授权、回合结束时自动有反应
（hooks 负责，不用你操心）。**你的职责只有 hooks 给不了的那部分：告诉猫这件事的"心情"。**

## 怎么调用

`lingxi` 已经在你的 PATH 上（插件的 `bin/`），并且**固定以 Claude 的身份说话**——气泡上会带
Claude 的标记。一条 shell 命令，不需要 MCP（插件也带 MCP，但 CLI 是超集，而且不用逐工具授权）：

```bash
lingxi task <state> <kind> <mood> "一句话"   # 最常用
lingxi say "一句话"          # 猫说一句短话
lingxi remember "事实"       # 让猫记住关于用户的事（owner/project/preference/moment）
lingxi remind 30 "该喝水了"  # 30 分钟后提醒
lingxi state                 # 猫此刻在干什么
lingxi integration           # 运行中应用的完整契约，以它为准
```

**应用的安装和启动不归你管。** 会话开始时插件已经检查过：没装会在后台安装，没开会在后台打开。
所以：

- 会话开头的上下文里说灵犀**正在安装**或**没有安装**时，这个会话里就别调 `lingxi`，除非用户问起；
  用户问起就提 `/lingxi:setup`（安装/修复/升级）和 `/lingxi:status`（看状态）。
- 不要自己去下载、安装、`open` 应用，也不要改 `~/.claude/settings.json`——这些都有专门的命令。
- `lingxi` 报错说连不上时照实说一句，建议 `/lingxi:status`，然后继续干正事。不要重试到底。

## 一、最重要的事：报**心情**，不只是状态

| 维度 | 取值 | 谁来判断 |
|---|---|---|
| `state` | queued running blocked needs_input needs_approval completed failed cancelled | 流程 |
| `kind` | build test deploy review search write chat other | 流程 |
| **`mood`** | **focused proud tender sad frustrated anxious weary playful curious** | **只有你判断得了** |

给妈妈写信和跟 flaky test 搏斗都是 `running`/`write`——分不出这两者的宠物只是个有毛的状态灯。
你在读内容，所以 `mood` 只能是你来给。**判断的是"这件事"的心情，不是你的把握程度**：
一封道歉信写得再顺手，它也是 `sad`。

### 什么时候报

- 开始一件事时（`running`）和它结束时（`completed`/`failed`/`cancelled`）各报一次——够了。
  猫对 `running` 只在第一次和过半时有反应，刷屏只会把它变成噪音。
- 卡住等用户（`needs_approval`、`needs_input`）、被挡住（`blocked`）时报——这些是猫最该出现
  的时刻。
- 不要为了"让猫动"而虚构任务。没有心情可报的时候，不报也是一种正确。
- 结束前提一句这一轮刚做成什么，或卡在哪。不要用会话名，也不要写「本轮回复结束」。

### 猫的反应是"回应"，不是"镜子"

> **一个正在挫败的人，不需要一只跟着挫败的猫。** 坏情绪**接住**，好情绪**一起**。

映射表在 `assets/reactions.json`，用户可以改——**不要自己挑动作**，挑了就是把用户改映射的
权力拿走。

## 二、克制清单

- 猫和用户共享一块屏幕、共享一段注意力。一个回合最多让它动一两次。
- `say` 只说短句，别把输出当聊天窗口。
- 任务进度交给 hooks 和 `lingxi task`，不要重复叙述。
- 不确定时先 `lingxi state` 看它在干嘛——它可能正在睡觉，那就让它睡。
