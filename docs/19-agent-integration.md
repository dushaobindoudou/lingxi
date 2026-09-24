# 接入灵犀：给 Agent 的完整规范

> 这份文档面向**写接入的模型和人**。运行中的应用会用
> `GET http://127.0.0.1:47811/integration` 把下面的词汇表和当前生效的映射原样吐出来——
> 那个接口是权威，这份文档是解释。

---

## 一句话版本

**报告你在干什么，不要指挥猫做什么。**

```
❌  构建失败了 → 我让猫播 shake-head + 表情"不爽"
✅  我报告 { state: "failed", kind: "build" } → 猫自己决定怎么表现
```

三个理由，都很实在：

1. **用户能一次改全部。** 映射在用户自定义资源目录的 `reactions.json`
   （`~/Library/Application Support/com.dushaobin.lingxi-desktop/assets/reactions.json`，不在仓库里），用户改完，所有 agent 一起变。
   你硬编码动作，用户就得去改你。
2. **你不用记 49 个动作 30 个表情。** 你只需要知道自己在干什么。
3. **我们加动作、改动画，你一行不用动。**

直接驱动（`POST /control {"action": ...}`）**仍然开放**，调试和特殊场合需要，
但那是低层接口，不适合日常接入。

---

## 零步之前：应用没开怎么办

桥只在应用活着的时候存在。以前每条接入路径在这件事上的答案都一样——
「灵犀 is not reachable」——这句话是对的，但**调用方是模型**，而能去开应用的那个人
不一定在看终端。

所以现在**每一个给第三方的入口都带同一个检查**：桥通不通？不通就
`open -g -b com.dushaobin.lingxi-desktop`，等 `/health` 答应（最多 15 秒），再继续。区别只在**什么时候查**：

| 入口 | 会话开始时 | 调用发现不通时 | 实现 |
|---|---|---|---|
| MCP server（Codex / WorkBuddy / Claude 插件 / 任何 MCP 宿主） | ✅ `initialize` 时在后台查，不拖握手 | ✅ 每进程一次，成功后第一条结果带一句"我启动了它" | `packages/mcp-server/src/launch.mjs`、`bridge.mjs` 的 `warmUp()` |
| Claude Code hooks（插件 + 主界面「一键接入」） | ✅ `SessionStart` hook：后台检查、拉起、等就绪，再补发这条事件 | — 其余事件只投递，不拉起 | `lib.rs` 的 `CLAUDE_SESSION_START_COMMAND` |
| DSH 插件 | ✅ 插件 `apply` 时登记身份，不通就拉起 | ✅ 每个插件实例一次 | `lingxi-dsh-plugin.js` 的 `ensureAppRunning` |
| `lingxi` CLI / skill | skill 第一步 `lingxi up` | ✅ 第一次请求之前 | `integrations/cli/lingxi` 的 `start_app` |
| Codex notify / `lingxi-emit` 适配器 | — | — 只投递 | Codex 的会话开始由 MCP server 那一行负责 |

`lingxi up` 就是这个检查本身，单独拿出来：在跑就不动，没跑就拉起并等就绪，结果看退出码。
给 skill 当第一步、给安装脚本当最后一步都行。

**拉起只放在会话边界**，这一条是有意的：每次提问、每个回合结束都去拉，会跟一个特意把猫关掉的人
一小时顶二十次牛。每次开会话拉一次是提醒，不是纠缠。

几条边界，都是有意的：

- **`-g` 不抢焦点。** 猫出现在桌面上，你手上的窗口不动。
- **`LINGXI_AUTOSTART=0` 可以完全关掉。** 一个会让窗口凭空出现在别人桌面上的调用应该是可以拒绝的
  ——对方可能正在投屏、正在演示，或者就是这会儿不想看见猫。
- **不装应用就不会装。** 找不到 `.app` 时给的是"怎么构建 / 装到哪"，不是静默失败。
- **每个进程只试一次。** 启动不起来的应用第四次也起不来；循环里的脚本不该每轮都赔上 15 秒超时。
- **检查绕开代理。** 所有 curl 都带 `--noproxy '*'`：环境里导出了 http_proxy 时，curl 连 127.0.0.1
  也交给代理，本地代理回一个 502——检查会把它读成"应用在跑"，于是什么都不启动。
