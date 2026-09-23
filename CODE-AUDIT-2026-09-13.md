# 代码审计：未完成目标、Bug 与修复顺序（2026-09-13 10:30 快照）

> ## ⚠️ 这是 2026-09-13 的快照，不是现状
>
> 下文若干结论已被后续实现推翻。2026-09-22 在运行中的应用上复核确认：
>
> - **4.4「Agent 任务观察——只有契约」不再成立。** Claude Code 的 hooks 一键安装、
>   `POST /task-event` 的通用入口、以及事件到动画的通路都已实现。实测：发一条
>   `{"state":"completed","kind":"test","mood":"weary"}`，`GET /perception` 从
>   `表情=安然 / 无动作` 变为 `表情=满足 / 动作=purr-settle`，并带一句台词。
> - **本机桥已有鉴权。** 应用首次运行时生成 32 字节令牌、以 0600 存盘，无令牌的请求被拒；
>   `GET /health` 是唯一免鉴权的接口，它的作用就是告诉调用方令牌在哪。
> - **MCP server 是真的。** `packages/mcp-server` 提供 13 个工具，
>   由 `packages/mcp-server/test/catalogue.test.mjs` 锁定不与管理页漂移。
>
> 未逐条复核其余结论——**没有在这里打勾的条目，既不代表已修，也不代表未修。**
> 判断现状请看运行时（托盘 →「主界面」、`GET /health`、`GET /integration`），
> 文档分层见 [`docs/README.md`](docs/README.md)。
>
> 保留原文不动：根因分析仍然准确，第 2 节的边界/层级分析尤其仍是这套坐标系的参考。

> 本文档是只读审计的产物，未改任何业务代码。
> 审计过程中仓库正被另一个代理并发编辑（详见第 1 节），所有行号以本次快照为准。

---

## 1. 审计现场的两个重要事实（先看这里）

### 1.1 有另一个 AI 代理正在同时编辑本仓库

审计期间（10:19–10:21）`packages/life-engine/src/index.mjs` 与其测试文件在本会话两次读取之间被外部改写。当前机器上确认在跑的相关进程：

- Codex trusted-worker / kernel（working-dir 就是 `dsh-lingxi`，09:48 启动）
- `claude --resume`（终端会话，09:37 启动）
- blender-mcp（09:40 启动，服务建模/毛发线）

今天上午被改过的文件：`main.ts`、`management.ts`、`lib.rs`（≈09:47）、`renderer.ts`（10:05）、`life-engine`（10:19）、`life-engine 测试`（10:21）。**结论：修复阶段必须先收敛为"单一执行者"，否则互相覆盖——"留一半"的直接成因之一。**

### 1.2 你正在跑的 App 落后于源码

- `/Applications/灵犀.app` 与 `target/debug/bundle` 构建时间都是 **10:06:45**；
- 而贴边休息（`pickEdgeRestTarget`）相关代码在 **10:19–10:21** 还在继续改；
- 即：**你体感到的"不能走边缘"至少有一部分是旧构建的行为，修复验收前必须先重新 build + 重装 + 复测**，否则一直在验证昨天的代码。

### 1.3 审计中目击的"半成品"已收敛

10:19 左右 life-engine 一度处于中间态（引用了不存在的 `pickAvoidTarget` / 未声明的 `lastCursorPos` 等，任何 cursor 非空的 tick 都会 ReferenceError）。当前版本（10:19）已恢复一致并全部用 `pickEdgeRestTarget`，`node --test` 30/30 通过。这印证了并发编辑的风险，但目前源码本身是完整可跑的。

---

## 2. "不能走边缘、只能在主视觉区域"的根因分析

这是一个多层叠加的问题，按因果链排列：

### R1【根因】引擎边界 = 整块显示器，不是"可视工作区"

`src-tauri/src/lib.rs:279-293` `primary_monitor_bounds` 用 `monitor.size()`（物理全屏尺寸），`lib.rs:594-601` 把窗口铺满整屏。菜单栏（顶部 ~24-25pt）和 Dock（底部，高度随设置变化，常见 70-100pt+）都被算进猫的活动范围。

