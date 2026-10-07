# shared/ — 每个接入共用的"找到、装上、打开灵犀"

用户装的是某个宿主的插件，想要的是那只猫。所以**每一条接入路径**在发现 Mac 上没有灵犀时都要自己把它装上，
而不是让用户再去找 .dmg（[`PLUGIN-STANDARD.md`](../hosts/PLUGIN-STANDARD.md) A1）。这里是它们共用的三个脚本：

| 文件 | 做什么 |
|---|---|
| `lib.sh` | 定位应用（常用位置 → Spotlight，排除挂载盘、构建目录、废纸篓）、检查桥接、投递事件、开关。`LINGXI_HOST` 决定状态目录 `~/.lingxi/<宿主>/` 和署名 |
| `install-app.sh` | 从 GitHub Releases 取最新版 → 校验 SHA256、bundle id、代码签名 → 复制到旁边再原子替换 → 可选打开并停在这个宿主的那一栏。全机一把锁 `~/.lingxi/install.lock`：两个宿主同时开第一个会话也只下载一次。只有 `--update` 会替换已经装好的应用 |
| `ensure-app.sh` | 通用的 SessionStart 检查：没装就后台安装、没开就后台拉起、在跑就把这次会话交给插件自己的 `event.sh`。毫秒级返回，一切正常时一句话都不说 |

## 谁在用

| 用的地方 | 副本 |
|---|---|
| Claude Code 插件 | `hosts/claude/scripts/{lib.sh,install-app.sh}`（SessionStart 用它自己的 `session-start.sh`，消息里有 `/lingxi:setup`） |
| Codex 插件 | `hosts/codex/plugin/scripts/{lib.sh,install-app.sh,ensure-app.sh}` |
| WorkBuddy 插件 | `hosts/workbuddy/plugin/scripts/{lib.sh,install-app.sh,ensure-app.sh}` |
| MCP server / npm 包 `lingxi-mcp` | `packages/mcp-server/scripts/{lib.sh,install-app.sh}`：宿主连上时发现没装，就后台起这个安装器 |
| `lingxi up`（CLI） | 找身边的 `install-app.sh`（仓库里就是这里这份） |
| 各宿主 `install.sh` 第 0 步 | 经 `lingxi up` 用这里这份 |

插件目录会被宿主整个拷进缓存、npm 包脱离仓库发布，所以每处都是**逐字副本**，不是软链。
[`../test/shared-copies.test.mjs`](../test/shared-copies.test.mjs) 守着每份副本和这里一字不差；改了这里，
照测试报错里的 `cp` 命令同步即可。

## 开关

| 变量 | 作用 |
|---|---|
| `LINGXI_AUTOINSTALL=0` | 没装时不自动安装（只提示一次/天） |
| `LINGXI_AUTOSTART=0` | 没开时不启动，也不安装 |
| `LINGXI_HOST` | 以哪个宿主的身份安装（状态目录、打开后停在哪一栏） |
| `LINGXI_RELEASE_REPO` | 从哪个 GitHub 仓库取 release，默认 `dushaobindoudou/lingxi` |
| `LINGXI_APP_PATH` / `LINGXI_INSTALL_DIR` / `LINGXI_INSTALL_LOCK` / `LINGXI_STATE_DIR` | 测试和特殊布局用 |