- **已经装过「一键接入」的机器不用重装。** 应用每次启动会把 `~/.claude/settings.json` 里**它自己写的**
  旧版 hook 命令原地升级成当前版本（先备份），别的 hook 一个字都不碰，也不会给你没装过的事件补装。

### `lingxi doctor` —— 接不通的时候先跑这个

"猫没反应"这**一个**症状，底下至少六种原因：应用没开、开了但桥没绑上端口、token 这个账号读不了、
权限档位不给写、skill 根本没装、宿主的插件没启用。模型看到的报错最多指出其中一种。

```sh
lingxi doctor
```

逐项检查**应用 / 鉴权 / 署名 / 权限档位 / 技能与宿主**，每一条不通过都带一句能照着做的话；
有任何一项失败就以非零码退出，可以直接放进 CI 或安装脚本的最后一步。

---

## 零步：鉴权

桥现在**需要 token**。应用第一次启动会生成一个，写在配置目录里，权限 `0600`：

```
~/Library/Application Support/com.dushaobin.lingxi-desktop/bridge-token
```

```bash
curl localhost:47811/health          # 唯一不需要 token 的接口，告诉你 token 在哪
curl -H "Authorization: Bearer $(cat "$TOKEN_FILE")" localhost:47811/status
```

也支持 `X-Lingxi-Token:` 头。**不要把 token 放进 URL**（`?token=` 仅作为旧版兼容保留）：
URL 会进 shell 历史、代理日志和 referrer，而 header 不会。

> **为什么只监听回环还不够**：回环是**网络边界，不是信任边界**。以这个用户身份运行的
> 任何进程都能访问 127.0.0.1——包括浏览器里的一个页面、一个沙箱进程。而这个桥能移动猫、
> **读取积累下来的主人记忆**、往用户配置目录写文件。token 文件只有本人可读，
> 能读到它的东西本来就已经是这个用户了。

**用 CLI 就不用管这些**——它自己会读 token。

## 第一步：注册身份 + 生成你自己的 logo

```bash
lingxi register claude-code --logo my-mark.svg --name "Claude Code" --color "#d97757"
```

| 字段 | 说明 |
|---|---|
| `id` | **必填**。稳定字符串，之后每次调用都带上它 |
| `name` | 显示名，24 字以内 |
| `logo` | **你自己生成的 SVG**。这是用户区分"哪个 agent 干的"的标志 |
| `color` | `#rgb` 或 `#rrggbb`，logo 底色 |
| `badge` | 两字符文本兜底，没给 logo 时用 |

**logo 要你自己画。** 模型写 SVG 是本行——第一次运行时生成一个能代表自己的小图标，
存在自己的配置里，之后一直用它。要求：

- **小而平**，两三种颜色，**不要文字**（22px 下看不清）
- 纯形状和路径。`<script>` / `<foreignObject>` / 外链 `href` / `<image>` 会被拒绝并告诉你原因
- 64KB 以内（正常的 SVG 标记远小于 8KB）

> **安全**：logo 在 webview 里是放进 `<img>` 渲染的，不是内联进 DOM。`<img>` 里的 SVG
> **不能执行脚本、不能加载外部资源**——这是浏览器自己的保证，比我们写任何 sanitizer 都强。
> 上面那几条拒绝规则是第二层，目的是让你**在注册时就收到报错**，而不是得到一个悄悄画不出来的图标。

**logo 显示在气泡上，随气泡一起消失。** 不是钉在猫身边——钉在身上的标记是个和宠物抢注意力的
HUD，而且没有自然的消失时机；气泡本来就有出现的理由和消失的理由。

不注册也能用——裸 `curl` 必须一直能工作——但你会显示成 id 的前两个字。

### 接入时必须检查并更新气泡配置

