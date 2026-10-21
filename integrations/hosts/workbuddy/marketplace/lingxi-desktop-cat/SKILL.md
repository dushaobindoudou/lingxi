---
name: lingxi-desktop-cat
display_name: 灵犀桌宠
display_name_en: Lingxi Desktop Cat
description: "让桌面上的 3D 小猫替你传达任务的开始、结果、失败和等待，并按内容判断心情（得意、温柔、挫败、担心、疲惫）。需要「灵犀」macOS 应用，没装时经用户同意可一键下载安装。触发词：灵犀、桌宠、小猫、让猫、猫的反应、提醒我、lingxi、desktop cat。"
description_zh: 把任务状态和情绪交给桌面上的 3D 小猫：完成时一起得意，失败时接住你，需要你处理时凑过来提醒。需要「灵犀」macOS 应用，没装时经你同意可一键下载安装。
description_en: "Let a 3D desktop cat carry your task states and moods: celebrate completions, soften failures, and nudge you when input is needed. Requires the Lingxi macOS app, which it can download and install for you once you agree."
category: productivity
version: 1.0.2
author: 灵犀 Lingxi
---

# 灵犀 · 一只有反应的桌面猫

用户的 Mac 上住着一只 3D 小猫。它自己在屏幕边缘散步、休息、睡觉，绕开你的鼠标。
**你能让它对正在发生的事作出反应**——不是弹通知，是抬头看你、凑过来、伸个懒腰、说一句很短的话。

这个技能做三件事：把任务进度报给它、把**心情**报给它、让它替用户记住该提醒的事。

## 先确认前提（只支持 macOS）

灵犀是 macOS 桌面应用，不是本技能自带的运行时。**第一次使用、或者猫没反应时，先跑一次只读体检：**

```bash
bash scripts/check.sh
```

它不下载、不安装、不启动、不写任何文件。最后一行 `RESULT:` 就是结论，按它处理：

| RESULT | 含义 | 你该做什么 |
|---|---|---|
| `ready` | 一切就绪 | 继续，往下读 |
| `app-not-running` | 装了但当前没开 | 直接调用 `scripts/lingxi.sh`，它会拉起一次 |
| `app-missing` | 没有安装 | 问用户要不要帮他装，同意后跑 `bash scripts/install.sh`（见下） |
| `app-not-started` | 装了，但从没启动过 | 让用户打开一次，或直接调用 `scripts/lingxi.sh` |
| `token-missing` | 桥接 token 还没生成 | 同上一行：让应用启动一次 |
| `unsupported-os` | 不是 macOS | 直接说明不支持，不要找替代路径 |

### 没装：问一句，同意就替他装好

用户不会自己去 GitHub 找安装包，别把下载页甩给他。`app-missing` 时**只问一句**，例如：

> 桌面猫「灵犀」还没装。要我现在帮你下载安装吗？大约一两分钟，装好会自动打开。

- 用户同意（「好」「装吧」「可以」都算）→ 立刻执行，不再追问：

  ```bash
  bash scripts/install.sh
  ```

  它从 GitHub Releases 下载最新版，校验 SHA256、bundle id 和代码签名，不对就拒装；
  装进「应用程序」（不可写时装到 `~/Applications`）并打开。已经装着就什么也不做。
- 最后一行有 `✓` 才算成功：告诉用户猫已经出来了，然后继续他原本的任务。
  没成功就照实转述那一行原因，再给下载页 `https://github.com/dushaobindoudou/lingxi/releases/latest`
  作为退路；退出码 3 表示另一个安装正在进行，等半分钟再跑一次 `check.sh`。
- 用户拒绝或没回应 → 不装，本次对话不再提，照常完成他的任务。
- 只能用 `scripts/install.sh` 安装：不要自己拼 curl / hdiutil，不要复制别处的 `.app`，
  没跑成功之前不要说「已经装好了」。

用户设了 `LINGXI_AUTOSTART=0` 表示不想让猫自己冒出来，照实说明，别绕过去。