### R2【根因】窗口层级低于菜单栏和 Dock，走到边缘 = 被遮住

`tauri.conf.json` 的 `alwaysOnTop: true` 对应 NSWindow floating level（3），而菜单栏是 24、Dock 是 20。猫窗口铺满整屏后，走到顶部边缘身体会被菜单栏盖住、底部边缘被 Dock 盖住——用户看到的正是"走不到边缘/边缘上猫会消失"。

**R1+R2 的正确修法（二者必须一起改）**：用 `NSScreen.main.visibleFrame`（自动排除菜单栏和 Dock）计算真正可用工作区 → ① 把它作为 life-engine 的 bounds；② 窗口直接定位/定尺寸到 visibleFrame（而不是整屏），画布坐标即可视区坐标。这样"边缘"才是用户眼中的边缘，且天然不会被系统 UI 遮挡。窗口是否保留铺满整屏以覆盖更多点击穿透场景，可再权衡，但引擎边界必须换成 visibleFrame。

### R3 `margin: 24` + 角落休息，把"到不了边"矫枉过正

`packages/life-engine/src/index.mjs:33-36`：`margin=24` 小于菜单栏高度，加上 R1/R2，auto 模式贴角休息时猫正好停在会被遮挡的位置。而 `pickEdgeRestTarget`（index.mjs:89）让猫"永远待在四个角落之一"，行为上从"从不到边"变成了"只在角落"——中间地带（沿边缘走、趴在边缘休息）缺失。真正的"沿边缘走"是一个行为态（比如贴边行走/坐在窗口边），当前引擎只有点到点的随机游走，表达不了。

### R4 'play' 模式的游走仍然永远到不了边缘

`index.mjs:332,335`：play 模式（cursor 为 null 时）用 `pickWanderTarget()`——从当前位置出发 ≤260px 的局部跳动（`wanderRadius: 260`），在 1470px 宽的屏上基本到不了边。auto 模式已修，play 模式没修。

### R5 follow/standoff 路径完全不 clamp，猫可以走出屏幕

`moveToward`（index.mjs:116-130）和 `standoffPoint`（106-114）都没有边界 clamp；`updateDrag`、`suggestMoveTo`、`setBounds` 都有（且注释明确说是防御性的）。play 模式追一个处于另一显示器/越界坐标的光标时，猫会走出 bounds 并停在那里（到达后 idle），只有"重置位置"能救回来。防御性 clamp 应该补齐到唯一没盖住的这条路径上。

### R6 光标坐标只在"单显示器"下正确，且不判越界

`spawn_cursor_poller`（lib.rs:436-453）的 y 翻转只按主屏高度算，`NSEvent.mouseLocation` 的全局坐标在多显示器（副屏负坐标、上下排列）时换算错误；`toLogicalCursor`（main.ts:84-89）不检查光标是否在 work area 内，越界坐标照常喂给引擎（联动 R5）。另外所有显示器共用 `workArea.scaleFactor` 换算，混合缩放屏会错。

**验收顺序建议**：先重新构建 → 确认 R1/R2/R3 修复后用户复测"贴边"体感 → 再决定是否要做显式的"沿边行走"行为态（R3 的后半句）和 play 模式贴边（R4）。

---

## 3. 其他确认的 Bug / 缺陷清单

