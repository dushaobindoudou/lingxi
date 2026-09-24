# 发布前盘点 · 2026-09-24

这是一次**快照**，不是状态板。按 [`docs/README.md`](docs/README.md) 的三层划分，它属于第三层：
写下来之后代码会继续变，请当回归清单用。

范围：codex 生成的托盘与主界面、dsh 补充的宿主插件与资源机制，以及两者落地后与既有文档的一致性。
**本轮只改文档，不改代码**（下面 D 类除外——已改）。

基线：`e473dec`，工作区带未提交改动。`npm run check` 通过，`npm test` 108/108 通过。

---

## 修复结论（2026-09-24 当天，盘点之后）

| 条目 | 结论 |
|---|---|
| **B1** 记忆/提醒全 403 | ✅ 已修。身份改成"`X-Lingxi-Agent` 头优先，回落 body 的 `agent` 字段"，两个 handler 改成先读 body 再判权限；CLI、MCP server、DSH 插件三处都补发了请求头；MCP 的 `remember`/`remind` 原本连 body 都没带身份，改成走 `stamp()` 并补 `ensureRegistered()`。新增 Rust 单测 `a_persistent_write_is_attributed_by_header_or_by_body` |
| **B2** DSH `lingxi_remember` 不注册 | ✅ 已修，补 `ensureIdentity` |
| **B3** `accentText` 未写进应用自己的 README | ✅ 已修，示例和说明都补了 |
| **B4** 探针 PNG 会进 `.app` | ✅ 已修。两张 PNG 从 `public/` 移到所属皮肤的 `textures/`，预览页改成 Vite import（该页不是构建入口，所以不会被打包） |
| **B5** `dist/` 入库 | ❌ 撤回，本条不成立（见下） |
| **S15/S16/S17** `plugins/` 与 `hosts/` 并存 | ✅ 已修。`integrations/plugins/` 整个删除，`install-skills.sh`、`lib.rs` 注释、三份 README 的指向全部改到 `hosts/` |

第二、三节的 ⬜ 条目里，U1–U15 仍然成立，见下。

---

## 一、Bug（按影响排序）

### B1 · 记忆和提醒对所有已发布的接入方全部是 403 —— P0

`POST /memory` 和 `POST /reminders` 走 `refuse_untrusted_write()`，调用方身份**只从
`X-Lingxi-Agent` 请求头读**（`apps/lingxi/src-tauri/src/lib.rs:2303`，注释解释了为什么不能读
body：body 只能消费一次）。不带这个头就是 `anonymous`，档位取默认值 `performer`，
`may_write_settings()` 为假 → **403**。

**而现在没有任何一个客户端发这个头：**

| 客户端 | 位置 | 发的头 |
|---|---|---|
| `lingxi` CLI | `integrations/cli/lingxi:131` | 只有 `Authorization` + `Content-Type` |
| MCP server | `packages/mcp-server/src/bridge.mjs:281,288` | 同上；身份只塞进 body 的 `agent` 字段 |
| DSH 插件 | `integrations/hosts/dsh/lingxi-dsh-plugin.js` `lingxi_remember` | 同上 |
| Claude hooks / Codex notify | 纯 curl | 不涉及这两个接口 |

后果：`lingxi remember` / `lingxi remind` / `lingxi_remember` / `lingxi_remind` /
DSH 的 `lingxi_remember` **一次都不会成功**，除非用户手工把 `anonymous` 提到 `trusted`
——而主界面的权限表只列出现过的 agent id，`anonymous` 未必在列。

README 首页宣传的"能记住关于你的事，能过一会儿提醒你"目前是不成立的。

修的方向（二选一，不要两个都做）：
- 客户端补 `X-Lingxi-Agent` 头（CLI、`bridge.mjs`、DSH 插件三处），或
- Rust 侧在读 body 之前先 peek 一个 `agent` 字段（要改 `read_body_capped` 的消费顺序）。

**回归验证**：`lingxi remember "测试" moment` 应返回 200；`lingxi agents` 里该 id 的
调用日志记 `applied` 而不是 `denied`。

### B2 · DSH 插件的 `lingxi_remember` 即使 B1 修好也仍然错

`integrations/hosts/dsh/lingxi-dsh-plugin.js` 的 `lingxi_remember` 是唯一一个**不调用**
`ensureIdentity(ctx)` 就直接发请求的工具。其余四个都调了。即便补上请求头，`dsh` 这个 id
也可能还没在注册表里（注册表是纯内存的，应用重启即空），档位落到默认值。

### B3 · `accentText` 有实现、有校验，但应用自己写出去的 README 不提它

`parseBubbleStyle` 已接受 `accentText`（`apps/lingxi/src/rig/custom-assets.ts:87`），
`docs/19` 也把它写成接入验收项之一。但应用启动时写进资源目录的那份
`assets/README.md`（模板在 `custom-assets.ts` 的 `## bubble.json` 段）示例里**没有这个字段**。
用户照着那份 README 改配置，永远不会知道有强调色。