**默认气泡不适合所有应用。** 新应用接入时，要结合宿主身份、实际文案和使用场景检查气泡，
并更新 `bubble.json` 中需要调整的配置。**它不在仓库里**——这些是用户级自定义资源，路径是
`~/Library/Application Support/com.dushaobin.lingxi-desktop/assets/bubble.json`（目录里还有
`actions.json` / `expressions.json` / `skins.json` / `reactions.json` / `textures/`，以及应用自己写出的
`README.md`）。先读取已有配置，在其基础上修改；这是共享配置，
修改后也要检查其他已接入应用的显示效果。默认气泡的优化和接入验收需覆盖：

| 检查项 | 要求 |
|---|---|
| 是否居中 | 分别确认气泡相对宠物的位置、文字在气泡内的对齐方式；短句和多行任务摘要都要检查，按场景决定是否居中 |
| icon 的位置 | 明确宿主 logo / badge 与正文的位置和间距；有图标、无图标、长文本换行时都不能遮挡文字或造成视觉偏移 |
| 多种字体颜色 | 正文与重点信息应能用不同颜色区分，同时保持背景上的可读性；当前配置提供 `text` 和 `accentText`，任意片段多色属于进一步优化需求 |
| 每轮任务总结 | 每轮对话根据最新上下文刷新任务 `summary`；用户修正目标或改变范围后，展示内容必须跟着更新，避免任务标题偏离当前工作 |

当前 `bubble.json` 没有居中方式和 icon 位置的配置字段，这两项需要结合渲染实现优化，
不能仅靠添加 JSON 字段完成。配置改完后执行 `POST /control {"reloadAssets":true}`，
通过 `GET /assets/status` 检查加载结果，并实际查看上述场景。

---

## 第二步：报告任务

```bash
curl -X POST localhost:47811/task-event -H 'Content-Type: application/json' -d '{
  "provider": "claude-code",
  "agent":    "claude-code",
  "taskId":   "build-4821",
  "state":    "failed",
  "kind":     "test",
  "summary":  "auth/ 里有 3 个测试挂了"
}'
```

### 每轮刷新任务总结

**每轮对话都要总结当前任务并上报最新 `summary`，不能一直复用首轮提示或会话标题。**
收到新一轮消息后，结合原目标和用户最新要求，概括这一轮实际要做的事；本轮结束时，
再用实际结果或阻塞原因更新摘要，并上报对应状态。摘要要简短、具体，能独立说明当前工作。

同一任务的追问或纠正沿用 `taskId` 并更新 `summary`；切换到独立任务时使用新的 `taskId`。
例如用户从“调整气泡样式”进一步要求“先更新接入文档”，摘要应改成“补充气泡接入配置说明”，
完成后改成“已补充气泡配置检查与每轮任务总结要求”，而不是继续展示最初的标题。

能读取对话内容的模型负责生成摘要；hook / notify 应传递宿主提供的最新摘要，
无法取得时由模型通道补充。仅发送状态事件不能代替每轮任务总结。

### 心情：让它是宠物而不是状态灯的那个字段

```bash
lingxi task failed test frustrated "第四次跑同一个测试了"
```

`state` 和 `kind` 描述**流程**。给妈妈写信和跟 flaky test 搏斗，两件事都是 `running`/`write`——
分不出这两者的宠物就是一个有毛的状态灯。**`mood` 是在读内容，所以只有 agent 判断得了。**

| mood | 什么时候 |
|---|---|
| `tender` | 私人的、亲密的、柔软的（写给家人、纪念日、悼词） |
| `proud` | 难啃的东西终于通了 |
| `sad` | 坏消息、失去、道歉 |
| `frustrated` | 同一个东西又败了 |
| `anxious` | 有风险、不可逆、有 deadline |
| `weary` | 干了很久、很晚了 |
| `playful` | 玩票、轻松 |
| `curious` | 在读新东西 |
| `focused` | 普通干活（默认） |

判断的是**这件事**的心情，不是你自己的把握程度。

#### 猫的反应是"回应"，不是"镜子"