| # | 级别 | 问题 | 位置 | 说明 |
| --- | --- | --- | --- | --- |
| B1 | 高 | 工作区边界错误（R1）+ 层级遮挡（R2） | lib.rs:279-293, 594-601; tauri.conf.json | 见第 2 节 |
| B2 | 高 | follow/standoff 无 clamp（R5） | life-engine index.mjs:106-130, 316-324 | 猫可被带出屏幕且不回头 |
| B3 | 中 | `get_status` 会触发辅助功能权限弹窗 | lib.rs:35-41, 327-339 | `accessibility_permission_ready()` 在未授权时调用 `application_is_trusted_with_prompt()`（主动弹系统弹窗），而 get_status 在**每次打开管理窗口和每次 companion 启动**都被调用 → 未授权用户反复被弹窗。状态展示应改用只读检查（不带 prompt 选项） |
| B4 | 中 | onWorkAreaChange 的事件源不对 | desktop-host.ts:36-46 | 绑在 `win.onResized` 上，但窗口尺寸从不变化；分辨率变化/Dock 变化/显示器插拔不触发（Rust 端也没监听 `NSApplicationDidChangeScreenParametersNotification`）。改分辨率后窗口/画布/引擎全部过期 |
| B5 | 中 | 多显示器光标换算错误（R6） | lib.rs:436-453; main.ts:84-89 | 单屏项目前可接受，但需要写进已知限制 |
| B6 | 中 | `resizable: true` 与"固定铺满"矛盾 | tauri.conf.json | 无边框窗口仍可能被系统手势缩放；一旦缩放，`onResized` 会把引擎 bounds 改成"窗口大小"，语义混乱。应设 false，工作区变化走 B4 的正确事件源 |
| B7 | 低 | 命中区偏大 | renderer.ts:49,173-182 | `boundingRadius 0.6`（世界单位）在 1470px 宽屏上 ≈170px 半径，明显大于可见猫身（~250px 长），光标在猫附近就会关掉点击穿透、吃掉本来要点到下层应用的点击。已声明 `preciseHitTest:false`，但半径值得收敛到贴近可见轮廓 |
| B8 | 低 | 感知记录的半成品 | main.ts:191-205; perception/index.mjs | `visibility_changed` 有 case 无生产者（显隐事件从不记录）；mode 切换不记录；`summary().idleMs` 可为 `Infinity` → JSON 序列化成 `null`，外部驱动拿到的 schema 不稳定 |
| B9 | 低 | 调试桥留在生产路径 | main.ts:21-24 dlog; lib.rs:273-276 debug_log | 文档自己标注 "Remove once the app has a real diagnostics story"；ai-intent/perception 路径仍在打日志 |
| B10 | 低 | `beginWindowDrag` 是死接口 | desktop-host-contract/index.d.ts:65-67; desktop-host.ts:65-67 | 契约定义了、宿主实现了、main.ts 从不调用（拖拽靠引擎位移实现）。留注释说明是给未来宿主的，或删 |
| B11 | 低 | bundle targets "all" 每次构建 DMG 必失败 | tauri.conf.json; docs/16 已记录 | 改成 `["app"]` 可消除每次构建的报错噪音 |
| B12 | 低 | 窗口初始 900x700 再由 setup 放大 | tauri.conf.json + lib.rs:594-601 | 首帧可能闪一个小窗口。可在 conf 里直接给合理初值或接受现状 |

---

## 4. 未完成目标对照（文档基线 vs 代码现实）

基线：README"当前阶段"段、docs/06 里程碑（P0→M1→M2→M3）、docs/02 MVP 表、docs/16"诚实地列一下还没做的"。

### 4.1 README 已经过期（文档债）

README 说"**尚无**……可运行桌面应用"，但 `apps/desktop-shell` 已可运行并装进了 /Applications；目录结构表也没列 `apps/`、`packages/life-engine`、`packages/perception*`、`packages/desktop-host-contract`。docs/11 同样未更新。

### 4.2 P0（可行性样机）——基本达成，收尾项

- ✅ 透明窗口、点击穿透、拖拽、跟随、托盘、管理窗、设置持久化、退出、Dock 图标
- ⬜ 本清单第 2/3 节的平台正确性问题（边界/遮挡/多显示器）
- ⬜ 用户一周试用验收未开始

### 4.3 M1（陪伴 MVP）核心缺口

| 目标 | 状态 |
| --- | --- |
| 冻结角色 | ⬜ 占位盒子猫仍在跑；视觉验收未通过（docs/12）；毛发 v5/v6 试作进行中（另一代理在做） |
| 行为编排 | ⬜ 仅 idle/wander/follow/dragged/ai_directed 五态；docs/04 的睡觉/舔毛/警戒等行为库、docs/14 动作图谱都没有落地 |
| 局部互动 | ◐ 只有拖拽/跟随；无摸头反应、喂食等 |
| 设置/隐藏/退出/本地恢复 | ✅ 已完成（含崩溃安全的 tmp+rename 落盘和 5 个 Rust 测试） |
| 产品验收 | ⬜ 未开始 |

