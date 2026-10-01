# WorkBuddy → Codex：嘴部动作 + 身体协调性/步态/比例 对比审计（round-i-check）

> 身份：**审计员，不是改代码的人**。
> 另一个 agent（Claude）正在改 `scripts/blender/build_lingxi_v5.py`，所以本任务
> **禁止修改任何已存在的文件**（含 build 脚本、审美脚本、发布页）。
> 允许新建的只有：`assets/characters/lingxi/v6/round-i-check/`（渲染/日志）
> 和 `reviews/compare/`（对比图 + 报告）。违反 = 任务失败。
> 结论写进 `reviews/compare/REPORT.md`；不要 commit（WorkBuddy 统一收）。

## 基线（不用重新 build，直接渲染）

- 现成模型：`assets/characters/lingxi/v6/round-h/lingxi-short-fur-rig-v5.blend`（round-h 代码状态）。
- 渲染链照抄 `assets/characters/lingxi/v6/round-h/run.sh` 里的 views / faces 段，
  输出改到 `round-i-check/`，knobs 记 `round-i-check/knobs.txt`（必须与 round-h 一致才能对比）。
- 参考图（判断对错的唯一依据）：
  - `assets/characters/lingxi/reference/turnaround-v1.png`（正面/侧面/背面趴姿）
  - `lingxi-ref-face-closeup.png`、`lingxi-ref-expressions.png`、`lingxi-ref-lick-paw.png`

## A. 嘴部动作：张嘴 / 牙齿 / 伸舌头（用户点名，最高优先）

对 Yawn、Bite、Lick、Happy、Curious 五个 clip 各渲一张**嘴部近景**（face 视角，
`V6_FACE_FOLLOW=1`，`V6_RES=900 V6_SAMPLES=128`，帧号从 `round-h/review-clips.json` 取该 clip
的 jaw_deg 最大帧 + 代表帧），并与参考图并排。

逐项判断（有数字、有结论，不许含糊）：
1. **张嘴（Yawn / Bite）**：下颌是不是绕下颌关节旋转（而不是平移/缩放）？张口角
   jaw_deg 与参考图张口幅度差多少？上下唇是否同步张开（上唇不动会像"掉下巴"）。
2. **牙齿**：上下齿列是否对齐（不对齐会像地包天/天包地）；牙齿是否浮在唇外、
   或埋进皮肤看不见（G2 的"露犬齿"回归要单独查：犬齿尖前面的皮肤厚度）；
   门齿/犬齿数量与参考是否一致。
3. **伸舌头（Lick）**：舌头是否从上下齿列之间伸出（不能穿出下颌、不能穿过脸颊）；
   伸出量 mm 与参考比；舌尖是否在舔爪动作里够到前爪（够不到/穿进爪里都算错）；
   舌色、牙龈色是否越界（不该有粉色块挂在唇外）。
4. 每个结论标 `错误 / 可疑 / 可接受`，并给出建议的修正方向和旋钮名（不要改代码）。

## B. 身体协调性、步态、身体比例

1. **步态（Walk / Run / Jump）**：四足相位是否成对角步态（LF→RH→RF→LH 交替，
   不能同侧同时腾空也不能四脚同时离地）；是否有**滑步**（支撑相脚掌相对地面的水平位移
   应≈0，超过 3mm 就是滑）；落地是否穿地（lowest_mm<0）或悬空（>3mm）。
   用 `scripts/lookdev-v6/v6_clip_review.py` 的数据 + 自探针（**只 `frame_set()`**，
   绝不给 rig 直接赋 action——烘焙 NLA strip 才是真姿态）。
2. **身体比例**：与 `turnaround-v1.png` 比：头长/身长、肩高/身长、前腿长/身长、
   胸深/肩高、尾长/身长。两个口径都给：① 真实顶点测量（**不要量 `bound_box`**，
   滚转/弯曲部件 AABB 会虚胖 50mm 以上）；② `scripts/blender/metrics_render.py`
   对渲染图的像素测量。两口径打架以①为准。
3. **协调性**：头-颈-肩在 Walk/Run 里是否跟着 root 起伏（头不动像滑行的毛球）；
   尾巴是否跟随身体转向（尾角滞后/甩鞭子都写清楚）；Jump 起跳-落地身体是否收放。

## C. 交付：对比图 + 报告

1. 所有对比图用 PIL 拼成**左右并排、同视角同比例、带标注线和数字**的 JPG，
   落在 `reviews/compare/`，命名 `A1-yawn.png`、`A2-bite.png`、`A3-lick.png`、
   `B1-gait-walk.png`、`B2-proportion.png` …（每个不超过 1200px 宽）。
2. 写 `reviews/compare/index.html`：一节一卡，图 + 数字 + 结论徽章（错误红/可疑黄/可接受绿），
   手机端 ≤700px 竖排。
3. 写 `reviews/compare/REPORT.md`：A/B 每项「现状数字 → 参考数字 → 结论 → 建议旋钮」，
   末尾给一句总体判断：**当前这版哪些是明确错误、哪些只是审美偏差**。

## 老规矩

- 量几何量真实顶点，不量 `bound_box`；量 clip 绝不直接赋 action，只 `frame_set()`。
- 新建探针脚本放 `scripts/lookdev-v6/` 下，命名 `v6_<主题>_audit.py`，不要改已有脚本。
- 渲染前后都把命令行与耗时记进 `round-i-check/pipeline.out`。
- 报告里的每个数字要能复现（写清楚用的哪个脚本、哪个帧、哪个部件名）。
