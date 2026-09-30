# lingxi-doubao — 灵犀的豆包（Doubao）专用插件

豆包没有进程外 hook 机制：没有 Claude Code 那种 hooks 配置文件，会话生命周期事件不外露
（官方文档无任何 hook / 事件回调）。但豆包工作支持**自定义插件**（MCP，HTTP/STDIO 两种
传输，2026-09-28 官方文档）与**技能上传**（skill.md）——这些是"模型主动调用"的能力面，
不是事件型 hook。接入形态与升级路径见 `DOUBAO-CUSTOM-PLUGIN.md`。

| 件 | 位置 | 作用 |
|---|---|---|
| 技能 `lingxi`（系统层，共享 skill 的逐字副本） | 豆包技能根 `.user_skills/` | 灵犀的行为规则：何时通知、报什么、心情、提醒、记忆、预算 |
| 技能 `lingxi-doubao`（宿主层） | 同上 | 只在豆包成立的事：没有 hook（模型不报猫就不知道）、身份、只用 CLI。两份一起读到才会驱动猫——这是上限，也是下限 |
| 技能 `lingxi-authoring`（共享版） | 同上 | 创作自定义动作/表情/主题 |
| CLI 包装器 `bin/lingxi` | `~/.local/bin/lingxi`（豆包 agent shell 的 PATH） | 每次调用**固定以豆包身份说话**，并在桥通时带 logo 补注册，气泡显示豆包官方图标 |
| 身份注册 `POST /agents` | 内存态 | 徽章/名字/颜色 + `doubao-logo`，包装器每次调用补注册，应用重启也不丢图标 |

> **徽章图标**：`doubao-logo` 的内容是豆包官方人设头像的 `data:image/png;base64,…`
> （来源：官网 CDN `doubao_avatar_new.png`，与 `/Applications/Doubao.app` 的 `app.icns` 同款人物），
> **已抠除浅蓝渐变背景，透明底**、128px，避免小尺寸气泡上出现色块背景；
> 应用只接受纯矢量 SVG 或 PNG/WebP data URI（拒绝 SVG 内嵌光栅图），所以用 data URI 形式注册。
> 图标版权归字节跳动所有，这里仅在本机个人工具中作为接入标识复用。

> **插件是下限，skill 是上限**这句话在豆包这里不成立——豆包没有 hooks，所以 skill 既是下限
> 也是上限。模型没想起来用 skill，猫就什么都不知道。这是豆包接入的固有形态，不是缺陷。

## 身份：为什么是包装器而不是 `~/.lingxi/agent.json`

`~/.lingxi/agent.json` 每台机器只能写一个名字。这台机器上同时有 WorkBuddy / Codex / Claude，
机器级署名归谁都不对。所以豆包插件跟 Claude 插件一样，用 `bin/lingxi` 包装器钉住自己的宿主 id：

```bash
export LINGXI_AGENT="${LINGXI_DOUBAO_AGENT:-doubao}"
export LINGXI_AGENT_NAME="${LINGXI_DOUBAO_AGENT_NAME:-豆包}"
export LINGXI_AGENT_BADGE="${LINGXI_DOUBAO_AGENT_BADGE:-豆}"
export LINGXI_AGENT_COLOR="${LINGXI_DOUBAO_AGENT_COLOR:-#E6EEFF}"
exec …/scripts/lingxi-cli "$@"
```

- `scripts/lingxi-cli` 是 `integrations/cli/lingxi` 的逐字副本（测试守着一致），插件目录
  拷到任何地方都能用，不引用仓库其他路径（自包含）。
- 想临时换一个豆包身份（比如多账号），设 `LINGXI_DOUBAO_AGENT` 系列环境变量，优先于默认值。
- **不改** `~/.lingxi/agent.json`——那是机器级共享文件，WorkBuddy 的 MCP 还读它。

## 安装

```sh
./integrations/hosts/doubao/install.sh            # 正常安装，幂等
./integrations/hosts/doubao/install.sh --dry-run  # 只打印将要做的变更
./integrations/hosts/doubao/install.sh --uninstall # 撤销（恢复原 CLI，不碰别人的东西）
```

前置条件：豆包已装并跑过（技能根 `.user_skills` 存在）、灵犀仓库在本地。
豆包改了技能根位置时用 `LINGXI_DOUBAO_SKILLS` 覆盖。

### 装完检查

```sh
lingxi health                       # 桥接在跑、token 在哪
lingxi agents                       # doubao 应带「豆」与 #E6EEFF
lingxi task completed write proud "豆包接好了"   # 让猫真的反应一次
lingxi events                       # 应看到 provider=doubao 的事件
```