### 4.4 Agent 任务观察（README 承诺的核心卖点）——只有契约

- ✅ `packages/contracts`：TaskObserver/TaskStore/taskCue 契约 + 校验 + 测试
- ⬜ 三个平台（DSH/Codex/Claude Code）**没有任何一个真实 Observer 实现**；shell 里的 `KNOWN_AGENTS`（lib.rs:73）只是管理界面上的标签，自己注释承认 "label today"
- ⬜ 猫对任务事件的可见反应（taskCue 的 soft_glance/attention_mark 没有渲染通路）

### 4.5 皮肤 / 性格 / 成长——只有契约与占位

- ✅ SkinManifest/PersonalityManifest 校验、4 个 preset 文件
- ⬜ `composeCompanion` 没有任何调用方；皮肤不影响渲染，性格 traits 不影响 life-engine 参数
- ⬜ growth/engagement 是占位公式（docs/16 承认未与 docs/04 对齐）

### 4.6 docs/16 已自认的欠账（仍然成立）

全局点击/按键感知（需辅助功能权限）、perception 只记录落在猫上的交互、HTTP 桥无鉴权（127.0.0.1 信任边界）、托盘/图标效果未经截图验证、DMG 打包失败。

---

## 5. 工程与流程层面的遗漏

1. **全部桌面壳代码从未提交**：`git status` 里 `apps/`、`packages/life-engine`、`packages/perception*`、`packages/desktop-host-contract` 全是 untracked；最后一次 commit（db4eaa3）不含任何桌面壳工作。崩溃/误操作即全部丢失。建议立即分逻辑提交（shell 骨架 / life-engine / perception / 文档）。
2. **测试门禁与文档声明不符**：根 `package.json` 的 `test` 只跑 `packages/contracts`；life-engine（当前 19 个）和 perception（4 个）测试、`cargo test`（5 个）、`tsc --noEmit`、desktop-shell 构建都不在 `npm run validate`/CI 里。README 宣称的覆盖并没有被门禁保护。
3. **并发 AI 代理无协调机制**（见 1.1）：需要人为约定同一时间只允许一个会话写这个仓库，或至少按目录分工。
4. `previews/threejs` 被 .gitignore 忽略且标注"source is versioned by Sites"——确认它确实有外部版本源，否则属于"看起来存在其实不受保护"的资产。
5. 命中/拖拽这类"手感"问题目前全靠人眼验收，缺一个最小的人工验收清单（贴边、Dock 区域、菜单栏区域、快速拖拽甩出、多显示器）挂在 docs/16。

---

## 6. 建议修复顺序（待你确认后执行）

1. **止血与对齐**（先做，风险最小）：
   - 重新构建 + 重装 /Applications（当前安装包落后源码）；
   - 全部现有工作分逻辑提交进 git；
   - 把三个纯逻辑包的测试和 `tsc --noEmit` 挂进 `npm run validate`/CI。
2. **边界正确性**（直接回应你的交互反馈）：R1+R2 一起改（visibleFrame 作为引擎边界与窗口几何）→ 调低 `margin` → R5 补 clamp → R6 至少加"光标越界即视为 null"的守卫。
3. **行为手感**：B3 权限弹窗、B4 工作区变化事件、B7 命中区收敛、play 模式贴边（R4）；之后与你确认是否要显式的"沿边行走"行为态。
4. **半成品收口**：B8/B9/B10/B11 清理；README/docs/11 更新到与代码一致。
5. **功能推进**（需要你拍板优先级）：真实 Agent Observer 三选一先做一个；皮肤/性格接入渲染与引擎参数；行为库（docs/04/14）。

> 单一写者原则：以上任何一步开工前，请先停掉另一个正在编辑本仓库的会话（Codex / claude --resume），避免再次互相覆盖。

---

# 第二轮：三角色评审（架构师 / 测试 / 产品，2026-09-13）

> 只讲第一轮没讲过的"设计评价"，不重复 bug 清单。同样未改任何代码。

## 7. 架构师视角

### 7.1 做对了的（保持）