> **一个正在挫败的人，不需要一只跟着挫败的猫。** 那是同一块屏幕前有两个人在烦。

坏情绪**接住**（failed + frustrated →「唔…这个真的难。歇一下再来？」），
好情绪**一起**（completed + proud →「看我的～」）。这是内置映射唯一的设计规则，
也是"治愈系"具体的意思。

优先级：`state:kind:mood` > `state:mood` > `state:kind` > `state` > `mood`。
**mood 高于 kind**——否则"部署完成"对得意、疲惫、如释重负会是同一张脸。

### 进度：`running` 大部分会被吞掉

带上 `progress`（0–1）。`running` 的更新**只有第一次和跨过 50% 那次**会产生反应，
其余吞掉——不然长任务就变成了桌宠本该替代的那种通知轰炸。终态永远不会被吞。

### 状态词汇表（8 个，封闭集合）

| `state` | 什么时候报 |
|---|---|
| `queued` | 排上了，还没开始 |
| `running` | 正在做 |
| `blocked` | 卡住了，但不需要用户介入 |
| `needs_input` | **需要用户回答**才能继续（一个问题，可以等） |
| `needs_approval` | **需要用户批准**才能继续（正卡着一个工具调用，更急） |
| `completed` | 做完了，成功 |
| `failed` | 做完了，失败 |
| `cancelled` | 被取消 |

> `needs_input` 和 `needs_approval` 是**故意分开**的:问题可以等用户抬头,
> 授权是**正卡着一个工具调用**。IM 通知最需要区分的就是这两个。
> Claude 的 `Notification` hook 两种都会发,适配器读消息内容来判断。

### 工作类型（8 个）

`build` · `test` · `deploy` · `review` · `search` · `write` · `chat` · `other`

类型让猫区分对待——部署失败和搜索失败不该是同一个表情。

### 当前的内置映射

| state | kind | 表情 | 动作 | 说话 |
|---|---|---|---|---|
| `completed` | `deploy` | 得意 | stretch-front | 上线啦！ |
| `completed` | `test` | 开心 | paw-wave | 测试全绿～ |
| `completed` | 其他 | 开心 | paw-wave | 搞定啦～ |
| `failed` | `deploy` | 警觉 | notice-you | 部署没过，我看着呢 |
| `failed` | `test` | 委屈 | shake-head | 有测试挂了 |
| `failed` | 其他 | 委屈 | shake-head | 这次没成… |
| `needs_input` | — | 好奇 | notice-you | 在等你哦 |
| `needs_approval` | — | 警惕 | paw-reach | 等你批一下～ |
| `blocked` | — | 困惑 | curious-tilt | 卡住了… |
| `running` | — | 认真 | — | — |
| `queued` | — | 清醒 | — | — |
| `cancelled` | — | 嫌弃 | shake-fur | — |

以 `GET /integration` 返回的为准。

---

## 权限：你能做什么，由用户决定

注册身份不等于拿到权限。每个 agent id 有一个档位，用户在 **主界面 → Agent 接入 →「权限与日志」** 里设，
**agent 自己改不了**——能自己选权限的身份不叫权限。

| 档位 | 能做 | 不能做 |
|---|---|---|
| `observer` | 读（`/status`、`/perception`、`/capabilities`）、注册身份 | 任何改动 |
| `performer`（**默认**） | 表演：表情、动作、说话、特效、玩具、`/task-event`、`/intent` | 改会保存的设置、写备忘和提醒 |
| `trusted` | 以上全部 + `skin` / `camera` / `scale` / `visible`、`POST /memory`、`POST /reminders` | — |

界线划在**会不会留下来**，不是划在重要不重要。表情播错四秒后就没了；一次 `visible: false`
会让用户的猫消失，而且看不出是哪个 agent 干的。这两件事该有不同的答案。

**默认是 `performer` 而不是 `trusted`**，意味着以前"任何 agent 都能改主题"的行为变了。
白名单的意思就是没列就不给。被挡下的调用不会静默：

