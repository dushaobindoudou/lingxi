# 灵犀 Lingxi · 项目长期约定

> 详细历史见 `.workbuddy/memory/2026-09-19.md`、`2026-09-23.md`、`2026-09-24.md`、`2026-09-30.md`。

## 产品与优先级

- 定位：**一只住在桌面上的猫，既是安静陪伴，也是 Agent 的可见状态。**
- 三层：共存层（透明/穿透/置顶/常驻）→ 表现层（自主行为/动作/表情/玩具/特效）→ Agent 状态可视化。
- 当前目标是让 Agent 彻底驱动整只猫；耗能后续专项优化，现在不要反复列为缺口。
- `docs/` 当前是合理第一版，不建议归档或重写。
- 猫的表现应克制；动作节奏预算与验收指标在 `integrations/skills/lingxi/SKILL.md`。
- 交付文案不要用勾叉符号装饰，改用明确语义。

## 工程不变量

- 解耦链：`packages/life-engine`（纯状态机）→ `apps/lingxi/src/renderer.ts`（Three.js）→ `apps/lingxi/src-tauri`（窗口/托盘/桥）。
- 朝向由引擎持有；步态由距离驱动；落地高度是姿态属性。改动画先跑 `probe-gait.html`。
- Agent 统一走 `127.0.0.1:47811` 回环桥。
- 动作/表情/皮肤来自用户可编辑 JSON，调用前必须查 capabilities，不能硬编码 id。
- `actions.json`、`expressions.json` 是整体替换，`skins.json` 是合并；改自定义资源前先读、备份。本机有其他 agent 并发写入。
- 测试：`npm run check && npm test`；应用侧再跑 `npx tsc --noEmit` 与 `cargo test`；渲染动画用 `probe-*.html`。

## Skill 与宿主

- 真源：`integrations/skills/{lingxi,lingxi-authoring}`；WorkBuddy 另有宿主私有 `integrations/hosts/workbuddy/skills/lingxi-workbuddy`。
- Codex 是精简 fork；Doubao 是实体副本；WorkBuddy plugin 有字节一致拷贝；英文文档另维护。改 skill 时按对应测试同步。
- 驱动优先 CLI：`~/Library/Application Support/com.dushaobin.lingxi-desktop/bin/lingxi`；MCP 与 CLI 同桥，CLI 能力更全。
- MCP 13 个工具签名的独立 reference 从未入库；现由运行时 schema + `lingxi integration` 替代，但后者不含完整签名。

## 当前接口事实与风险

- `/intent` 对非有限坐标曾可产生 NaN 并让猫消失；`resetPosition` 不足以恢复。`holdMs` 也需边界保护。不要把 clamp 或 `ok:true` 当安全证据。
- 当前 `lingxi state` 已可观测 expression、heading、intent、recoveredAt；action/expression 拼错会明确报错；自定义皮肤可被 agent（trusted）和界面使用。
- 多提醒同时到期仍有被吞风险；完整待办见 `ISSUES-2026-09-19.md`。
- 多 agent 仲裁已上线：`ambient < status < report < alert`；stage busy 被丢是设计，不要重试。hooks 与主动 control 仍可能对同一事件重复反应。

## WorkBuddy 接入红线

- WorkBuddy 5.6+ hooks：`UserPromptSubmit`→running、`Stop`→completed、`Notification`/`PermissionRequest`→等待用户；不装工具级 hooks，避免通知轰炸。
- `~/.workbuddy/mcp.json` 的 Lingxi server **不要加/改 env**：授权绑定配置哈希，变更会使信任失效。新配置必须由用户在连接器管理页手动点“信任”。
- 不得替用户改 `agent-permissions.json`；trusted 权限只能由用户在界面授予。
- `agent.json` 要增量更新，不能整体覆盖 `logo`；hook 不要写死 Node 版本路径。
- `mcp-tool-list.json` 以 server 配置哈希为键，工具名是裸名（如 `lingxi_capabilities`）。
- 回归：`integrations/test/workbuddy-plugin.test.mjs`；探针会先核对配置哈希，再验证 13 工具、身份和 mood。

## v5 / v6 Blender 渲染管线

- 链路：`build_lingxi_v5.py` → `native_fur_lingxi_v5.py` → `render_lingxi_v5_poses.py` → `make_lingxi_v5_pose_sheet.py`；build 后必须重跑 native_fur。
- `LX_Fur_*` 毛源网格必须 `hide_render=True`；颜色写 attribute 前先 `srgb_lin()`；毛发用不透明 Principled BSDF + `coat_color`；native_fur 必须幂等。
- 改头身比用最终统一 `HEAD_S` 围绕颈关节缩放全头组件，之后跑 `verify_rig_deform.py`。
- 视觉量化用 `scripts/blender/metrics_render.py` 对参考图 `reference/turnaround-v1.png`；背景或曝光变动后重做背景板。
- 修改脚本后先 `py_compile` + preview 快验，再跑 standard。
- **量几何要量真实顶点，不要量 `bound_box`**：滚转/弯曲的部件 AABB 会膨胀 50 mm 以上（侧躺身体实测
  −218 vs 真实 −165）。还要注意部件的"位置"和"尺寸"别混：耳宽要取该高度行的 x 跨度，不是 `max|x|`。
