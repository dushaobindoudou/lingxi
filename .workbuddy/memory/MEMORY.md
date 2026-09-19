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

### ⛔ 最危险：`/intent` 无输入校验 → NaN 让猫永久消失

`POST /intent -d '{"targetPoint":{}}'` → 返回 `{"ok":true}`，然后
`petPosition` 变成 `{x:null,y:null}`、`petState` 卡 `ai_directed`，**猫从桌面消失**。

根因：`clamp(NaN)` 返回 NaN（`clamp` 是 `Math.min(Math.max(v,min),max)`，
而 `Math.max(undefined,24)` = NaN）—— 所以 `suggestMoveTo` 里那层"防御性 clamp"
**对非有限输入完全无效**。之后 `heading` 与 `position` 同时 NaN，`atan2` 持续产出 NaN，**自我维持**。

**`resetPosition` 救不回**：实测重发后连续 24 秒位置仍非法 —— `resetPosition()`
（index.mjs:790-800）只重置引擎侧变量，**不重置 `heading`，也不重置渲染层平滑状态**。
实测约 10 分钟后自行恢复，但**触发点不明**（无可观测性）。

`holdMs` 也**没有上下界**（`/control` 与 `/intent` 都没有），
且 `/perception` **不暴露当前表情** —— 一个超大的 holdMs 可以把猫的脸钉住 27 小时而无人察觉。

⚠️ **教训：这个项目里"防御性 clamp"和 `ok:true` 都不能当作安全证据。**

### 假成功 / 静默失败（同一枚硬币的两面）

`POST /control` 的 `action` / `expression` 是**转发**的，id 拼错**不报错**（`applied` 标 `(forwarded)`，
`rejected` 为空）。对比 `perform` / `camera` / `skin` / `scale` / `toy` 走 Rust 校验、拼错明确 400。

修法（很便宜，**不需要复制词表**）：`CapabilitiesState.latest`（lib.rs:563-570）在启动时由渲染器
`report_capabilities` 上报并缓存了完整动作/表情清单，直接拿它校验即可。注意初始值是 `json!({})`，
**webview 上报前是空表，必须降级为转发**，不能误杀合法请求。

静默失败那面：字段名拼错或类型错（`{"expresssion":..}` / `{"scale":"big"}`）会报
`empty command: expected at least one of ...` —— 调用方会以为"我什么都没传"而不是"我拼错了"。
截断也全静默：`say` 140 字、提醒 text 140 字、记忆 text 280 字，都不告知（`say` 还谎报复全文）。

### 多提醒同时到期会被静默吞掉

`spawn_reminder_ticker`（lib.rs:940-965）把**所有**到期的标记 `done=true`，但只播报 `due.first()`。
实测 3 个同时到期 → 全部 done=true，**2 个永久丢失、用户再也看不到**。
意图（不背待办清单）是对的，实现应该"推迟"而不是"丢弃"。

### 可观测性缺口

`/perception` 没有"当前表情"和 `heading`，也没有事件日志（`/debug/events` 至今未做）。
所以"猫什么时候消失的、为什么回来"无法还原。NaN 经 JSON 序列化成 `null`，
外部无法与"字段缺失"区分。`/intent` 只有写没有读。

## 多 agent 共用一个桥（2026-09-19 确认的问题）

两个入口写同一个「当前值」，**单 agent 今天就会重复反应**：
`/task-event` → `react_to_task_event`（hooks 自动）与 `/control` → `apply_control_command`（MCP 主动）
完全不相干。且 `react_to_task_event` 把 `TaskEvent` 已有的 `platform`/`source` 压成三元组后丢掉了，
所以归属不可见。

三阶段解法与取舍见 `~/.workbuddy/skills/lingxi-desktop-cat/references/multi-agent.md`。
**决定做不做仲裁队列前，先加 reaction/event ratio 计数器**（目标 0.2–0.4，>0.8 一定烦人）。
待修复清单见 `2026-09-19.md` 末尾（6 条任务）。

## 测试

`npm run check` + `npm test`（50 个单测全绿）。`cd apps/lingxi && npx tsc --noEmit && cd src-tauri && cargo test`。
渲染/动画不适合单测，用 `probe-*.html` 页面量化回归。
