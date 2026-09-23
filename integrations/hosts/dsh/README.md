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

## 验收

```bash
lingxi agents   # 出现 dsh / DS 徽标
lingxi events   # 激活瞬间有一条 provider=dsh 的"桥接就绪"
# 会话内直接调 lingxi_state → 返回 perception JSON
```

## 生命周期

动态插件是会话级的：进程重启即消失，重新按上面两步加载即可（源码在本目录，随时可贴）。
要跨会话常驻，应做成 agent preset 的一行 Cordis 组合——那是另一条路径，见
`editing-cordis-compositions` skill。
