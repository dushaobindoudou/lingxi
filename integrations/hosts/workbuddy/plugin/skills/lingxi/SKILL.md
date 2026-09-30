---
name: lingxi
description: Drive the 灵犀 desktop cat - let it react to what you are working on with expressions, actions and short lines, remember things about the user, and nudge them later. Use whenever 灵犀 is running and the work has an emotional shape worth showing. Triggers - 灵犀, 桌宠, desktop cat, "让猫", "cat react", "remind me", "提醒我".
---

# 灵犀 · 一只住在桌面上的猫

用户的桌面上住着一只猫。你可以看到它在做什么，也可以让它对你正在做的事作出反应。

## 先读两份：这份是系统层，另有一份宿主层

灵犀的 skill 分两层，每个宿主都同时装着两份：

| 层 | skill | 管什么 |
|---|---|---|
| 系统层 | `lingxi`（本文） | 灵犀怎么和人相处：什么时候通知、报什么、心情、提醒、记忆、预算、别做的事。所有宿主一字不差 |
| 宿主层 | `lingxi-<宿主>`，如 `lingxi-claude`、`lingxi-codex` | 只在这个宿主上成立的事：以谁的身份说话、用 CLI 还是 MCP、宿主已经自动报了什么、应用由谁安装启动、这里特有的坑 |

**身份、调用入口、自动上报、安装启动——这四件事以宿主层为准，其余以本文为准。** 宿主层只补
这个宿主的事实，不改本文的规则。找不到宿主层时按本文的通用做法，并且别让 CLI 拿
`~/.lingxi/agent.json` 里的机器级身份冒充你（见「怎么调用」）。

## 什么时候让猫通知

猫是**关键消息的传达者**，不是日志播报员：

| 事件 | 什么时候说 | 怎么报 |
|---|---|---|
| 需要用户决定、授权或补充信息；失败或有明确风险 | 立刻 | `needs_input` / `needs_approval` / `failed`，`summary` 写清发生了什么、现在要用户做什么；要回答的问题原样写进去 |
| 一轮工作结束、有可用结果、重要里程碑 | 自然停顿处 | `completed`，点名任务、这轮做成了什么、下一步（包括是否还要用户继续驱动你） |
| 开始、常规进度、工具日志 | 安静 | 第一次 `running` 换个表情就够，重复进度不说话 |

**任务报告是主通道。** 每件真实的事：开始报 `running`，结束报终态（`completed` / `failed` /
`cancelled` / `needs_input` …），**始终复用同一个内部 `taskId`**（CLI 每条命令都带同一个
`LINGXI_TASK_ID`，shell 之间环境变量不会自动保留；MCP 的 `lingxi_task` 显式传 `taskId` 和 `summary`）。
`summary` 写**任务名 + 结果 + 下一步或原样的问题**，一两句、结论在前、最多 140 字。猫会完整显示、
按长度延长停留，不截断——所以别自己缩成「完成了」「搞定」，也别拿工作目录、会话 ID、旧会话标题
代替任务名。同一结果只报一次。

报 `state`、`kind`、`mood`，让应用的反应映射挑表情和动作。特效只给用户明确要的、或真值得庆祝的
里程碑，先查可用 id；风险、授权、普通提醒不做成全屏特效。

未来的事由你判断值不值得让猫记住：用户明确说了带时间的提醒或例行日程，主动 `lingxi remind`，并告诉
他实际触发时间；只有「明天」没有几点时，先问或说明你采用的时间；偶然看到的截止日期先提议，不擅自建。

**它的名字是"灵犀"——心有灵犀。** 这不是装饰性的命名，是验收标准：一只只会在任务结束时挥个爪
的猫，任何状态灯都能做到；一只知道你今晚在给妈妈写信、知道你和同一个 bug 耗了三小时的猫，才配
叫这个名字。

## 怎么调用

**一条 shell 命令搞定全部能力,不需要 MCP。**