模块边界与契约先行（desktop-host-contract / life-engine 纯函数 / perception-contract）、单窗口 + Rust 轮询 + 前端状态机的分工、AI 只开一条窄腰意图通道——与 docs/16 对标过的同类开源项目一致，这些不需要动。

### 7.2 结构性风险（按严重度）

| # | 风险 | 说明 | 建议 |
| --- | --- | --- | --- |
| A1 | **坐标系统没有唯一权威** | 四套坐标（物理屏 px / 逻辑 CSS px / three 世界单位 / NDC）、三处分散换算（Rust y 翻转、main.toLogicalCursor、renderer 的相机几何魔数）。已出过的"上下反向"、DPI、多屏问题全是这一类 | 建 `Viewport`/坐标模块：host 只提供 workArea+scale，全库换算只走它；相机几何封死在 renderer 内部，对外只有"逻辑 px" |
| A2 | **信任边界不校验，NaN 可永久污染状态** | POST /intent 原样转发任意 JSON；`suggestMoveTo` 对 NaN 无防御：`clamp(NaN)=NaN` → position 永久 NaN，猫凭空消失（只有拖拽或重置能救回）。负 holdMs、非数值 targetPoint 同理。/perception 响应不带 schemaVersion | 在 Rust 边界校验 AIIntent（数值 + 有限性 + 类型），拒绝非法；响应带 schemaVersion；引擎侧 clamp 前先 `Number.isFinite` |
| A3 | **功耗架构缺位** | 全屏透明 WebGL 60fps 常驻，idle 呼吸动画让每一帧都在渲染。常驻桌面应用"安静"的内涵包括电量安静 | idle 时降帧（10–15fps 足够 2Hz 的呼吸/摆尾），遮挡/失焦暂停渲染；纳入 P0 验收指标 |
| A4 | **main.ts 胶水层是零测试的组合根** | 事件订阅、光标状态、拖拽、hit→穿透切换、感知上报、帧循环全在此层；历史上"拖不动""拖拽不跟手"两个真实 bug 都出生在这里。架构上它"唯一认识所有人"是对的，但没 harness 就测不了 | 把接线抽成可注入函数（fake host + fake renderer），见测试 T1 |
| A5 | **契约已漂移，"契约"实际是注释** | `RendererCapabilities` 声明"行为层不得请求不存在的能力"但 life-engine 从不读它；`Renderer.render` 的 `facing` 参数 renderer 已不用（改用位移 atan2）；`beginWindowDrag` 无调用方 | 三选一：运行时断言（dev 构建）、清理死参数、或在契约注释里写明"信息性字段" |
| A6 | **同一状态三条同步通道、无版本号** | Tauri 广播事件 / get_status 启动拉取 / HTTP 桥。已踩过"事件先于监听"的坑，用启动拉取补救——说明广播不可靠 | 状态加单调版本号（客户端能发现漏事件），或统一为"拉取为主、事件仅提醒" |
| A7 | **多显示器是契约级决定，越晚越贵** | WorkArea 单数、光标换算主屏系；"仅主屏"目前只是隐式事实 | 近期把限制写进契约注释和 README；设计 WorkArea 复数化时预留 |
| A8 | **"确定性"声明与实现不符** | life-engine 头注释称 deterministic，实现重度依赖 Math.random() | 注入可播种 RNG：测试可复现，AI 驱动行为可回放调试 |

## 8. 测试视角

### 8.1 底子评价

纯逻辑包 30 个单测 + Rust 5 个，质量好；**很多测试直接以用户投诉命名**（"上下拖动方向反的""拖拽不灵敏"）——每事故一回归的惯例非常对，务必保持。

### 8.2 缺口（按收益排序）

