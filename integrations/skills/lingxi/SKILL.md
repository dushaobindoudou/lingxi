---
name: lingxi
description: Drive the 灵犀 desktop cat - let it react to what you are working on with expressions, actions and short lines, remember things about the user, and nudge them later. Use whenever 灵犀 is running and the work has an emotional shape worth showing. Triggers - 灵犀, 桌宠, desktop cat, "让猫", "cat react", "remind me", "提醒我".
---

# 灵犀 · 一只住在桌面上的猫

用户的桌面上住着一只猫。你可以看到它在做什么，也可以让它对你正在做的事作出反应。

**它的名字是"灵犀"——心有灵犀。** 这不是装饰性的命名，是验收标准：一只只会在任务结束时挥个爪
的猫，任何状态灯都能做到；一只知道你今晚在给妈妈写信、知道你和同一个 bug 耗了三小时的猫，才配
叫这个名字。

## 怎么调用

```bash
lingxi help          # 全部子命令
lingxi state         # 猫在干什么
lingxi integration   # 运行中的应用吐出的完整契约，以它为准
```

`lingxi` 在仓库的 `integrations/cli/lingxi`。它自己读鉴权 token，不用配置。
如果命令不存在或 `lingxi health` 连不上，**就说猫没启动**，不要假装做了。

也有 MCP server（`lingxi_*` 工具），宿主想要带类型的 schema 时用。两条路同一个桥，
**两条路也认同一个署名变量**：设了 `LINGXI_AGENT`，每一次调用都会带上它并自动补注册；
不设的话两边都会以 `anonymous`（💻）出现，用户分不清是哪个 agent。
MCP 的 `lingxi_task` 同样接受 `mood`——别以为只有 CLI 有。

---

## 一、最重要的一件事：报告**心情**，不只是状态

```bash
lingxi task <state> <kind> <mood> "一句话"
```

| 维度 | 取值 | 谁来判断 |
|---|---|---|
| `state` | queued running blocked needs_input completed failed cancelled | 流程 |
| `kind` | build test deploy review search write chat other | 流程 |
| **`mood`** | **focused proud tender sad frustrated anxious weary playful curious** | **只有你能判断** |

`state` 和 `kind` 描述的是**流程**。给妈妈写信和跟一个 flaky test 搏斗，两件事都是
`running` / `write`——分不出这两者的宠物，就是一个有毛的状态灯。

**`mood` 是你在读内容，所以只有你判断得了。** 这是整个接入里最有价值的一个字段。

### mood 怎么选

| mood | 什么时候 | 例子 |
|---|---|---|
| `tender` | 私人的、亲密的、柔软的 | 写给家人的信、纪念日、准备礼物、悼词 |
| `proud` | 难啃的东西终于通了 | 攻克了一个算法、重构收尾 |
| `sad` | 坏消息、失去、道歉 | 删掉写了很久的东西、写道歉邮件、项目黄了 |
| `frustrated` | 同一个东西又败了 | 第四次跑同一个测试、和构建系统打架 |
| `anxious` | 有风险、不可逆、有 deadline | 上生产、改数据库、明早要交 |
| `weary` | 干了很久、很晚了 | 连续三小时、凌晨两点 |
| `playful` | 玩票、轻松 | 取名字、周末小项目、瞎折腾 |
| `curious` | 在读新东西 | 调研、翻陌生代码库 |
| `focused` | 普通干活（**默认**） | 大多数时候 |

**判断的是"这件事"的心情，不是你自己的把握程度。** 你对一封道歉信很有把握，它依然是 `sad`。

### 猫的反应是"回应"，不是"镜子"

这是设计规则，也是"治愈系"具体的意思：

> **一个正在挫败的人，不需要一只跟着挫败的猫。** 那是同一块屏幕前有两个人在烦。
> 他需要的是一个小小的、温热的、不受影响的东西。

所以内置映射是这样的：