### B4 · 探针产物会被打进 `.app`

`apps/lingxi/public/.probe-sunhonglei/`（2 个 PNG，20 KB）是未提交的临时探针产物。
Vite 把 `public/` 整目录原样拷进 `dist/`，包括点开头的目录，所以它会进打包产物。
体积不大，但不是发布内容。

### ~~B5 · `dist/` 已入库~~ —— 撤回，本条不成立

初查时误判。`apps/lingxi/dist/` 确实在磁盘上（4.8 MB），但 `.gitignore:3` 的 `dist/` 已经把它排除，
`git ls-files apps/lingxi/dist` 是空的——它只是本地构建产物，从来没有入过库。

---

## 二、过期内容（文档与代码已经不一致）

> 标 ✅ 的已在本轮直接改掉；标 ⬜ 的需要决策或涉及代码，只登记。

| # | 位置 | 过期在哪 | 处理 |
|---|---|---|---|
| S1 | `docs/README.md` | `21-tray-menu-and-home-surface.md` 在"当前规格"表里**列了两次**，两行描述还不一样 | ✅ 合并成一行 |
| S2 | `docs/README.md` | 索引漏了 `12-character-study-review.md` 和 `lingxi-完整技术方案 v0.1.md`（3904 行，仓库里最大的一份文档） | ✅ 补进对应层 |
| S3 | `docs/20-arbitrary-png-skin-import.md:60` | 指向 `apps/lingxi/src/style-lab/texture-import.ts`，文件已移到 `apps/lingxi/src/rig/texture-import.ts` | ✅ 改路径 |
| S4 | `docs/18-main-interface-design.md` | 整篇的 ✅/◐/⬜ 状态标注停在 2026-09-13。MCP server（13 工具）、权限档位、写入频控、调用日志、Agent 一键接入、猫侧反应**都已实现**，文中仍写"⬜ 待建"/"未做" | ✅ 顶部加状态横幅 + 逐条订正 |
| S5 | `docs/18` §0/§4/§10/§11 | 说导航是 **5 页**；实际是 6 页（多一个"玩法"），`docs/21` 写的是"六个页面" —— 两份"当前规格"互相打架 | ✅ 统一为 6 页 |
| S6 | `docs/18` §4 | 顶栏画的是 `[工作/逗猫模式]`；`docs/21` 已经废掉全局模式，实际顶栏是 大小 + 找回猫咪 | ✅ 改图 |
| S7 | `docs/18:271` | "桌面壳里跑的还是 `placeholder-cat.ts` 几何体占位猫" —— 该文件已删除，现在是 `src/rig/skeleton.ts` 的体素骨架 + 完整动画系统 | ✅ 订正 |
| S8 | `docs/16-desktop-shell-prototype.md:23` | 同样指向已删除的 `placeholder-cat.ts` | ✅ 加失效注记（第二层文档保留原文，只标注） |
| S9 | `README.md` | "托盘图标里有：主界面、调试台、大小、玩具、特效、显示/隐藏" —— 实际托盘只有 状态摘要 / 显示 / 大小 / 互动 / 打开灵犀 / 退出；调试台改从主界面→设置进入，特效和玩具不在托盘 | ✅ 改写 |
| S10 | `integrations/README.md:22` | 教用户装 `integrations/plugins/claude-code`，而 `integrations/hosts/README.md` 明确写"两条路径**别同时装**" —— 两份接入文档给的是互相冲突的首选路径 | ✅ 改为以 `hosts/` 为准 |
| S11 | `integrations/README.md:26` | 指向 `plugins/codex/README.md`，同一件事 `hosts/codex/` 下也有一份且更新 | ✅ 改指向 |
| S12 | `docs/21` 首页 ASCII 图 | 图里画着"一起度过的今天 3 小时 12 分"，正文同一节又写"当前没有这个契约，因此整项隐藏" —— 文档内部自相矛盾，实现按"隐藏"做的 | ✅ 改图 |
| S13 | `docs/21` 交互表 | 按钮在三处叫三个名字：图里"找回灵犀"、表里"找到灵犀"、代码里"找回猫咪" | ✅ 统一为"找回猫咪" |
| S14 | `docs/19` 权限一节 | 写"主界面 → Agent 接入 → **权限与日志**"，代码的拒绝文案写"→ **权限**" | ✅ 文档对齐代码实际的区块标题 |
| S15 | `integrations/install-skills.sh:73,79` | 同 S10/S11，脚本输出仍推荐 `plugins/` 路径 | ✅ 改指向 `hosts/claude` 与 `hosts/codex/install.sh` |
| S16 | `apps/lingxi/src-tauri/src/lib.rs:940,980` | 注释指向 `integrations/plugins/`，应为 `integrations/hosts/claude/` | ✅ 已改 |
| S17 | `integrations/plugins/` 整个目录 | `hosts/` 已按"一个宿主一个插件"重做，`plugins/` 是上一版通用插件。留着就会一直产生 S10/S11/S15/S16 这类冲突 | ✅ 删除。装过 `plugins/claude-code` 的人需要重装 `hosts/claude`，三份 README 都写了这句 |

