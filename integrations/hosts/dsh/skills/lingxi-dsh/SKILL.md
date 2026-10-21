---
name: lingxi-dsh
description: DSH-only rules for the 灵犀 desktop cat - stable host identity, Cordis tools, and installation or upgrade guidance when the desktop app is missing or outdated. Read alongside the lingxi skill when using 灵犀 from DeepSeek Harness, including first setup and bridge-unreachable errors.
---

# 灵犀 · DSH 宿主层

这是 `lingxi` 系统层的补充。通知时机、任务摘要、心情和提醒预算遵循系统层；这里负责 DSH 的身份、
Cordis 工具以及桌面应用的安装与升级引导。

## 身份与调用入口

- 动态插件注册与 MCP 相同的 13 个工具：`lingxi_capabilities`、`lingxi_state`、`lingxi_say`、
  `lingxi_express`、`lingxi_perform`、`lingxi_play`、`lingxi_remember`、`lingxi_recall`、
  `lingxi_remind`、`lingxi_look`、`lingxi_register`、`lingxi_task`、`lingxi_reload_assets`。
  旧名 `lingxi_react` 已改为 `lingxi_express`。工具未出现时，先确认 Cordis 包已经加载并激活，
  不把“没有工具”判断成“没有安装桌面应用”。
- 插件固定以 `dsh` 身份调用。CLI 备用入口每条命令带 `LINGXI_AGENT=dsh`。
- 每件真实任务沿用同一个 `taskId`，开始报 `running`、结束报对应终态，`summary` 写清具体任务与结果。
  插件加载和身份注册不代表用户任务完成。有真实会话 id 时传 `session`，不知道就省略。

## 确定性的一半本来就不存在

DSH 没有宿主级的会话事件，也没有等价机制，所以**不要向用户承诺「每轮自动反应」**，
也不要建议装什么来获得它——这里没有可装的东西。你报的终态与心情就是全部；
用户问起时照实说明这一点，比给一个做不到的方案好。

## 桌面应用

桥接不通时，插件会打开已经安装的「灵犀.app」。没装、且 `LINGXI_AUTOINSTALL` 不是 `0`/`false`/`no`/`off`
时，它在后台用和其他宿主相同的安装器从 GitHub 下载最新版（校验 SHA256、bundle id、签名），装进
「应用程序」并打开。`LINGXI_AUTOSTART=0` 时不打开也不下载。下载不阻塞这次工具调用；返回「正在安装」
就告诉用户大约一分钟后再试。进度在 `~/.lingxi/dsh/install.log`。不要自己再写一套下载，也不要在开关
关掉之后绕过去。

自动安装没能开始，或用户关掉了自动安装时，才给手动步骤：

1. 打开 [官方 GitHub Releases](https://github.com/dushaobindoudou/lingxi/releases/latest)，下载该页实际提供的
   `Lingxi-<版本>-universal.dmg` 和 `SHA256SUMS.txt`，核对 SHA256。页面还没有目标版本时照实说明。
2. 打开 DMG，把「灵犀」拖入「应用程序」，再启动。配置和数据沿用原目录。
3. 再检查 `curl -fsS --max-time 2 --noproxy '*' http://127.0.0.1:47811/health`，并用 `lingxi_state` 确认可读。

已安装的旧版不会在任务途中被自动替换。用户要求升级后，先确认发布页的目标版本可用，再用：

```bash
LINGXI_HOST=dsh LINGXI_AGENT=dsh lingxi update
# 当前有完整仓库、但 CLI 不可用时，在仓库根执行：
LINGXI_HOST=dsh bash integrations/shared/install-app.sh --update --open
```

两条是替代路径，选择可用的一条。升级后重新读取版本并验证桥接；目标版本尚未发布时说明原因。

## 接入引导

照系统层「第二步：接入引导」做，扫描写成 `LINGXI_AGENT=dsh lingxi connect`；本宿主（`dsh`）已接入，只问 `OFFER: yes` 列出的其他软件。
