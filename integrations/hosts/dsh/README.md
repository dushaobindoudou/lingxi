# lingxi-dsh — 灵犀的 DSH（DeepSeek Harness）专用插件

DSH 没有进程外插件机制——宿主能力以**动态 Cordis 插件**注册。本目录存的是插件源码
（`lingxi-dsh-plugin.js`，即 `cordis_define` 的 `code.host` 函数体），把它注册为 5 个
model Tools，DSH 会话里的模型从此可以直呼其名地驱动桌上的猫。

## 能力

| Tool | 作用 | 走的接口 |
|---|---|---|
| `lingxi_task` | 报任务流程 + **心情**（state/kind/mood/summary/progress） | `POST /task-event` |
| `lingxi_say` | 让猫说一句话 | `POST /control {say}` |
| `lingxi_react` | 直接做一个表情/动作 | `POST /control` |
| `lingxi_state` | 读猫的状态与完整表情/动作库 | `GET /perception` |
| `lingxi_remember` | 持久记住一条关于用户的事实 | `POST /memory` |

`lingxi_task` 的 `summary` 是必填项：开始时用 `running` 报当前目标，结束时用
`completed` / `failed` / `cancelled` 报结果，并在 `summary` 写清具体任务。完成气泡会把
这个摘要和 DSH 标识一起展示。当前 DSH 接入通过工具描述直接提供这些行为规则；只有 DSH
宿主会加载独立 agent skill 时，额外安装 skill 才会增加触发准确度。

## 稳定事件契约

每个实际任务至少报开始和终态，所有事件沿用同一个 `taskId`。插件会把 `provider` 与
`agent` 固定为 `dsh`，因此气泡署名和主界面的任务归属稳定显示为 DSH；不要为每次工具调用
另造 agent id。`taskId`、`state`、`summary` 都是必填字段：

```json
{"state":"running","taskId":"fix-login-2026-09-23","kind":"build","summary":"修复登录流程并运行相关测试"}
{"state":"completed","taskId":"fix-login-2026-09-23","kind":"build","summary":"修复登录流程；相关 18 项测试全部通过"}
```

- `completed` 只表示用户目标已经成功完成；中间一轮模型回答、工具调用结束或插件刚加载，不能报告为任务完成。
- `failed` 说明没有成功，并在摘要里指出失败对象；用户取消用 `cancelled`。
- `needs_input` / `needs_approval` 只在确实需要用户回答 / 批准而无法继续时使用；`blocked` 表示暂时卡住但不需要用户介入。
- `summary` 写用户能读懂的结果，不写“好了”“搞定”或仅有状态名。它会用于完成气泡和主界面最近任务；托盘只显示需要留意的任务数量，不暴露任务内容。
- 长任务可用相同 `taskId` 报进度；不要为每个进度点另开任务。猫会压低重复进度反应，但主界面仍显示最新状态。
- 只在确有判断依据时传 `mood`；它影响灵犀如何回应，不改变任务状态。

插件激活时只注册 DSH 身份，不制造一个永远处于 running 的“桥接就绪”假任务。故而首页显示“已登记 · 暂无任务”是正常的；真正调用 `lingxi_task` 后才会出现任务状态。

身份固定 `dsh`，启动时 `POST /agents` 注册徽标（`DS`，DeepSeek 蓝）——幂等。

## 设计约束（都是沙箱教过的）

- 动态插件沙箱禁 Node 全局：HTTP 不能 `fetch`（`WebFetchRequest` 是 GET-only），所以走
  `shell` 服务的 curl——与 CLI/hooks 完全同一条 token `-K` 路径，token 不进 argv；
- `shell` 用 `ctx.get('shell')` 可选查询（沙箱 façade 允许；`ctx.shell` 属性访问才要求
  `inject` 声明），并回退 `bash`；
- 所有 Tool 注册挂在 `ctx.effect` 的 disposer 上，stop/update/undefine 全部可逆；
- 桥接没起时工具调用如实报错（"bridge unreachable - is the cat running?"），不假装成功。

## 加载（在 DSH 会话里让 agent 执行）

1. `cordis_define`：`code.host` = 本文件内容（去掉首尾注释也可，整段贴进去即可）；
2. `cordis_run`：激活返回的 packageId（Host-only 包，无需浏览器批准）；
3. 下一步起 `lingxi_*` 五个工具即可被模型调用。

如果 DSH 采用 profile/preset 管理动态插件，建议把 `cordis_define` 与 `cordis_run` 收进该 preset，
避免每次新会话手工重贴；插件生命周期仍由宿主管理，更新源码后要重新定义并激活，旧会话里的
工具不会自动热更新。

## 验收

```bash
lingxi agents   # 出现 dsh / DS 徽标，确认身份注册
# 在 DSH 会话中调 lingxi_state → 返回 perception JSON，确认桥可达
# 报一条 running 和对应的 completed 后，lingxi events 应能看到两条同 taskId 的 dsh 事件
```

常见排查：若没有 `lingxi_*` 工具，确认 Cordis 包已 `cordis_run`；若工具报 bridge unreachable，
确认灵犀桌面端在运行且 shell 服务可用；若身份出现但首页没有任务，这是尚未调用
`lingxi_task` 的正常空态；若有任务但没有署名徽标，确认 `lingxi_register` / 插件的
`POST /agents` 使用稳定 id `dsh`，并从该 agent 发出 `lingxi_task`。

## 生命周期

动态插件是会话级的：进程重启即消失，重新按上面两步加载即可（源码在本目录，随时可贴）。
要跨会话常驻，应做成 agent preset 的一行 Cordis 组合——那是另一条路径，见
`editing-cordis-compositions` skill。