---

## 三、未完成（有设计、无实现，或只做了一半）

| # | 事项 | 现状 | 来源 |
|---|---|---|---|
| U1 | 气泡"是否居中"与"icon 位置"没有配置字段 | `docs/19` 把它们列为**接入必查项**，同一段又承认"需要结合渲染实现优化，不能仅靠添加 JSON 字段完成"。目前接入方无法完成这项验收 | `docs/19` 气泡一节 |
| U2 | 气泡任意片段多色 | 只有全局 `text` / `accentText` 两色 | 同上 |
| U3 | 外观页皮肤预览 | 九款皮肤只显示配色块，没有角色缩略图；`docs/21` 要求"从统一镜头用 renderer 生成小型实时/快照预览" | `docs/21` 素材盘点 |
| U4 | 陪伴时长 | 没有可靠的累计字段，首页整项隐藏。`docs/21` 明确禁止用 `cursorNearPetMs` 冒充 | `docs/21` 开发映射 |
| U5 | Agent 在线心跳 | 没有心跳契约，只能显示"已登记/最近有报告"，不能判断断连 | `docs/21` 信息克制 |
| U6 | DSH 一键接入 | 通道已核实，插件源码已入库，但主界面 DSH 分区只给手工步骤，没有按钮 | `apps/lingxi/management.html:150-161` |
| U7 | LLM 大脑 | 控件已摆出但禁用，未接后端 | `docs/18` §11 |
| U8 | growth / engagement 计分 | 仍是占位公式，未反向对齐 `docs/04-life-engine.md` | `docs/16:117,221` |
| U9 | 短毛骨架 v5 | Blender 离线 look-dev，未批准为品牌母版，未导入 Three.js 应用 | `docs/22` |
| U10 | 孙红雷风格皮肤 | `assets/characters/lingxi/skins/sunhonglei-inspired/` 与 `scripts/make-sun-honglei-skin.mjs`、`apps/lingxi/sun-honglei-preview.html` 全部未提交，未进 `src/data/skins.json`，未在任何文档登记 | 工作区未跟踪文件 |
| U11 | WorkBuddy 皮肤 | `skins/workbuddy-mint/` 同上，未提交、未登记 | 工作区未跟踪文件 |
| U12 | `hiddenNodes` / `proportions` 皮肤字段 | 已实现并有校验，应用写出的 `assets/README.md` 里有 `hiddenNodes` 示例，但 `docs/20`（皮肤导入的权威文档）完全没提这两个字段 | `custom-assets.ts:200,248` |
| U13 | ZIP 资源包导入 | 未实现，只支持 JSON+PNG 配对 | `docs/archive/19` |
| U14 | Lingxi ↔ Minecraft Java/Bedrock 皮肤转换器 | 未实现，需要独立转换器 | `docs/20:56` |
| U15 | `.workbuddy/` 目录的归属 | 探针脚本和 memory 笔记放在仓库根的隐藏目录里，既不在 `integrations/`，也没有任何文档说明它算不算发布内容 | ⬜ 需要决策 |

---

## 四、本轮已改的文档

只改了"文档说的和代码做的不一致"的部分，没有改设计意图：

- `docs/README.md` —— 去重、补全索引、把本文件登记进第三层
- `docs/16-desktop-shell-prototype.md` —— 给已删除文件的引用加失效注记
- `docs/18-main-interface-design.md` —— 状态横幅、5→6 页、顶栏、猫侧反应、§11 验收逐条订正
- `docs/19-agent-integration.md` —— 权限入口名称、`assets/` 的实际绝对路径
- `docs/20-arbitrary-png-skin-import.md` —— 失效路径、补 `hiddenNodes` / `proportions` 登记
- `docs/21-tray-menu-and-home-surface.md` —— 首页 ASCII 图、按钮名统一
- `README.md` —— 托盘菜单实际内容
- `integrations/README.md` —— 首选接入路径改为 `hosts/`

---

## 五、建议的下一步顺序

1. **B1** —— 它让 README 承诺的两个能力完全失效，且用户看不出原因（403 的文案指向一个
   `anonymous` 可能不在列的权限表）。修完顺手处理 B2。
2. **S17** —— 决定 `integrations/plugins/` 的去留。不决定，S10/S11/S15/S16 会反复回潮。
3. **B4 / B5** —— 发布前的产物卫生，两条 `.gitignore` 规则的事。
4. **U10 / U11 / U15** —— 决定这批未跟踪的皮肤与探针算不算发布内容；算，就补 manifest 与文档登记，不算，就清掉。
5. **U1** —— 气泡居中与 icon 位置：`docs/19` 已经把它写成接入方的硬性验收项，但接入方做不到。
   要么实现，要么把它从验收项降级成"已知限制"。