体检通过后，`scripts/lingxi.sh` 是唯一入口：它定位 CLI、在需要时拉起应用，然后把参数原样转发。
**下面所有命令都写成 `bash scripts/lingxi.sh ...`。** CLI 不在 PATH 上，这是正常的。

### 接入引导：把这台 Mac 上其他 AI 软件也接上

灵犀就绪后，每个会话第一次用猫时跑一次扫描（只读）：

```bash
bash scripts/lingxi.sh connect
```

- 最后一行 `OFFER: no` → 什么都不说。
- `OFFER: yes <软件…>` → 在自然停顿处问一句，例如「这台 Mac 上还有 Cursor 没接上灵犀，要我一起接上吗？」
  同意就 `bash scripts/lingxi.sh connect --all`，把每行 ✓ / ✗ 转述给用户，并提醒「新开一个会话后生效」；
  只要其中几个就 `connect <软件 id>…`；拒绝或没回应就 `connect --decline`（30 天内不再问）。
- 只通过 `connect` 接入，不要自己改别的软件的配置文件。整场对话最多问一次。
- 命令报不认识 `connect`，说明灵犀应用版本较旧，跳过这一步，不要提。

## 一、最重要的一件事：报心情，不只是状态

```bash
bash scripts/lingxi.sh task <state> <kind> <mood> "一句话"
```

| 维度 | 取值 | 谁来判断 |
|---|---|---|
| `state` | queued running blocked needs_input needs_approval completed failed cancelled | 流程 |
| `kind` | build test deploy review search write chat other | 流程 |
| **`mood`** | **focused proud tender sad frustrated anxious weary playful curious** | **只有你能判断** |

`state` 和 `kind` 描述流程。给妈妈写信和跟一个 flaky test 搏斗，都是 `running` / `write`
——分不出这两者的宠物，只是一个有毛的状态灯。

| mood | 什么时候 | 例子 |
|---|---|---|
| `tender` | 私人的、亲密的、柔软的 | 写给家人的信、纪念日、准备礼物 |
| `proud` | 难啃的东西终于通了 | 攻克一个算法、重构收尾 |
| `sad` | 坏消息、失去、道歉 | 写道歉邮件、项目黄了 |
| `frustrated` | 同一个东西又败了 | 第四次跑同一个测试 |
| `anxious` | 有风险、不可逆、有 deadline | 上生产、改数据库、明早要交 |
| `weary` | 干了很久、很晚了 | 连续三小时、凌晨两点 |
| `playful` | 玩票、轻松 | 取名字、周末小项目 |
| `curious` | 在读新东西 | 调研、翻陌生代码库 |
| `focused` | 普通干活（默认） | 大多数时候 |

判断的是**这件事**的心情，不是你的把握程度。你对一封道歉信很有把握，它依然是 `sad`。
不确定就不报 mood（默认 `focused`）——报错情绪比不报更糟。

**猫的反应是"回应"，不是"镜子"**：坏情绪接住，好情绪一起。所以别自己挑动作和表情，
报 mood 就够，剩下的由应用和用户自己配的映射决定。

## 二、什么时候开口

猫是关键消息的传达者，不是日志播报员。

| 事件 | 什么时候 | 怎么报 |
|---|---|---|
| 需要用户决定、授权或补充信息；失败或有明确风险 | 立刻 | `needs_input` / `needs_approval` / `failed`，`summary` 写清发生了什么、现在要用户做什么 |
| 一轮工作结束、有可用结果、重要里程碑 | 自然停顿处 | `completed`，点名任务、做成了什么、下一步 |
| 开始、常规进度、工具日志 | 安静 | 第一次 `running` 换个表情就够 |

**任务报告是主通道。** 每件真实的事：开始报 `running`，结束报终态，**始终复用同一个 `taskId`**。
CLI 通过环境变量传：每条命令都带同一个 `LINGXI_TASK_ID`（shell 之间环境变量不会保留，要逐条写）。

