**中文** · [English](README.en.md)

[![CI](https://github.com/dushaobindoudou/lingxi/actions/workflows/ci.yml/badge.svg)](https://github.com/dushaobindoudou/lingxi/actions/workflows/ci.yml)

# 灵犀 Lingxi

> 你忙你的，我在这里。

一只安静住在 macOS 桌面上的 3D 小猫。它会散步、休息、躲开鼠标，也会追毛线球、扑逗猫棒。
接入编程 Agent 后，任务完成、失败或需要你处理时，它会用表情、动作和头顶气泡提醒你。

<img src="assets/brand/lingxi-icon-v3.png" width="200" alt="灵犀：灰棕虎斑小猫，露出白色小爪" />

当前运行时采用程序生成的方块式 3D 造型；上图为品牌形象。

当前准备发布 **v1.0.0**。支持 **macOS 12 及以上、Apple 芯片和 Intel**。

## 下载与安装

1. 打开 [GitHub Releases](https://github.com/dushaobindoudou/lingxi/releases/latest)，下载最新应用版本的 `Lingxi-<版本>-universal.dmg`。
2. 打开磁盘映像，将「灵犀」拖入「应用程序」，再启动它。
3. 点击菜单栏猫咪图标 →「打开灵犀…」，可以调整大小、性格、外观、玩具和 Agent 接入。

直接使用桌面应用不需要安装 Node.js 或 Rust。版本尚未发布时，Latest 仍会指向上一版，请以发布页版本号为准。
签名与首次启动步骤以对应版本的发布说明为准；未经过 Apple 公证的构建需要在「系统设置 → 隐私与安全性」中允许打开。
每个应用版本附 `SHA256SUMS.txt`，可以用 `shasum -a 256` 校验下载文件。

## 日常陪伴

- **自己活动**：在屏幕边缘散步、休息和睡觉，工作时避开鼠标；隐藏猫咪、锁屏或睡眠时暂停活动与渲染。
- **互动与玩具**：抚摸、双击互动，或者放下毛线球、逗猫棒、激光笔。
- **任务提醒**：接入 Agent 后显示来源图标和会话名称，按失败、待处理、完成等事件作出反应。
- **记事与提醒**：主界面可以添加提醒与每日重复提醒；你离开电脑时，提醒会等你回来再说。
- **性格与外观**：五个性格滑杆影响行为，大小、视角、主题即时切换。动作、表情和皮肤支持通过 JSON 自定义。

## 接入编程 Agent

桌面应用和各接入渠道都只支持 macOS。插件与 MCP 服务在应用缺失时可以从 GitHub Releases 安装它，
已有应用和用户数据会被复用。自动下载需要网络；桌面猫的日常行为在本地运行。
DSH 动态插件通过 [DSH skill](integrations/hosts/dsh/skills/lingxi-dsh/SKILL.md) 引导安装和升级，不自动下载 DMG。

**Claude Code**（需要宿主 CLI；MCP 服务需要 Node.js 22+）：

```sh
claude plugin marketplace add dushaobindoudou/lingxi
claude plugin install lingxi@lingxi
```

**Codex**：

```sh
codex plugin marketplace add dushaobindoudou/lingxi
codex plugin add lingxi@lingxi
```

**其他 MCP 客户端**（需要 Node.js 22+；把 `cursor` 换成实际宿主身份）：

```json
{
  "mcpServers": {
    "lingxi": {
      "command": "npx",
      "args": ["-y", "lingxi-mcp"],
      "env": { "LINGXI_AGENT": "cursor" }
    }
  }
}
```

更多接法：[WorkBuddy / CodeBuddy](integrations/hosts/workbuddy/README.md)、[Cursor](integrations/hosts/cursor/README.md)、
[豆包](integrations/hosts/doubao/README.md)、[DeepSeek Harness](integrations/hosts/dsh/README.md)、[完整接入说明](integrations/README.md)。

以上命令使用本仓库提供的插件市场。官方插件目录的审核与上架是独立流程；仓库可安装不代表已经进入官方目录。
`LINGXI_AUTOINSTALL=0` 可关闭自动安装，`LINGXI_AUTOSTART=0` 可关闭自动启动。

## 数据与边界

- HTTP 桥只监听 `127.0.0.1:47811`，除健康检查外需要本机 token。任务观察接口不会批准或执行 Agent 的任务。
- Agent 回复可在本机用于生成气泡，不写入任务事件日志、不发送到通知 webhook。记忆、提醒和设置保存在本机配置目录。
- 交互次数和靠近猫咪的时长只在内存统计，重启清空；不记录鼠标轨迹。数据位置见[配置目录说明](apps/lingxi/src-tauri/README-config.md)。
- 当前只支持 macOS。多显示器坐标及部分蜷缩动作仍有已知限制，详见[已知问题](docs/KNOWN_ISSUES.md)。

## 自定义与开发

主界面 → 外观 →「导出内置资源为模板」，编辑配置目录的 `assets/`，再点「重新加载自定义资源」。
无效资源保留内置版本并显示错误。[自定义规范](integrations/skills/lingxi-authoring/SKILL.md)。

开发使用 Tauri 2、Rust、TypeScript 和 Three.js。环境、测试、回归探针和贡献流程见[参与开发](CONTRIBUTING.md)，
打包签名与渠道发布见[发布指南](docs/RELEASING.md)。

[文档索引](docs/README.md) · [English docs](docs/en/README.md) · [更新日志](CHANGELOG.md) ·
[报告问题](https://github.com/dushaobindoudou/lingxi/issues) · [安全报告](SECURITY.md) · [行为准则](CODE_OF_CONDUCT.md)

## 许可

[PolyForm Noncommercial 1.0.0](LICENSE.md)：非商业使用、修改与分发遵守许可证；商业使用需另行授权。
使用、修改、分发或衍生项目须按许可证附加条件标注来源「灵犀 lingxi」并附仓库链接。
