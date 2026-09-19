# 桌面主程序原型：架构落地、一场误诊、以及后续功能

2026-09-12 更新：用户确认在真实屏幕上看到了猫，证实前一版记录的"WKWebView 内容不上屏"其实是**误诊**——用来验证效果的 `screencapture` 系统截图工具在本环境里本身就截不到任何应用窗口内容（连 Chrome、iTerm 这些正常窗口都截不到，只能截到桌面壁纸），并不是应用真的没渲染。原始诊断过程和已排除的假设仍保留在下文，作为这类问题的排查记录；结论以本节为准。

在此基础上完成的追加工作：用不需要辅助功能权限的 `NSEvent.mouseLocation` 替换了 `device_query`（修好了"不能拖动""不能跟随鼠标"两个问题，根因是同一个）；加了系统托盘（大小档位、显示/隐藏、管理弹窗、退出）；换了全部图标为用户提供的奶猫头像；给 life-engine 加了可被外部"AI"建议移动目标的意图通道；搭了一个本机 HTTP 桥（`packages/perception-contract`）供外部 AI 驱动读取感知数据、下发意图，并用 curl 实测验证了收敛效果。细节见文末新增章节。

---


2026-09-12。用户明确要求暂停猫模型精修，转向做"主程序"：Three.js + Tauri 的透明桌面壳，支持模型自由行走、跟随鼠标，并要求完整 API 和良好架构设计，先用占位模型验证流程。本文记录已落地的架构、已验证通过的部分，以及一个反复复现、目前未解决的窗口渲染问题。

## 已落地的架构

代码在 `apps/lingxi/`（Tauri v2 应用）和三个新 `packages/`，对应 [05-technical-architecture.md](05-technical-architecture.md) 里定义的模块边界：

| 模块 | 位置 | 状态 |
| --- | --- | --- |
| Desktop Shell | `apps/lingxi/src-tauri/src/lib.rs` | 已实现：监视器定位、全局鼠标轮询、点击穿透切换、Accessibility 权限检查与系统提示 |
| DesktopHost 契约 | `packages/desktop-host-contract/index.d.ts` | 纯类型接口，零依赖，宿主实现可替换 |
| DesktopHost 实现 | `apps/lingxi/src/desktop-host.ts` | 用 `@tauri-apps/api` 实现上述接口，是前端唯一直接引用 Tauri SDK 的文件 |
| Cat Life Engine | `packages/life-engine/src/index.mjs` | 纯状态机（idle/wander/follow_cursor/dragged），零依赖，6 个单元测试全部通过（`node --test packages/life-engine/test/*.test.mjs`） |
| Renderer | `apps/lingxi/src/renderer.ts` | Three.js 正交相机 + 透明 WebGLRenderer，实现 `Renderer` 契约的 mount/resize/render/hitTest |
| 占位模型 | `apps/lingxi/src/placeholder-cat.ts` | 纯 Box 几何拼的"像素猫"，用于验证流程，不依赖 Blender 导出管线 |
| Animation Director | `apps/lingxi/src/main.ts` | 唯一同时认识 DesktopHost 和 LifeEngine/Renderer 的粘合层 |

`packages/life-engine` 和 `packages/desktop-host-contract` 沿用 `packages/contracts` 已有的约定：纯 `.mjs`/`.d.ts`，不引入构建步骤，用相对路径引入，不依赖尚未建立的 npm workspaces。

## 已验证通过的部分