```bash
LINGXI_TASK_ID=fix-login bash scripts/lingxi.sh task running write focused "正在修复登录提示并检查相关测试"
LINGXI_TASK_ID=fix-login bash scripts/lingxi.sh task completed write proud "登录提示已修复，相关测试通过，可以继续发布"
```

`summary` 写**任务名 + 结果 + 下一步或原样的问题**，一两句、结论在前、最多 140 字。
猫会完整显示并按长度延长停留，别缩成「完成了」，也别拿工作目录、会话 ID、会话标题代替任务名。
同一结果只报一次。

### 不等人开口，这几个时刻主动报

| 你看到的 | 报什么 |
|---|---|
| 用户话里带情绪：烦、急、累、高兴、写给家人 | 第一条 `running` 就带对应 mood |
| 红转绿、难啃的东西通了 | `completed` + `proud` |
| 同一个问题第三次失败 | `failed` + `frustrated`，说卡在哪、下一步试什么 |
| 要做不可逆的事（删数据、上生产、强推） | 动手前 `running` + `anxious` |
| 连着干了两三个小时，或深夜 | mood 报 `weary`，并设一个休息提醒 |
| 在等超过两分钟的外部过程 | `blocked`，说在等什么 |

一个时刻只报一次，不为同一件事叠加。

### 偶尔给一点小惊喜：自动特效

全屏特效由你根据任务语境自己挑，但只在用户开了「设置 → 自动特效」时才放。时机是上表里分量最重的
那几种：难啃的问题终于解决、长时间构建首次全绿、交付了重要成果，或者用户道谢、表达亲近。
普通改动、日常问答、每次测试通过都不放；失败、风险、等授权**绝不**用特效。拿不准就不放。

1. 先 `bash scripts/lingxi.sh caps`，看 `autoEffects`：`enabled: true` 且 `remainingCooldownMs: 0`
   才继续；关着、冷却中或没有这个字段就安静跳过，不替用户打开，也不等冷却结束再试。
2. 从同一份结果的 `performances` 里挑一个合情绪的：庆祝或放松挑 `zoomies`，回应亲近挑 `kiss-rush`。
   `angry-claw` 只用于明确的玩笑；`pee-at-you` / `poop-at-you` 只在用户自己想看或已在开玩笑时用。
3. 放 `bash scripts/lingxi.sh perform <id>`（不加 `--manual`）。被拒或跳过就到此为止，不重试。

同一任务最多一次，所有 Agent 共用至少 10 分钟冷却；用户正拖猫、玩玩具或撸猫时别抢。
特效是任务报告的点缀，不代替 `completed` 那条报告，也不重复播报同一结果。
用户点名要看某个特效时，才用 `perform <id> --manual`；不要把自己挑的特效标成手动来绕开开关。

### 用户觉得猫不够主动时

猫的反应有两个来源：

| 来源 | 覆盖 | 谁触发 |
|---|---|---|
| 你主动上报（本技能） | 任务终态、心情、等待 | 你，想起来才报 |
| 宿主的会话 hooks | 每轮开始/结束、失败、权限弹窗 | 宿主，一定发生 |

hooks **不在这个技能的能力范围内**，你也**不要**去写 `~/.workbuddy/settings.json`。

**什么时候提（整场对话最多一次）：**

- 用户问「为什么它不自动反应」「怎么让它每轮都有反应」；
- 或者用户明确说以后要长期用、在问「有没有更完整的接入」。

其余时候不提。不装也能用——主动推销会把「安静陪伴」变成广告。

真的要说时：

1. 先跑 `bash scripts/check.sh`，看有没有「会话 hooks 已安装」这一行——有就说明已经装了，
   问题在别处（回到排障）。
2. 没有的话，用一句「这是可选增强，不装也能用」说明差别，然后**只给一条**最合适的路：
   - 普通用户：在 WorkBuddy 里输入 `/plugin marketplace add dushaobindoudou/lingxi`，
     再输入 `/plugin install lingxi@lingxi`。
   - 开发者：按仓库 README 跑一次 `install.sh`，幂等，重复跑不会重复装。