```jsonc
// POST /control  {"agent":"my-ci","skin":"midnight","expression":"得意"}
{
  "ok": true,
  "applied": ["expression"],            // 没被挡的照常生效
  "rejected": ["「my-ci」的权限档位是 performer，不能改会保存下来的设置（skin）。…"]
}
```

注意 `applied` 和 `rejected` 同时出现：一个越权字段**不会**连累同一次调用里的其他字段。
写备忘和提醒是单一动作，没有可拆的部分，所以直接返回 `403`，body 里有同样的 `rejected`。

`POST /memory` 和 `POST /reminders` 用 `X-Lingxi-Agent` 头认人（body 只读一次，不能再翻找 `agent` 字段）。
不带头就是 `anonymous`，按默认档位处理。

### 写入限速

`trusted` 的持久化写入是**每 60 秒 10 次**，滑动窗口，按 agent 单独计。超出返回 `429`。
这不是防坏人，是防循环——一个在紧循环里重试写入的 agent 会以发包的速度重写 settings.json，
而第一个征兆是磁盘在响。正常调用碰不到这个上限。

### 调用日志

每次调用都记：谁、哪个接口、**要了哪些字段**、结果（已执行 / 被拒 / 无权限 / 频控）、以及原因。
最近 200 条，在内存里，重启清空，同一个页面上能看。

**不记内容。** 你让猫说的话、猫记住的事，都不进日志——日志是给用户判断"要不要给这个 agent 放权"的，
不是给它读用户私事的第二个入口。

调不通的时候先看这里：一条 `无权限` 会直接告诉你是档位问题，而不是让你去猜为什么接口"没反应"。

## 第三步：多 agent 共存

同时接入好几个 agent 是正常情况。规则只有一条需要你配合：

### 优先级来自**事件**，不来自你是谁

```bash
curl -X POST localhost:47811/control -d '{"agent":"my-ci","priority":"alert","expression":"惊吓"}'
```

| `priority` | 含义 |
|---|---|
| `alert` | 用户**现在**得看一眼：失败、需要确认、危险操作 |
| `report` | 有结果了 |
| `status` | 状态变了，不急（**默认**） |
| `ambient` | 纯氛围，有配额 |

不要因为"我比较重要"就一律发 `alert`。用户需要看到的是**要紧的事**，
不是要紧的工具——构建失败比空闲卖萌重要，不管是谁报的。

### 优先级不够高会**排队**，太低的会被**丢弃**

```json
{ "ok": true,
  "applied": ["queued behind a higher-priority reaction (position 1, expires in 4000ms)"],
  "queued": true, "queuePosition": 1, "expiresInMs": 4000 }
```

- `alert` / `report` 会**排队**等舞台空出来，并且**有过期时间**（默认 8 秒，
  用 `expiresInMs` 自己定）。过期的会被丢掉不播——一个反应是对某个**瞬间**的陈述，
  晚了不是"迟到"，是"错了"。
- `status` / `ambient` **不排队**，直接拒绝：氛围没有晚点播出的价值。

### 收到 `400 stage busy` 要**丢弃**，不要重试

```json
{ "ok": false,
  "rejected": ["stage busy: claude-code (🤖) is showing a \"alert\" reaction for another 2600ms..."],
  "retryAfterMs": 2600,
  "dropRatherThanRetry": true }
```

一个 3 秒后才播出来的"测试通过"是**过期信息**，那时候猫在讲别的事了。丢掉它。

### 用户的设置不是你的

`skin` / `camera` / `scale` / `visible` 是**用户的偏好**。接口不拦你（不想破坏已有接入），
但会在响应里说一句。想被认出来，**用你自己的 logo，别改皮肤**。

---

## 完全定制：改猫本身

用户和 agent 都可以改。资源目录：

```
~/Library/Application Support/com.dushaobin.lingxi-desktop/assets/
```

（主界面 →「外观」→「导出内置资源为模板」会写出一整套可改的样板。）

