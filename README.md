**中文** · [English](README.en.md)

[![CI](https://github.com/dushaobindoudou/lingxi/actions/workflows/ci.yml/badge.svg)](https://github.com/dushaobindoudou/lingxi/actions/workflows/ci.yml)

# 灵犀 Lingxi

> 你忙你的，我在这里。

一只安静住在桌面上的 3D 小猫。它在屏幕边缘自己遛达、做自己的事、躲开你的鼠标，
你逗它它会玩，你的 Agent 干完活它会有反应。

<img src="assets/brand/lingxi-icon-v3.png" width="200" alt="灵犀：灰棕虎斑小猫安静趴着，露出两只白色小爪" />

macOS · Tauri 2 + Rust + TypeScript + Three.js · 无第三方运行时依赖（除 three 与 Tauri 本体）

---

## 它现在能做什么

- **自己活着。** 沿屏幕边缘巡逻，会拐弯（有转弯半径，不是原地掉头），走路时脚是**踩在地上的**
  （支撑相足部在世界坐标里静止），停下来会自己做动作、换表情。
- **躲着你干活。** 鼠标是你正在工作的地方，所以它不往那儿去——连"落脚点"都不会选在光标附近。
- **能玩。** 毛线球（跟着鼠标、点击蓄力、甩出去，会滚会反弹，猫会追会拍）、逗猫棒（猫会潜伏、
  立起来够、原地起跳）、激光笔（带拖尾，永远抓不住）。
- **有反应。** 鼠标停在它身上会抬头看你，来回摸会眯眼呼噜，双击会用头蹭你。
- **会说话。** 头顶漫画气泡，钉在头骨投影上，蹲下跳起换视角都跟得住。
- **能演。** 三段全屏特效，按动漫运镜编排：从屏幕深处冲过来越来越大、集中線、命中闪白、震屏。
- **可以改。** 动作、表情、主题都是可编辑的 JSON；支持手绘身体图集和表情图。
- **接 Agent。** MCP server + Claude Code hooks + 纯 HTTP，任务完成/失败会有表情动作，
  能记住关于你的事，能过一会儿提醒你。

---

## 跑起来

需要 Node.js 22+ 和 Rust（`rustup`，仓库里有 `rust-toolchain.toml` 锁定版本）。

```sh
npm ci --ignore-scripts
cd apps/lingxi && npm ci

npm run tauri dev            # 开发
```

**打包和发布**走脚本，不要直接 `tauri build`——那样出来的包签名不完整，发给别人会显示"已损坏"：

```sh
./scripts/release.sh               # 测试 → 通用二进制 → 签名 → 校验，产物在 release/v<版本>/
./scripts/publish-release.sh       # 打 tag、推送、发布到 GitHub Releases
```

版本号、签名证书、CI 发布和排查见 [`docs/RELEASING.md`](docs/RELEASING.md)。

托盘图标里有（7 行，按 [`docs/21`](docs/21-tray-menu-and-home-surface.md) 收敛过）：
状态摘要两行、显示/隐藏、大小（小/中/大）、互动（逗一逗 / 收起玩具）、打开灵犀…、退出灵犀。
调试台、玩具、特效和全部设置都在主界面里，托盘不做功能目录。

### 开发辅助页

跑 `npm run dev`（在 `apps/lingxi` 里）后可以打开，这些页面不在打包产物里：

| 页面 | 用途 |
|---|---|
| `/app-harness.html` | 不经 Tauri 直接跑真实渲染路径，在浏览器里调试 |
| `/probe-gait.html` | **回归探针**：身体抖动、脚底打滑、自由模式行为统计 |
| `/probe-clips.html` | 逐个动作检测穿模，按严重程度排序 |
| `/probe-airborne.html` | **回归探针**：跳跃的真实高度、滞空和躯干下落的重力；加 `?strip` 出侧视图 |
| `/probe-framing.html` | **回归探针**：各视角 / 各尺寸下屏幕四边各裁掉猫的多少 |
| `/probe-unproject.html` | **回归探针**：屏幕坐标↔世界坐标是否处处可逆（曾经在屏幕底部失效） |
| `/rig-preview.html` `/style-lab.html` | 骨架和配色试验 |

`probe-gait.html` 是几个结构性 bug 的回归检查，健康值写在文件头部。改动画系统之前先看它。

---

## 架构

三层，互相之间只通过契约通信，任何一层都可以单独换掉。

```
packages/life-engine        纯行为状态机。没有 DOM、没有渲染、没有 Tauri。
     │                      只知道一个 2D 世界和一个光标。可单元测试。
     │  snapshot { state, position, heading, toy, ... }
     ▼
apps/lingxi/src/renderer    Three.js 场景。不知道桌面宿主的存在。
     │                      骨架 / 步态 / 脊柱弯曲 / 相机 / 主题 / 特效层
     ▼
apps/lingxi/src-tauri       窗口、托盘、设置持久化、本机 HTTP 桥
```

关键点：

- **朝向由引擎持有，不是从位移反推的。** 猫只能沿着 `heading` 前进，转向有角速度上限和最小
  转弯半径。这条是很多稳定性问题的根因——一旦朝向是位置的导数，位置的任何抖动都会变成
  朝向的抖动，并被相机的透视比例放大。
- **步态由距离驱动，不是时钟。** 一个步幅的地面距离推进一个步态周期，所以任何速度下脚都不打滑。
- **落地高度是姿态的属性**，不是"这一帧哪只爪子最低"。
- **边界是按身体算的，不是按锚点算的，而且分两层。** 引擎操纵的点是猫的**脚**，身体整个画在
  它上方，所以四条边不能用同一个 margin——上边用 24px 会把整只猫顶出屏幕。渲染器量出身体在
  屏幕上的实际跨度（`screenExtent()`），宿主据此给出两个盒子：
  **极限**（拖拽、玩具、全屏特效能到的地方）允许身体的一半出屏，四条边都是；
  **自由活动**（猫自己决定去哪）左右仍然露一半（这是要保留的观感），上下则整只猫都在屏幕内——
  猫高约为宽的三倍，同样的比例在侧面切掉的是身侧，在上面切掉的是**脑袋**，而表情是核心。
- **躲鼠标不只是"逃"，还会绕。** 以前只有两种反应：选目标时避开光标，或者光标压上来就跑。
  中间那种最常见的情况没人管——目标在光标另一边，于是猫直接从光标上碾过去。现在行进中会瞄准
  光标禁区的**切线**绕过去（不是加一个侧向推力，那会在快到时自己衰减掉）。只改期望朝向，
  转向速率、过弯减速、步态都不碰。实测光标不动时待在禁区内的时间 1.22%→0.00%，
  光标在五个位置间跳动时 8.15%→2.94%。
- **特效层是 DOM/SVG，全程 `pointer-events: none`。** 全屏特效不会吞掉你的任何一次点击。

细节见 [`docs/05-technical-architecture.md`](docs/05-technical-architecture.md)。
过期但有参考价值的早期文档在 [`docs/archive/`](docs/archive/README.md)。

---

## 自定义

主界面 → 外观 → 「导出内置资源为模板」，会在应用配置目录写出：

```
assets/
  actions.json       动作库      改完在界面上点「重新加载」即可，不用重新编译
  expressions.json   表情
  skins.json         主题
  textures/*.png     手绘身体图集 / 表情图
  README.md          格式说明（应用自己写的）
```

**每个文件都会先完整校验再生效。** 格式不对时保留内置版本、在界面上显示具体哪一行不对，
不会出现半张脸或者关节拧断的情况。

---

## 接 Agent

一个本机 HTTP 桥（`127.0.0.1:47811`，只监听回环），三种接法：MCP server、Claude Code hooks、
直接 HTTP。完整说明见 [`integrations/README.md`](integrations/README.md)。

```jsonc
// 任何 MCP 客户端
{ "mcpServers": { "lingxi": { "command": "node", "args": ["<repo>/packages/mcp-server/src/index.mjs"] } } }
```

十三个工具：注册身份、报告任务、看能力、看状态、说话、表情/动作、全屏特效、放玩具、
记住一件事、读回记忆、设提醒、换视角主题、重载自定义资源。

**接入的正确姿势是报告你在干什么，而不是指挥猫做什么**——
`{state:"failed", kind:"deploy"}` 比"播 shake-head"好，因为映射在用户手里
（`assets/reactions.json`），改一次对所有 agent 生效。

多个 agent 同时接入是正常情况：各自注册一个 emoji 徽章，猫身边会显示当前是谁在驱动；
表现冲突按**事件**的紧急程度仲裁（失败 > 完成 > 状态 > 氛围），**不按 agent 身份**——
用户要看到的是要紧的事，不是要紧的工具。

完整规范见 [`docs/19-agent-integration.md`](docs/19-agent-integration.md)，
设计理由见 [决策 003](docs/decisions/003-multi-agent-arbitration.md)。
运行中的应用会用 `GET /integration` 把契约原样吐出来，以它为准。

---

## 测试

```sh
npm test          # 全部包的单元测试
npm run check     # 项目规范检查
cd apps/lingxi && npx tsc --noEmit && cd src-tauri && cargo test
```

行为、转向、玩具、交互反应都有测试。渲染和动画不适合单元测试，用上面的探针页面量化回归。

---

## 现状与边界

**能用，在日常使用中。** 但要说清楚没做到的：

- 只支持 macOS。窗口、托盘、光标读取都走 AppKit。
- 多显示器下光标坐标的 y 翻转只按主屏计算，副屏上会不准。
- 摆动中的爪子会低于地平面最多约 0.7 体素。桌面没有画地板所以看不出穿模，真正的解法是
  世界空间踩地锁定 + 双骨 IK。
- 部分蜷缩类动作（打滚、侧卧、挠耳朵）后腿和躯干有重叠，见 `probe-clips.html` 的排序。
- 系统鼠标指针无法隐藏，所以逗猫棒/激光笔是画在光标位置上，不是替换了指针。
- 人格倾向滑杆目前只持久化，行为引擎还没消费它们（界面上标了「即将生效」）。

---

## 文档索引

仓库里既有当前规格，也有当时的快照。[`docs/README.md`](docs/README.md) 把每份文档归到
**当前规格 / 历史决策 / 已修复归档** 三层之一——读一份旧审计之前先看那里，否则很容易
把 2026-09-13 的结论当成今天的状态。

| 入口 | 内容 |
| --- | --- |
| [**文档分层索引**](docs/README.md) | 哪份文档描述现在，哪份只是记录当时 |
| [English docs](docs/en/README.md) | 同一套文档的英文译本。中文是原文 |
| [接入 Agent 的完整规范](docs/19-agent-integration.md) | **写接入先看这个**：词汇表、优先级、定制、自证生效 |
| [技术架构](docs/05-technical-architecture.md) | 三层分工与契约 |
| [行为系统](docs/04-life-engine.md) | 纯状态机的行为设计 |
| [主界面设计](docs/18-main-interface-design.md) | 管理窗口的信息架构 |
| [扩展架构](docs/09-extension-architecture.md) | 换肤 / 性格 / Agent 观察的接口边界 |
| [品牌与设计系统](docs/08-brand-and-design-system.md) | 名字、视觉基准、图标与界面变量 |
| [决策 001：实时桌面方案](docs/decisions/001-realtime-desktop.md) | 为什么是实时 3D 而不是预渲染 |
| [决策 002：物理与游戏库](docs/decisions/002-physics-and-game-libraries.md) | 为什么不引入 Rapier / 游戏框架 |
| [决策 003：多 Agent 仲裁](docs/decisions/003-multi-agent-arbitration.md) | 优先级、归属、鉴权的取舍 |
| [配置目录](apps/lingxi/src-tauri/README-config.md) | 运行时数据都放在哪 |
| [早期文档存档](docs/archive/README.md) | 已过期但有参考价值的设计与试作记录 |

---

## 社区

[参与开发](CONTRIBUTING.md) · [安全报告](SECURITY.md) · [行为准则](CODE_OF_CONDUCT.md) · [更新日志](CHANGELOG.md)

## 许可

见 [LICENSE.md](LICENSE.md)。以 **PolyForm Noncommercial 1.0.0** 发布：非商业用途（个人学习、爱好项目、公益与科研机构等）免费使用、修改与分发；**商业使用需另行获得商业授权**（联系方式见 LICENSE.md）。

**来源标注义务**：任何使用、修改、分发或衍生本软件的项目，必须在面向最终用户可见的显著位置标注来源「灵犀 lingxi」并附本仓库链接——详见 LICENSE.md「来源标注（附加条件）」。