3. 不装也能用：你照样能报终态和心情，只是少了"每轮一定发生"的确定性兜底。
4. **整场对话最多提一次。** 用户说不需要就不再提，也不要在任务汇报里夹带这件事。

## 三、提醒：猫记得，而不是你记得

```bash
bash scripts/lingxi.sh remind 45 "该起来走走啦" --mood tender
bash scripts/lingxi.sh remind 09:30 "站会时间到啦" --mood focused --every 1440   # 每天 09:30
bash scripts/lingxi.sh reminders                                                  # 看都设了什么
```

- `--mood` 决定用什么表情送达：「记得喝水」和「该交税了」不是同一张脸。
- `--every N` 是常驻提醒，最小 5 分钟。固定时间点用 `HH:MM`（今天没过就是今天，过了就是明天）。
- 用户说"等下要…""明天…"且时间明确 → 直接设，然后告诉他你设了几点；时间不明确 → 先问，
  或者说明你采用了哪个时间。
- 只看到截止日期时先提议，不擅自建。

## 四、记忆：让猫更懂他

```bash
bash scripts/lingxi.sh remember "写代码前喜欢先把根因量出来" preference
bash scripts/lingxi.sh recall
```

`kind` 只有四个：`owner`（他是谁）、`project`（在做什么）、`preference`（怎么做事）、`moment`（发生过的事）。

**只在真的观察到新东西时写**，一小时一条已经算多。值得记的是「周四晚上常熬到很晚」
「被 flaky test 惹毛过好几次」；「是个程序员」「在用 TypeScript」看代码就知道，不算观察。

**绝不写**密码、密钥、他人的私人信息、健康与财务细节——这是一个用户会自己打开读的明文文件。

## 五、预算：安静是默认值

每一次可见的动作都是从用户注意力里扣掉的，不是演示。

| 通道 | 预算 |
|---|---|
| 气泡 | 每个真实任务终态与待回答问题都要传达；纯闲聊 ≤ 3 次/小时 |
| 表情 | 不限，但同一分钟内别重设，2 秒内别切两次 |
| 动作 | ≤ 6 次/小时，只在自然停顿处 |
| 全屏特效 | 仅用户开启「设置 → 自动特效」后偶尔触发；同一任务最多一次，至少间隔 10 分钟 |
| 玩具 | ≤ 1 次/天 |

动手前先 `bash scripts/lingxi.sh state`：用户正在拖猫、玩玩具或撸猫时，他已经在互动了，别抢。

## 六、自证生效

发完要能验证，否则就是瞎飞。

```bash
bash scripts/lingxi.sh state     # expression / action / heading / intent
bash scripts/lingxi.sh status    # skin / camera / scale / visible
bash scripts/lingxi.sh agents    # 谁在驱动
```

**动作有延迟是正常的**：猫在走路时动作会推迟到它停下才播。单次采样看到的 `action`
可能是上一个自主动作——不要据此判定失败然后重发。

## 七、别做的事

- **别自己挑动作和表情来表达任务结果**，报 `mood` 让猫决定；唯一例外是上面「自动特效」那条路。
- **别改 `skin` / `camera` / `scale` / `visible`**——那是用户的偏好，不是你的表达手段。
- **别把 `alert` 当默认**，用户要看的是要紧的事，不是要紧的工具。
- **别在 `running` 时话多**，陪着比说话好，尤其是 `tender`。
- **拿到 `stage busy` 就丢掉，不要重试**——等舞台空出来时，那句话已经在讲历史了。
- **别调 `update` 子命令**，升级由用户自己决定。

## 需要更多细节时

- 全部 CLI 子命令、参数、优先级与坐标：`@references/cli-reference.md`
- 猫没反应、`stage busy`、权限被拒、应用不在跑：`@references/troubleshooting.md`
