# 宿主插件标准

灵犀给每个宿主（Claude Code、Codex、Cursor、DSH、WorkBuddy……）各做一个插件。这份文档规定
**每个插件都必须做到什么**。参照实现是 [`claude/`](claude/)——下面每一条在那里都有代码和测试，
写新插件或改旧插件时照着它对。

条目按"用户会不会因此吃亏"排序，前三组是硬性要求。

## 一、应用的生命周期

| # | 要求 | 为什么 | Claude 插件里在哪 |
|---|---|---|---|
| A1 | **没装就装**：在会话边界发现应用不存在时，后台下载最新 release、校验 SHA256 / bundle id / 代码签名、装进「应用程序」、在前台打开，并把用户带到主界面这个宿主的那一栏（`POST /control {"openManagement":"agent:<宿主>"}`）。宿主不允许装东西时，给一句能照做的话 | 用户装插件就是想要猫；让他再去找 .dmg 是把活推回给他 | `scripts/install-app.sh`、`session-start.sh` |
| A2 | **装了就复用**：先查 `/Applications`、`~/Applications`，再查 Spotlight，**排除** `/Volumes/`、`/target/`、废纸篓；打开时**按路径** `open -g <path>`，`-b` 只作后备 | `open -b` 让 Launch Services 在所有见过的副本里挑，开发机上它挑中过 `src-tauri/target/…/bundle` 里的构建产物 | `lib.sh` 的 `lx_app_path`、`lx_open_app` |
| A3 | **只在会话边界启动**，其余事件只投递 | 每条消息都去拉起，会跟一个特意把猫关掉的人一小时顶二十次牛 | `event.sh` 从不 `open` |
| A4 | **尊重开关**：`LINGXI_AUTOSTART=0` / `LINGXI_AUTOINSTALL=0`（`0`/`false`/`no`）对所有插件生效；宿主有自己的配置系统时再加宿主级选项 | 投屏、演示时，一个会让窗口冒出来的插件必须能关掉 | `lx_may_start`、`lx_may_install` |
| A5 | **绝不阻塞宿主**：会话开始的检查毫秒级返回，下载和启动都 detach；任何 hook 都以 0 退出 | 很多宿主会等 hook 结束；有的把非 0 当成"拦下这次操作" | `detach`、`exit 0` |

## 二、用户的数据

| # | 要求 | 为什么 |
|---|---|---|
| D1 | **不写**应用的配置目录 `~/Library/Application Support/com.dushaobin.lingxi-desktop/`，只读（找 token、报告数据在哪） | 设置、记忆、提醒、自定义资源都在这里。它跟着 bundle id 走，所以卸载重装、升级都会沿用——前提是没有插件去动它 |
| D2 | 升级只替换 `.app`：先复制到旁边再原子替换，失败时旧版本原样保留；替换前退出正在运行的旧版本，之后再打开 | 半个新应用比一个旧应用糟得多 |
| D3 | 插件自己的状态放 `~/.lingxi/<宿主>/`，**不放**宿主会随插件一起删掉的目录（例如 Claude Code 的 `${CLAUDE_PLUGIN_DATA}`） | "重装插件"不能等于"忘了应用已经装好" |
| D4 | bundle id `com.dushaobin.lingxi-desktop` 永远不改 | 它就是数据目录的名字；改了等于让每个用户从一只空白的猫开始（`integrations/test/claude-plugin.test.mjs` 守着所有引用处一致） |

## 三、传输与身份

| # | 要求 | 为什么 |
|---|---|---|
| T1 | 每个 `curl` 都带 `--noproxy '*'` | curl 连 127.0.0.1 也交给环境里的 http_proxy，本地代理回 502：事件丢失，而健康检查会把 502 当成"应用在跑"，于是什么都不启动 |
| T2 | token 从 0600 文件读，经 `curl -K <临时文件>` 或请求头传递，**不进 argv** | argv 在 `ps` 里对本机所有用户可见 |
| T3 | 以**固定的宿主 id** 说话（`claude`、`codex`、`cursor`……），不要用 `~/.lingxi/agent.json` 的机器级 id；首次接入时 `lingxi register` 带上宿主的标记 | 一台机器上常常同时跑几个宿主，机器级 id 会把 Claude 的调用记到 WorkBuddy 头上 |
| T4 | 同一个宿主有两条接入路径（例如插件 + 应用的「一键接入」）时，**只能有一条发事件** | 宿主通常不会把两份 hook 去重，猫会把每件事听两遍 |

