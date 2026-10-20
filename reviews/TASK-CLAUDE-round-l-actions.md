# 任务：躺姿三兄弟重塑 + 动作里的脚（round-l 动作域）

你负责 `build_lingxi_v5.py` 的**动作域**。用户看过 round-k 渲染后说：「躺下去的效果不好」「脚的效果不好」，整体已经不错，就差动作、体态、步态。

## 领地（硬约束，违反会毁掉并行会话的工作）

**另一个 Claude 会话正在同一文件上工作（round-l 体态域，未提交改动已在工作区）**。它已改/正改：

- `BODY_K` / `V6_BODY_K`（身长比例）、`NeckRuff` / `RUFF`、`GAPE_W` / `V6_GAPE_W`、`solve_sit` 的 `V6_SIT_PITCH`、`CHEST`

**你的领地**（可以改）：

- `pose()` 里 `LieDown` / `SideLie` / `Sleep` 块（约 L1749-1763）
- 腿脚靶表（`solve` 区约 L1680-1686 的 `SideLie/Sleep` leg targets）
- `Lick` 的姿态块（约 L1807 起）与 `SIT` / `LICK_WRIST` 等动作常量
- 如需新旋钮，用 `_v6('V6_XYZ', default)` 形式

**协议**：每次编辑前重新 Read 文件（对方在持续写入）；发现文件又有新改动属正常，不要 revert、不要 stash、不要 checkout、不要整体重写文件；小步 Edit；每完成一个动作域就 `git add scripts/blender/build_lingxi_v5.py reviews/HANDOFF.md && git commit`（**只 add 具体文件，不要 `git add -A`**——工作区有对方未提交改动和 .workbuddy 临时文件）。

## 问题清单（来自 round-k 实测 + 渲染目检）

### P0-1 LieDown：像压扁的毯子

现状（round-k `review-clips.json`）：root_z −99.5、spine 2.5°（脊柱几乎放平）、body_length 1000.3（比 Idle 还长）、`lowest = Body +0.4`。渲染观感：脖子完全消失、头直接接在压扁躯干上；**前爪白毛戳出身体前缘下方像两个雪橇**；没有猫趴下时「前腿收拢/前伸贴胸、肩胛撑出轮廓」的造型。

目标：

- 胸/腹贴地（Body 最低点 0~+2mm），但脊柱保留轻微曲线（spine 3-6°），脖子有可见弧度
- 前腿向前伸出并收拢到胸侧（参考真猫 loaf / sphinx pose：前爪可以一只前伸一只收，或双收），**前爪不超出鼻尖轮廓太多**
- 头微抬（head_pitch 略正），下巴不贴地

### P0-2 SideLie：身体悬空的「翻滚球」

现状：root +139mm、roll 1.25rad；`lowest_parts = RearToe0.L −2.3, RearBean0.L +1.6, Body +5.5`——**身体侧面离地 5.5mm 悬空**，四爪朝天（RearPaw.R tip 277mm、FrontPaw.R 264mm）；头立着（neck 13.1°、head_pitch 5.8°），没躺下。

目标：

- 身体侧面**真实贴地**：Body 最低点 ∈ [0, +2]，不是靠后趾撑地
- root 抬升量按「体宽/2」重新推（体宽变化后 0.139 已不对；可用 `v6_ground_calib.py` 或直接扫 root 让 Body 贴地）
- 头侧枕：neck 放平（≤8°），头贴地或近地（可用 head_clear/新探针量）
- 上侧腿松散伸出或微曲，下侧腿被身体压住；四爪不朝天

### P0-3 Sleep：和 SideLie 几乎同一姿态

现状：root +127、roll 1.15、back_top 323.8 vs SideLie 323.7、body_length 999.6 vs 1000.3——除了闭眼一模一样。真猫睡觉是**蜷成团**（curl up）。

目标：

- 蜷缩：脊柱卷曲（spine pitch 明显）、body_length 明显缩短（目标 ≤ 920mm，现在 999.6）
- 头低下贴向前爪/身侧（head_pitch 大于 SideLie）
- 尾巴绕到体侧可见（tail_deg 有表现）
- 与 SideLie 的 `distance_to_idle` 或姿态角差异要显著；最低点 ∈ [−5, +2]

### P1-1 Lick：后半身一团棉

渲染目检：坐姿成立、右爪贴嘴、舌头接触已修好（+1.44mm），但**后半身没有大腿轮廓**（Haunch 区被毛糊成一团白）、**尾巴完全看不见**（tail_deg 204.5 卷进身体后面被挡）。

目标：尾尖绕到身体侧前方可见（调 Tail1-3 的卷向）；若 Haunch 轮廓问题在毛系统则**不要动毛系统**，只记录到 HANDOFF。

### P1-2 步态观感复验（不重做）

round-k 步态数值已达标（Walk 滑移 0.04mm/帧、Run 接地、头颈 ±2.4°）。你只需在最终渲染后目检 Walk/Run 渲染图是否还有观感问题（比如 bob 幅度、步幅），有问题记录，不改代码。

### 不做（对方会话的领地）

肩高/身比例（BODY_K）、NeckRuff、Yawn 张口宽度（GAPE_W）、Bite 开口、犬齿——**都不要碰**。

## 工作流（严格按序）

1. `git status` + `git diff scripts/blender/build_lingxi_v5.py | head` 确认现场；Read 你要改的区段。
2. 每个动作：改 → `py_compile` → **preview 质量快验**（`LINGXI_QUALITY=preview` 只 build 该 clip 或低采样渲 1-2 帧）→ `v6_clip_review.py` 量 → 数字达标再下一个。**不要每改一个动作就跑全量 build+fur（各 ~10 分钟），攒够一批再 build。**
3. 三个躺姿全部达标后：全量 build + native_fur + `v6_clip_review.py` + `v6_gait_audit.py`（确认没把步态改坏）。
4. standard 质量渲 15 个 poses（`render_lingxi_v5_poses.py`）+ 逐张目检躺姿三兄弟。渲染命令参考 `assets/characters/lingxi/v6/round-k/run.sh`（输出目录建议 `assets/characters/lingxi/v6/round-l/`，把 run.sh 里 OUT 改掉）。
5. 把「改前 → 改后 → 达标与否」写进 `reviews/HANDOFF.md`（追加，不覆盖）。
6. commit（只 add 你改的文件）。

## 禁止假收工

- 渲染一律**前台阻塞**跑，不许 `&` 丢后台后退出（37 分钟白跑的前科）。
- 没有全量渲染图、没有 commit、HANDOFF 没写，不许结束。
- 如果标准质量渲染时间太长，至少完成 build+fur+audit+clips+poses 全链。