| # | 缺口 | 说明 |
| --- | --- | --- |
| T1 | **胶水层集成 harness（最高收益）** | 用契约做内存 fake host/renderer，把 main.ts 接线抽成可注入后覆盖：hit→穿透切换状态机、mousedown/move/up 三事件流、事件先于监听的启动窗口、感知快照字段完整性 |
| T2 | **畸形输入 fuzz** | /intent 通道喂 NaN/Infinity/负数/错类型/超长字符串（对应 A2，是真实存在的崩溃路径而非理论风险） |
| T3 | **Rust 换算纯函数化 + 测试** | 光标 y 翻转与物理/逻辑换算是纯数学，现在内联在线程体里；抽成 fn 即可单测，是"上下反向"类 bug 的回归防线 |
| T4 | **启动冒烟自动化** | debug_log 通道现成：断言"N 秒内出现 first frame rendered 且无 frame() error"——防"看不见的窗口"这类平台级回归 |
| T5 | 门禁补全 | 三包测试 + `tsc --noEmit` + `cargo test` 进 validate/CI（第一轮已列，此处归位到测试视角） |
| T6 | **人工验收清单制度化** | docs/16 里"仍需用户目测确认"在持续积累；固化成每构建一次的勾选清单：贴边/菜单栏/Dock/快速甩拖/隐藏找回/重启恢复/(将来)多屏 |
| T7 | 可观测性即测试基建 | 环形事件日志（状态迁移、帧错误、capture 切换）+ `GET /debug/events`——用户报"猫不见了"时可还原现场，而不是靠猜 |

## 9. 产品视角

### 9.1 核心命题核对

"你忙你的，我在这里"——安静、真实、活的陪伴。用这个尺度量：

| # | 评价 | 说明 |
| --- | --- | --- |
| P1 | **投资错位：全在"移动正确性"，零在"表现力"** | 工程投入几乎全在走路/贴边/朝向，但这个品类的差异化是"它是不是活的"。占位模型阶段补表现力（理毛、坐下、看光标、耳朵动）与移动正确性应同优先级——否则修完移动，只是一只走得准的盒子 |
| P2 | **auto 模式回避产生负情绪** | 150px 排斥半径 ≈ 8 个猫身远就跑，体感是"它在躲我"，与陪伴命题相反。建议只在光标真的遮挡猫（距离 ≲ 猫半径+缓冲）才让位，且让位动作是"起身换地方趴下"而非"逃离"。（今天源码刚把"忙时才回避"改成"无条件回避"，方向建议再议） |
| P3 | **不生效的设置在消耗信任** | 猫名字只进快照不上屏、性格无消费者、"Agent 接入"卡片是纯标签。用户做了选择而世界没变化，比没有该设置更伤。要么标注"即将生效"，要么先隐藏——仓库自己的"诚实"原则应同样用在 UI |
| P4 | **首次体验无引导** | 启动后猫在屏幕中央发呆：不知道可拖、有托盘、有模式。一次性可消失的轻提示或首跑打开管理窗，成本低收益高 |
| P5 | **隐私是现成卖点，但只写在注释里** | perception 的"不留轨迹、不出本机"是品类里少有的认真设计；应在管理窗明说（"所有数据只在你电脑上"） |
| P6 | **任务观察落地前价值天花板低** | 现状本质是"会动的桌面挂件"，新鲜感以天计。M1"一周试用"门槛是对的，但通过标准现在就该定成可数：≥N 天有主动互动、0 次"找不到猫"、电量影响可接受、无因打扰被关闭 |
| P7 | **恢复路径产品化** | "重置位置"是工程动词，用户心智是"猫走丢了"——可改"找回猫咪"；连续多日未互动时主动出现一次也算回归钩子 |

## 10. 三角色 Top 建议汇总

| 优先级 | 架构 | 测试 | 产品 |
| --- | --- | --- | --- |
| P0 | A1 坐标权威；A2 意图校验/NaN 防御；A3 idle 降帧 | T1 胶水 harness；T5 门禁补全 | P6 M1 试用量化标准；P3 隐藏/标注不生效设置 |
| P1 | A5 契约强制或清理；A6 状态版本号；A7 多屏限制声明 | T3 Rust 换算纯函数+测试；T4 冒烟断言；T6 验收清单 | P1 表现力排期；P2 回避半径收敛；P4 首跑引导 |
| P2 | A8 可播种 RNG | T7 事件日志端点 | P5 隐私文案；P7 "找回猫咪"文案 |

（T2 fuzz 随 A2 一起做，归入 A2 的工单。）
