---
name: lingxi-dsh
description: DSH-only rules for the 灵犀 desktop cat - stable host identity, Cordis tools, and installation or upgrade guidance when the desktop app is missing or outdated. Read alongside the lingxi skill when using 灵犀 from DeepSeek Harness, including first setup and bridge-unreachable errors.
---

# 灵犀 · DSH 宿主层

这是 `lingxi` 系统层的补充。通知时机、任务摘要、心情和提醒预算遵循系统层；这里负责 DSH 的身份、
Cordis 工具以及桌面应用的安装与升级引导。

## 身份与调用入口

- 动态插件注册 `lingxi_task`、`lingxi_say`、`lingxi_react`、`lingxi_state`、`lingxi_remember` 五个工具。
  工具未出现时，先确认 Cordis 包已经加载并激活，不把“没有工具”判断成“没有安装桌面应用”。
- 插件固定以 `dsh` 身份调用。CLI 备用入口每条命令带 `LINGXI_AGENT=dsh`。
- 每件真实任务沿用同一个 `taskId`，开始报 `running`、结束报对应终态，`summary` 写清具体任务与结果。
  插件加载和身份注册不代表用户任务完成。

## 桌面应用检查与安装引导

DSH 插件会尝试打开已经安装的「灵犀.app」，**不会自动下载 DMG 或安装缺失的应用**。
首次使用或遇到连接失败时，先区分以下情况；不要因端口不通就认定应用没有安装。

```bash
curl -fsS --max-time 2 --noproxy '*' http://127.0.0.1:47811/health
```

- 桥接正常：继续使用工具，无需安装。
- 应用已安装但未启动：通常位于 `/Applications/灵犀.app` 或 `~/Applications/灵犀.app`；
  可按 bundle id `com.dushaobin.lingxi-desktop` 查找其他安装位置。使用插件的启动尝试，或在用户允许
  自动启动时打开已确认的应用路径。`LINGXI_AUTOSTART=0` 时给出手动启动指引。
- 应用缺失：告诉用户“DSH 工具已接入，但还需要安装灵犀桌面应用”，给出以下安装步骤。
- 应用已启动但桥接仍失败：说明实际错误，检查端口、启动状态与鉴权；一次重试后停止，不反复重装。

安装指引：

1. 打开 [官方 GitHub Releases](https://github.com/dushaobindoudou/lingxi/releases/latest)，确认页面已提供
   **v1.0.0 或更新的稳定版**。若仍只有旧版，说明目标版本尚未发布，不把旧版说成 v1.0.0。
2. 下载对应版本的 `Lingxi-<版本>-universal.dmg` 和 `SHA256SUMS.txt`，核对 SHA256。
3. 打开 DMG，把「灵犀」拖入「应用程序」，再启动它。未公证构建按该版本发布说明完成首次打开。
4. 再检查 `/health`，并调用 `lingxi_state` 确认可以读取状态后，才报告接入成功。

用户要求代为安装且当前有完整仓库时，可在仓库根使用现有的校验安装器：

```bash
LINGXI_HOST=dsh bash integrations/shared/install-app.sh --open
```

它从 GitHub Latest 下载并验证校验和、bundle id 和签名。没有仓库时给上述下载步骤；
不要假定用户机器上已经有这个脚本。`LINGXI_AUTOINSTALL=0` 时保留手动安装引导。

## 旧版升级到 v1.0.0

检查已安装应用的版本；应用放在其他目录时，使用查到的实际路径：

```bash
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' '/Applications/灵犀.app/Contents/Info.plist'
```

DSH 的启动检查只复用已有应用，**不会自动把旧版升级到 v1.0.0**。发现旧版时提示可升级，
不要因任务需要猫作出反应就自行替换应用。用户要求升级后，先确认官方发布页的目标版本可用，再使用：

```bash
LINGXI_HOST=dsh LINGXI_AGENT=dsh lingxi update
# 当前有完整仓库、但 CLI 不可用时，在仓库根执行：
LINGXI_HOST=dsh bash integrations/shared/install-app.sh --update --open
```

两条是替代路径，选择可用的一条。也可引导用户从 DMG 替换应用。保留应用配置目录，
不删除设置、记忆、提醒或 Agent 配置。升级后重新读取版本并验证桥接，按实际结果报告；
目标版本尚未发布时说明原因，已有明确来源和校验文件的本地候选包则标明候选包来源。
