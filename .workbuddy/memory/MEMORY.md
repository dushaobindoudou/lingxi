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
- 猫的可见动作要克制 —— 节奏预算见 `~/.workbuddy/skills/lingxi/SKILL.md`
  （软链 → 仓库 `integrations/skills/lingxi/`；姊妹 skill `lingxi-authoring` 管自定义内容）。
- **驱动优先走 CLI 而不是 MCP**：`~/Library/Application Support/com.dushaobin.lingxi-desktop/bin/lingxi`
  （不在 PATH）。MCP 每个工具一次授权，CLI 只有一次且是能力的**超集**（多 `activity` / `events` /
  `unremind` / `raw`）。两条路同桥同 token 同契约。

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

`holdMs` 也**没有上下界**（`/control` 与 `/intent` 都没有）—— 一个超大的 holdMs
可以把猫的脸钉住 27 小时而无人察觉。（"表情不可观测"那半已修，见下方 2026-09-23 修正。）

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

### ✅ 2026-09-23 20:27 修正：三项盲区已被补上

当时说"真正的盲区只有 `expression` / `heading` / `aiIntent`"，**现在三者 `lingxi state` 全都有**：
`expression: "安然"`、`expressionHeld: false`、`heading: 1.46`、`intent: null`，
还多出一个 `recoveredAt`（正是当年 NaN 消失事件缺的那个观测点）。
所以"表情能改但改完无法验证"这条**不再成立**。
`/status.skin` 能读、写入口被硬编码挡住那条（#13）也已解（见下方四道门修正）。

### 自定义资源：位置正确，但皮肤谁也够不到

**资源位置**：`~/Library/Application Support/<bundle-id>/assets/`（本机 `com.dushaobin.lingxi-desktop`）。
安装版与源码构建版**共用同一 bundle id，因此共用同一目录** —— 写进 `.app` 包内反而会被下次构建覆盖。
判断"应用到底读哪"的可靠姿势：`lsof -nP -i :47811` 拿 PID → `lsof -p <PID> -a -d txt` 拿可执行路径
→ 对照 `Info.plist` 的 `CFBundleIdentifier`。（sandbox 下 `ps aux` 读不到进程，`lsof` 可以。）

**自定义资源的三种可达性**（2026-09-19 实测）：

| 资源 | agent 能否用 | 用户能否用 | 备注 |
|---|---|---|---|
| 动作 `actions.json` | ✅ 能，真播 | ❌ 无手动触发入口 | `category:"特效"` 永不自动播 |
| 表情 `expressions.json` | ✅ 能，**拼错会报错** | ❌ 无界面显示 | 见下方修正 |
| 皮肤 `skins.json`（新 id） | ✅ 能（需 `trusted`） | ✅ 外观页有卡片 | 四道门已开 |

### ⚠️ 2026-09-23 修正：上面那四道门已经全开了

实测（新增 id `workbuddy-mint`）：写 `skins.json` → `/capabilities` 标 `source:"custom"`
→ `lingxi reload` 后 `lastErrors: []` → **外观页把 `/capabilities.skins` 合并进卡片列表**，
自定义的加 `skin-card-custom` 标记（`management.ts:54-69`）→ `settings.json.skin` 指向新 id
能活过重启。**所以「新增 id 的皮肤当前版本别做」这条已不成立。**

同一条线上另一处也过期了：`/control` 的 `action` / `expression` **不再是静默转发**，
拼错会明确回 `unknown expression "绿灯" (see GET /capabilities for the 30 currently loaded)`。
`CapabilitiesState.latest` 校验已落地，"假成功在表情上不可检测"这句不再成立。

**仍然成立的是**：`actions.json` / `expressions.json` 是**整体替换**，`skins.json` 是**合并**。
所以改前必须先 `GET /capabilities` 看 `source`——对 `skins.json` 尤其致命：
一份不先读就写的文件会把用户已有的皮肤从盘上抹掉（本机曾同时存在 3 款自定义皮肤）。
`reload_custom_assets` 本身有效，不必重编译。

## 多 agent 共用一个桥（2026-09-19 确认的问题）

两个入口写同一个「当前值」，**单 agent 今天就会重复反应**：
`/task-event` → `react_to_task_event`（hooks 自动）与 `/control` → `apply_control_command`（MCP 主动）
完全不相干。且 `react_to_task_event` 把 `TaskEvent` 已有的 `platform`/`source` 压成三元组后丢掉了，
所以归属不可见。

三阶段解法与取舍见 `ISSUES-2026-09-19.md` 与 `decisions/003-multi-agent-arbitration.md`
（`~/.workbuddy/skills/lingxi-desktop-cat/` 这个路径不存在，别再去找）。

### ✅ 2026-09-23 20:27：优先级仲裁已经上线

