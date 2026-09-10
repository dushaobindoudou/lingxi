# 灵犀 Lingxi

> 你忙你的，我在这里。

一只真实、柔软、安静地生活在桌面上的 3D 小猫。保持熟悉的外形与猫性，支持独立换肤和性格配置，并为 Codex、Claude Code、DeepSeek Harness 等平台提供可扩展的任务观察入口。

<img src="assets/brand/lingxi-icon-v2.png" width="240" alt="灵犀：灰棕虎斑小猫安静趴着，轻轻歪头" />

**当前阶段：设计与工程基础。** 已有参考图与图标、官方 Blender MCP 集成、Blender 角色设计工作场景、配置与观察契约、测试和项目规范。尚无成品猫模型、完整毛发绑定、可运行桌面应用或三个 Agent 平台的在线观察功能；不能把参考图当成实时 3D 效果。

## 从这里开始

| 入口 | 内容 |
| --- | --- |
| [品牌与设计系统](docs/08-brand-and-design-system.md) | 用户确定的名字、纠正后的视觉基准、图标与界面变量 |
| [真实 3D 桌面方案](docs/decisions/001-realtime-desktop.md) | Blender 母版、运行时毛发、透明窗口、技术验证门槛 |
| [换肤 / 性格 / Agent 观察](docs/09-extension-architecture.md) | 可扩展接口、来源验证与实现边界 |
| [官方 Blender 工作流](docs/10-blender-workflow.md) | 已安装版本、连接、设计源文件和验证证据 |
| [角色工作场景](assets/characters/lingxi/source/lingxi-reference-studio.blend) | 打包参考、相机、灯光、材质基线与制作集合 |
| [角色多视图候选](assets/characters/lingxi/reference/turnaround-v1.png) | 供进一步校正的角色设计参考 |
| [项目设置与状态](docs/11-project-setup.md) | 仓库设置、开发约定与交付边界 |

## 开发

需要 Node.js 22+，当前基础包无第三方运行依赖。

```sh
npm ci --ignore-scripts
npm run validate
```

测试覆盖任务去重、乱序、来源隔离、过期、隐私字段过滤、皮肤与性格解耦及 rig 兼容。Blender 自动化另需按[安装文档](docs/10-blender-workflow.md)配置本地官方 MCP。

```text
assets/brand/              图标、设计变量和生成记录
assets/characters/lingxi/  角色参考与 Blender 源文件
packages/contracts/       平台独立契约、运行时校验与测试
presets/                  计划皮肤与性格配置
scripts/blender/           官方 MCP 工作流与来源锁定
docs/                     产品分析、决策、工作流、证据
.github/                  CI、依赖更新、issue/PR 模板
```

## 原始思考与历史基线

2026-09-10 的文档保留了项目如何形成；与后续用户决定冲突时，以新决策为准。

- [项目理解](docs/01-project-understanding.md) · [MVP](docs/02-product-and-mvp.md) · [角色资产](docs/03-character-and-assets.md)
- [行为系统](docs/04-life-engine.md) · [早期技术比较](docs/05-technical-architecture.md) · [早期路线图](docs/06-roadmap-and-decisions.md)
- [审美分析](docs/07-visual-direction.md) · [原始长文](docs/source/original-thinking.txt) · [用户概念图](docs/source/peipei-concept-board.png)

开发流程见 [CONTRIBUTING](CONTRIBUTING.md)，安全边界见 [SECURITY](SECURITY.md)，当前为[私有孵化许可状态](LICENSE.md)。
