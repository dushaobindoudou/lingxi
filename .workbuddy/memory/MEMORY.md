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

**边界要说准（2026-09-19 09:20 修正）**：不是"什么都看不到"。`GET /status` 暴露
`skin` / `camera` / `scale` / `visible` / `mode` / `activeAgent` / `behaviorPreset`；
`/perception` 暴露 `petState` / `petPosition` / `action` / `toy` / `activity`。
**真正的盲区只有三项：`expression`、`heading`、`aiIntent`。**
其中 `expression` 最致命 —— 它是唯一"能改但改完无法验证"的控制项，
拼错和正确返回一模一样的 `200 (forwarded)`，所以假成功在表情上**不可检测**。
`/status.skin` 能读还让 #13 更刺眼：**用户能选、接口能读，只有写入口被硬编码挡住。**

### 自定义资源：位置正确，但皮肤谁也够不到

**资源位置**：`~/Library/Application Support/<bundle-id>/assets/`（本机 `com.dushaobin.lingxi-desktop`）。
安装版与源码构建版**共用同一 bundle id，因此共用同一目录** —— 写进 `.app` 包内反而会被下次构建覆盖。
判断"应用到底读哪"的可靠姿势：`lsof -nP -i :47811` 拿 PID → `lsof -p <PID> -a -d txt` 拿可执行路径
→ 对照 `Info.plist` 的 `CFBundleIdentifier`。（sandbox 下 `ps aux` 读不到进程，`lsof` 可以。）

**自定义资源的三种可达性完全不同**（真实资源上实测）：

| 资源 | agent 能否用 | 用户能否用 | 备注 |
|---|---|---|---|
| 动作 `actions.json` | ✅ 能，真播 | ❌ 无手动触发入口 | `category:"特效"` 永不自动播 |
| 表情 `expressions.json` | ⚠️ 发得出去，无法验证 | ❌ 无界面显示 | `200 (forwarded)` 与拼错无法区分 |
| **皮肤 `skins.json`（新 id）** | ❌ | ❌ | **四道门全关** |

**自定义皮肤的四道门**（任何一道都足以挡死）：

1. 外观页卡片列表读**编译期打包**的 `apps/lingxi/src/data/skins.json`（9 条内置）
   → 自定义皮肤**不生成卡片**，用户根本看不见（`management.ts:16/27/202`）。
2. UI 点击 → `set_skin` → `apply_skin`（`lib.rs:399`）`KNOWN_SKINS` 校验失败 → **静默回落默认皮肤**。
3. `/control`（agent 路径，`lib.rs:865`）→ **400**，错误信息还让调用方去查 `GET /capabilities`，
   而那个接口**恰好列出了这个 id** —— 自相矛盾。
4. 启动读 `settings.json`（`lib.rs:266`）→ 不在白名单 → 回落 `default_skin()` —— **活不过重启**。

`management.html:225` 承诺"动作、表情、主题…改完点「重新加载」即可生效" ——
**对主题不成立**，会让用户白点一次并以为应用坏了。

**重载本身是有效的**（`reload_custom_assets` 只让渲染层重读 `assets/*.json`，不重新编译/安装），
动作能立刻播 —— 但三样东西都没有用户可见入口，所以体感是"什么都没发生"。

复用**内置 id** 覆盖配色是通的（合并语义 + id 在白名单里）；**新增 id 的皮肤当前版本别做。**

## 多 agent 共用一个桥（2026-09-19 确认的问题）

两个入口写同一个「当前值」，**单 agent 今天就会重复反应**：
`/task-event` → `react_to_task_event`（hooks 自动）与 `/control` → `apply_control_command`（MCP 主动）
完全不相干。且 `react_to_task_event` 把 `TaskEvent` 已有的 `platform`/`source` 压成三元组后丢掉了，
所以归属不可见。

三阶段解法与取舍见 `~/.workbuddy/skills/lingxi-desktop-cat/references/multi-agent.md`。
**决定做不做仲裁队列前，先加 reaction/event ratio 计数器**（目标 0.2–0.4，>0.8 一定烦人）。
完整待修复清单：`ISSUES-2026-09-19.md` + TaskList #1–#15（用户明确"先记录，一会再修复"，
且在修复前要求"只测不修"）。

## 测试

`npm run check` + `npm test`（50 个单测全绿）。`cd apps/lingxi && npx tsc --noEmit && cd src-tauri && cargo test`。
渲染/动画不适合单测，用 `probe-*.html` 页面量化回归。