```bash
lingxi help          # 全部子命令
lingxi state         # 猫在干什么
lingxi integration   # 运行中的应用吐出的完整契约，以它为准
```

**身份要固定。** 宿主层写着你的身份怎么来：插件自带的 `lingxi` 包装器、`LINGXI_AGENT=<宿主 id>`、
或 MCP 配置里的 env。没有宿主层时，每条命令都带上 `LINGXI_AGENT=<你的宿主 id>`——不带时 CLI 退回
`~/.lingxi/agent.json`，那是机器级文件，常常写着别的宿主，猫就会顶着别人的头像替你说话。

### 第一步：确认猫在跑，没跑就拉起来

宿主层说应用的安装和启动归插件管时，照宿主层做，跳过这一步。

```bash
L="$(command -v lingxi || echo "$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bin/lingxi")"
if [ -x "$L" ]; then "$L" up
elif [ "${LINGXI_AUTOSTART:-1}" != 0 ]; then open -g -b com.dushaobin.lingxi-desktop
fi
```

`lingxi up` 就是检查模块：猫在跑就什么都不做；没跑就在后台把应用拉起来（`open -g`，不抢焦点），
等桥接就绪再返回，结果看退出码。其它子命令遇到猫没开也会自己拉起一次，所以这一步只是让第一条
真正的命令不用等。

`lingxi` 不在 PATH 上也没关系——**应用每次启动都会把它写到上面那个固定位置**。那个文件还不存在，
说明应用从没在这台机器上跑过：直接 `open -g -b com.dushaobin.lingxi-desktop`，应用起来后几秒内
就会把 CLI 写好。应用在跑时也可以问它自己（`/health` 是唯一免鉴权的接口，返回里有 `"cli"` 的绝对路径）：

```bash
curl -s --noproxy '*' localhost:47811/health
```

**它自己读鉴权 token,没有任何要配置的东西。** 依赖只有 `curl` 和 `python3`(或 `node`),
都是现成的——**不需要 jq**。

`lingxi up` 拉不起来时——没装应用、用户设了 `LINGXI_AUTOSTART=0`、不是 macOS——它会说明原因。
**照实告诉用户，不要假装做了。** 用户设了 `LINGXI_AUTOSTART=0` 就是不想让你开猫，别绕过去。

### 为什么优先用它而不是 MCP

MCP 的每个工具调用在很多宿主里都是**一次独立的授权**——一轮里改三次表情就要过三次确认。
shell 只有一次。而且 CLI 的能力是 MCP 的**超集**:MCP 那 13 个工具它全有,
另外还有 `activity`(谁在干什么)、`events`(历史)、`unremind`(取消提醒)、
`raw`(任何没包装的接口)。

MCP 仍然有用——宿主想要带类型的 schema、想逐工具控制权限时更合适。
**两条路同一个桥、同一个 token、同一份契约。** 在你的宿主上优先用哪条，宿主层说了算。

---

## 一、最重要的一件事：报告**心情**，不只是状态

```bash
lingxi task <state> <kind> <mood> "一句话"
```

| 维度 | 取值 | 谁来判断 |
|---|---|---|
| `state` | queued running blocked needs_input needs_approval completed failed cancelled | 流程 |
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
LINGXI_TASK_ID=build-check lingxi task running build focused "正在编译项目并检查构建结果"  # 第一次：设置表情
lingxi raw POST /task-event '{"state":"running","progress":0.6,...}'   # 过半：再看一眼
LINGXI_TASK_ID=build-check lingxi task completed build proud "项目编译通过，可以继续验证功能"  # 终态：一定会表现
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
  它**按自己的时刻表走**：每天 09:30 的提醒，电脑合盖三天再打开，下一次仍是 09:30，不会漂到开机时间。
- 固定时间点用 `HH:MM`（今天还没到就是今天，过了就是明天）：

  ```bash
  lingxi remind 09:30 "站会时间到啦" --mood focused --every 1440   # 每天 09:30
  lingxi remind 17:45 "该把今天的日报发了" --mood anxious           # 今天 17:45，一次
  lingxi reminders                                                  # 看都设了什么（id 给 unremind 用）
  ```

