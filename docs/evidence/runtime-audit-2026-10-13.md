# 本机代码与运行日志检查 · 2026-10-13

## 版本核对

- 工作区原为 `main@1d25e4e`，无本地改动；fetch 后落后远端 4 个提交，已用 `git pull --ff-only origin main` 更新至 `eb79272`，与 `origin/main` 一致。
- GitHub 最新正式发布为 `v0.4.0`，发布时间 2026-10-12 23:39（北京时间）。七处应用版本均为 0.4.0。
- 检查前运行 `/Applications/灵犀.app/Contents/MacOS/lingxi`，plist 版本 0.4.0，二进制与本地原构建产物 SHA-256 一致。已安装 CLI 与仓库源文件逐字节一致。
- WorkBuddy 已安装五个事件的独立 `--host workbuddy --event …` 命令；Cursor 已安装 `afterAgentResponse`，stop 带 `--response-hook`；豆包 LaunchAgent 在运行且 stderr 为空。
- 应用依赖安装正常；`source-map-js` 已为 1.2.2。

## 实际异常与修复

### DSH 气泡返回 400，且日志丢失拒绝原因

`~/.lingxi/notify-log.jsonl` 共 2492 条记录；历史投递失败包含 229 次 say HTTP 400、68 次超时。
其中 224 次 400 带有 `taskId`，10 月 12–13 日仍有 27 次 400；历史日志未保留拒绝正文，因此不能把每一次失败都归为同一原因。

通知日志实际由另一工作区的 DSH 插件写入：
`~/workspace/dsh-plugin/packages/dsh-lingxi`，本机 web profile 通过软链加载它。
这不同于本仓库 `integrations/hosts/dsh/lingxi-dsh-plugin.js` 的会话工具接入。

可控调用复现：该插件将日志关联用的 `taskId` 发给 `/control`，应用返回 400，
`rejected` 明确为 `unknown field "taskId"`；同一响应可能已有 `applied: ["say"]`，
所以「dropped」甚至不等于气泡没有出现。插件又将拒绝原因简化为 `HTTP 400`。

已修改外部工作区的 `lib/pet-contract/bridge.js`：从控制请求中移除 `taskId`，
日志层仍保留关联；将结构化 `rejected` 原因保留为错误信息。
修正 `lib/notify.js` 关于未知字段会被忽略的旧注释。
新增真实 HTTP 边界回归，两项在修改前均失败、修改后通过。
同一调用向实际应用重放后为 HTTP 200，`applied: ["say"]`，`rejected: []`，
交付日志仍带 `taskId`。

该工作区已有未提交的文案与其他改动，全部保留。同步更新一个与既有文案不符的旧断言，
并将测试命令改为显式匹配 `test/*.test.mjs`，避免 Node 24 将 `test/` 当模块路径。

运行中的 DSH 默认只热加载配置，模块监听 `root: []`。源码修复已写入其软链目标，
新实例已经通过实际桥接验证；既有 DSH 进程需重新加载插件或重启宿主才能载入新模块。
本次未终止用户的 DSH 会话，也未改变其热加载配置。

### 原生任务日志并发写坏

`task-events.log` 中解析出 2537 条记录，另有两条损坏行，时间为 10 月 9 日。
旧实现直接对文件做格式化写入，不同线程可将一个 JSON 的多个片段交错写进同一行；轮转也未同步。

