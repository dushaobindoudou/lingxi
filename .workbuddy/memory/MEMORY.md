# 灵犀 Lingxi · 项目长期约定

> 详细快照见同目录 `2026-09-19.md`。

## 产品定位（用户 2026-09-19 确认）

三层价值，最上层是差异化核心：

1. **共存层** —— 透明、点击穿透、置顶不抢焦点、常驻（能耗优化待做）
2. **表现层** —— 自主行为、玩具、表情动作、全屏特效
3. **Agent 状态可视化** —— MCP / Claude Code hooks / HTTP 都经 `127.0.0.1:47811` 窄腰桥驱动

一句话：**一只住在桌面上的猫，既是安静的陪伴，也是你的 Agent 的可见状态。**

## 用户的明确决定（2026-09-19）

| # | 决定 |
|---|---|
| 1 | 自定义能力（动作/表情/皮肤/气泡）已完成，**目标是让 Agent 能彻底驱动整只猫** |
| 2 | **耗能问题后面会做彻底优化** —— 当前不是优先项，不要再提"idle 降帧没做"当缺口 |
| 3 | **文档当前版本是合理的第一版** —— 不再迭代重写 `docs/`，不要建议把 01-06 归档 |
| 4 | **"日常平均多久做一次有意思的动作"必须落在 skill 里** —— 已做成节奏预算 + 可验收指标 |
| 5 | **所有 MCP 接口文档很重要** —— 已完整落进 skill 的 `references/interface.md` |

## 工程约定

- 三层契约解耦，任何一层可单独替换：`packages/life-engine`（纯行为状态机，无 DOM/渲染/Tauri）
  → `apps/lingxi/src/renderer.ts`（Three.js）→ `apps/lingxi/src-tauri`（窗口/托盘/桥）。
- **朝向由引擎持有，不从位移反推；步态由距离驱动，不是时钟；落地高度是姿态属性。**
  改动画系统前先跑 `probe-gait.html` 回归探针。
- Agent 只走一条窄腰 HTTP 桥（`127.0.0.1:47811`，仅回环）。桥稳定，客户端随便换。
- **动作/表情库是用户可编辑的 JSON**，所以任何 agent 都不能硬编码 id，必须先 `lingxi_capabilities`。
- 猫的可见动作要克制 —— 节奏预算见 `~/.workbuddy/skills/lingxi-desktop-cat/SKILL.md`。

## 已知接口陷阱

`POST /control` 的 `action` / `expression` 是**转发**的，id 拼错**不报错**（`applied` 标 `(forwarded)`，
`rejected` 为空）。对比 `perform` / `camera` / `skin` / `scale` / `toy` 走 Rust 校验、拼错明确 400。

## 测试

`npm run check` + `npm test`（50 个单测全绿）。`cd apps/lingxi && npx tsc --noEmit && cd src-tauri && cargo test`。
渲染/动画不适合单测，用 `probe-*.html` 页面量化回归。