- `node --test packages/life-engine/test/*.test.mjs`：6/6 通过（起始 idle→wander 转换、到达目标返回 idle、鼠标进入/离开跟随半径、拖拽覆盖自主行为、`setBounds` 正确收缩当前位置）。
- Rust 后端 `cargo check`/`cargo build` 编译通过（用 rustup 的 stable 1.98.1，因为 Homebrew 的 rust 1.87.0 装不动这版 Tauri 的依赖，且 `brew upgrade rust` 会连带要求从源码构建 `llvm@22`——[Tier 3、明确不建议](https://docs.brew.sh/Support-Tiers#tier-3)，所以改用 `rustup override set stable` 只在这个项目目录生效，没有动全局默认工具链）。
- 前端 TypeScript 类型检查通过（`npx tsc --noEmit`），跨包引入（`../../../packages/life-engine/...`）已通过给 Vite 加 `server.fs.allow` 解决。
- 用调试桥接命令（`debug_log`，见 lib.rs）确认了完整启动链路：`main()` 启动 → renderer 挂载 → `primary_monitor_bounds` 正确返回 `{width:2940,height:1912,scaleFactor:2}` → `resize` 正确算出逻辑尺寸 `1470x956` → canvas 存在且 `getContext('webgl2')` 成功 → **第一帧 `renderer.render()` 执行无异常**，快照数据正确（`{state:"idle",position:{x:735,y:478},...}`）。
- macOS Accessibility 权限：`device_query` 在 macOS 上读取全局鼠标位置**确实需要** Accessibility 权限（不是文档最初假设的"仅键盘需要"，已实测验证并修正代码注释）。用 `macos-accessibility-client` 加了权限检测 + 系统提示弹窗，未授权时优雅降级（跳过鼠标轮询，不崩溃），已用 panic-then-fix 的方式实测过。
- 腿骨/窗口尺寸的一个真实 bug 并已修复：`"visible": false` 配置 + 手动 `window.show()` 的组合会让 AppKit 报告 `is_visible()==true`、`set_size`/`set_position` "成功"，但窗口**从不出现在 WindowServer 的屏幕内列表里**（用 `CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly)` 交叉验证确认）。改成窗口默认可见、不手动调用 `show()`，问题消失——这个修复是真实的，已保留在代码注释里防止回归。

## 未解决的问题：WKWebView 内容不上屏

**现象**：应用能正常启动、成为前台应用（菜单栏显示应用名）、Rust 端确认窗口在 WindowServer 的屏幕内列表中（`CGWindowListCopyWindowInfo` 能查到，有正确的屏幕坐标和 `alpha=1.0`）、前端 JS 确认执行到"第一帧渲染完成"且无异常——但**任何内容都不会真正显示在屏幕上**，包括：

1. 生产配置（透明背景 + WebGL 猫模型）
2. 纯色（`renderer.setClearColor(0xff00ff, 1)`，不透明品红色）
3. 纯 HTML（一个不透明红色 `<div>`，完全不涉及 WebGL）
4. 把窗口配置改成最朴素的形态（`transparent:false`、`decorations:true`、`alwaysOnTop:false`、`skipTaskbar:false`、`focus:true`）依然不显示
5. 从 `tauri dev`（`cargo run`）切换到正式 `.app` 包 + `open` 启动，结果相同

**最关键的诊断**：窗口在屏幕内列表中出现时，直接用 `screencapture -l <windowID>` 单独截这个窗口，报错 `could not create image from window`——说明这不是"内容被别的东西遮住"或"透明度算错"，而是这个窗口的实际渲染图层/backing store 对截屏系统来说是**空的或无效的**，尽管 WindowServer 的窗口列表认为它存在且在线。

已排除的可能原因：
- ~~毛发/腿骨等不相关问题~~ 不适用，这是全新的应用
- ~~WebGL 特定问题~~ 已用纯 HTML `<div>` 排除
- ~~透明度导致"看不见"~~ 已用不透明品红色和不透明红色排除
- ~~`alwaysOnTop`/`skipTaskbar`/`visibleOnAllWorkspaces` 的某个组合~~ 已逐个关闭测试，结果不变
- ~~`cargo run` 直接起进程缺少正常 GUI 会话~~ 已用正式 `.app` 包 + `open` 启动排除（这条路径下同一会话里 `open -a Blender` 全程显示正常，证明本环境本身能正常显示原生 GUI 应用）
- ~~构建缓存导致跑的是旧代码~~ 已核对进程启动时间晚于二进制构建时间，排除

尚未验证、值得下一步排查的方向：
- 用 Console.app 或 Instruments 在图形界面下直接观察这个 WKWebView 进程的 Core Animation 层树，而不是只能通过 `screencapture`/`CGWindowListCopyWindowInfo` 这类间接手段
- 换一个更旧或更新的 Tauri/wry 版本（当前 `tauri = "2"` 解析到 2.11.5、`wry 0.55.1`）试试是否是这个版本组合的已知问题
- 检查这台机器的 GPU 进程（`com.apple.WebKit.GPU`）是否真的完成了渲染合成，而不仅仅是日志里出现了 "didFinishLoadForFrame"（页面加载完成不等于合成上屏）
- 在**真正的图形登录会话**里手动双击 `.app` 启动（而不是通过任何自动化工具调用 `open`），确认是否与自动化环境本身有关——虽然已经用 `open` 排除了"直接执行二进制"这一种可能，但自动化 shell 触发的 `open` 和用户手动双击之间，理论上仍可能存在会话权限的细微差别

## 现状与后续

代码架构、类型契约、状态机逻辑、Rust 后端的监视器/鼠标/权限处理都已完成并通过可验证的测试——这部分不是"声称完成"，是有单元测试和运行时检查点证据的。唯一卡住的是最后一步"WKWebView 内容合成上屏"，这是一个具体的、可复现的平台级问题，不是我们自己代码逻辑的 bug（应用逻辑本身全程无异常执行到底）。

在这个问题解决之前，不建议继续往这个应用里加功能（表情、皮肤切换、任务观察 UI 等）——那样只会在一个看不见的窗口上继续堆资产，重复本仓库自己在角色试作阶章节里已经写明的教训。

---

## 追加：权限修复、托盘、图标、AI 感知接口（2026-09-12）

### 光标追踪不需要辅助功能权限了

`device_query` 在 macOS 上读鼠标位置也需要辅助功能权限（此前的注释误以为只有键盘需要），这挡住了"跟随鼠标"和"拖动猫"两个功能——因为两者共用同一条"全局光标位置"数据，光标一直是 `null`。改用 `NSEvent.mouseLocation()`（AppKit 的普通只读类属性，不涉及事件监听/事件抓取，不需要任何授权）后两个问题一起解决。用户已实测确认：能看到猫、点击穿透正常。`macos-accessibility-client` 保留在依赖里，只为将来做"感知全局点击/按键"这种真正需要授权的功能。

### 系统托盘

`apps/lingxi/src-tauri/src/lib.rs` 的 `build_tray`：大小三档（0.25x/0.5x/1x，互斥勾选）、"管理..."（打开管理窗口）、显示/隐藏（动态切换文案）、退出。应用改成 `ActivationPolicy::Accessory`，不显示 Dock 图标，托盘是唯一常驻入口。`TrayState` 用 `app.manage()` 托管，`set_scale`/`set_companion_visible`/`get_status` 三个 Tauri 命令让管理窗口和托盘操作同一份状态并互相同步（改状态用的 CheckMenuItem/MenuItem 句柄是 Clone 的原生对象包装，不是数据重复）。

### 管理弹窗

新窗口 `management`（`apps/lingxi/management.html` + `src/management.ts`），大小选择、显示/隐藏按钮、辅助功能权限状态展示。Vite 配置改成多入口构建（`main` + `management`）。

### 图标

用用户提供的奶猫头像（`docs` 目录外的下载文件，未入库）生成了完整图标集：应用图标加了一层柔和渐变背景+投影（避免耳朵尖贴边被 macOS 圆角遮罩裁掉），托盘图标用裁边后的透明版本。生成脚本是一次性跑的 Python/PIL，产物直接放进了 `apps/lingxi/src-tauri/icons/`（`icon.icns`、`icon.ico`、各尺寸 PNG）和 `apps/lingxi/public/icon.png`（管理弹窗用）。

### AI 感知与驱动接口

新增两个零依赖包，延续 `packages/contracts` 的约定：

- `packages/perception-contract`：类型定义。`ActivityEvent`（点击/拖拽/光标进出/尺寸变化/显隐）、`ActivitySummary`（滚动窗口的计数与时长，不存原始光标轨迹或按键）、`GrowthMetrics`（v0 版的"参与度"分数，公式很粗糙，形状先稳定下来）、`PerceptionSnapshot`（给外部 AI 的完整快照）、`AIIntent`（外部 AI 唯一能下发的东西：建议走到某个点，带过期时间）。
- `packages/perception`：`createActivityRecorder()`，纯逻辑，4 个单元测试全部通过（`node --test packages/perception/test/*.test.mjs`）。

`packages/life-engine` 加了 `suggestMoveTo(point, now, holdMs)` / `clearIntent()`，新状态 `ai_directed`：优先级在"用户拖拽"之下、"自主游走/跟随"之上，到期自动失效，不会把猫卡在"AI 模式"里出不来。已用 3 个新单元测试覆盖（建议生效、拖拽始终优先、过期后自动恢复），9 个测试全部通过。

Rust 端起了一个本机专用的 HTTP 桥（`tiny_http`，同步、零 async 运行时依赖，只监听 `127.0.0.1:47811`，不监听 `0.0.0.0`）：

- `GET /perception`：最新的 `PerceptionSnapshot`（前端每 2 秒推一次给 Rust 缓存，`report_perception` 命令）。
- `POST /intent`：body 是 `AIIntent` JSON，转发成 `ai-intent` 事件给前端，喂给 `suggestMoveTo`。

**已用 curl 实测验证收敛效果**，不是纸面设计：

```sh
curl -X POST http://127.0.0.1:47811/intent -H "Content-Type: application/json" \
  -d '{"targetPoint":{"x":50,"y":900},"holdMs":10000,"reason":"convergence test"}'
```

随后连续三次 `GET /perception`，`petState` 稳定显示 `ai_directed`，`petPosition` 从 `(153,155)` → `(138,262)` → `(114,440)`，正朝着 `(50,900)` 平滑移动——链路从外部 HTTP 请求到桌面上猫的实际移动，全程跑通并有证据。

### 诚实地列一下还没做的

- 全局点击/按键感知（"用户在别的地方点了什么"）：需要真正的事件监听，还是要辅助功能权限，没做。
- `packages/perception` 目前只记录"落在猫身上"的点击/拖拽，不是全局活动。
- 托盘/管理窗口/图标目测效果本轮没有截图验证（同样卡在截图工具的限制上），需要用户自己看一眼确认好不好看、位置对不对。
- growth/engagement 的计分公式是占位实现，产品层的"猫如何随用户行为成长"设计还在 `docs/04-life-engine.md`，没有反向对齐到这版代码。
- HTTP 桥没有鉴权（假设"只有本机进程能连 127.0.0.1"这个信任边界成立），如果以后要接不受信的外部驱动，需要加一层。

---

## 追加：架构对比开源参考（2026-09-12）

看了几个和我们同类的开源项目，作为"架构是否最优"这个问题的参照，而不是凭空判断：

- [CrabNebula: Building a Desktop Pet with Tauri](https://crabnebula.dev/blog/building-a-desktop-pet-with-tauri/) — Tauri 官方生态团队写的同类型教程项目。
- [gonzalovsilva/Shimeji-ee](https://github.com/gonzalovsilva/Shimeji-ee)（及 [Kilkakon 的 affordances 文档](https://kilkakon.com/shimeji/affordances.php)）— 桌宠这个品类最老牌、最成熟的开源实现（Java），行为库极其丰富。
- [AkshitIreddy/AI-Desktop-Pet](https://github.com/AkshitIreddy/AI-Desktop-Pet) — 定位几乎和我们的终局目标一样："AI 驱动的桌宠"，同样用 Rust 处理屏幕/窗口/光标，同样强调隐私边界。
- [iiviie/cursor-pets](https://github.com/iiviie/cursor-pets)、[SeakMengs/WindowPet](https://github.com/SeakMengs/WindowPet) — 更轻量的 Tauri 桌宠，功能集和我们目前这版接近（跟随光标、点透、拖拽）。

**我们已经做对、和这些项目路子一致的地方：**

- 透明 + alwaysOnTop + `set_ignore_cursor_events` 做点透，是 Tauri 桌宠的标准解法，CrabNebula 那篇文章明确写了"没有现成配置项，必须自己用 Rust 实现"——我们的做法完全对路。
- Rust 端轮询光标、发事件给前端，前端只管位置状态和动画——CrabNebula 的项目和我们是同一个分工（虽然他们用 `mouce`/`mouse_position` crate 且只在点击时更新位置、配 CSS transition 做平滑；我们用 `NSEvent.mouseLocation` 连续轮询、由 life-engine 做真正的每帧位移计算，精细度更高）。
- 用一个共享的全屏透明窗口承载角色，而不是每个角色一个窗口——AI-Desktop-Pet 的文档里明确提到他们是从"每个宠物一个 Electron 窗口"重构成"一个共享窗口"的，我们从一开始就是这个设计，不用走回头路。
- AI 只给一个收敛的意图通道（不是把每个能力都开一个接口）——这一点和 AI-Desktop-Pet 的"skill wheel"是同一个思路的不同规模：他们已经长成 22 个命名 skill，我们目前只有"移动到某点 / 切模式"两种，但设计上是同一个可扩展形状（`AIIntent` 加字段，不是加端点）。

**值得记录、但现在不必动手的差距（未来若要长期投入可以参考）：**

- **窗口感知（"趴在别的应用窗口上走"）**：Shimeji 的 affordances 和 AI-Desktop-Pet 都支持猫沿着真实窗口边缘走/坐在窗口上。我们目前只知道桌面整体尺寸，不知道其他窗口在哪。技术上是可行的——本轮排查托盘问题时已经用 `CGWindowListCopyWindowInfo` 验证过可以读到其他进程窗口的位置和层级，只是还没把这条信息接进 life-engine。
- **行为定义数据化**：Shimeji 把"什么时候做什么"（behaviors.xml）和"这个动作具体怎么演"（actions.xml）拆成外部可编辑的配置文件，非程序员也能加新行为/新皮肤。我们目前这两层的拆分是对的（life-engine 决定 state，Renderer 决定怎么演），但都硬编码在 TS/JS 里。现在阶段（还在验证管线，模型都是占位盒子）硬编码没问题；等正式模型和更多行为上线后，值得把"行为触发条件"这层数据化。
- **AI 意图词表**：目前 `AIIntent` 只有"走到哪+切模式"。等以后真接 AI 决策，大概率会需要参考 skill-wheel 那种"叫得出名字的动作"（比如"睡觉""跳舞""打招呼"），到时候在 `AIIntent` 上加一个可选的 `skill` 字段，而不是新开一个通道——和现有设计原则一致，不是推翻重来。
- **"给 AI 一点屏幕感知"的隐私模式**：AI-Desktop-Pet 的"screen vision"功能做法是"用户手动开一小段时间、自动过期、不存帧"，这个分寸感和我们 `perception-contract` 里已经写的隐私边界（"不留光标轨迹、不留按键"）完全一致。如果以后真要做"让 AI 看屏幕"这种更重的感知，这是个现成的、经过验证的分寸参考。

**结论**：现有的模块划分（Desktop Shell / Life Engine / Renderer / Perception）、单窗口方案、Rust-轮询+前端-状态机的分工、AI 只开一条可扩展意图通道，这几个奠基性的架构决策和同类开源项目是一致的，不是我们想当然拍出来的。上面列的几条差距都是"以后长出更多行为/更多 AI 能力时"才需要动的扩展点，不是现在就该推翻重做的问题。

---

## 追加：托盘三件套补完——设置持久化与启动状态同步（2026-09-12）

### 本轮之前的状态

托盘（大小三档 / 显隐 / "管理..." / 逗猫模式 / 退出）、管理弹窗（`management.html`）、`set_scale` / `set_companion_visible` / `set_interaction_mode` / `get_status` 四个命令已经实现，且托盘与管理窗口通过同一份 `TrayState` 互相同步。但存在两个会让它"用起来不像做完"的缺口：

1. **设置不持久化**：大小 / 显隐 / 模式全部存在内存里，重启后回到默认（1x、显示、日常）。
2. **启动状态同步缺口**：前端只靠监听 `set-scale` 事件更新大小，而 Rust 侧任何"启动时设置状态"的广播都发生在 webview 加载完成之前——事件必然丢失。表现就是：托盘勾选状态与猫的实际大小可能不一致（一旦引入持久化就会立刻触发：托盘勾着"小"，猫却按 1x 渲染）。

### 本轮改动

- `src-tauri/src/lib.rs`：新增 `PersistedSettings`（`version/scale/visible/mode`），路径为应用 config 目录下的 `settings.json`（macOS 即 `~/Library/Application Support/com.dushaobin.lingxi-desktop/`）。`TrayState` 的每次 `apply_scale` / `set_visible` / `apply_mode` 都同步落盘（tmp 文件 + rename，崩溃不会留下半个文件）；setup 时加载恢复，坏数据（手改过的 scale/mode）回退默认值而不是产生一只大小为 0 的猫。
- `src/main.ts`：启动时主动 `get_status` 拉一次权威状态应用到 renderer 和 life-engine，不再依赖"可能错过的广播事件"。
- `src-tauri/src/lib.rs` 测试模块：5 个单元测试覆盖——文件缺失回退默认、路径为 None 回退默认、非法 scale/mode 被拒绝且 visible 正常透传、三个托盘档位精确往返、按真实落盘方式（pretty JSON + tmp/rename）写入后完整读回。

### 验证

- `cargo test`：5/5 通过。注意在本机沙箱 shell 里 PATH 会先命中 Homebrew rust 1.87，而这批依赖要求 rustc ≥ 1.88，需要 `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"` 后再跑 cargo——目录级 `rustup override` 只对 rustup 代理生效，兜不住 cargo 内部再解析 `rustc` 的场景。
- `npx tsc --noEmit` 通过；`npm run build` 通过且 `dist/index.html`、`dist/management.html` 双入口都产出。
- `node --test packages/...` 17/17 不变（本轮没动纯逻辑包）。
- 实机证据：`tauri dev` 检测到 Rust 改动自动重启应用后，`settings.json` 以正确 schema 落盘（默认值），说明持久化写入路径已在真实启动流程里执行过。
- **仍需用户目测确认**：托盘菜单出现且勾选正确；切换大小后猫实时变化、重启后保持；隐藏后托盘"显示"能找回猫；"管理..."弹窗能打开且控件与托盘联动。截图工具在本环境截不到窗口内容（见本文开头的误诊记录），这几项只能人眼验收。

---

## 追加：找到"不上屏 + 托盘消失"的真正根因——启动方式（2026-09-12 晚）

### 用户验收结果

以打包后的 `.app` + `open` 启动后，**用户当场确认：猫上屏了，托盘图标也有了**。持久化恢复路径（`settings.json` 在启动时被读取并应用）也在真实启动流程中执行。

### 根因：裸二进制 vs 打包后的 .app

之前的"误诊"结论只对了一半（`screencapture` 工具确实坏了），但掩盖了真正的问题——**在本机（macOS 14.6，tauri 2.11.5 / wry 0.55.1）上，以裸二进制运行应用（`cargo run` / `tauri dev` 直接跑 `target/debug/desktop-shell`）时**：

- 窗口在 WindowServer 的 on-screen 列表里、`alpha=1.0`、全尺寸——但 WKWebView 内容**永远不合成为像**；
- `TrayIconBuilder::build()` 无报错、进程内 NSStatusItem 创建成功——但屏幕上**从未出现**对应的状态栏图标。

改用 `tauri build --debug` 打出 `Lingxi Desktop.app` 再 `open`（走 LaunchServices，在真实 GUI 会话启动）后，两个问题**同时消失**。也就是说最初记录的"WKWebView 内容不上屏"从一开始就是启动方式问题，不是 Tauri 版本 bug，也不是渲染代码 bug；"用户确认看到猫"的那次，跑的应该是打包启动或不同上下文的实例。

### 可复用的验证手段（沙箱环境里 screencapture 不可用）

用系统自带 python 的 Quartz 直接问 WindowServer，**不需要截屏、不需要任何权限**：

```python
import Quartz
wl = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID)
# 正常应看到 owner="Lingxi Desktop" 的 layer 5 全尺寸窗口（alpha 1.0），
# 以及 layer 25 的状态栏项；托盘没注册上时后者直接缺席。
```

本轮就是靠它区分出"窗口在但内容空"（layer 5 在、alpha 1）和"托盘根本没上屏"（layer 25 列表里没有我们）这两个不同的问题。

### 对日常开发的实际影响

- **开发循环要用 `npm run tauri build -- --debug` + `open target/debug/bundle/macos/Lingxi Desktop.app`**，不要用 `tauri dev`——后者在裸二进制形态下什么都看不见，还会让人以为代码坏了。debug bundle 复用已编译产物，几十秒就能出一版。
- `tauri build` 的 DMG 步骤（`bundle_dmg.sh`）在本机会失败，但 `.app` 已在此前生成，不影响开发验证；只有对外分发才需要回头修 DMG。
- 托盘/WebView 的此类"进程内成功、屏幕上消失"症状，先用上面的 Quartz 检查区分"没创建"和"创建了没上屏"，再决定往哪查。

### 追加改动：显示 Dock 图标 + 安装到 /Applications（2026-09-12 晚，用户验收通过）

- `ActivationPolicy::Accessory` → `Regular`（用户要求"运行时展示在 dock 中"，推翻此前"托盘是唯一常驻入口"的产品决定）；同时新增 `RunEvent::Reopen` 处理：点击 Dock 图标时若猫处于隐藏状态则调 `set_visible(true)` 找回，与托盘显示/隐藏走同一条 `TrayState` 路径，勾选与文案保持同步。托盘仍是主要控制面，Dock 图标是第二个入口。
- 已把 `Lingxi Desktop.app` 安装到 `/Applications`（沙箱拒绝了工作区外写入，按流程提升权限完成）。之后日常从启动台/Spotlight/Dock 打开即可，不必再 `open` bundle 路径。
- 安装后从 /Applications 启动实测：layer 25 托盘项在屏（34×37 @ x=974）、layer 5 猫窗口全尺寸在屏（alpha 1.0）、`NSWorkspace` 报 `activationPolicy: 0 (Regular)` 即 Dock 图标正常；WKWebView 的 Networking/WebContent/GPU 三个辅助进程如预期为 accessory，不影响 Dock。

### 上一轮"诚实清单"的现状核对（2026-09-13，动手前先盘点，不留半截）

在动新一轮改动前，先核对 2026-09-12 那份"诚实地列一下还没做的"清单，避免又堆出新的半成品：

- 全局点击/按键感知：仍未做，仍然是"需要辅助功能权限的真监听，现在没有"——原因没变，不是本轮范围。
- `packages/perception` 只记录落在猫身上的点击/拖拽：这是有意的范围限定（隐私边界），不是 bug，不需要"补完"。
- 托盘/管理窗口/图标的目测验证：上一轮用户已实测确认猫上屏、托盘图标在、Dock 图标正常（见上面两节）；管理弹窗内部控件（大小选择、显隐按钮）与托盘联动这部分**仍未经用户目测确认好看/位置对不对**，继续挂账。
- growth/engagement 打分公式：仍是占位实现，产品设计仍未反向对齐 `docs/04-life-engine.md`——有意搁置，不是本轮任务。
- HTTP 桥鉴权：仍然只信任"能连 127.0.0.1 的都是本机进程"这个边界，未加鉴权——有意搁置。

以上除"管理弹窗目测"外都是明确的、有记录的范围外决定，不是遗漏；本轮改动只针对下面这个新报告的、真正的行为问题。

### 追加：逗猫模式/工作模式的行为修正（2026-09-13）

用户反馈三点，指向同一个根因：

1. "逗猫模式时候，他会自动去找鼠标的位置"——即"逗猫模式"没有主动追光标，只有光标凑巧走近猫（`followRadius`=220 以内）才会触发追逐，光标一直在远处时猫只是照常闲逛/游走。
2. "工作模式的时候，他会自动去边缘不影响主要视觉点"——工作模式没有稳定地"待在边缘"，之前的"避让"只在 `userBusy`（最近 1.5 秒内光标移动过）成立时才触发，鼠标静止不动时猫可能待在屏幕正中间。
3. "上下左右似乎无法移动到边缘位置"——即使触发了避让/游走，目标点是"从猫当前位置起、随机角度、`wanderRadius`（260px）以内的一跳"，在明显大于这个半径的屏幕上，随机游走幅度不够、方向不稳定，实际上很难真正走到任何一条边。

根因是同一个：`packages/life-engine/src/index.mjs` 里游走/避让的目标点从来不是"锚定在工作区边界"的坐标，而是"从当前位置出发的一个小半径随机跳"；"逗猫"追逐则被一个距离阈值（`followRadius`/`followReleaseRadius`）挡住，只有光标已经很近才生效。

改动（均在 `packages/life-engine/src/index.mjs`）：

- **逗猫模式**：移除 `followRadius`/`followReleaseRadius` 距离阈值，只要能拿到光标坐标（不论多远）就立刻进入 `follow_cursor` 并追过去；只有光标信号彻底丢失（`cursor === null`，比如移出屏幕）才退回 `idle`。
- **工作模式**：新增 `pickEdgeRestTarget(cursor)`，直接把目标锚定在工作区的角上（x 取 `margin` 或 `width-margin`，y 取 `margin` 或 `height-margin`，选光标所在象限的对角），而不是从当前位置随机跳一段。空闲转游走、游走目标用完、光标靠近当前位置/目标点这三个触发点全部改用这个函数，并且去掉了原来的 `userBusy`（"最近 1.5 秒光标动过"）门槛——工作模式现在不论光标是否正在动，只要离猫近了就立刻挪到对角，默认闲逛/游走的落点也总是四个角之一，不再可能停在屏幕正中间。
- 因为目标点直接就是边界坐标（而不是"随机跳恰好落在边界附近"），第 3 点的"到不了边缘"问题随之解决——这不是两个独立修复，是同一处改动的两个表现。

验证：`packages/life-engine/test/life-engine.test.mjs` 更新并全部通过（`node --test packages/life-engine/test/*.test.mjs`，20/20），新增/重写了 5 个用例专门覆盖这三点（逗猫模式远距离立即追逐、逗猫模式追逐途中光标远离仍不脱离、工作模式光标逼近时退向角落而非跟随、空闲转游走时目标就是真实的远角坐标、游走全程能实际到达边界坐标而非停在半途）。`npx tsc --noEmit`（`apps/lingxi`）通过。这一轮只动了纯逻辑的 `packages/life-engine`，未涉及 Rust/渲染层，未重跑 `cargo test`。

**仍需用户在真机上目测确认**：工作模式下猫是否真的稳定停在四个角附近（而不是某个不符合直觉的位置）、逗猫模式下追逐速度/手感是否自然——这两点无法在无头单元测试里验证观感，只能靠人眼验收。

### 追加：真正的"到不了边缘"根因——渲染层坐标映射，不只是 life-engine（2026-09-13）

用户确认了上一轮的三点判断（`followRadius` 距离阈值确实没意义、"边缘"就是指屏幕物理边缘、动机是"工作时不想被打扰"），但同时指出"移动不到边缘"仍需优化。重新核查后发现：上一轮只修了 life-engine 的*逻辑*目标点（现在确实会算出"贴着 margin 的角坐标"），但 `apps/lingxi/src/renderer.ts` 把这个逻辑坐标换算成 Three.js 世界坐标的公式本身有 bug，逻辑坐标到了边界，画面上根本没跟着到——这是本轮真正要修的问题，life-engine 的修复是必要但不充分的一半。

**根因**：渲染用的是一个有俯角的正交相机（`position (0,1.4,2.6)`，`lookAt (0,0.4,0)`），之前的换算 `cat.root.position.x = px * unitsPerPixelX`（z 同理）里，`unitsPerPixelX` 是"整个视锥半宽"对应的像素比例尺，但 `px`（逻辑坐标相对屏幕中心的偏移）的取值范围只有 `±width/2`——只是视锥半宽本身的一半，所以猫最多只能走到视锥的一半宽处；垂直方向更糟：相机有俯角，世界 Z 轴的位移在投影到屏幕纵轴时会被这个俯角"压扁"（缩小到约 0.36 倍），这个压缩量之前完全没有被换算公式考虑。写了一段独立的数值验证（Node 脚本，纯向量运算，不依赖 three.js）复现了这两个问题的量级：**逻辑坐标已经到了屏幕最右/最左边缘时，画面上只走到了视口宽度的 50%；到了逻辑坐标的最上/最下边缘时，画面上只走到了视口高度的约 18%**——这完全能解释"上下左右似乎无法移动到边缘"，而且解释了为什么"上下"感觉比"左右"更明显（0.18 远小于 0.5）。

**修复**：不再用视锥的"整体缩放比例尺"去换算位置，而是从相机的真实朝向反解出"地面平面上，沿屏幕左右/上下方向各走一个像素，世界坐标该挪多少"（`groundRight`/`groundUp`，用 `camera.position`/`lookAt` 现算的向量叉乘得到，不是手抄的魔数），据此定义新的 `worldPerPixelX`/`worldPerPixelZ` 并替换原来的换算。连带修了两处会被同一个问题波及的地方：朝向角 `facingAngle`（原来直接对逻辑像素 `atan2(dx,dy)`，在两个轴换算比例相同时凑巧不出错，换算比例不同之后必须先转换到世界坐标系再取角度，否则斜着走的时候身体朝向会偏）、以及头部看向光标的 `desiredYaw`（同样的原因，且它要和 `facingAngle` 做差值比较，两者必须在同一个坐标约定下才有意义）。

**验证方式**：这是纯几何换算 bug，无法用 `node --test` 覆盖（没有可运行的 WebGL/DOM 环境），改用一个独立的数值脚本，把改动前后的公式都跑一遍、和期望的 NDC 边界值（±1）比对，确认修复后精确落在边界上（改动前：右边缘 0.5、下边缘 -0.18；改动后：右边缘 1.0、下边缘 -1.0，左/上边缘同理）。`npx tsc --noEmit` 和 `npm run build` 都过。**这依然只是几何上"应该对了"，猫在真实窗口里贴边贴得好不好看、走过去的路径顺不顺，还是要用户亲眼看一遍确认**——这类"数值对但美术效果不好看"的情况在这个项目里发生过（腿骨/毛发那几轮），不能只凭这一次数值验证就当作最终收尾。