提取实际文件写入边界后，用 12 个并发写入者复现了 JSON 解析失败。
[修复后的写入实现](../../apps/lingxi/src-tauri/src/lib.rs#L5451) 用同一把锁保护轮转和完整记录写入，
先生成一条完整 JSONL，再 `write_all`。
回归还验证超过 1 MiB 后轮转，旧记录完整保留，120 条并发事件无丢失、无重复、均可解析。
历史损坏行保留作为证据，未清洗或删除用户日志。

## 运行态安装与复验

- 构建命令：`PATH="$HOME/.cargo/bin:$PATH" CI=true APPLE_SIGNING_IDENTITY=- npm run tauri -- build --bundles app`（在 `apps/lingxi`）。只构建应用，不发布 release。
- 新包签名校验通过，已替换 `/Applications/灵犀.app` 并于 10:17:21 重启，恢复重启前五个 agent 的名称、徽标与 logo。
- 原包及 agent 快照保留于 `/tmp/lingxi-runtime-20261013-101721/`。
- 运行二进制与新构建产物 SHA-256 一致：`8db580fd17200c4b8454e22d66716a657f6b151c70119bd5db8bb757b8d47f3a`。版本仍为 0.4.0，包含本次本地修复，尚未提交或发布。
- 执行本机 WorkBuddy settings 的实际命令：running → needs_approval → completed → idle echo；权限、结束产生气泡，idle echo 被静默处理，活动行保持 completed。
- 执行本机 Cursor wrapper：running → 回复末尾提问 → stop；保持 needs_input；下一条最终回复恢复 completed。包装器后台投递，验收等待实际活动状态到达。
- 新进程的冒烟共 14 条 in/react 记录均可解析，四次 spoke，无 rejected。以上验证的是安装命令到运行应用；未宣称完成宿主窗口的 UI 自动触发测试。

## 预期行为与验证结果

重复进度静默、模型已报告后 hook 让位、相同等待去重均属于正常策略。
历史超时集中在 10 月 8–9 日，最近两天未再出现；没有找到灵犀崩溃报告，用户资源加载无错误。
Claude 的 `quota_auto_resume_fired` 未识别通知不等于权限/结束通知失败，不将它伪装成等待用户。

- `npm run check` 与 `git diff --check`：通过。
- 主仓库 Node 测试：238/238 通过。
- Rust 测试：82/82 通过（包含新增并发与轮转回归）。
- 外部 DSH 插件 `npm test`：39/39 通过（包含新增两项接口回归）。
- 构建：成功；运行桥、CLI doctor、资源状态与签名检查均正常。

验证输出留在 `/tmp/lingxi-audit-20261013-tests.log`、
`/tmp/lingxi-audit-20261013-rust-fixed.log`、`/tmp/dsh-lingxi-tests-20261013.log`、
`/tmp/lingxi-build-20261013.log`。未提交、推送或发布本次修改。

## 再次编译与安装 · 11:00

- 再次 fetch，远端无新增提交；构建前后校验仓库应用输入内容一致，包含本次尚未提交的日志修复。
- 重新编译前端与原生 crate，release 编译耗时 3 分 15 秒；应用包完成签名。
- 新进程 PID **25472**，11:00:03 启动，桥接 `startedAt=1791860404523`，可执行路径为 `/Applications/灵犀.app/Contents/MacOS/lingxi`。
- 运行二进制与本次构建 SHA-256 完全一致，仍为 `8db580fd17200c4b8454e22d66716a657f6b151c70119bd5db8bb757b8d47f3a`。相同源码重新编译得到相同校验值；新进程与构建记录用于确认安装确实执行。
- 旧包与六个 agent 的注册信息保存在 `/tmp/lingxi-reinstall-20261013-110003/`，注册信息已恢复。
- 版本 0.4.0；签名、CLI doctor、资源加载与桥接检查通过。新进程实际通知为 `spoke`，包含 `say`，无 rejected。
- 构建凭据：`/tmp/lingxi-reinstall-20261013-110003/BUILD_RECEIPT.json`；构建输出：`/tmp/lingxi-reinstall-build-20261013.log`。

## 托盘数字一直显示 1 · 11:28–11:41

用户再次观察到数字不消失。本次为原生显示问题，区别于 0.4.0 已修复的空闲心跳制造未读。

- 逻辑数字来自最近 24 小时内未读的 `failed / needs_input / needs_approval / blocked` 活动行。
  首页前台显示到的提醒自动确认已读；页面每 4 秒刷新，焦点和页面切换也触发刷新。
- 运行日志中 11:18:15 的 DSH `blocked` 报告曾使计数为 1；后续 DSH 已恢复 running。
  11:28 的活动行均为 running/completed，没有应计数的提醒；只存在一个灵犀进程。
- 应用归零时调用 `set_title(None)`。实际依赖 `tray-icon 0.24.2` 的 macOS 实现只对
  `Some(title)` 调用 NSStatusItem 按钮的 `setTitle`，`None` 不清除已有文字。
  因此内部计数归零、菜单提示正常，图标旁却仍留着旧「1」。
- 提取实际标题参数映射到 [tray_badge.rs](../../apps/lingxi/src-tauri/src/tray_badge.rs)，
  [原生回归探针](../../scripts/check-tray-badge.mjs) 使用真实 tray-icon 和 NSStatusItem 读取标题。
  修改前 `unread=0, native title="1"` 导致断言失败；改为显式空字符串后
  `1 → "" → 2 → ""` 全部通过。命令：`node scripts/check-tray-badge.mjs`，
  需先在 `apps/lingxi/src-tauri` 跑 `cargo test` 准备调试依赖，且在 macOS 桌面会话运行。
- Rust 82 项测试通过，项目检查与 diff 检查通过。
- 修复包 11:41:24 启动，PID **49450**，运行路径 `/Applications/灵犀.app/Contents/MacOS/lingxi`。
  运行二进制与本次构建 SHA-256 一致：`e4a8cce44e4b0d4ece553e0b4b607def88d7738c9bba76d3b92a85001e7e2021`。
  签名与 CLI doctor 均通过，启动后没有待关注状态行。
- 旧包与构建凭据：`/tmp/lingxi-tray-fix-20261013-114121/`；
  构建输出：`/tmp/lingxi-tray-build-20261013.log`；失败复现：`/tmp/lingxi-tray-badge-red-20261013.log`。