- 审阅工具：`scripts/lookdev-v6/v6_part_audit.py`（部件到体表的带符号距离）、
  `v6_clip_review.py`（每个 clip 的爪行程 / 身长变化 / 耳·下颌·尾角 / 最低顶点）。
- **量 clip 时绝不能给 rig 直接赋 action**：`v6_clip_review.py` 靠烘焙好的 NLA strip 求值，直接赋
  `bpy.data.actions['LX_<clip>']` 得到的是另一个姿态（strip 时间 vs action 时间）——同一帧号下 Lick
  一个口径 +1.5 mm、另一个 −77.1 mm。自建探针要抄它的处理方式，只 `frame_set()`。
- **成品文件里可以扫参**：`frame_set()` 之后再写 `pb.rotation_euler` / `pb.location` 会覆盖烘焙曲线
  （求值读的是骨骼当前值），所以调尾角、扫 root 抬升都不用重建。
- **给「看图」publish 的路口**：`present_files` 只给 localhost 预览，手机打不开；
  用户要看图就用 `workbuddy_sites_deploy` 发静态目录。先把 PNG 压成 JPEG
  （`reviews/b4-round/make_site.py`，24 MB → 0.82 MB，原图不动），
  再发 `reviews/b4-round/site/`（单 app，index.html + img/），
  需要 `domainPrefix` + `appName` + `userAskedToPublish`。
  兜底产物是 `lingxi-review-offline.html`（base64 内联单文件，微信/AirDrop 直开）；
  手机端校验走 `verify_mobile.cjs`（390×844，查坏图/零宽图/横向溢出/pageerror），
  `playwright-core` 不在这个 worktree，要指 `~/.workbuddy/binaries/node/workspace/node_modules`。
- **JS 模板串里的图没法按文件名内联**：`src="img/poses-b4/${n}.jpg"` 的 `${n}` 是字面量，
  内联前先替换成 `src="${IMG['b4'][n]}"` + 注入一张 `const IMG` 映射表。
- **坐姿是"前腿打直"的硬约束**：`Lick` 的坐姿里前腿已经到 `L1+L2` 极限，`leg_ik` 的 `over` 一抬根就
  > 0，抬身体 80 mm 只会让前爪跟着悬空 77 mm。要抬后半身只能动**髋部高度**，而髋部与脊柱俯仰是
  **同一个决策**（只改 hip 目标求解器纹丝不动：62° 俯仰会把肩顶出前腿够得到的范围；
  hip 170 mm + 俯仰 44° 才解得动）。158 mm 是这个骨架的上限，Lick 剩的 15 mm 沉地是几何硬约束。

## 构建、安装与版本判据

- 构建：`export PATH="$HOME/.cargo/bin:$PATH"` 后 `cd apps/lingxi && npm run tauri -- build`（约 1.5 分钟）。
  **dmg 打包在沙箱内必失败**（`bundle_dmg.sh` 要 hdiutil），`.app` 照常产出在
  `apps/lingxi/src-tauri/target/release/bundle/macos/灵犀.app`，不需要 dmg。
- 安装：先 `mv /Applications/灵犀.app <备份目录>`（保留、可回滚）→ `pkill -x lingxi` → `cp -R` → `open -a`；
  确认进程真退出了用 `curl /status` 是否被拒。
- 本 shell 没有 `ps`/`pgrep`（Operation not permitted），`osascript ... quit` 报 -10004，**只有 `pkill -x lingxi` 可用**。
  依赖 `/bin/ps` 的测试（如 `claude-plugin.test.mjs:375`）在这里必然失败，属环境级，不是回归。
- **版本判据不能看 HTTP `/activity`**：那个端点不输出 `attention` / `attention_seen` / `key`——
  这些是 tauri command `get_agents` 给主界面加的。可靠办法是搜二进制符号（如 `acknowledge_activity`）。

## 托盘未读数字

- 数字 = 24h 内 `!attention_seen && state ∈ {failed,needs_input,needs_approval,blocked}` 的行数；
  键是 `identity#session`，所以一个会话一行，会按会话累加。
- Claude Code / WorkBuddy 每轮 Stop 之后 **60.0s** 会补一条 echo `needs_input`
  （"waiting for your input"），把已结束的行改写成未读——托盘数字不清的主因。
- 已修：`is_repeat_wait()` 让 echo `needs_input` 落在已结束行（completed/failed/cancelled）上时静默；
  真提问走非 echo 的 PermissionRequest，不受影响。
- 排障入口：`~/Library/Application Support/com.dushaobin.lingxi-desktop/logs/task-events.log`
  （脱敏 JSONL，字符串只记 `str(len)`）、`GET /activity`、`POST /task-event`，token 在同目录 `bridge-token`。
