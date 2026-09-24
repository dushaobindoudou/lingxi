# 灵犀 · Claude Code 插件

让桌面上的灵犀陪你用 Claude Code：会话开始时它醒过来，Claude 等你授权时它来叫你，一轮做完它有
反应；Claude 会在合适的时候告诉它这件事是什么心情，让它说句话、记住你的事、过一会儿提醒你。

**应用不用你先装。** 插件发现这台 Mac 上没有灵犀，会在后台下载、校验、安装、打开；已经装了就直接
复用。你的配置和数据（设置、记忆、提醒、自定义资源）跟着应用的 bundle id 走，**卸载重装、升级
都会沿用**，插件从不碰它们。

## 安装

```bash
claude plugin marketplace add dushaobindoudou/lingxi
claude plugin install lingxi@lingxi
```

或者在 Claude Code 里：`/plugin marketplace add dushaobindoudou/lingxi`，然后 `/plugin install lingxi@lingxi`。

装完开一个新会话。第一次会看到一行「正在后台下载安装桌面猫（约 16 MB）」，十几秒后猫出现在桌面上，
主界面会停在「Agent 接入 → Claude Code」这一栏，告诉你 Claude 已经接上、有什么权限。之后的会话里
插件什么都不说——一切正常时它就该是安静的。

> 仓库目前是私有的：插件从 GitHub Releases 下载应用时用的是你本机 `gh` 的登录身份，所以需要先
> `gh auth login`，而且这个账号要能访问仓库。仓库公开之后不需要 `gh`。

## 命令

| 命令 | 做什么 |
|---|---|
| `/lingxi:setup` | 没装就装、没开就开，以 Claude 的身份接入，打开主界面的 Claude Code 一栏，最后告诉你还有什么要处理 |
| `/lingxi:setup update` | 同上，并把应用升级到最新版本（配置和数据保留） |
| `/lingxi:status` | 只读：装了没、在不在跑、有没有新版本、Claude 的权限、数据在哪、插件选项 |

Claude 自己用的是 `lingxi`（插件把它放进了 Bash 的 PATH）：`lingxi task running write tender "给妈妈写信"`、
`lingxi say`、`lingxi remember`、`lingxi remind`。什么时候该用、什么时候不该用，写在插件带的 skill 里。

## 它在什么时候做什么

| 时机 | 插件做的事 | 你会看到 |
|---|---|---|
| 会话开始，应用没装 | 后台下载 → 校验 SHA256、bundle id、代码签名 → 装进「应用程序」→ 在前台打开 → 显示 Claude 这一栏 | 一行提示；十几秒后猫出现 |
| 会话开始，装了没开 | 后台打开（不抢焦点），就绪后告诉猫"会话开始" | 猫出现 |
| 会话开始，已经在跑 | 告诉猫"会话开始" | 猫抬头 |
| 你提交一条消息 | 告诉猫"开始干活"（`reactions=important` 时不发） | — |
| Claude 等你授权 / 等你回话 | 告诉猫；授权会比提问更醒目 | 猫来叫你 |
| 一轮结束 / 出错 | 告诉猫结果 | 一句短评 |
| 会话压缩（compact） | 什么都不做 | — |

会话开始时的检查**毫秒级返回**：下载和启动都在后台，不会拖住你的会话。除了会话开始，插件**从不**
启动应用——你中途把猫关了，它就一直关着，直到下一次会话开始。

## 选项

`/plugin` → lingxi → 配置：

| 选项 | 默认 | 说明 |
|---|---|---|
| 没装灵犀时自动安装 | 开 | 关掉后改用 `/lingxi:setup` 手动安装；没装时每天最多提醒一次 |
| 会话开始时自动打开灵犀 | 开 | 关掉后插件只投递事件，不启动应用 |
| 猫对会话的反应 | `all` | `important` 不发每条提问的事件；`off` 不发生命周期事件（Claude 报的心情照常） |

安装时 Claude Code 会提示「3 userConfig options not yet set」——不用管，不设置就是上表的默认值。

环境变量 `LINGXI_AUTOSTART=0`、`LINGXI_AUTOINSTALL=0` 对所有灵犀接入生效，优先于这里的选项。

