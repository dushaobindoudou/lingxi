---
name: lingxi-workbuddy
description: WorkBuddy-only rules for the 灵犀 desktop cat - the trust gate that decides whether MCP tools appear at all, why the CLI beats MCP on this host, the hooks and quota guard that are already installed, and the permissions only a human can grant. Read alongside the lingxi skill whenever you are driving the cat from WorkBuddy. Triggers - 灵犀, 桌宠, desktop cat, WorkBuddy, 信任, 额度, "让猫".
---

# 灵犀 · WorkBuddy 宿主层

这份是 **宿主层**（`lingxi-workbuddy`）。系统层是 `lingxi`——怎么调用、`mood`、任务进度、
提醒、记忆、预算都在那里，**两份都要读**。

按系统层的分工，**身份、调用入口、自动上报、安装启动**这四件事以本文为准，其余以系统层为准。
本文只补 WorkBuddy 的事实，不改系统层的规则。

## 一、生命周期和弹窗都不用你报了

`install.sh` 已经装好五个 hook 事件，宿主自己触发（具体事件支持取决于宿主版本）：

| 事件 | 猫的反应 |
|---|---|
| `UserPromptSubmit` | 新一轮开始 → running |
| `Stop` | 这一轮结束 → completed |
| `StopFailure` | 失败终止 → failed |
| `Notification` | agent 在等用户（权限提示、提问）→ `needs_approval` / `needs_input` |
| `PermissionRequest` | 权限对话框刚打开 → `needs_approval` |

所以你**不用**自己去报"开始了""结束了"，也不用替弹窗播报——那部分已经有人在做了。
（弹窗这两条是后加的：以前只装生命周期，WorkBuddy 弹权限框时猫完全没反应。）

hook 报不出的是**心情**和完整任务结果。结束前用稳定 `taskId` 报终态和具体 `summary`；
Stop 由独立 workbuddy 适配器读取原生 transcript 的最终回复；取不到时播「这一轮结束了」，
只代表回合结束，不代表用户任务完成。你报过同一轮的结果后，应用仍会让 hook 让位。
同一等待的 Notification 是重复提示，不会反复念或重新挂起已读数字。

每条任务命令都带同一个 `LINGXI_TASK_ID`，不要只换表情。结束前报具体结论，例如：

```bash
LINGXI_AGENT=workbuddy LINGXI_TASK_ID=fix-login "$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bin/lingxi" task completed test proud "登录测试已修复，相关用例通过，可以继续发布"
```

## 二、额度守卫也在自己跑

同一批 hook 里的第二条会读 WorkBuddy 自己的用量库，在会话上下文跨过 60% / 70% / 90% 时
让猫说一句话。它会自己说，你不用替它操心，也不用重复播报。

它说不出"账号还剩多少 credits"——**余额不在本地**，只有服务端知道。别去猜，更别编一个数。

## 三、用 CLI，不要用 MCP

```bash
LINGXI_AGENT=workbuddy "$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bin/lingxi" state
```

- 每条 CLI 命令显式带 `LINGXI_AGENT=workbuddy`，避免机器级身份被其它宿主覆盖。
- 已知真实会话 id 时用 `LINGXI_SESSION`（CLI）或 `session`（MCP）；不知道时省略，不要猜最新会话。
- CLI **不在 PATH 上**，应用每次启动会把它写到上面那个固定位置。
- MCP 在 WorkBuddy 上每个工具都要单独授权，一轮里改三次表情就过三次；shell 只有一次。
- MCP 还多一道闸门（见下）。CLI 不需要通过它。

## 四、MCP 工具不出现时，是闸门没开，不是坏了

会话里看不到 `mcp__lingxi__*` 这些工具，不是安装失败，是**宿主还没给信任**：
连接器管理页右上角 → 自定义连接器 → lingxi → 「信任」。在那之前工具根本不会注册进来。

⚠️ **别为了"修好它"去改 `mcp.json` 的 `env`。** WorkBuddy 把信任按
`sha256(command | args | env 键名)` 记账——多一个 env 键就换了一个哈希，等于把用户已经
点过的信任吊销。而这次连进程都没被拉起，server 里任何日志都不会执行，
表象只有一句"猫不反应了"，和别的故障完全无法区分。

（skill 和 CLI 这两条路不受闸门影响，装完就能用。）

## 五、被拒就别重试，也别自己去发权限

`skin` / `camera` / `scale` / `visible`、备忘录、提醒这些需要 `trusted`，
由用户在 **主界面 → Agent 接入 → 权限** 里给。被拒绝就是答案，换条路走。

**不要自己写 `~/.lingxi/agent-permissions.json`**——那是 agent 给自己发权限，设计上就是禁止的；
而且那份文件是启动时载入的，手改要重启应用才生效，所以正路只能是 UI。

## 六、身份已经注册过了

`~/.lingxi/agent.json` 里是 `workbuddy` / 🐧 / `#0AC89F`，还带着一段 logo（气泡头像用它）。
所以：

- **不要重复跑 `lingxi register`**——不带全参数的那次会把 badge 和 name 覆盖成默认值。
- **别想用 env 覆盖身份**，MCP 读的是这个文件，env 在这里不起作用。

## 七、应用的安装和启动不归你管

插件在会话开始时检查：没装就下载、校验、安装并打开，没开就后台拉起；其它子命令遇到猫没开也会拉起一次。
用户设了 `LINGXI_AUTOSTART=0` 就是不想让你开猫——照实说，别绕过去。

## 八、排障

```bash
lingxi state          # expression / heading / intent —— 猫现在到底怎么了
lingxi agents         # 在册 agent、各自的 permission，以及 stage 被谁占着
LINGXI_QUOTA_DEBUG=1  # 额度守卫为什么没说话（它会读 ~/.workbuddy/workbuddy.db）
```

拿到 **`stage busy` 就丢掉，不要重试**——等舞台空出来，你那句话已经在讲历史了。

## 九、确定性的一半装没装

`install.sh` 和插件都默认装 hooks，**不用主动查**。只在用户问「为什么它不自动反应」时：

```bash
{ grep -qs 'lingxi-emit' ~/.workbuddy/settings.json 2>/dev/null || grep -qs '"lingxi@' ~/.workbuddy/plugins/installed_plugins.json 2>/dev/null; } && echo installed || echo absent
```

两个来源都看：`install.sh` 写 settings.json，插件市场装的在 `installed_plugins.json`。
**只读这两个文件**——`plugins/` 有几百 MB，递归 grep 会卡死。

`absent` → 装插件或跑本目录 `install.sh`。不要自己写 hooks（见第四、五节）。

## 接入引导

照系统层「第二步：接入引导」做，扫描写成 `LINGXI_AGENT=workbuddy "$HOME/Library/Application Support/com.dushaobin.lingxi-desktop/bin/lingxi" connect`；本宿主（`workbuddy`）已接入，只问 `OFFER: yes` 列出的其他软件。