## 四、体验

| # | 要求 |
|---|---|
| U1 | 一切正常时**一句话都不说**。只在有事时说：第一次安装、安装失败、没装且关了自动安装；持续存在的状况**每天最多说一次** |
| U2 | 每个 ✗ 后面跟一句能照着做的话 |
| U3 | 提供"装/修/升级"和"看状态"两个入口（Claude 是 `/lingxi:setup`、`/lingxi:status`），输出给模型读、由模型转述 |
| U4 | 给模型的说明（skill / 规则文件）写清：安装和启动不归模型管；应用正在安装或没装时这个会话别调 `lingxi` |

## 五、工程

| # | 要求 |
|---|---|
| E1 | 只依赖每台 Mac 都有的东西（bash 3.2、curl、open、PlistBuddy、hdiutil、codesign）。需要 node 的部分（MCP）是可选项 |
| E2 | 自包含：插件目录拷到任何地方都能用，不引用仓库里其他路径。要用仓库里的文件就放一份副本，并用测试守住副本和源头逐字一致 |
| E3 | bash 3.2 的坑：变量后面紧跟中文要写 `${VAR}`（UTF-8 下 `"$VAR」"` 会被读成一个未定义的变量名）；`set -u` 下不要展开空数组；`set -o pipefail` 下不要 `cmd \| grep -q` / `\| head` |
| E4 | 行为测试：用假的 `curl` / `open` 在临时 HOME 里真跑脚本，覆盖"没装 / 装了没开 / 在跑 / 开关关闭 / 重复接入"，并在 UTF-8 locale 下跑 |

---

## 审查结果 · 2026-09-24

按上面的标准逐个看了现有插件。✓ 达标，◐ 部分，✗ 没有。

| | A1 装 | A2 复用 | A3 边界 | A4 开关 | D1–D3 数据 | T1 代理 | T3 身份 | T4 去重 | E2 自包含 | E4 测试 |
|---|---|---|---|---|---|---|---|---|---|---|
| **Claude**（`claude/`） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Codex**（`codex/`） | ✗ | ✓ 经 MCP server（本次已改为按路径） | ✓ | ✓ | ✓ | ✓ node fetch 不走代理 | ✓ `LINGXI_AGENT=codex` | ◐ notify 与应用的「一键接入」可能双发 | ✗ 指向仓库里的 `packages/mcp-server`、`adapters/lingxi-emit.mjs` | ◐ 安装脚本无测试 |
| **Cursor**（`cursor/`，5bf797f 新加） | ✗ | ✓ 本次已改为按路径 | ✓ | ✓ `LINGXI_AUTOSTART` | ✓ | ✓ | ✓ | — | ✗ 依赖仓库路径和 node | ✗ 没有测试 |
| **DSH**（`dsh/`） | ✗ | ✓ 本次已改为按路径 | ◐ 插件加载时 + 调用失败时 | ✓ | ✓ | ✓ | ✓ | — | ✓ 单文件 | ✗ |
| **WorkBuddy**（`workbuddy/`） | ✗ | ✓ 经 MCP server | ✓ | ✓ | ✓ | ✓ | ◐ 机器级 `agent.json` 就是 workbuddy，会把其他宿主的 CLI 调用也记成它 | — | ✗ 指向仓库路径 | ✗ |

**建议的修改顺序**

1. ~~Cursor 的隐私问题~~（已修，见审查意见 R1）。
2. **把 `~/.lingxi/agent.json` 降级为兜底**（T3）：它现在写着 `workbuddy`，所有没显式设 `LINGXI_AGENT` 的 CLI 调用都会记到 WorkBuddy 头上。每个插件应自己设宿主 id（Claude 插件的 `bin/lingxi` 就是这么做的）。
3. **A1 + E2**：把 `claude/scripts/install-app.sh`、`lib.sh` 抽到共享位置，打包进每个插件（副本 + 测试），Codex / Cursor 的安装脚本改成拷贝插件目录而不是引用仓库路径。
4. **E4**：给 Codex、Cursor、DSH 各补一份"假机器"行为测试，模板见 `integrations/test/claude-plugin.test.mjs`。

另见 5bf797f 的审查意见：[`../../docs/reviews/2026-09-24-5bf797f.md`](../../docs/reviews/2026-09-24-5bf797f.md)。
