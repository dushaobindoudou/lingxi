# 灵犀 CLI 参考

所有命令都通过 `bash scripts/lingxi.sh <子命令>` 调用（脚本负责定位 CLI 和署名）。
**以正在运行的版本为准**：`bash scripts/lingxi.sh help` 与 `bash scripts/lingxi.sh integration`
输出的是当前应用的真实契约，和本文冲突时以它们为准。

## 检查与观测

| 命令 | 作用 |
|---|---|
| `doctor` | 应用侧自检（需要 CLI 已存在时才跑得动）。**应用没装或没启动时用 `scripts/check.sh`** |
| `up` | 猫在跑就什么都不做；没跑就在后台拉起并等桥接就绪 |
| `health` | 是否在跑、token 在哪（从不启动应用） |
| `state` | 位置、状态、表情、朝向、intent |
| `status` | 主题、视角、大小、可见性 |
| `capabilities` | 全部动作 / 表情 / 主题，带来源（自定义资源也会列出） |
| `integration` | 完整契约，机器可读 |
| `assets` | 已加载的自定义资源与错误 |
| `agents` | 谁在驱动这只猫，各自的权限与舞台占用 |

`capabilities` 与 `integration` 是**唯一可信的能力清单**。调用任何动作或表情前先查一次，
不要按本文或记忆里的 id 硬编码。

## 驱动猫

| 命令 | 说明 |
|---|---|
| `task <state> [kind] [mood] [summary]` | **首选**。任务状态 + 心情 + 一句话 |
| `say <text>` | 让猫说一句话（气泡） |
| `express <expression> [action]` | 换表情，可带一个动作 |
| `do <action>` | 播一个动作 |
| `perform <id> [--manual]` | 播一次特效；用户明确要求时才加 `--manual` |
| `toy <yarn\|feather\|laser\|pet\|none>` | 毛线球 / 逗猫棒 / 激光笔 / 撸猫 / 收起 |
| `look [--camera X] [--skin Y]` | 改视角或皮肤（**属于用户偏好，不要主动改**） |

### task 的取值

- `state`: `queued` `running` `blocked` `needs_input` `needs_approval` `completed` `failed` `cancelled`
- `kind`: `build` `test` `deploy` `review` `search` `write` `chat` `other`
- `mood`: `focused` `proud` `tender` `sad` `frustrated` `anxious` `weary` `playful` `curious`

同一个任务的所有命令复用同一个 `LINGXI_TASK_ID`：

```bash
LINGXI_TASK_ID=deploy-1 bash scripts/lingxi.sh task running deploy anxious "准备发布，先跑一遍检查"
LINGXI_TASK_ID=deploy-1 bash scripts/lingxi.sh task completed deploy proud "发布完成，线上验证通过"
```

### 进度不会被刷屏

`running` 的更新只有**第一次**和**跨过 50%** 那次会产生反应，其余被吞掉；终态
（`completed` / `failed` / `needs_input` / `blocked` / `cancelled`）**永远不会被吞**。
所以可以放心报进度，不用自己算什么时候该说话。

### 优先级

```bash
LINGXI_PRIORITY=alert bash scripts/lingxi.sh express 惊吓
```

| priority | 什么时候 | 冲突时 |
|---|---|---|
| `alert` | 用户**现在**得看一眼：失败、要确认、危险操作 | 立刻打断低的 |
| `report` | 有结果了 | 排队等，带过期时间 |
| `status` | 状态变了，不急（默认） | 被拒绝 |
| `ambient` | 纯氛围 | 被拒绝 |

## 提醒与记忆

| 命令 | 说明 |
|---|---|
| `remind <分钟\|HH:MM> <文本> [--mood M] [--every N]` | 到点让猫说这句话 |
| `reminders` | 已设的提醒与 id |
| `remember <文本> [kind]` | 记一条，kind: `owner` `project` `preference` `moment` |
| `recall` | 读回来 |

- `--every N` 最小 5 分钟；固定时间点用 `HH:MM`。
- 多个提醒同时到期时猫一次只说一个，其余留到下一轮。
- 人不在电脑前（键鼠 5 分钟没动）时，到期的提醒会等他回来再说。
- 记忆是明文 JSON，**绝不写**密码、密钥、他人隐私、健康与财务细节。

## 身份

署名由 `scripts/lingxi.sh` 统一设成 `workbuddy`（`LINGXI_AGENT` 可覆盖）。
**不要跑 `register`**：不带全参数的那次会把用户在应用里配好的 badge 和昵称覆盖成默认值。
需要独立标识时，让用户在灵犀主界面「Agent 接入」里配。