`lingxi agents` 现在直接暴露仲裁状态：`priorities`（`ambient < status < report < alert`）
与 `stage{agent, badge, priority, rank, until}`。实测吃到 drop ——
`stage busy: dsh (DS) is showing a "report" reaction for another 3600ms`，
我的 `status` 不敌被丢。**被丢是设计，不要重试**（skill 里也这么写）。
同一条命令还能看到全部在册 agent 及其 `permission`。

**仍然成立**：`/task-event`（hooks 自动）与 `/control`（agent 主动）写的是同一个「当前值」，
归属仍靠 `activeAgent` 间接推断。（原来那句"先加 reaction/event ratio 计数器"的
前置条件已经过去了，仲裁先于计数器落地。）
完整待修复清单：`ISSUES-2026-09-19.md` + TaskList #1–#15（用户要求"只测不修"）。

## WorkBuddy 接入（2026-09-23 落地）

宿主插件在 `integrations/hosts/workbuddy/`（README + install.sh + workbuddy-mark.svg）。
身份：`~/.lingxi/agent.json` → `{"id":"workbuddy","name":"WorkBuddy","badge":"🐧","color":"#0AC89F"}`。

**三条只在 WorkBuddy 上成立的规则**：

1. **只有建议性的一半。** WorkBuddy 没有 hooks / notify（应用里既无 `hooks` 配置键，也无 Claude
   那套事件名）→ 会话事件不外露 → 没有"确定性的一半"，`mood` 只能靠模型自己报。
2. **`env` 是毒药。** 第三方 MCP server 的授权按 `sha256(command|sorted(args)|sorted(env 键名))`
   记账，存在 `~/.workbuddy/mcp-approvals.json`（键形如 `<hash>::lingxi`）。加/改一个 env 键就换哈希
   → 存量信任失效 → **宿主拒绝启动 server**；而进程没被拉起，server 内任何日志都不执行，
   表象只是"猫不反应了"。所以 `mcp.json` 里 `env` 永远留空，身份走机器级文件。
   `env` 在 Claude Code / Codex 那边是安全的——区别只在宿主有没有把信任挂在配置哈希上。
3. **信任闸门要用户点。** 新 server 必须去 连接器管理页右上角 → 自定义连接器 → 点「信任」，
   否则 `mcp__lingxi__*` 工具在会话里根本不出现。

本机 config hash = `8ab237fd4229218a…`（改 `command`/`args` 就变，就要重新点信任）。

⚠️ 未获用户明确授权时**别自己去写 `agent-permissions.json`**——那是"agent 自己选权限"，
设计上就是禁止的。`skin` / `camera` / `scale` / `visible` / 备忘 / 提醒都要 `trusted`，
由用户在 主界面 → Agent 接入 → 权限 里给。（`permission_of` 先查内存、再查启动时载入的 `saved`
表 → 手改文件要重启应用才生效，所以正路只能是 UI。）

`.workbuddy/probes/` 三个探针的 `REPO` 已从硬编码 `/Users/dushaobin/...` 改成从脚本位置推导
（那个路径在本机不存在，三个脚本原本都跑不起来）。`verify-workbuddy-mcp.mjs` 会先复算哈希对账，
再走 stdio 握手验 13 个工具 + 归属 + mood——**门进不去，后面检查都没意义**。

**本机有并发写入者。** 会话期间 `skins.json` 里的 `sunhonglei-inspired` 被改名成 `sun-honglei`、
当前皮肤从 `deepseek-whale` 变成 `sun-honglei`、`dsh` 的 claims 持续增长——另有 agent/会话在同一台
机器上驱动同一只猫、改同一批文件。**改 `assets/` 前先读后写、先备份**，别假设文件还是你上次看到的那个。

**接入现状（2026-09-23 20:27 已核实）**：

- skill 已软链到 `~/.workbuddy/skills/{lingxi,lingxi-authoring}` → 仓库 `integrations/skills/`，
  Skill 工具可正常加载，base dir 指向软链。**注意**：`~/.workbuddy/skills/lingxi-desktop-cat/`
  这个路径不存在，别再按旧记忆去找。
- **信任闸门已点过**（`8ab237fd4229218a…`）→ `mcp__lingxi__*` 工具在会话里可用、真能驱动猫。
- **权限已提**（2026-09-23 20:30，用户经 UI 授）：`workbuddy` 是 `trusted`，换皮实测通过。
  在册：`dsh` / `codex` 也 `trusted`；`anonymous` / `claude-code` 仍 `performer`。
- 换皮命令是 **`lingxi look --skin <id>`**（没有独立 `skin` 子命令）；`trusted` 下会放行但
  返回 `userSettingChanged` 告诫「skin 是用户偏好，建议用 `POST /agents` 注册徽章」。
  当前皮肤 = `workbuddy-mint`（落盘在 `settings.json`，能活过重启）。

## 测试

`npm run check` + `npm test`（50 个单测全绿）。`cd apps/lingxi && npx tsc --noEmit && cd src-tauri && cargo test`。
渲染/动画不适合单测，用 `probe-*.html` 页面量化回归。