| 文件 | 内容 | 替换方式 |
|---|---|---|
| `actions.json` | 动作库 | **整体替换** |
| `expressions.json` | 表情库 | **整体替换** |
| `skins.json` | 主题 | 与内置**合并**（同 id 覆盖） |
| `bubble.json` | 气泡样式（颜色/字体/形状） | 整体替换 |
| `face.json` | **五官几何**：眼距/眼睛大小/鼻子/嘴/胡子根数与长度 | 按字段覆盖 |
| `reactions.json` | **任务 → 表情/动作映射** | 按条覆盖 |
| `textures/*.png` | 手绘图集 / 表情贴图 | 按引用 |

### ⚠️ 整体替换的含义

`actions.json` 和 `expressions.json` 是**整体替换**的。所以在写之前**必须先查来源**：

```bash
curl -s localhost:47811/capabilities | jq '.actions[] | select(.source=="custom")'
```

- `source: "builtin"` → 用户还没改过，你可以从内置模板出发写一份
- `source: "custom"` → **用户已经有自己的文件了**，你必须读出来、在上面增量修改，
  否则你一写就把人家的东西全删了

这是接入方最容易造成不可逆损失的一个点。

### `face.json` 的形状

颜色一直是可换的（皮肤里的 `materials`），表情一直是数据（`expressions.json`），
但**五官的位置和大小**以前只能改代码重新编译。现在：

```jsonc
{
  // 只写想改的部分，其余用内置值。坐标在 256x256 的脸部贴图空间里。
  "eyes":     { "spacing": 72, "top": 99, "width": 44, "height": 43, "pupilRadiusX": 11 },
  "nose":     { "y": 174, "halfWidth": 9, "depth": 9 },
  "mouth":    { "y": 193, "halfWidth": 19 },
  "whiskers": { "rows": 3, "length": 58, "spread": 7, "width": 2, "droop": 0.8 },
  "muzzle":   { "x": 85, "y": 166, "width": 86, "height": 48, "radius": 16 }
}
```

写错字段会**点名**告诉你哪个字段不存在、可选的有哪些：

```
face.json：eyes.spacng 不是可调项，可用的是：spacing / top / width / height / radius / ...
```

### `reactions.json` 的形状

```jsonc
{
  // 键是 "<state>" 或 "<state>:<kind>"，越具体越优先
  "failed:deploy": { "expression": "惊吓", "action": "shake-head", "say": "部署炸了…" },
  "completed":     { "expression": "得意" }
}
```

`expression` 必填，`action` / `say` 可选。**每条独立校验**——写错一条只会跳过那一条，
不会让整个文件失效。

### 改完让它生效（不用重启，不用让用户点按钮）

```bash
curl -X POST localhost:47811/control -d '{"reloadAssets":true}'
curl -s localhost:47811/assets/status
# → { "active": {...}, "lastLoadedAt": ..., "lastErrors": ["actions.json：..."] }
```

`lastErrors` 是**具体哪个文件哪条不对**，直接可读。

---

## 自证生效

写完要能验证，否则就是瞎飞。

| 你改了 | 去哪读回来 |
|---|---|
| 表情 | `GET /perception` → `expression` / `expressionHeld` |
| 动作 | `GET /perception` → `action` |
| 位置/朝向 | `GET /perception` → `petPosition` / `heading` |
| 你下的移动指令 | `GET /perception` → `intent` |
| 皮肤 / 视角 / 大小 | `GET /status` |
| 自定义资源 | `GET /assets/status` |
| 谁在驱动 | `GET /agents` |
| 猫是否自愈过 | `GET /perception` → `recoveredAt`（非 null 说明有人喂了非法值） |

**动作有延迟是正常的**：猫在走路时，动作会推迟到它停下才播。
单次采样看到的 `action` 可能是**上一个**自主动作——不要据此判定失败然后重发。

---

## 通知出口：接到 IM(我们不内置)

灵犀**不连接** Slack / 飞书 / Telegram——那是你的账号,内置任何一个都意味着要处理它们的
token、API 变更和隐私模型。我们提供的是**出口**,你指向自己已有的 webhook。

在配置目录里放 `notifications.json`：