## 数据与卸载

| 东西 | 在哪 | 谁管 |
|---|---|---|
| 应用 | `/Applications/灵犀.app`（不可写时是 `~/Applications`） | 插件装、升级；卸载时拖进废纸篓 |
| 配置和数据 | `~/Library/Application Support/com.dushaobin.lingxi-desktop/` | **应用**。插件只读不写；卸载应用、卸载插件都不会删 |
| 插件状态（安装进度、日志） | `~/.lingxi/claude/` | 插件。不放在 `${CLAUDE_PLUGIN_DATA}`，因为那里会随插件卸载一起删掉 |

- 卸载插件：`claude plugin uninstall lingxi@lingxi`。应用和数据都留着。
- 连数据一起清掉：退出灵犀，删掉应用，再删 `~/Library/Application Support/com.dushaobin.lingxi-desktop/`。

## 和「一键接入」的关系

应用主界面里的「一键接入」会把 hooks 写进 `~/.claude/settings.json`。Claude Code **不会**把插件的 hook
和 settings 里的 hook 去重，两个都装的话每个事件会发两遍——所以插件发现那些 hooks 时**自动让路**，
只做安装和启动，事件交给它们发。主界面会显示"由插件接入"，并提供"移除一键接入的 hooks"按钮。
推荐只用插件。

## 安全

- 安装包必须和同一个 release 的 `SHA256SUMS.txt` 对得上、bundle id 必须是 `com.dushaobin.lingxi-desktop`、
  代码签名必须能校验通过，否则拒装，旧版本保持原样。
- 下载用 `gh` 或 `curl`，不经过浏览器，所以没有隔离属性，第一次打开不会被 Gatekeeper 拦
  （发布说明里那段「仍要打开」的步骤，走插件安装就不需要了）。
- 事件通过本机 HTTP 桥发给应用，只监听 `127.0.0.1`；token 从 0600 的文件读，经 `curl -K` 传递，不出现在
  进程列表里；所有请求都 `--noproxy`，不会被环境里的代理转走。

## 排查

| 现象 | 看这里 |
|---|---|
| 猫没出现 | `/lingxi:status`；安装日志在 `~/.lingxi/claude/install.log` |
| 下载失败 | 私有仓库需要 `gh auth login`；或者从 Releases 下载 .dmg，运行 `scripts/install-app.sh --from <文件>` |
| 猫没反应 | 终端里 `lingxi doctor`，逐项检查应用、鉴权、署名、权限、宿主 |
| 反应太多 | 选项里把「猫对会话的反应」改成 `important` |

## 结构

```
.claude-plugin/plugin.json   清单与三个用户选项
hooks/hooks.json             SessionStart 同步（毫秒级）；其余四个异步
scripts/lib.sh               共享：定位应用、检查桥、投递事件、选项、去重
scripts/session-start.sh     检查模块：装 / 开 / 报
scripts/event.sh             生命周期事件：只投递，不启动
scripts/install-app.sh       下载、校验、安装、升级；也可 --from 离线安装
scripts/lingxi-cli           integrations/cli/lingxi 的逐字副本（测试守着）
bin/lingxi                   Claude 用的 CLI，固定以 claude 身份说话
bin/lingxi-claude            /lingxi:setup 和 /lingxi:status 的实现
commands/                    /lingxi:setup、/lingxi:status
skills/lingxi/SKILL.md       教 Claude 报心情、克制地让猫说话
.mcp.json + mcp/             可选的 MCP server（packages/mcp-server 的副本）
```

这个插件是灵犀所有宿主插件的**参照实现**，其他宿主要达到的标准写在
[`../PLUGIN-STANDARD.md`](../PLUGIN-STANDARD.md)。测试在 `integrations/test/claude-plugin.test.mjs`
（真的造一个签名的 .dmg 去装、升级、篡改）和 `packages/mcp-server/test/plugin-copy.test.mjs`。

发布新版插件：改 `.claude-plugin/plugin.json` 的 `version`，推到 main。用户那边 `claude plugin update lingxi@lingxi`。