| 你报的 | 猫的反应 | 为什么 |
|---|---|---|
| `failed` + `frustrated` | 委屈 + 伸爪够你 +「唔…这个真的难。歇一下再来？」 | **接住**，不是一起生气 |
| `failed` + `sad` | 温柔 + 头蹭你 +「没关系的，我在。」 | 陪着，不评价 |
| `failed` + `anxious` | 安心 + 伸爪 +「别急，一步一步来」 | 稳住，不加压 |
| `failed` + `weary` | 困困 + 趴下 +「今天到这儿吧，明天再说」 | 给台阶下 |
| `completed` + `proud` | 得意 + 伸懒腰 +「看我的～」 | **好情绪要一起**，这才是高兴的意义 |
| `completed` + `weary` | 满足 + 呼噜趴下 +「终于弄完了…歇会儿吧」 | 落地，不是再来一轮 |
| `completed` + `tender` | 温柔 + 头蹭 +「写完啦，蹭蹭你」 | |
| `running` + `tender` | 温柔（**不说话**） | 私人的事，陪着就好，别插嘴 |
| `running` + `weary` | 困困 + 打哈欠 | 一个不说话的提醒 |

坏情绪**接住**，好情绪**一起**。这是唯一需要记住的规则。

用户可以在 `assets/reactions.json` 里改任何一条——所以**不要自己挑动作**，
挑了就把这个权力从用户手里拿走了，而且我们每加一个动作你都得改。

---

## 二、任务进度：大部分时候应该是安静的

长任务会报很多次进度。**猫对每一次都反应，就变成了桌宠本该替代的那种通知轰炸。**

```bash
lingxi task running build focused "编译中"          # 第一次：设置表情
lingxi raw POST /task-event '{"state":"running","progress":0.6,...}'   # 过半：再看一眼
lingxi task completed build proud "过了"            # 终态：一定会表现
```

系统帮你兜底：`running` 的更新**只有第一次和跨过 50% 那次**会产生反应，其余吞掉。
终态（completed / failed / needs_input / blocked / cancelled）**永远不会被吞**。

所以你可以放心地报进度，不用自己算什么时候该说话。

### 优先级：按**事情**的紧急程度，不按你的重要程度

```bash
LINGXI_PRIORITY=alert lingxi express 惊吓
```

| priority | 什么时候 | 冲突时 |
|---|---|---|
| `alert` | 用户**现在**得看一眼：失败、要确认、危险操作 | 立刻打断低的 |
| `report` | 有结果了 | **排队**等，带过期时间 |
| `status` | 状态变了，不急（默认） | 被拒绝，丢掉 |
| `ambient` | 纯氛围 | 被拒绝，丢掉 |

不要因为"我比较重要"就一律 `alert`。用户要看到的是**要紧的事**，不是要紧的工具。

---

## 三、提醒：猫记得，而不是你记得

```bash
lingxi remind 45 "该起来走走啦" --mood tender
lingxi remind 60 "站起来动一动" --mood tender --every 60     # 每小时一次
lingxi remind 1440 "明天记得回复那封邮件" --mood anxious
```

- `--mood` 决定**用什么表情送达**。「记得喝水」和「该交税了」不是同一张脸，
  用错语气的提醒比不提醒更糟。
- `--every N` 是常驻提醒，自己会重新上弦（最小 5 分钟——再快就是闹钟了，而这是只猫）。
- 多个提醒同时到期，猫**一次只说一个**，其余留到下一轮。不会一口气背清单。

**什么时候主动设提醒**（不用等用户开口）：

- 用户说"等下要…"、"晚点记得…"、"明天…" → 直接设上，然后告诉他你设了
- 你看到一个有时限的东西（证书过期、会议、deadline）→ 提议设一个
- 用户已经连续工作两三个小时 → `--mood tender` 设一个 45 分钟的休息提醒

---