```jsonc
{
  "sinks": [
    { "url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx",
      "states": ["failed", "needs_approval"],   // 留空 = 全部
      "format": "feishu" },                     // feishu | slack | raw
    { "url": "http://127.0.0.1:9787/relay", "format": "raw" }
  ]
}
```

`feishu` / `slack` 发的是两边都认的 `{"text": "..."}`;`raw` 发完整的 task event,
你自己的 relay 想怎么转都行。

### 要说清楚的取舍

**在此之前这个应用完全不发起对外连接**,那是它安全性的一部分。一个 sink 会把
**你在做什么的摘要**发给第三方。所以：

- **只能改文件配置,故意不提供 API。** 否则任何能访问这个桥的进程都能把你的任务摘要
  指向它选的服务器——那就把桌宠变成了一个外泄通道。
- **文件不存在就一条都不发。** 默认仍然是零对外流量。
- **只接受 https**,或者 `127.0.0.1` 上的 http(本机 relay 是最常见的接法,
  要求自己跟自己用 TLS 没有意义)。

## 完整接口清单

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/health` | **唯一免 token**：是否在跑、token 文件在哪 |
| GET | `/integration` | **本文档的机器可读版，以它为准** |
| GET | `/capabilities` | 全部动作/表情/主题/视角 + `source` 标记 |
| GET | `/status` | 皮肤、视角、大小、可见性 |
| GET | `/perception` | 位置、状态、表情、朝向、意图、玩具、健康 |
| GET | `/activity` | **每个工具此刻在干什么**（一行一个工具，带它自己的 logo） |
| GET | `/agents` | 注册过的 agent + 当前占用舞台的是谁 |
| POST | `/agents` | 注册身份和 logo |
| POST | `/task-event` | **推荐的主接入点** |
| POST | `/control` | 低层直接驱动 |
| POST | `/intent` | 让猫走到某个坐标 |
| GET/POST | `/memory` | 关于主人的记忆 |
| GET/POST | `/reminders` | 定时提醒（`mood` 决定送达的表情，`repeatEveryMinutes` 常驻） |
| DELETE | `/reminders/{id}` | 取消一个提醒 |
| GET | `/assets/status` | 自定义资源状态与校验错误 |
| GET | `/debug/events` | 任务事件历史 |

---

## 两种接法，按摩擦成本选

### A. 只用 skill + 脚本（推荐，摩擦最低）

MCP 的每个工具调用都是一次授权面：不少宿主会**逐个工具**弹确认，一轮里改三次表情就要过三次。
脚本只有一次。所以我们直接提供一个 CLI，skill 把它带上就行，**完全不用注册 MCP server**：

```bash
integrations/cli/lingxi register claude-code --logo mark.svg --name "Claude Code"
integrations/cli/lingxi task running build "编译中"
integrations/cli/lingxi task completed test "全绿"
integrations/cli/lingxi say "搞定了"
integrations/cli/lingxi state          # 自证生效
```

token 它自己读，不用配置。`lingxi help` 列全部子命令，`lingxi raw <METHOD> <PATH> [json]`
兜住任何没包装的接口。

### B. MCP server

宿主想要带类型的 schema、想逐工具控制权限时更合适。见
[`integrations/README.md`](../integrations/README.md)。

两条路走的是同一个桥、同一套 token、同一份契约。

---

## 接入自检清单

- [ ] 启动时 `POST /agents` 注册了 id + 一个自己挑的 emoji
- [ ] 每次调用都带 `agent`
- [ ] 用 `/task-event` 报告状态，而不是自己挑动作
- [ ] `priority` 按事件的紧急程度给，不是按自己的重要程度
- [ ] 收到 `stage busy` 会丢弃而不是重试
- [ ] 写 `actions.json` / `expressions.json` 前查过 `source`
- [ ] 不擅自改 `skin` / `camera` / `scale`
- [ ] 改完资源会 `reloadAssets` 并读 `lastErrors`
- [ ] 驱动后会从 `/perception` 或 `/status` 自证生效