- 多个提醒同时到期，猫**一次只说一个**，其余留到下一轮。不会一口气背清单。
- **人不在电脑前（键鼠 5 分钟没动）时，到期的提醒会等他回来再说**，不会对着空屋子说完就算了。
- 气泡上带「提醒」和设它的 agent 的标记，用户分得清这是提醒还是猫在闲聊。
- 用 MCP 的 `lingxi_remind` 也一样：`mood` 和 `repeatEveryMinutes` 都支持，固定时间点给 `dueAt`（毫秒时间戳）。

**什么时候主动设提醒**（不用等用户开口）：

- 用户说"等下要…"、"晚点记得…"、"明天…"且时间明确 → 直接设上，然后告诉他你设了（说清楚是几点）；时间不明确时先确认或说明采用的时间
- 用户提到日程或例行的事（"每天十点站会"、"周报周五交"、"三点开会"）→ 设成对应时间点的提醒，
  例行的加 `--every`；会议提前 10 分钟提醒比准点更有用
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

- 值得记：「周四晚上常常熬到很晚」「被 flaky test 惹毛过好几次」「喜欢先量再改」
- 不值得记：「是个程序员」「在用 TypeScript」（看代码就知道了，不算观察）

**不要写**任何他不愿意看到被落在磁盘上的东西：密码、密钥、私人的第三方信息、
健康和财务细节。这是一个明文 JSON 文件。

---

## 五、预算：安静是默认值

猫和一个正在工作的人共用一块屏幕。**每一次可见的动作都是从他的注意力里扣掉的**，不是演示。

| 通道 | 预算 | 为什么 |
|---|---|---|
| 说话气泡 | 每个真实任务终态和待回答问题都要传达；纯陪伴闲聊 ≤ 3 次/小时 | 关键消息不能漏，闲聊不能抢注意力 |
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

## 结束时总结这一轮，不要用会话名

会话名是打开时起的。后面换了话题，拿它当结束提示就是在说一件已经过去的事。hook 也不会再用它。

回复结束前报**这一轮刚发生的事**。摘要写完整、具体，最多 140 字；猫会按长度延长气泡显示时间。结论在前，问题要原样给出。

带一点情绪。猫不是状态灯，可以贱兮兮，不要阴阳，也不要冷冰冰地报流程。

```bash
LINGXI_TASK_ID=login-message lingxi task running write focused "正在修复登录提示并检查相关测试"
LINGXI_TASK_ID=login-message lingxi task completed write proud "登录提示已修复，相关测试通过，可以继续发布"
```

- 写结果，或卡在哪。带具体名词，像跟旁边的人说话。
- 同一会话换了话题，就写新的这句，不要沿用第一轮，也不要写会话标题。
- 不要写「结束了」「本轮回复结束」「任务已完成」。也不要堆数字和步骤。

有的宿主装了 hook，回合结束时会自动告诉猫（有没有，宿主层写着）。你报过这一轮的结果，应用就不让
hook 再念一遍；你没报，hook 才从最终回复里截一句兜底——那一句远没有你写的好。所以回复的第一句也
点名任务和结论；需要用户回答时，把问题放在最后一行、用问句结尾。

## 别做的事

- **别自己挑动作和表情来表达任务结果。** 报 `mood`，让猫决定。用户改一次映射，所有 agent 一起变。
- **别改 `skin` / `camera` / `scale` / `visible`。** 那是用户的偏好，不是你的表达手段。
  想被认出来，注册一个你自己画的 logo（`lingxi register`）。
- **别把 `alert` 当默认。**
- **别在 `running` 时话多。** 陪着比说话好，尤其是 `tender`。
- **拿到 `stage busy` 就丢掉**，不要重试——等舞台空出来时，你那句话已经在讲历史了。