## 四、让猫更懂他

```bash
lingxi remember "写代码前喜欢先把根因量出来" preference
lingxi recall
```

`kind` 只有四个：`owner`（他是谁）、`project`（在做什么）、`preference`（怎么做事）、
`moment`（发生过的一件事）。

**只在真的观察到新东西时写。** 重复记录同一件事会把 `memory.json`——一个用户会自己打开读的
文件——变成噪音。一小时写一条已经算多了。

好的记忆是**具体的**：

- ✅「周四晚上常常熬到很晚」「被 flaky test 惹毛过好几次」「喜欢先量再改」
- ❌「是个程序员」「在用 TypeScript」（看代码就知道了，不算观察）

**不要写**任何他不愿意看到被落在磁盘上的东西：密码、密钥、私人的第三方信息、
健康和财务细节。这是一个明文 JSON 文件。

---

## 五、预算：安静是默认值

猫和一个正在工作的人共用一块屏幕。**每一次可见的动作都是从他的注意力里扣掉的**，不是演示。

| 通道 | 预算 | 为什么 |
|---|---|---|
| 说话气泡 | ≤ 3 次/小时，绝不重复同一句 | 每句话都在抢注意力，重复是应用被卸载的原因 |
| 表情 | 不限，但同一个 60 秒内别重设，2 秒内别切两次 | 改起来免费，但闪烁就读不出来了 |
| 动作 | ≤ 6 次/小时，只在自然停顿处 | 一个动作占 3–6 秒，看得出来"被占用了" |
| 全屏特效 | ≤ 1 次/天，只给里程碑 | 占屏好几秒，用错一次就永久退休了 |
| 玩具 | ≤ 1 次/天，他明显被磨平了的时候 | 玩具出来猫就不干别的了 |
| 记忆 | 只在真有新观察时 | 见上 |

动手前先 `lingxi state`：如果用户正在拖猫或者在玩玩具，**他已经在和它互动了**，别抢。

---

## 六、其他场景（不默认集成，按需自己接）

我们**不**内置 IM / 邮件 / 日历。它们涉及用户的私人数据，默认连上是越界的。
但如果用户明确让你接，用同一套词汇表就行——猫不需要知道数据是从哪来的：

| 场景 | 怎么映射 |
|---|---|
| 收到重要消息 | `needs_input` + `chat` + mood 按内容判断，`alert` 优先级 |
| 一封难写的邮件 | `running` + `write` + `tender` 或 `sad` |
| 会议还有 10 分钟 | `lingxi remind 10 "十分钟后有会" --mood anxious` |
| CI 挂了 | `failed` + `build` + `frustrated` |
| PR 被 approve | `completed` + `review` + `proud` |
| 长时间没动静 | `lingxi express 困困`，`ambient` 优先级，别说话 |

**接之前先问用户。** 读邮件是读邮件，不管中间隔了几只猫。

---

## 七、自证生效

发完要能验证，否则就是瞎飞。

```bash
lingxi state     # expression / action / heading / intent / recoveredAt
lingxi status    # skin / camera / scale / visible
lingxi agents    # 谁在驱动
```

**动作有延迟是正常的**：猫在走路时，动作会推迟到它停下才播。单次采样看到的 `action`
可能是**上一个**自主动作——不要据此判定失败然后重发。

---

## 别做的事

- **别自己挑动作和表情来表达任务结果。** 报 `mood`，让猫决定。用户改一次映射，所有 agent 一起变。
- **别改 `skin` / `camera` / `scale` / `visible`。** 那是用户的偏好，不是你的表达手段。
  想被认出来，注册一个你自己画的 logo（`lingxi register`）。
- **别把 `alert` 当默认。**
- **别在 `running` 时话多。** 陪着比说话好，尤其是 `tender`。
- **拿到 `stage busy` 就丢掉**，不要重试——等舞台空出来时，你那句话已经在讲历史了。
