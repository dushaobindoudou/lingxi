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

1. **用户能一次改全部。** 映射在 `assets/reactions.json`，用户改完，所有 agent 一起变。
   你硬编码动作，用户就得去改你。
2. **你不用记 49 个动作 30 个表情。** 你只需要知道自己在干什么。
3. **我们加动作、改动画，你一行不用动。**

直接驱动（`POST /control {"action": ...}`）**仍然开放**，调试和特殊场合需要，
但那是低层接口，不适合日常接入。

---

## 第一步：注册身份

```bash
curl -X POST localhost:47811/agents -H 'Content-Type: application/json' -d '{
  "id":    "claude-code",
  "name":  "Claude Code",
  "badge": "🤖",
  "color": "#d97757"
}'
```

| 字段 | 说明 |
|---|---|
| `id` | **必填**。稳定字符串，之后每次调用都带上它 |
| `name` | 显示名，24 字以内 |
| `badge` | **一个 emoji**（最多两个）。这是用户区分"哪个 agent 干的"的唯一标志 |
| `color` | `#rgb` 或 `#rrggbb`，徽章描边色 |

**badge 让模型自己挑。** 第一次运行时选一个能代表自己的 emoji 和颜色，记在自己的配置里，
之后一直用它。不要每次换。

> **为什么是 emoji 不是图片**：你自己就能生成，用户不用准备素材，渲染零成本，
> 任何尺寸都清楚。图片方案（上传/存储/多分辨率/失效）成本高得多，收益只是精致一点。
> `badge` 是字符串，将来要扩展成 URL 不会破坏现有调用方。见
> [决策 003](decisions/003-multi-agent-arbitration.md)。

不注册也能用——裸 `curl` 必须一直能工作——但你会显示成一个通用的 💻。

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

### 状态词汇表（7 个，封闭集合）

| `state` | 什么时候报 |
|---|---|
| `queued` | 排上了，还没开始 |
| `running` | 正在做 |
| `blocked` | 卡住了，但不需要用户介入 |
| `needs_input` | **需要用户回答**才能继续 |
| `completed` | 做完了，成功 |
| `failed` | 做完了，失败 |
| `cancelled` | 被取消 |

### 工作类型（8 个）

`build` · `test` · `deploy` · `review` · `search` · `write` · `chat` · `other`

类型让猫区分对待——部署失败和搜索失败不该是同一个表情。

### 当前的内置映射

| state | kind | 表情 | 动作 | 说话 |
|---|---|---|---|---|
| `completed` | `deploy` | 得意 | stretch-front | 上线了！ |
| `completed` | `test` | 开心 | paw-wave | 测试全绿～ |
| `completed` | 其他 | 开心 | paw-wave | 搞定啦～ |
| `failed` | `deploy` | 惊吓 | shake-head | 部署炸了… |
| `failed` | `test` | 不爽 | shake-head | 有测试挂了 |
| `failed` | 其他 | 不爽 | shake-head | 这次没成… |
| `needs_input` | — | 好奇 | notice-you | 在等你哦 |
| `blocked` | — | 困惑 | — | 卡住了 |
| `running` | — | 认真 | — | — |
| `queued` | — | 清醒 | — | — |
| `cancelled` | — | 嫌弃 | shake-fur | — |

以 `GET /integration` 返回的为准。

---

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
但会在响应里说一句。想被认出来，**用徽章，别改皮肤**。

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

## 完整接口清单

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/integration` | **本文档的机器可读版，以它为准** |
| GET | `/capabilities` | 全部动作/表情/主题/视角 + `source` 标记 |
| GET | `/status` | 皮肤、视角、大小、可见性 |
| GET | `/perception` | 位置、状态、表情、朝向、意图、玩具、健康 |
| GET | `/agents` | 注册过的 agent + 当前占用舞台的是谁 |
| POST | `/agents` | 注册身份和徽章 |
| POST | `/task-event` | **推荐的主接入点** |
| POST | `/control` | 低层直接驱动 |
| POST | `/intent` | 让猫走到某个坐标 |
| GET/POST | `/memory` | 关于主人的记忆 |
| GET/POST | `/reminders` | 定时提醒 |
| GET | `/assets/status` | 自定义资源状态与校验错误 |
| GET | `/debug/events` | 任务事件历史 |

MCP 接法见 [`integrations/README.md`](../integrations/README.md)。

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
