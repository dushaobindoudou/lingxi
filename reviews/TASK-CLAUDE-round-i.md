# WorkBuddy → Claude：round-i 任务书（重点：爪子 + 动作体态）

> 用户反馈原话：「脸型也不对，爪子也不对」「重点关注动作和爪子」。
> 本轮 P0 = 爪子 + 动作体态；P1 = 脸型三项（时间不够就留下一轮）。
> 产出目录：`assets/characters/lingxi/v6/round-i/`（round-h 已占用）。
> 发布页 `reviews/b4-round/`（site/make_site.py/verify_mobile.cjs/offline）归 WorkBuddy，不要碰。

## P0-A 爪子（用户点名的最大痛点）

现状证据（round-h `views/paws.png`，900px）：
- 每只前爪是「四颗白球」：TOE 球太圆太鼓，趾缝几乎看不见，整体像一串毛球不像爪。
- 爪背毛太长，把趾轮廓完全糊掉；参考图（`assets/characters/lingxi/reference/turnaround-v1.png`
  右下趴姿）趾是<b>隐约的鼓包</b>，不是分立的球。
- 腿是细棍+雪球：腿毛短、躯干毛长，过渡生硬；参考图小猫腿短粗、被绒毛包住。

要做（先量后改，改完重测同一把尺）：
1. 用 `scripts/lookdev-v6/v6_g_review.py` 先量 round-h 的外侧趾缝（P0-A 基线数字写进报告），
   然后：
   - 趾球收小收扁：`TOE_R`（现 (.016,.021,.021)）与 `TOE_Z=.022` 往「隐约鼓包」方向调，
     `TOE_ARC`（现 .60）让四趾贴爪背弧线，别往前戳；
   - 爪背/趾部毛长单独压短（趾部毛 ≤ 爪背毛），让四趾缝在 900px 渲染下可辨；
   - 外侧趾缝目标：四条趾缝都呈负值沟（不得再出现 +鼓包）。
2. 腿毛过渡：腿段毛长/毛密度上调贴近躯干绒毛，消「细棍」感（优先毛，不改骨骼几何）。
3. 审计常驻：把「四趾缝深浅」写进 `v6_part_audit.py`（paw 组），每轮自动出数。

## P0-B 动作体态

现状证据（round-h `review-clips.json` / poses 渲染）：
- Walk/站立背影「驼峰」明显：背拱太高、头埋进毛里（Walk.png）。
- Walk 步幅偏小：前爪 travel 36mm / 后爪 45mm（身长 ~1000mm），看起来像小碎步。
- 沉地未清零：LieDown −8.0、Stretch −7.3、SideLie −4.5、Sleep −4.9、PawPlay −3.5、Lick −15.0。
  （已知：Lick 坐姿 −15mm 是前腿打直的几何硬约束，勿强拗；其余目标 ≥ −5mm 且不穿地。）
- Run 前爪 travel 51 / 后爪 63，与 Walk 拉不开档次。

要做：
1. 驼峰：查 Walk/Idle 代表帧的脊柱俯仰与 root pitch，把背拱压平（以参考图站姿为准），
   改完看 Walk.png 背线是否顺。
2. 步幅：Walk/Run 的 paw travel 上调（Walk 前爪 ≥ 55mm、Run ≥ 90mm 为参考量级，
   具体以不滑步、落地不穿地为限），保持距离驱动步态的既有逻辑。
3. 沉地：LieDown/Stretch/PawPlay 再收 3–5mm（Lick 除外）。
4. 全部 15 clip 重跑 `v6_clip_review.py`，lowest/paw_travel 与 round-h 逐项对比写进报告。

## P1 脸型（有余力再做，做不完如实留在 HANDOFF）

5. 耳：`ear_wid()` .058→.044、flare 1.30→1.20、t>0.88 半圆封顶
   （目标：宽 112mm、w/h .83、顶端 ~30mm；round-h 现状 116mm / 0.788 / 0.4mm 尖点）。
6. 瞳径：round-h 渲染瞳孔占虹膜目测 ~70%+（参考图 ~40%）。先判定 `v6_face_shape.py`
   是不是把虹膜当瞳孔（catchlight 咬内切圆）；是尺子问题修尺子，是瞳孔问题就改小。
7. 唇线：`V6_LIP` .98→.970 配 `V6_MUZZLE_GROW`≈.010；动唇线<b>之前</b>先在
   `v6_part_audit.py` 加「犬齿尖前皮肤厚度」审计（防 G2 露犬齿回归）。
   目标 lip_below_nose≈0.31E≈35mm（现 24.2mm）。

## 老规矩（违反任何一条都算失败）

- `build_lingxi_v5.py` 每层缩进一个空格；`LX_Fur_*` 必须 `hide_render=True`；
  颜色写 attribute 前过 `srgb_lin()`；`native_fur_lingxi_v5.py` 必须幂等。
- 量几何量真实顶点，不量 `bound_box`；量 clip 绝不直接给 rig 赋 action
  （`v6_clip_review.py` 靠烘焙 NLA strip，只 `frame_set()`）。
- 每次改脚本先 `py_compile` + 低采样 preview 快验，再跑 standard。
- 渲染链照抄 round-h 的 `run.sh`（build → native_fur → audit → clips → poses → views → faces），
  全部 knobs 记到 `round-i/knobs.txt`，管线日志进 `pipeline.out`。
- 代码改动分主题提交（爪 / 动作 / 脸 各自 commit），不整体 WIP 一把梭。
- 完成后在 `reviews/HANDOFF.md` 追加「round-i 交接」：改动清单、每项前后数字、
  遗留风险、给 WorkBuddy 的发布提示（换图归 WorkBuddy）。
- 渲染预计 1.5–2h，中间不用等确认，按本任务书自主推进。