## 一键唤起豆包接入向导（README 链接）

点击下面的入口，豆包客户端会被唤起，并自动新建一个工作任务、把「灵犀接入向导」
粘进输入框；你按回车后，豆包工作任务里的 agent 会自己按向导完成整套官方接入
（读文档 → 运行安装脚本 → 确认/注册连接器 → 确认技能 → 端到端验证 → 汇报）。

- 🔗 [**Open-Doubao-Onboarding.command**](onboarding/Open-Doubao-Onboarding.command) —
  Finder 里双击即可运行（等价 `bash onboarding/open-in-doubao.sh`）
- 🔗 [**open-in-doubao.sh**](onboarding/open-in-doubao.sh) — 命令行直接跑：
  `bash integrations/hosts/doubao/onboarding/open-in-doubao.sh`
- 向导文本可用 `DOUBAO_BOOT_PROMPT` 环境变量覆盖。

**为什么是脚本而不是 doubao:// 链接**：豆包桌面端（`com.bot.pc.doubao`）的
`Info.plist` 里 `CFBundleURLTypes` 为空——没有注册任何 URL scheme，`doubao://`
带参数唤起不存在。所以 README 的"链接"指向本机脚本，由脚本完成
「唤起应用 → ⌘N 新建工作任务（豆包 2.30.4 快捷键，旧版为 ⌘J）→ 全选覆盖粘贴向导」。

**注意**：
- 首次运行需在「系统设置 → 隐私与安全性 → 辅助功能」给终端/运行器授权
  （AppleScript 按键注入依赖它）。
- 脚本**只粘贴、不自动发送**：运行期间别操作豆包窗口约 5 秒，检查输入框后按回车，
  避免误发到其他会话。
- 已验证：运行后豆包自动进入新任务「灵犀桌宠豆包官方接入」，agent 已能自主执行接入。

## 验收基线（对 hosts/README 的底线逐条）

| 底线 | 豆包插件的做法 |
|---|---|
| 桥接 `/health` 通 | 安装器第 3 步先 `lingxi health` 再注册；不通过就照实提示，不假装成功 |
| token 权限 0600 | 包装器只负责设身份 env，token 由 CLI 自己从 0600 文件读、经 `curl -K` 传递，不进 argv |
| 事件署名正确 | `bin/lingxi` 固定 `LINGXI_AGENT=doubao`，事件流里是 `provider=doubao` |
| 卸载后不再产生事件 | `--uninstall` 删技能软链 + 恢复原 CLI，插件不再被调用 |

## 排查

- **豆包任务运行时不发 `tools/call`（2026-09-29 实证，MCP 通道）**：官方注册与工具
  发现全通——`~/Library/Logs/lingxi-mcp-access.log` 里有来自豆包的 15 次
  `initialize`、128 次 `tools/list`，但全天仅有的 2 条 `tools/call` 都是本机自检
  （08:17 / 09:53）。豆包任务里模型回复"调用成功 + 完整 JSON"属虚构：server 先记日志
  后分派（`packages/mcp-server/src/index.mjs` 先 `accessLog` 再 `handle`，handler 崩溃
  也有 catch，帧一旦到达必然留痕——此前 `request.params` 崩溃循环就是这么定位的），
  零记录说明调用帧从未到达本机。向豆包反馈前，日志窗口（08:12–09:58）之后的时间段
  连 `initialize` 都没有，即下午的任务连工具发现都没做。**MCP 通道等豆包官方修复；
  当前真正能驱动猫的是 skill + CLI 包装器**：模型在 agent shell 里跑
  `lingxi task|look|say`，不经过 MCP。验证后者：任务里让模型执行
  `lingxi task completed test "canary"`，看猫和 `lingxi events` 有无 `provider=doubao`。
- **豆包会话里模型想不起 lingxi**：豆包没有 hooks，「确定性的一半」不存在。skill 装好后
  模型读到才会用；用户主动说「让猫…」是最可靠的触发。
- **气泡署名不是「豆」**：确认 `command -v lingxi` 指向插件包装器（`readlink ~/.local/bin/lingxi`），
  以及 `lingxi agents` 里有 `doubao / 豆 / #E6EEFF`。
- **工具报 bridge unreachable**：确认灵犀桌面端在跑（`lingxi up`）。
- **豆包技能根变了**：用 `LINGXI_DOUBAO_SKILLS=/新路径 ./install.sh` 重装。
