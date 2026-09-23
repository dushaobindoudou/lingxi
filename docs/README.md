# 文档索引

这个仓库的文档里既有**现在的规格**，也有**当时的记录**。两者都值得留着，但混在一起读会
得到互相矛盾的"现状"——比如一份 2026-09-13 的审计说"Agent 任务观察只有契约"，而今天
往 `/task-event` 发一条 `completed` 事件，猫会换表情、播动作、说一句话。两句话都曾经是
真的，只是一句已经过期。

所以每份文档属于且只属于下面三层之一。**读之前先看它在哪一层。**

## 一、当前规格 —— 描述现在的实现

改代码之前看这些；它们和代码不一致就是 bug，该改的是其中一边。

| 文档 | 讲的是 |
|---|---|
| [`01-project-understanding.md`](01-project-understanding.md) | 项目要做成什么 |
| [`02-product-and-mvp.md`](02-product-and-mvp.md) | 产品范围与 MVP 边界 |
| [`03-character-and-assets.md`](03-character-and-assets.md) | 角色设定与资产约束 |
| [`04-life-engine.md`](04-life-engine.md) | 行为引擎的设计意图 |
| [`05-technical-architecture.md`](05-technical-architecture.md) | 三层架构与模块边界 |
| [`07-visual-direction.md`](07-visual-direction.md) | 视觉方向 |
| [`08-brand-and-design-system.md`](08-brand-and-design-system.md) | 品牌、图标与设计系统 |
| [`09-extension-architecture.md`](09-extension-architecture.md) | 扩展与适配器架构 |
| [`11-project-setup.md`](11-project-setup.md) | 环境与工程约定 |
| [`18-main-interface-design.md`](18-main-interface-design.md) | 主界面（管理窗口）的信息架构 |
| [`21-tray-menu-and-home-surface.md`](21-tray-menu-and-home-surface.md) | 托盘菜单与治愈系主界面视觉方案、素材拼接和开发映射 |
| [`19-agent-integration.md`](19-agent-integration.md) | **接 Agent 的权威文档**：桥的接口、词汇表、反应映射 |
| [`20-arbitrary-png-skin-import.md`](20-arbitrary-png-skin-import.md) | 自定义皮肤导入 |

关于「现在到底装没装、接没接、开没开」这类**运行时**问题，文档不是答案——
托盘 →「主界面」那一页是从运行中的应用读的，`GET /health` 和 `GET /integration` 也是。
文档描述设计，运行时回答状态。

## 二、历史决策记录 —— 解释为什么是现在这样

结论仍然有效，但它们记录的是**当时**的取舍，不是当前接口。

| 文档 | 讲的是 |
|---|---|
| [`decisions/001-realtime-desktop.md`](decisions/001-realtime-desktop.md) | 为什么是实时桌面程序 |
| [`decisions/002-physics-and-game-libraries.md`](decisions/002-physics-and-game-libraries.md) | 为什么不引入物理/游戏引擎 |
| [`decisions/003-multi-agent-arbitration.md`](decisions/003-multi-agent-arbitration.md) | 多 agent 同时驱动时怎么仲裁 |
| [`06-roadmap-and-decisions.md`](06-roadmap-and-decisions.md) | 路线图与阶段决策 |
| [`16-desktop-shell-prototype.md`](16-desktop-shell-prototype.md) | 桌面壳原型期的架构落地与一场误诊 |
| [`14-daily-life-action-atlas.md`](14-daily-life-action-atlas.md) | 64 格日常动作图集（图不在仓库里，见下） |
| [`evidence/`](evidence/) | Blender / MCP 时期的实测记录 |

## 三、已修复问题归档 —— 当时的快照，不是现状

**这一层最容易被误读成现状。** 每份都是某一天的实测或审读结果，写下来之后代码继续变了。
把它们当回归清单用，不要当状态板用。

| 文档 | 快照日期 | 状态 |
|---|---|---|
| [`../ISSUES-2026-09-19.md`](../ISSUES-2026-09-19.md) | 2026-09-19 | 顶部有逐条修复结论；作为接口回归清单仍然有效 |
| [`../CODE-AUDIT-2026-09-13.md`](../CODE-AUDIT-2026-09-13.md) | 2026-09-13 | 部分结论已被后续实现推翻，顶部有说明 |
| [`archive/`](archive/) | — | Blender 资产管线时期的文档，见 [`archive/README.md`](archive/README.md) |

## 为什么有些链接指向仓库里没有的文件

`.gitignore` 故意排除了建模期的重材料（`.blend`、渲染图、评估帧、导出包——几百 MB，
排除掉才使这个仓库可克隆）。描述这些材料的文档仍然按原路径引用它们，因为在产出它们的
机器上文件确实在那儿。

`npm run check` 知道这件事：它对缺失目标跑一次 `git check-ignore`，被 git 故意忽略的
不算死链，其余照样报错。所以检查通过时会顺带打印一行"N 条链接指向 git 忽略的工作材料"。
