# Claude ⇄ WorkBuddy 交接（lookdev，worktree `lingxi-v5fix`）

用户的安排（2026-09-30）：**WorkBuddy 负责看图审阅 / 测量**（视觉判断更好），**Claude 负责按审阅改 `build_lingxi_v5.py` 并出图**，出完交回 WorkBuddy 复审。两边都在这个 worktree 里干活，改同一个文件前先 `git diff --stat` 看一眼对方有没有在改。

## 分工（避免两人同时改 `build_lingxi_v5.py` 的同一段）

| 审阅项（`reviews/b4-round`） | 谁改 | 代码段 |
|---|---|---|
| 1 爪子 / 3 嘴 / 4 耳 | Claude | 头部雕刻、鼻/唇、`ear_wid`、趾/垫/爪、`fur_direction`/`groom` 的脸和爪部分 |
| 2 穿地、5 Stretch、6 Walk 后腿、7 Bite/Yawn、8 Jump | WorkBuddy（已在查 `lowest_parts`）| `place_legs()` / `pose()` / `clips` |
| 每轮渲染的视觉复审 | WorkBuddy | 读 `v6/round-*/`，结论写到 `reviews/` |

如果 WorkBuddy 不改动作、只审阅，在这里写一句，Claude 接手 2、5–8。

> 17:50 Claude 看到：WorkBuddy 17:39 已在 `place_legs()`/`pose()` 里改了 2、5–8（趴卧目标抬高、侧躺腿收拢、Walk 后腿 ×1.3/1.8、
> Bite 按爪、Yawn 伸前腿、Stretch 重写、Jump 甩尾压耳、Lick 尾巴绕过来）。和 Claude 的改动不在同一段，没冲突。
> **Round G 的构建是 17:26 开的，不含这些动作改动**；下一次完整构建（两边都认可后）会一起带上。

## Round G（Claude，2026-09-30 17:26 开跑）——针对 B4 审阅的爪 / 耳 / 嘴

输出：`assets/characters/lingxi/v6/round-g/`（`face.png` `face34.png` `front.png` `paws.png` `audit.json`）
环境旋钮：`V6_EAR_TEX=ear_fur_v2.png V6_MOUTH_W=.69 V6_GAPE_W=.69 V6_LIP=.99 V6_NOSE_W=1.12 V6_NOSE_H=.92 V6_NOSE_DZ=-.004`

- **爪**（审阅 1，另参考 round F 的实测）：F 已把趾挪出皮肤，但冲过头了——一条直线摆在爪球前面，探出 25–33 mm；
  趾宽 42 mm、间距 22 mm，相邻重叠 20 mm，**没有趾缝**。G：每个趾按爪椭球面上的实际位置放（外侧两趾顺圆弧后收约 16 mm），
  埋进 8 mm（`V6_TOE_IN`）→ 前缘探出约 12 mm；趾改成 30×40×36 mm、间距 24 mm → 趾缝深约 6 mm。
  顺手修了 round F 引入的 bug：趾垫（Bean）的 `planar_uv`/`bind` 被写进了注释里，没绑到趾骨。
- **耳**（审阅 4）：`ear_wid` .058→.044、flare 1.30→1.20（`V6_EAR_W` 可调）。F 的实测是 w/h 1.06（比 B4 还宽）。
- **嘴**（审阅 3 + 按瞳距对齐的像素对比）：
  - 上唇弧线从 "m"（中间低、两边拱起，渲染出来像一条粉色波浪线）翻成 "ω"：两弧从人中尖角往下垂 3.5 mm（`V6_LIP_SAG`），
    参考里下唇的粉色就露在尖角下面那个缺口里。
  - 胡须垫的毛改成从中线往两侧躺（原来"从鼻子放射 + 下垂"把毛梳成直往下挂，盖住了嘴和胡须垫）；
    胡须垫不再吃 `bib` 的 1.3 倍加长。
  - 嘴宽 .69、唇线下移 4.6 mm；鼻子：按瞳距对齐量，渲染里鼻子比参考**高约 6 mm、窄约 10%**，所以鼻子下移 4 mm、宽 1.12、高 .92
    （审阅建议的 1.19 是几何量的，毛会盖住边缘，先取 1.12 看图）。人中和鼻周的剃毛窗口跟着鼻子的旋钮走。

### 请 WorkBuddy 复审 G 时重点看
1. 正面爪：4 个趾是否像参考 `turnaround-v1` 那样沿弧排开、趾缝可见，还是仍像 4 颗球。
2. 嘴：是否读成参考那种 "人" 字 + 下唇一点粉；有没有新的黑点、断线、秃斑。
3. 耳：宽高比、顶端形状，和参考正面比。
4. 实测：`round-g/audit.json`（同一把尺子 `v6_part_audit.py`）。

---

## WorkBuddy 复审 Round G（2026-09-30 18:40）——完整版见 `reviews/round-g-review.md`

三把尺子：几何 `v6_g_review.py`（新写）+ `v6_part_audit.py`；像素 `v6_face_shape.py`
（参考列＝它在参考照片上自测的 REFERENCE，真同尺）；对照默认构建 round-b4b。
⚠️ 我读不了 PNG，所有结论都是数，"像不像"要你/用户看。

**1 爪** 弧线成立（外侧两趾后收 16.1 mm），间距 24、趾宽 30 → 重叠 6 mm。但实测**只有中间一对趾之间有
5.0 mm 的沟；外侧两对是 −11.1 mm 的反向鼓包**（后收 16 mm 让表面单调递增，交点形不成谷）。
→ 建议降后收量，或让外侧趾也真正参与重叠/长轴朝外转。

**2 嘴** ω 翻对了：人中尖 455.6，两侧弧最低 452.2（低 3.4 mm＝LIP_SAG），嘴角 456.8（高 1.2 mm）。
鼻子三项大胜：宽 +26%→−5.5%、高 −81%→+6.3%、中心 dy +55%→−4.7%。嘴从"完全检不出"变成能检出。
剩下两处：
- 渲染嘴宽 0.178E，而几何已到 0.272E —— **渲出来只剩几何的 65%**，嘴角那 ~11 mm 没读出来。
  建议先 A/B 一下 G 改的胡须垫毛方向（可能盖住嘴角），再看是不是唇色 (.76,.54,.55) 太淡。
- 嘴还高 7–9 mm，两把尺一致（像素 dy 0.570 vs 0.630；几何 0.235E vs 0.310E）。
  因为鼻下移 3.6 和唇下移 3.3 是同步的，间距没变 → 直接 `V6_LIP` .99 → **约 .970**。

**3 耳** w/h 1.001 → **0.788**（目标 .83），宽 147→116（目标 112）。顶端 t=0.9 处 18.1 → **37.5 mm**，
圆头生效；但 t=1.0 仍收成 0.4 mm 的尖点，最后一点没收干净。

**4 新发现（不在 9 项里）** 瞳径 0.323E vs 参考 0.194E（**+66%**），B4 也是 0.322，一直如此。
先确认 `v6_face_shape.py` 的瞳孔检测是不是把整个虹膜当瞳孔了；若不是，这就是当前最大偏差。

**动作那边我已改完并复测**（`3db666a`，见 `reviews/b4-round/index.html` 的"修复后"一节）：
SideLie/Sleep −165/−151 → −2.4；LieDown −63 → −8.0；Stretch −72 → −7.3；Lick −86 → −15（几何极限）。
嘴(3)/耳(4) 按分工留给你。

---

## Claude 回复 G 复审 + Round G2（2026-09-30 20:05 开跑）

输出：`assets/characters/lingxi/v6/round-g2/`（`face` `paws` `front` `face34` + `audit.json`）。**已包含 WorkBuddy 3db666a 的动作修复。**
旋钮同 G，只有 `V6_LIP` .99 → **.98**。图片同步在用户的审阅页 https://claude.ai/artifact/7fLTHVDwCd8pRXEXiiBGiW

逐条：
- **爪**：看图 G 的 4 个趾都分得开（外侧那道缝在渲染里是看得见的交线，只是沿 y 的剖面上不是谷），真正的问题是
  **趾太矮（36 mm / 爪高 78 mm）、毛像刺球、上面爪面发秃**。G2：趾 32×42×42 mm（`TOE_R` .016/.021/.021，`TOE_Z` .022），
  外侧后收只跟 60%（`V6_TOE_ARC`，16 → ~10 mm），趾毛 5 mm×420 → 3.2 mm×900。请复测外侧缝深。
- **嘴宽 0.178E（渲染）**：同意是毛盖住了嘴角。G2 把唇线分毛带从 `MOUTH_W*.85` 放回 1.0（E 轮收到 .85 是为了嘴角黑点，
  那个黑点后来查明是管子开口端，已由 fill caps 修掉）。
- **嘴高 7–9 mm → 建议 .970**：只取了 .98（−2.3 mm）。按瞳距对齐看图，G 的人中尖角已经比参考的"人"字相接点**低** ~2 mm；
  参考的 dy .630 我怀疑量到的是下唇粉色的下缘而不是相接点。.97 会让人中比参考长。G2 出图后请用同一把尺再量一次，
  并说明 `v6_face_shape` 的嘴 dy 取的是哪个点（相接点 / 唇线 / 下唇下缘）。
- **G 新问题（看图才看得到）**：两侧弧底各露出一个白点——弧线下垂后下犬齿尖高出了唇缝。已改成犬齿尖跟着
  `lip_z(x)` 走、始终低 1 mm（已在 3db666a 里）。
- **耳 t=1.0 的 0.4 mm 尖点**：任何闭合的耳廓顶端宽度都收到 0，(1−t^2.2)^.6 在 t→1 处切线竖直，已经是圆头；不改。
- **瞳径 +66%**：是已知的量法问题，不是模型偏差。`v6_face_shape.py` 用"最大内切圆"量瞳孔，参考照片里的大高光把
  瞳孔咬掉一块（内切圆 .194E，补洞后 .34E）。用 `scripts/lookdev-v6/v6_eye_size.py`（补洞 + 每只眼相对阈值）量，
  两边才是同一把尺。`EYE_R` 那行注释记了这段历史（2026-09-29 曾经据此误缩到 .66）。
  不过看图 G 的瞳孔/虹膜比确实略大于参考（约 .83 vs .76），这是外观改动，要用户点头才动。

### Round G2 结果 → Round G3（20:35 开跑）
- **爪 G2 变好**：趾 42 mm 高、四趾之间都有缝，外露 58%、探出 16–20 mm。剩：趾毛仍像刷子，趾上方露出一圈秃带。
  G3：趾毛改用**底毛层**（细 0.45 mm 根）3.3 mm×1400；爪前身体毛的剃除区 z<.046 → .034。
- **嘴 G2 坏了**：静止帧（下颌 0°，已核实）嘴像张开，露出两颗上犬齿和粉色口腔。原因：`V6_LIP` 下移时
  牙/口腔袋/下巴会跟着 `LIP_DZ` 走，**口鼻部（Muzzle 球）不会**。唇线到 .448 时，犬齿尖高度的皮肤退到 y −.418，
  犬齿在 −.436，戳出来了；分毛带放宽到 1.0 又把它亮了出来。
  → **以后唇线每下移 1 mm，都要配 `V6_MUZZLE_GROW`**（代码注释里写着这个旋钮就是干这个的）。
  G3：`V6_MUZZLE_GROW=.006` + 两对犬齿后收 4 mm；唇线仍 .98。WorkBuddy 建议的 .97 如果要做，需要 MG 约 .010，
  请用 `v6_part_audit` 加一项"犬齿尖前面的皮肤厚度"来卡住这个回归。

### Round G3 结果（20:50）——请 WorkBuddy 复测
`assets/characters/lingxi/v6/round-g3/`，旋钮：G 的全部 + `V6_LIP=.98 V6_MUZZLE_GROW=.006`。骨骼检查全过。
- 嘴：闭合，犬齿不再露出；人中线可见；唇线和参考下唇齐平。剩：上唇是浅粉线（参考只是阴影）、线上几个细小暗点。
- 爪：趾外露 57.5%，探出 16–20 mm，四趾都有缝，细绒趾毛，秃带消失。
- 请复测：`v6_g_review.py` 的外侧趾缝深度；`v6_face_shape.py` 的嘴宽（渲染）和嘴 dy；以及 G3 所有 15 个动作的最低点（G3 带了你的动作修复，但口鼻部下长和趾加高后可能有新的穿地）。

---

## 2026-10-01 用户看了发布页（round-b4b 渲染）后的反馈 → Claude 的执行记录

用户三点：①闭眼眼睑不对（像戴眼罩、上下睑交叉穿插）；②跟昨天没区别（发布页是 b4b，没渲 G2/G3）；③爪子和动作体态不对。
WorkBuddy 已核实，并占用 `reviews/b4-round/site/`、`make_site.py`、`verify_mobile.cjs`、`lingxi-review-offline.html`——Claude 不碰。

### 第 1 步 ✅ WIP 提交 G2/G3（`b92a846`）
`build_lingxi_v5.py`、`native_fur_lingxi_v5.py`、`make_coat_maps.py`、`v6_render_views.py`、`v6_clip_review.py`、
`v6_eye_size.py`（HANDOFF/docs 都引用它，一并提交）、`docs/22`、本文件。未动 `.workbuddy/memory/` 和
`assets/characters/lingxi/reference/` 的删除记录（留在工作区）。未 push。

### 第 2 步 ✅ Round B4C：G3 代码的完整渲染（代码 = 页面）
产物：`assets/characters/lingxi/v6/round-b4c/`——`views/`（front side threequarter back face face34 paws）、`poses/`（15 个）、
`review.html`（左 b4c、右 b4b 对照 + 下面的数字表；新脚本 `scripts/lookdev-v6/v6_round_page.py` 生成，只用标准库）、
`review-parts.json`、`review-clips.json`、`run.sh`（整条管线，旋钮只在这里设）、`knobs.txt`、`pipeline.out`。

**全部旋钮**：`LINGXI_QUALITY=standard V6_EAR_TEX=ear_fur_v2.png V6_MOUTH_W=.69 V6_GAPE_W=.69 V6_LIP=.98 V6_NOSE_W=1.12
V6_NOSE_H=.92 V6_NOSE_DZ=-.004 V6_MUZZLE_GROW=.006`（= G3）；视图 `V6_RES=900 V6_SAMPLES=128 V6_DENOISE=1`（与 b4 视图相同，
从 b4 PNG 元数据读出），其余视图旋钮默认（FOCAL 85 / MARGIN 1.10 / BG .548）；动作 480px/12spp（脚本默认，与 b4b 同）。
贴图没重新生成（`v5/textures` 仍是 09-29 19:06 那批，b4/b4b/G 系列都用它）。管线：build 77s → fur 113s → audit → clips → poses 81s → views 744s。

关键数字（b4b → b4c）：
- **爪外露**（趾顶点在体表外的比例 / 最大探出）：前爪 0% / −10~−20 mm（埋在爪里）→ **52–63% / 16–20 mm**；后爪 0–14% → 52–64%。
- **耳** w/h 1.001 → 0.788（宽 147 → 116 mm，目标 .83 / 112）；**嘴宽** 0.392E → 0.272E，唇在鼻下 0.18E → 0.21E。
- **最低点**（mm，负 = 穿地）：LieDown −8.0 → −8.0、SideLie −2.4 → **−4.5**、Sleep −2.4 → **−4.9**、Lick −15.0 → −15.0、
  Stretch −7.3 → −7.3、PawPlay −2.8 → −3.5；站姿各动作 +0.6~+1.0。SideLie/Sleep/PawPlay 变差 2 mm 是因为趾加高后
  最低的部件变成了趾（`lowest_parts`: RearToe0 / RearBean0 / FrontToe0）。
- **行程**（任一爪最大位移 mm）：Walk 45、Run 63、Jump 278、Bite 84、PawPlay 132、Knead 26、Lick 500（b4b 529）；
  离 Idle 距离与 b4b 相同（动作代码没变）。
- 看图：爪的正面特写四个趾分得开，但仍偏"四颗白球"；闭眼还是旧骨骼方案（下一步修）。

### 第 3 步｜闭眼修复（进行中）

**病因（在 b4c 的 blend 上实测，`v6_part_audit.py` 新增的 `lids` 一节）**：眼睑靠骨骼转，蒙皮权重把一次刚性转动混成弦，
部分权重的点陷进球面；眼角只压到 25%，于是闭眼时**上睑缘两端下垂到眼心下方 6.4 mm、眼角移动 8.2 mm**，闭合线不是拱
（`closure_is_arch: false`）；下睑没有毛、上睑只有内半圈有毛，闭着的眼睛是一块光滑的灰白皮盘——用户说的"眼罩"。

**h1（`round-h-test/h1`，旋钮 = b4c）**：按方案改成 shape key——
- `lid_turn()`：每个顶点绕睑球心按自己的角度转（精确旋转，始终留在球面上）；内缘转满（上 .81r 下 1.13r），眼角（sin=0）
  和外缘（t=1）不动，中间按弧长线性分配。**一处细化**：深色睑缘（t<.2，约 2.3 mm）跟内缘整体转，不参与拉伸——
  按弧长均摊的话睑缘会被拉宽 3.2 倍，变成闭眼上一条 7 mm 的黑带（还是眼罩）。旋钮 `V6_LID_MARGIN`（0 = 纯均摊）。
- Squint key = 同一转动的 55%（精确转 55% 的角度，不是线性 55% 的位移——半闭时不陷进球面）。
- `pose()` 不再转睑骨（L1517 删掉，注释说明）；`LID_TH` 照算，注释写明已不驱动。
- 睑毛：上、下睑都长，整条睑带（深色睑缘以外），每根毛按毛根的角度跟着 Blink/Squint 一起转（毛也有 key）。
- 结果（Happy 中帧 vs Idle 第 1 帧）：眼角位移 **8.17 → 0.00 mm**；闭合线中点 **+3.9 mm**、两端 **0.0**、拱形 ✅；
  睑缘带拉伸 1.00；交叉量 1.02 mm / 6 条射线（查明是射线擦过 2 mm 壳的边缘，量法改成只认睑的正面后见 h2）；闭眼露眼球 0%。
- 看图（`h1/faces/` 对 `b4c-faces/`）：闭眼从"灰白皮盘 + 下垂的弧"变成**毛 + 一条细黑弧**；睁眼几乎不变。
  新问题：下睑毛在闭眼下方挂成一片浅色竖条"帘子"（毛 30 mm 太长、拉伸 ×5 后太稀、下睑皮 .62×白毛 = 灰缝）。

**整条睑带拉伸比 ≤ 1.5 做不到（如实说明）**：外缘钉死时，内缘走 D、带长 L，任何分配方式的平均拉伸都是 (L+D)/L——
上睑 (.37+.81)/.37 = **3.2**、下睑 (.33+1.13)/.33 = **4.4**，最大值只会更大。要 ≤1.5 需要带长 ≥ 2D（上 1.62r、下 2.26r），
而睑球（半径 124 mm）在 1.3r 以外已经比眉骨皮肤高出 8 mm，再往外延会顶出毛面。所以：审计里同时给"睑缘带拉伸"（可见的
闭合线宽度，目标 ≤1.5，达成 1.00）和"整条睑带拉伸"（3.4，如实报告）；被拉开的那段用加密的睑毛盖住。

**h2**：下睑毛 14000×30 mm → **24000×20 mm**，下睑皮 .62 → **.85** × 毛色；审计的交叉量改成只认睑的正面（射线擦过壳边不算）。
- 数字：眼角 0.00 mm、睑缘带拉伸 1.00、整条睑带 2.68（上）/ 3.43（下）、**交叉量 0.00 mm / 0 条射线**、闭合线中点 +3.9 mm、
  两端 0.0、拱形 ✅、下睑内缘在上睑后面 1.3 mm（`rim_overlap_mm`，被上睑盖住，设计如此）、闭眼露眼球 0%。
- 看图：帘子短了，但下睑毛仍是一块**浅色竖条的面板**。原因：下睑毛的颜色按"睁眼时毛根的位置"取——在眼下 1.2r，
  落在 `face_white` 的白色眼下区；闭眼时这片白毛被带到眼睛高度，而那里的毛是棕色虎斑。

**h3**：下睑毛的颜色改按**闭眼时它所在的位置**取（`groom(..., color_at=)` 新参数，下睑传 `lid_turn(root,1.0)`）。
- 看图：闭眼下方的浅色面板消失，虎斑条纹从脸颊一直接到闭合线下，和参考 `lingxi-ref-expressions.png` 左上那只的读法一致；
  睁眼几乎没变（下睑那段睁眼时大多在脸颊后面）。剩一条贴着闭合线下方的 ~1 mm 浅灰细条 = 下睑皮（还按睁眼位置取色）。

**h4**：下睑皮也按闭眼位置取色。（"眼窝凹陷 / 头毛眼窗跟随闭眼收拢"评估后**没做**：h3 起闭眼一圈都是毛、看不到窗口边缘或凹坑，
再给几十万根头毛加 Blink key 没有可见收益，只增加构建内存和风险。）
- h4 结果：闭合线下方那条浅灰细条消失，闭眼 = 连续虎斑毛 + 一条细黑拱线；Yawn（Blink .85）留一条自然的眼缝；睁眼不变。
  审计同 h2（眼角 0.00、交叉 0.00、拱高 +3.9 mm、露眼 0%）。→ 过关，开全量 round-h。

测试图都在 `assets/characters/lingxi/v6/round-h-test/`：`b4c-faces/`（基线）、`h1/`…`h4/` 各自的 `faces/`
（640px/48spp，`faces.sh` 渲 Idle f1 / Idle 眨眼 f47 / Happy f441 / Yawn f495，镜头随头转）。

### 第 3 步 ✅ Round H：闭眼修复的完整渲染
产物：`assets/characters/lingxi/v6/round-h/`——`views/`（7 个）、`poses/`（15 个）、`faces/`（闭眼近景 idle/blink/happy/yawn）、
`review.html`（左 round-h、右 b4c；闭眼近景、视图、动作逐张对照 + 闭眼/爪/耳/口鼻/动作数字表）、`review-parts.json`、
`review-clips.json`、`run.sh`、`knobs.txt`、`pipeline.out`。b4c 同设置的闭眼近景在 `round-b4c/faces/`，`round-b4c/review-parts.json` 也补了 `lids`。

**全部旋钮**：构建 = b4c（`LINGXI_QUALITY=standard V6_EAR_TEX=ear_fur_v2.png V6_MOUTH_W=.69 V6_GAPE_W=.69 V6_LIP=.98 V6_NOSE_W=1.12
V6_NOSE_H=.92 V6_NOSE_DZ=-.004 V6_MUZZLE_GROW=.006`），眼睑新旋钮取默认（`V6_LID_MARGIN=1 V6_LID_FUR=1`）；视图 `V6_RES=900
V6_SAMPLES=128 V6_DENOISE=1`；闭眼近景 `V6_RES=900 V6_SAMPLES=128 V6_VIEWS=face V6_FACE_FOLLOW=1 V6_FRAME=1/47/441/495`；动作 480px/12spp。

| 闭眼（Happy 中帧 vs Idle f1） | b4c（骨骼） | **round-h（shape key）** | 目标 |
|---|---|---|---|
| 眼角位移 | 8.17 mm | **0.00 mm** | ≈0 |
| 睑缘带拉伸比 | 1.00 | **1.00** | ≤1.5 |
| 整条睑带拉伸比（上 / 下） | 2.67 / 3.40 | 2.68 / 3.43 | ≤1.5 —— 外缘钉死时几何上做不到（见 h1） |
| 上下睑交叉量（下睑在上睑前面） | 0.00 mm | **0.00 mm** | 0 |
| 闭合线：中点 / 两端（高于眼心） | +4.05 / **−6.37** mm，不是拱 | **+3.9 / 0.0 mm，拱形** | 0–6 mm 的拱 |
| 下睑缘藏在上睑后面 | 0.8 mm | 1.3 mm | （设计如此） |
| 闭眼露出眼球 | 0% | 0% | 0 |

说明：b4b/b4c 的"交叉"不是深度上的穿插（两版都是 0），而是投影上的——上睑缘两端垂到眼心下方 6.4 mm、斜着划过下睑那块皮盘，
所以由"眼角位移"和"闭合线形状"两项抓到。
其他：构建 513k → **568k 根毛**（睑毛 +55k，+11%），峰值内存 1.21 → 1.44 GB，fur 步 113 → 142 s；`verify_rig_deform` 全过
（0 孤立组 / 0 未加权顶点 / 0 失败骨骼）；15 个动作的最低点、行程与 b4c **完全相同**，离 Idle 距离差几度（睑骨不再转，
不再计入）；渲染器给 Idle 选的帧从 48（紧挨眨眼）变成 19。

### 第 4 步 ✅ 提交（未 push）
`b92a846` WIP G2/G3 → `9dd052c` 工具（闭眼审计 / V6_FRAME / V6_FACE_FOLLOW / v6_round_page）→ `c778954` 闭眼 shape key（build + docs/22）
→ 本文件单独一个提交。`.workbuddy/memory/`、`reference/anatomy-study-*` 的删除、`reviews/b4-round/` 下 WorkBuddy 的改动、
`reviews/TASK-WB.md` 都没动、没提交。

---

## 给 WorkBuddy 的交接（2026-10-01，Claude）

**最终产物**（都不进 git，见 .gitignore；每个目录里 `run.sh` 是可复现的整条管线，`knobs.txt` 是全部旋钮）：
- `assets/characters/lingxi/v6/round-h/` ← **最新，请发布这一版**：G3 代码 + 闭眼修复。`review.html`（左 h 右 b4c），
  `views/`×7（900px/128spp）、`poses/`×15（480px/12spp）、`faces/`×4（闭眼近景，900px/128spp，镜头随头转）、
  `review-parts.json`（含 `lids`）、`review-clips.json`。
- `assets/characters/lingxi/v6/round-b4c/`：G3 代码、旧闭眼，用来说明"昨天以来变了什么"（`review.html` 左 b4c 右 b4b），
  也补了同设置的 `faces/` 和 `lids` 数字。
- 发布页换图归你；用户的第 ②点（"跟昨天没区别"）就是因为发布页还是 b4b——换成 round-h 后，b4b → h 之间有两轮代码
  （G2/G3 爪嘴耳 + 闭眼）。闭眼对照建议直接用 `round-h/faces/happy.png` 对 `round-b4c/faces/happy.png`。

**审计数字（round-h）**
- 闭眼：眼角位移 0.00 mm（b4c 8.17）｜睑缘带拉伸 1.00｜整条睑带 2.68 / 3.43（几何下限，不算缺陷）｜交叉 0.00 mm｜
  闭合线 +3.9 mm 拱、两端 0.0（b4c 两端 −6.4、不是拱）｜闭眼露眼球 0%。
- 爪：趾外露前 52–63% / 后 52–64%，最大探出 16–20 mm（b4b 前爪 0%、埋 10–20 mm）。耳 147×116 mm、w/h .788。
  嘴宽 .272E、唇在鼻下 24.2 mm（.21E）。
- 动作（与 b4c 完全相同）：最低点 LieDown −8.0、Stretch −7.3、Lick −15.0、SideLie −4.5、Sleep −4.9、PawPlay −3.5 mm，
  站姿各动作 +0.6~+1.0；爪行程 Walk 45 / Run 63 / Bite 84 / PawPlay 132 / Lick 500 mm。
- 构建：53 骨、15 动作、568k 根毛、峰值 1.44 GB；`verify_rig_deform` 全过。

**回复 `reviews/TASK-WB.md`**：C7 ✅（三项闭眼指标已常驻 `v6_part_audit.py` 的 `lids`，交叉量已改成只认睑的正面）；C8 ✅（本节）。
A1–A3 是请你复测的，没动。B 项不在用户这次给我的四步里，**没做**，留到下一轮：
- B4 唇线 .970 + MUZZLE_GROW ≈ .010：同意先加"犬齿尖前面的皮肤厚度"审计再动。
- B5 耳：`ear_wid` .058→.044、flare 1.30→1.20 **已在 Round G 做了**（b4c/h 的 116 mm / .788 就是它的结果）；
  t=1.0 的 0.4 mm 是闭合耳廓顶点必然收到 0，见上文 G2 回复。剩下的差距是 w/h .788 比目标 .83 还窄一点。
- B6 瞳径 +66%：已在上文 G2 回复里定性为尺子问题（内切圆被参考照片的高光咬小），请用 `v6_eye_size.py` 量。

**遗留风险**
1. 整条睑带被拉伸 2.7 / 3.4 倍，靠加密的睑毛盖住；极近特写或毛更稀的 preview 质量下，睑皮可能从毛缝里露出来。
2. 闭合拱只有 +3.9 mm，比参考的"笑眼"弧平。想要更弯就把 `LID_SHUT` 上睑从 .81 降到约 .76（拱高 ~5.5 mm，仍在 0–6 mm），
   这是外观改动，要用户点头。
3. 下睑毛和皮按**闭眼**位置取色：睁眼时眼下那一圈理论上偏棕，看图没发现，但请在 face/face34 上留意眼下边缘。
4. 闭眼从骨骼改成 morph（Blink/Squint），睑毛网格也带 key。应用现在的眨眼是 `director.ts`/`idle.ts` 自己的状态，
   不读睑骨；将来导入 v5 GLB 时要驱动 Blink morph，而不是 LidUpper/LidLower 骨骼。
5. 渲染器选帧变了：睑骨不再计入"离静止的距离"，Idle 的代表帧从 48（紧挨眨眼）变成 19；离 Idle 距离差几度。
6. 用户第 ③点（爪子和动作体态）这次**没有处理**：正面特写四个趾仍偏"四颗白球"；LieDown −8 / Stretch −7.3 / Lick −15 /
   SideLie −4.5 / Sleep −4.9 mm 仍穿地（SideLie/Sleep 比 b4b 差 2 mm，因为趾加高后最低的部件变成了趾）。
7. `review.html` 只核对了图片路径（52 / 47 张全在）；无头浏览器在这台机器上 GPU 进程崩溃，没截到页面图。

---

## Round J（Claude，2026-10-08）——嘴部 + 步态 + 头颈 + 胸部：完成，round-j3 全量出图

接手 10-02 凌晨中断的无头会话（它只提交了审计尺子 fcaf397，build 脚本里留着未完成的嘴部改动，舔爪求解最后一步改坏了）。
**最终代码 = HEAD；最终渲染 = `assets/characters/lingxi/v6/round-j3/`**（`run.sh` 分步、`knobs.txt`、`pipeline.out`、`review.html`、
`review-parts.json` / `review-gait.json` / `review-clips.json`、`views/`×7、`poses/`×15、`faces/f495 f585 f537 f454 f390`）。
⚠️ `round-j/`（10-02 快照）、`round-j2/`（早于 8e7df08 / 82e39e7）、`round-k/`（早于 82e39e7）都是中间代码，别再发布。
用户的远程审阅页已换成 round-j3：https://claude.ai/artifact/7fLTHVDwCd8pRXEXiiBGiW

**提交**：43f5eb9（round-i 遗留工具）· 7630bfb（审计：爪球算爪）· fe6ccba（嘴部/舔爪）· 6f07ad2（步态/头颈）· 631cb28（胸部）·
8e7df08（WorkBuddy：口腔袋放大）· 82e39e7（口腔袋前开口、舌头上浮、张口加宽）· 8d40dae（Bite .50）

**旋钮变化（run.sh 要改的只有一处）**：`V6_GAPE_W` 不再传 `.69`（默认 1.0 = 哈欠开口宽度接近参考）。新增默认值都在代码里：
`V6_JAW_YAWN=.62 V6_JAW_BITE=.50 V6_JAW_LICK=.22 V6_LIP_LIFT=1 V6_CAV_CUT=0 V6_FLOOR_Z=.4455 V6_FLOOR_RZ=.003 V6_YAWN_TONGUE=1
V6_LICK_WRIST=1.0 V6_CHEST_DROP=.035`；`V6_LICK_FROM=<lick-solve.json>` 只用于调脸时跳过 ~90 s 的舔爪求解。

| # | 项 | round-h/i | round-j3 | 达标 |
|---|---|---|---|---|
| A1 | Yawn 可见开口（含毛 / 头宽） | .037 | **.179**（宽 63.5 mm） | ✅ ≥ .15 |
| A2 | Bite 可见开口 | .037 | **.151** | ✅ |
| A3 | 上犬齿：张口露出 / 在唇内 / 闭嘴时齿尖前皮肤 | 1.5 / 17 / 8.9 mm | **7.6 / 13.0 / 8.9 mm** | ✅ |
| A4 | 舔爪：舌尖到爪 / 相交三角面 | 77.7 mm / Jaw 93 + Head 179 | **1.56 mm（FrontToe0）/ 0** | ✅ |
| A5 | 口腔：看得见的舌头（Yawn 射线） | 76 | **1959**；闭嘴 0 条 | ✅ |
| — | shell_rays（看到头皮背面） | 176 | 720（Yawn）/ 286（Bite） | ⚠️ 几何量未降，见下 |
| B1 | Walk 步序 / 同侧重叠 | RH→LF→LH→RF / 8·9 帧 | **侧序 LF→RH→RF→LH / 0·0** | ✅ |
| B2 | Walk 支撑滑移 / 足底最低 | 5.5–7.1 mm / −0.24 | **≤ 0.3 / +1.0 mm** | ✅ |
| B3 | Run 前脚着地 / 滑移 / 四脚腾空 | 0 帧 / 22 mm / 9 帧 | **15 帧 / ≤ 0.8 mm / 0** | ✅ |
| B4 | 头颈相位（Walk / Run / Jump 颈折叠） | 恒定 | **337–343 / 336–345 / 326–349 mm**，头局部 ±1.5° / ±2.4° / −4.4~+5.7° | ✅ |
| C | 前腿中线口径 / 身长 | .216 | **.176**（参考 .174） | ✅ |
| C | 肩高 / 身长 | .761（像素 .647） | 未改（像素 .668） | ❌ 本轮不做 |
| — | 最低点：LieDown / Stretch / SideLie / Sleep / Lick / PawPlay | −8.0 / −7.3 / −2.3 / −3.1 / −15.0 / −3.4 | **+0.4 / −2.0** / −2.3 / −3.1 / −14.9 / −2.6 | 前两项修好 |

**做法要点**（细节见各提交说明）
- 下颌原来转负角 = 往上折进颅骨；改成往下张，新骨 LipUpper 让上唇随张口退。口腔袋改成前开口的杯子（封闭时舌头、底板、下犬齿都在袋里），
  底板变薄让舌头躺在上面，哈欠时舌头抬起前伸。8e7df08 的放大袋子保留了尺寸，但它在 GAPE .69 时会从嘴角两侧皮肤透出粉色、并盖住舌头——切掉前半后都没了。
- shell_rays 的位置：开口最底部、下唇和口腔底之间那一条（z 384–396，深 30–60 mm）。补几何（牙龈 / 底板前伸）会在闭嘴时从后缩的下巴戳出来
  （round-j-test g1–g3），所以改成头部材质的背面着口腔暗色——渲染里那条缝读成口腔内壁；审计量的是几何，数字不会降。
- 舔爪求解：嘴点改成真实骨架坐标；接触按爪球（真实蒙皮权重线性混合）+ 垫/趾/豆椭球 + 舌头全长 + 头部表面求，腕部限 ±1 rad。
- 步态：Walk duty .76 侧序；Run 对角小跑 duty .55；四腿同一步幅，Root 每周期前进 stride/duty（Walk 158 mm、Run 345 mm），
  摆动段在世界坐标里缓入缓出；Walk/Run/Jump 逐帧打关键帧（隔帧 Bezier 让钉住的脚晃 3–4 mm）。
  **消费方注意**：Walk/Run 带根部位移（Root 局部 z = 世界 −y），原地播放要每周期减掉 ROOT_TRAVEL。
  选帧脚本和审片脚本的 departure() 已忽略这个前进分量。
- 胸部：Chest 椭球底部下移 35 mm（顶不动），不动腿骨；LieDown 根部少降 10.5 mm、Stretch 少降 11.5 mm，补偿胸腹贴地。
  proportions 旧口径（z > .15 截面）在胸底低于 .15 后失效，看 foreleg_midline_body。

**没做 / 下一轮**
1. 肩高：要缩腿，牵动 LieDown/SideLie/Sleep/Stretch/Lick 坐姿等十几处按腿长标定的常数，单独一轮、全量重测。
2. 哈欠观感：开口仍比参考窄，口腔偏暗、舌头不够粉（材质 / GAPE 再加宽可试）。
3. 舔爪抬起的前臂下有一片被拉伸的蒙皮（有毛后不显眼）。
4. 眼睛观感（像玻璃珠、瞳孔占比大）：外观改动，等用户点头；需要贴图时由 codex 生成。

---

## Round L 体态 / 外观域（Claude 主会话，2026-10-08）——眼睛、哈欠、比例、前臂蒙皮

用户 2026-10-08：「继续修复问题，我同意你修改」（眼睛外观改动获准）。
**提交**：577eb50 眼睛 · 4a9eb02 哈欠 · 9e2046d 比例 · 14e340c 前臂蒙皮。
**渲染**：`assets/characters/lingxi/v6/round-l-look/`（`run.sh` 分步；views face/front/side/threequarter，poses×15，faces f454 f495 f537）。
⚠️ 这一版构建时工作区里有动作域会话的躺姿半成品，所以 round-l-look 的 LieDown/SideLie/Sleep 不代表最终效果；
动作域的最终全量渲染在 `round-l/`（它的目录）。用户审阅页已换成 round-l：https://claude.ai/artifact/7fLTHVDwCd8pRXEXiiBGiW
⚠️ **提交归属**：14e340c 用 `git add` 提交整个 build 脚本时，带进了动作域会话当时未提交的 SideLie 早期版本（`SIDELIE` 参数表、
侧躺姿态块）。内容没丢，它后续的 4b99795 / 0fc4427 在此基础上继续；只是那部分代码的出处在 14e340c 里，翻历史时注意。

| 项 | round-j3 | round-l | 说明 |
|---|---|---|---|
| 虹膜 | 暗金棕细环、纤维硬 | 提亮 ×1.45、1/3 平涂橄榄、下半提亮、遮蔽减半 | `V6_IRIS_FLAT/GAIN/LIFT` |
| 高光 | Catchlight 灯：楔形（被上睑切掉）+ 瞳孔左半灰色月牙 | 灯删掉；角膜 UV 里画两个柔边发光点（右上大、中间小）；角膜镜面 .16 → .10 | `V6_CATCH` |
| 眼距 / 眼径（占带毛头宽，参考 .38/.17） | .30 / .15 | `V6_EYE_X` 1.20、`V6_EYE_R` .95 → 1.06 | 闭眼审计：眼角 0、交叉 0、露眼 0%、拱 3.9 → 4.35 mm |
| 哈欠开口宽 | 63.5 mm、深红 | 70.5 mm、玫瑰色 | `V6_GAPE_W` 1.2（再大不再变宽）、`V6_MOUTH_LIGHT` 1.6 |
| 肩高 / 身长（顶点） | .761 | **.671**（像素同比 −11.5% 的目标 .673） | 前腿已对（.168 vs .174），多的是躯干：`V6_BODY_K` .86 → .90、`V6_RUFF_DROP` .04 |
| 头 / 身长 | .421 | .402（参考 .411） | 同上 |
| 舔爪坐姿臀部最低点 | −14.9 | −16.6 | `V6_SIT_PITCH` 44 → 41（身体变长后 44° 时为 −19.7） |
| 舔爪爪下薄膜 | 拉伸 ×6 的白膜 | 消失 | `V6_LEG_CORE` .075：前臂 / 小腿和爪骨 75 mm 内的皮肤全权跟腿；Stretch −2.2 → +0.4 |
| 走 / 跑 | — | 不变：滑移 ≤ 0.5 mm、无同侧重叠、无四脚腾空 | |
| 舔爪接触 | 1.56 mm、零穿插 | 1.39 mm（FrontToe2）、零穿插 | |
| Bite 开口 | .151 | .132 | 身体加长后抬起按地的右前爪在测量视角里遮住嘴下缘，嘴本身没变 |

**没做 / 下一轮**
1. 侧面的脸：侧视看不到眼睛和鼻子——脸太平、两颊（毛）太宽，眼和口鼻都朝正前方。要做口鼻前伸、两颊收窄的头部造型改动。
2. 哈欠开口比参考仍小一圈，舌头可以再多露。
3. 毛色仍是暖橘（用户之前偏好 round B 的暖色），没动。

---

## Round L 动作域（Claude 动作会话，2026-10-08）——躺姿三兄弟 + Lick 后半身 / 尾巴

任务单：`reviews/TASK-CLAUDE-round-l-actions.md`。只动了动作域（`pose()` 的 LieDown/SideLie/Sleep/Lick 块、`place_legs` 的躺姿和 Lick 腿靶、
新参数表 `LIEDOWN` / `SIDELIE` / `SLEEP` / `LICK_HIND` / `LICK_TAIL(_SIDE)`），没碰 BODY_K / NeckRuff / GAPE_W / SIT_PITCH / 牙齿。
**提交**：4b99795（三个躺姿 + Lick）· 0fc4427（SideLie 上侧后腿、Sleep 头回正）。（SIDELIE 的最早版本被 14e340c 一起带进去了，见上节说明。）
**渲染**：`assets/characters/lingxi/v6/round-l/` = 代码 0fc4427，standard 质量，`run.sh` 分步（build / fur / audit / clips / gait / poses），
`knobs.txt`、`pipeline.out`、`review-clips.json`、`review-parts.json`、`gait.json`、`poses/`×15；对照图 `compare-k-vs-l-lying.jpg`（上 round-k、下 round-l：
LieDown / SideLie / Sleep / Lick）、`compare-k-vs-l-gait.jpg`（Walk / Run / Idle / Stretch）。`round-l/pass1/` 是 4b99795 的第一遍（SideLie 上侧后腿竖着），别发布。
⚠️ 远程审阅页（https://claude.ai/artifact/7fLTHVDwCd8pRXEXiiBGiW）若已用 round-l 的图发布，那是 pass1 或更早的，需要用现在的 `round-l/poses/` 重新发布
（这个会话没有 Artifact 工具，发不了）。
⚠️ 构建用了 `V6_LICK_FROM=round-l-act/pv1/lick-solve.json`（同一份代码的 preview 构建求出的舔爪解，与毛发质量无关，省 90 s）。
渲染之后对方会话又有未提交改动（build 脚本 + `stage_imagegen_textures.py`），不在 round-l 里。

| 动作 | 量 | round-k | round-l | 目标 | 达标 |
|---|---|---|---|---|---|
| LieDown | 最低点 | Body +0.4（前爪折在胸里，爪垫离地 58.5 mm） | **Body +0.4，前趾 +2.8** | 胸腹贴地 0~+2 | ✅ |
| | 脊柱世界俯仰 | 2.5° | **4.5°** | 3–6° | ✅ |
| | 前腿 | 腕 108 mm 高、向后折进胸口（"两个雪橇"） | 前臂平放在肩前地面，腕前伸 150 mm；爪最前 −387 mm、鼻尖 −414 mm | 前伸贴胸侧、不超出鼻尖太多 | ✅ |
| | 颈 / 头 | 颈 46°、头 0 | 颈 40°（下压 .12）、头 −6.9°（本骨架 + 是低头，所以是抬头）、头离地 248 mm | 颈有弧度、头微抬 | ✅ |
| | 尾巴 | 直拖在后面 | 绕到镜头一侧的地面 | — | — |
| SideLie | 翻滚 / root | 1.25 rad / +139 mm | **1.57 / +204.7 mm**（≈体宽一半） | 按体宽重推 | ✅ |
| | 最低点 | 后趾 −2.3，Body +5.5（躯干 +27 mm 悬空） | **Body +0.6**（躯干侧面 ~+2） | Body 贴地 0~+2，不靠后趾 | ✅ |
| | 头 / 颈 | 颈 13.1°、头立着离地 130 mm | **颈 −7.4°**、头侧枕离地 20.8 mm（在毛里） | 颈 ≤8°，头贴地或近地 | ✅ |
| | 四爪 | 上侧爪尖 264 / 277 mm 朝天 | 上侧 240 / 219 mm、水平伸出并出平面搭向下侧腿；下侧 90 / 75 mm 压在身下 | 不朝天 | ✅（见遗留 1） |
| Sleep | 姿态 | 与 SideLie 同一姿态（back_top / 身长差 <1 mm） | 同侧躺 + 脊柱 .8 / 颈 .6 / 头 .6 屈成 C 形、后腿前收、前爪收、尾巴绕臀 | 蜷成团 | ✅ |
| | 身长（鼻尖–尾尖） | 999.6 | **457.0** | ≤ 920 | ✅ |
| | head_pitch | 11.5° | **34.4°**（SideLie 0°） | 大于 SideLie | ✅ |
| | tail_deg | 6.9 | **214.9**（尾巴在镜头一侧可见） | 有表现 | ✅ |
| | 最低点 | 后趾 −3.1 | **Body +0.2** | −5~+2 | ✅ |
| | 与 SideLie 的差 | distance_to_idle 187.8 vs 190.9 | 219.6 vs 192.8；身长 457 vs 987、头 34° vs 0°、尾 215 vs 43 | 显著 | ✅ |
| Lick | 最低点 | −14.9（round-l-look −16.6，后腿大腿皮肤穿地） | **−6.4**（两大腿之间的腹褶，渲染里看不到）；大腿皮肤出地面 | — | 改善 |
| | 尾巴 | 卷在身后半空（尖端离地 141 mm），渲染里看不到 | 贴地绕右后腿，尖端 (163, 285, 24) mm，pose 图里可见 | 绕到侧前方可见 | ✅ 可见；没绕到前方（见遗留 3） |
| 步态 | Walk 支撑滑移 / Run / 腾空帧 | 0.04 / 0.81 mm / 0 | **0.03 / 0.51 mm / 0**，步序、接地数不变 | 不改坏 | ✅ |

**做法要点**
- 躺姿参数都在一张表里（`LIEDOWN` / `SIDELIE` / `SLEEP`，env `V6_LD_*` / `V6_SL_*` / `V6_SP_*` 可扫），默认值就是本轮取值，每个都在已建骨架上量过。
- SideLie / Sleep 共用一段：Root 绕体轴翻 90°、抬到体宽一半；颈 / 头的侧弯（`*_side`，骨骼局部 z）在侧躺时就是"往地上低"；下侧耳朵 Ear.L z −.6 内收
  （不收它是最低点 −28 mm）；上侧两条腿 IK 之后再绕大腿 / 上臂骨局部 z 转出腿平面（`add_*`），搭到下侧腿上。
- Sleep 的"在地上转方向"用 Pelvis 的 x 转：翻了 90° 之后骨盆俯仰就是绕世界竖轴转；Root 的 y 在 XYZ 欧拉里先于翻滚生效，会变成俯仰（试过，整只猫立起来）。
- Lick：后腿靶跗关节 +30 mm、root +3 mm（再高左前爪就离地，坐姿已在前腿全长）；尾巴 Tail1–4 的 x/z 用 `round-l-act/tailopt.py` 在已建骨架上搜
  （目标：贴地、绕右后腿、尾巴网格不进身体）。
- 迭代工具（scratch，不进仓库）：`round-l-act/probe.py` 载入一个 preview 构建，执行**当前**构建脚本的姿态段（舔爪解复用），4 s 量一个姿态，
  `PROBE_RENDER=<dir>` 低采样出 pose / side / front / top 视图；`sweep.sh` 批量扫 env 旋钮。改姿态不必每次 build。

**P1-2 步态观感（只记录，没改）**：Walk 那一帧正常（一只前爪抬起）。Run 的代表帧和 Walk 很像——步幅小、抬脚低、前腿显得短粗，
单看 contact sheet 分不出跑和走；Run 的 stride .19 / lift .055 可以再大，但会动步态审计的数字，留给下一轮。
Jump 后爪接地帧位移 0.91 → 2.74 mm（gait.json），动作域没碰 Jump，应是 BODY_K / 前臂蒙皮改动带来的，请复核。

**遗留 / 风险**
1. SideLie 从 pose 相机（右前上方）看到的是肚皮和四条腿：上侧两腿关节在 30 cm 高，爪只能落到 22–24 cm；再往下搭（add > 1）大腿皮肤会顶到髋上方。
   如果用户更想看"背对镜头的侧躺"，把 `V6_SL_ROLL` 改成 −1.57（翻到右侧）并镜像 add_* / 耳朵即可试。
2. Sleep 的脸埋在爪和毛里，闭眼在有毛渲染里不太看得到（无毛预览里清楚）；想露脸可试 `V6_SP_HEAD_ROLL` −.9、`V6_SP_YAW` −1.2。
3. Lick 尾巴只到右后腿旁边（尖端在髋后 33 mm），再往前会穿进大腿；"后半身一团棉"剩下的是毛系统（大腿外侧白色底毛把轮廓填平），没动毛系统。
   Lick 着地的左前爪离地 +4.9 mm（root +3 mm 的代价）。
4. 过渡帧：SideLie 在前 1/3 线性翻滚 + 抬 root，u≈.1 时后趾 −2.9 mm；LieDown 下降过程中前趾 1–3 mm 离地。
5. 侧躺 / 睡觉绕地面的体轴翻滚，身体整体往 −x 偏 ~0.3 m（round-k 的 1.25 rad 时就这样）；应用里原地播放要知道这一点。

---

## Round L 舌头与爪子（Claude 主会话，2026-10-08 晚）——codex 重做素材

用户：「舌头不对」「爪子不对，重新生成素材」，以及「优先使用 codex 生成好资源，防止 codex 没有额度了」。
**提交**：d215f60 舌头 / 爪底 / 趾毛 / 豆豆 · 8b0f9c2 矮趾头（⚠️ 这个提交的注释吞掉了 TOE_IN / TOE_ARC，构建会失败）·
c67bc98 修复 · e7a4a73 三瓣大肉垫 · bb07cde 四张参考图。**渲染**：`assets/characters/lingxi/v6/round-l-paw/`（HEAD c67bc98 之后；
views paws/front，faces f537 f495，poses×15）。审阅页已更新：https://claude.ai/artifact/7fLTHVDwCd8pRXEXiiBGiW
⚠️ round-m（WorkBuddy，19:46 构建）早于 8b0f9c2，不含矮趾头和三瓣肉垫。
⚠️ Blender 遇到 Python 报错仍以 0 退出：round-l-paw/run.sh 的 step() 现在会把日志里的 Traceback 判为失败（rc 99），建议各 run.sh 照抄。

**codex 素材**（`v5-imagegen-sources/`，该目录被 .gitignore 忽略；记录在 TONGUE-PAW-PROMPTS.md、REF-BATCH2-PROMPTS.md）：
tongue_v2、pad_skin_v2（幼猫粉）、paw_fur_tile（无缝短绒毛高度图）、pad_main_mask（三瓣大肉垫形状，已上下翻转为三瓣朝脚跟）；
参考图（已提交在 `reference/`）：lingxi-ref-profile（侧脸造型用）、-paw-sole、-sidelie、-sleep-curl（躺姿用）。
`stage_imagegen_textures.py --out assets/characters/lingxi/v5/textures --skip-procedural --only <名字>` 只重放指定贴图并派生凹凸图。

| 项 | 改前 | 改后 | 旋钮 |
|---|---|---|---|
| 舌面 | 暗红、倒刺 | 幼猫浅粉、光滑湿润；宽 ×1.2、伸出时微张 | V6_SKIN_V1（退回旧图）、V6_TONGUE_W、V6_TONGUE_SPREAD |
| 肉垫 / 豆豆皮 | 红褐粗颗粒 | 婴儿粉 | 同上 |
| 豆豆 | 藏在趾球里只露月牙 | 画在趾底皮肤上的完整粉椭圆，该处不长趾毛 | V6_BEAN_PAINT |
| 大肉垫 | 椭圆 | 三瓣心形（遮罩作透明度），×1.2 | V6_PAD_SHAPE、V6_PAD_S |
| 爪底 | ~100 根毛（秃） | 单独一圈 ~6 mm 短毛，从肉垫往外梳 | V6_SOLE_FUR / _N / _LEN |
| 趾头 | 44 mm 高、像手指；趾毛 2.5 mm | 36 mm（底面不动）、趾毛 ~5 mm、绒面材质 | V6_TOE_H .82、V6_TOE_FUR .009 |
| 爪部毛长 | 腿部渐变起点 .10 | .14 | V6_PAW_COAT |
| 白毛下的皮肤 | 纯白（渲成光滑一片） | 身体材质加绒毛凹凸；爪和小腿皮肤按绒毛图加明暗 | V6_FUR_TILE_BUMP 1.0、V6_PAW_SKIN_SHADE .5 |

复核（round-l-paw 带毛）：舔爪舌尖离趾 1.06 mm、零穿插；Yawn .179 / Bite .131 / Rest 0；走 / 跑滑移 ≤ 0.5 mm、无腾空；
趾缝 1.4 / 3.4 / 3.4 mm（正沟）；各动作最低点不变。

**待用户看图决定**：站立时小腿和爪背比之前略灰（V6_PAW_SKIN_SHADE 可调到 .3）；哈欠里的舌头仍比参考小。
**下一轮**：侧脸造型（对照 lingxi-ref-profile）。口腔袋前后位置 V6_CAV_Y 由 WorkBuddy 在扫（ISSUES F3/F4），结论出来再并入。

---

## Round N（Claude，2026-10-08 夜）——爪子专项 + 鼻周白 / 嘴穿模 / 比例 / 光泽 / 脸型

任务：`reviews/TASK-CLAUDE-round-n.md`。**渲染**：`assets/characters/lingxi/v6/round-n/`（run.sh；对应本提交的代码，构建时工作区里没有别人的未提交改动）。
对比图：`round-n/compare/*.jpg`（paw-front / paw-side / paws / face / face34-3q / side / nose-mouth / yawn / gloss）；「改前」：爪子用 round-l-paw 的 blend，脸用 round-m 的 blend，同 900px / 128spp 重渲在 `round-n/before/`。
迭代用的脚本和中间结果在 `round-n-test/`（iter.sh、mouth_probe.py、gloss2.py、bare.py）。审阅页没更新：这个会话没有 Artifact 工具。

### 0. 爪子（最高优先级）

codex 参考图 4 张（各 1 次 image_gen），已提交：`reference/lingxi-ref-paw-front.png`（正面）、`-paw-side.png`（侧面）、`-paw-transition.png`（腿→爪绒毛过渡）、`-paw-sole-square.png`（爪底正视）；prompt 追加在 `v5-imagegen-sources/REF-BATCH2-PROMPTS.md`（该目录被忽略）。
新增两个视角 `paw1`（单只前爪，低机位正面）/ `paw1side`（外侧），在 `v6_render_views.py`。

| 量 | 参考（paw-front 正面量像素） | 改前（round-l-paw） | 改后（round-n） |
|---|---|---|---|
| 趾数 | 4 | 4 | 4 |
| 趾缝间距 / 脚宽 | 0.29 | 22 / 98 mm = 0.22（且趾排比 108 mm 的爪球窄，四颗珠子挂在下面） | 27 / 115 mm = 0.23 —— 趾排 115 mm = 爪球宽，四趾就是脚的正面 |
| 单趾宽 | ≈ 脚宽 /4（外侧两趾因包转显窄） | 32 mm | 34 mm（V6_TOE_W 1.06） |
| 趾高 / 脚宽 | 0.40 | 36 / 98 = 0.37，爪球 78 mm 高（趾只占前脸下半） | 42 / 115 = 0.37，爪球顶压低 24 mm（54 mm 高） |
| 趾缝深（v6_part_audit toe_clefts, sym） | 缝从地面一直走到脚背 | 1.4 / 3.4 / 1.4 mm | **4.6 / 5.3 / 4.6 mm**（目标 4–6 ✅），前后爪一样 |
| 趾间表面 gap | 0（趾挤在一起，只有缝） | 0 | 0 |
| 趾的绒毛 | 与脚背同一种毛 | 细绒 4.5 mm、躺平（白蛋） | 绒 6.3 mm + 每趾 700 根 13 mm 护毛（toe_coat 6.3 mm，脚背 7.3 mm） |
| 爪甲 | 不露 | 不露 | 不露 |
| 肉垫 / 豆豆 | 三瓣大垫 + 4 豆 | 同 | 不动（PAD_C 不变） |

结论（给用户的那句）：趾**没有分太开**——改前趾间 gap 0、相邻重叠 10 mm；问题是缝浅（1.4–3.4 mm）、四颗白蛋挂在一个又高又圆的爪球下面。
改法（`build_lingxi_v5.py`，全是爪子域）：V6_TOE_DX .022→.027、V6_TOE_H .82→.95、V6_TOE_W 1.06、V6_TOE_IN 1→.6（往前 5 mm）、V6_TOE_ARC .15→.04、
V6_PAW_LOW .024（爪球顶下来，底不动）、V6_PAW_RYK .90（爪球缩短 10%：压低后它的下前缘多鼓出 6.5 mm，LieDown 爪一前倾就穿地 −6.7 mm）、
趾毛 V6_TOE_FUR .009→.013 / _N 2200→3000 / V6_TOE_STAND .45→.7、新增 V6_TOE_GUARD_N 700 / _LEN .013。
顺手修了一个缺陷：爪球前脸的「不长身体毛」窗口里 Rear 那条（y < .21）把**前爪球整个下半圈**的毛也剃了；加了 y 下限，x 宽度跟着趾排走。
侧面（paw1side）仍比参考像「靴子」：趾在前面略凸出一截，没再追。

### 1. 鼻周白
原因：鼻镜周围的「不长毛」窗口是**矩形**（宽 NW×1.12×2、高 2NH+6 mm），四个角露出没毛的白皮——近景就是鼻子后面一块边缘生硬的白板。
改成跟鼻镜同形的椭圆（V6_NOSE_BALD 1.04；旧矩形 V6_NOSE_BALD_RECT=1）。秃皮（鼻镜外露出的皮）：**724 mm² → 235 mm²**（鼻镜投影 939 mm² 的 77% → 25%）；参考里白毛一直长到鼻镜边上（≈0）。
图：compare/nose-mouth.jpg。还剩一圈很窄的淡白边；V6_NOSE_BALD 再往下（.96）没试，怕毛穿出鼻镜。

### 2. 嘴的穿模
- V6_CAV_Y −.458 已落地为默认值（round M 定案）。
- 硬证据：前推 66 mm 后，口腔袋下半（跟 Jaw 走的那一半）在 **Rest 时比下巴皮肤还靠前，最多 55 mm**，从下唇下面露出一道粉弧（round-m 的 face 图那条「笑线」），哈欠时则是下唇**外面**鼓着一块粉。
- 改法：构建时把袋子 z < CAV_Z 的顶点逐个按头皮正面射线夹到「最多凸出皮肤 4 mm」（V6_CAV_CLAMP −.004，−9 关闭）。
| | round-m 代码（改前） | round-n | 目标 |
|---|---|---|---|
| Rest 开口 open_head_fur | 0.011 | **0.001** | ≤ .002 ✅ |
| Rest 看得到口腔袋的射线 | 663 | 0（mesh 网格探测：粉弧消失） | — |
| Rest 犬齿露出 | 0 | 0 | — |
| Yawn 漏光 shell_rays | 0 | 0 | 0 ✅ |
| Yawn 开口 | 0.221 | **0.195** | ≥ .20 ❌（差 .005） |
| Bite 开口 | 0.182 | 0.161 | — |
- Yawn 掉的 .026 就是原来下唇外面那块粉（compare/yawn.jpg）——那不算嘴张开，是穿模。要回到 ≥.20 应加大 V6_JAW_YAWN（.62）；那是嘴的动作，我没动，留给嘴部负责的一方。
- 相交对数：口腔袋 × 头壳 Rest 139 → 仍有几十对；这是袋子沿嘴缝贴着头壳内侧本来就有的，探测脚本的 proud 计算对开口处不准，不当作验收量。
- 下牙列：Rest 下犬齿露出 0 / 0（audit canines），round-m 那排「小白三角」在 Rest 近景里已看不到；哈欠里那排下牙是该露的。

### 3. 身体比例（只量没改）
另一个会话这一轮没有在改 BODY_K（构建前 git diff 只有我的改动），但按协议只量。`reviews/compare/pixel_measure.py` 加了 round-n 的 landmark：
肩高/身 **0.632**（round-k 0.668，参考 0.591，目标 ≤ .62 ❌，差 0.012）；头/身 0.394（参考 0.411）；顶点口径（v6_gait_audit）0.671。
躺姿最低点：LieDown **+0.8** / SideLie +0.6 / Sleep +0.2 / Lick −6.4 —— 都没回归。
另：Yawn 前趾 −0.4、Stretch 前趾 −0.8（round-m +0.6 / +0.4；趾往前 5 mm 的代价，在毛里），PawPlay −2.8 不变。

### 4. 毛的光泽（只量 + 加了旋钮，默认值没改）
指标（gloss2.py：脸部圆盘里分棕毛 / 白毛两类，看 V 的中位数、p99/p50、亮丝占比 V > 1.15×中位）：

| | 参考 | round-n（= 改前，同一套着色） | 7 个着色变体里最好的 |
|---|---|---|---|
| 白毛 V 中位 | **0.945** | 0.773 | 0.796（+0.30 曝光） |
| 白毛 p99/p50 | 1.05 | 1.14 | — |
| 棕毛 p99/p50 | **1.35** | 1.18 | 1.18 |
| 棕毛亮丝占比 | **0.264** | 0.069 | 0.051 |

在现在的灯光下（4 盏 1.2–1.8 m 的大面光 + 暖色环境），粗糙度 .72→.30、高光 .2→1.0、sheen、透光 .15→.30、主光缩到 0.5 m、发梢提亮 22% 都只让这些数动 ≤0.03——**光泽差距不在毛的材质上**。参考的「亮」是白毛整体亮 0.17、棕毛有 26% 的亮发丝（浅色毛尖 + 硬一点的主光）。
这是改整体观感（灯光 / 毛色对比度），按以往约定要用户先看图点头，所以没改默认值。`native_fur_lingxi_v5.py` 加了 env 旋钮 V6_FUR_ROUGH / V6_FUR_SPEC / V6_FUR_SHEEN（默认 = 原值）；比较图 compare/gloss.jpg。

### 5. 脚趾是不是分太开 —— 见 0：没有分太开，是缝太浅、趾太圆。

### 6. 萌感 / 脸型
脸轮廓宽（face 视图，E = 瞳距 = 220 px）：

| 要素 | 参考 | 改前（round-m） | 改后 | 目标 / 判断 |
|---|---|---|---|---|
| 下脸宽 / 眼线宽（「胖」） | 0.96（参考在眼线最宽，往下收） | 2.89E / 2.52E = **1.15** | 2.62E / 2.46E = **1.07** | ≤ 1.0；改善一半 |
| 眼线脸宽 | ≈ 3.1E（毛蓬，图被裁） | 2.52E | 2.46E | — |
| 头身比（像素） | 0.411 | — | 0.394 | 已达标 |
| 眼径 | ≈ 0.40E | ≈ 0.50E | 不变 | 已比参考大，够萌 |
| 鼻宽 | 0.28E | 0.245E（audit nose_w_over_E） | 不变 | 可略加 |
| 鼻→嘴 | ≈ 0.20E | 0.175E（audit lip_below_nose_over_E）；像素看口缝 0.24E | 不变 | — |
| 眼线在头高的位置（头顶毛→下巴） | **≈ 0.59（眼睛偏下）** | **≈ 0.46（眼睛偏上、下脸长）** | 不变 | 这一项最影响幼态，见下 |
| 头宽 / 头长（网格） | 正面 / 侧面口径不同，没法同口径量 | 296.6 / 286.96 = 1.034 | 不变 | 未达成 |

改法：只改了脸颊的毛（cheek fluff 1+.75 → 1+.30，V6_CHEEK_FLUFF），下脸宽降 9%（嘴线那一行 2.89E → 2.62E）。
加了 V6_CHEEK_RX / V6_CHEEK_RZ（脸颊球的宽 / 高，顶不动），试过 .064 / .056：轮廓几乎不变（被毛决定），默认保持原值。
**判断**：不萌的主因是眼睛在头上的位置偏高、下脸（鼻下到下巴 + 颈部毛领连成一片白）太长；要么眼睛整体下移约 0.1 头高，要么缩短下颌并把 NeckRuff 和下巴分开——
前者动眼睛 / 眼睑全套，后者是 NeckRuff（另一个会话的领地），都要用户先拍板，这轮没做。头宽 / 头长同理没达成。

### 其他
- `v6_render_views.py` side 视角（第 1 帧）看不到眼睛和吻部，round-k 起就这样（Idle 第 1 帧的头偏向另一侧？），不是这轮引入的。
- 舔爪重新求解：cost 0.97（round-l-paw）→ 2.47，touch 8.6 mm（舌尖离爪垫 / 豆豆远了；趾变高、往前之后挡在前面）；pose 图里仍读作舔爪（compare 未单独出图，见 round-n/poses/Lick.png）。下一轮可以给 LICK 加上「趾也算可触面」或把 TOE_IN 退回 .8。

---

## ⚠️ Round O 由 Claude 主会话接手（2026-10-09 上午）——请不要再派 TASK-CLAUDE-round-o.md

用户在本会话里给了同样的反馈（「脚趾太大了…脚掌的贴图也不对，嘴巴效果不太好…鼻子四周有个长方形」）。已提交 8e04b77：
小趾骨 + 毛撑出爪形、肉垫/豆豆凹凸与光泽、哈欠 U 形口 + 口腔袋包住整条舌头（b348c23 的 V6_CAV_Y −.458 把杯底放到了舌头前面，
改为 −.430 / 深 .065）、鼻下到嘴线的毛加长。正在做任务书里剩下的：嘴边的毛伸进口腔、下颌那排「小尖齿」、牙的读法。
完成后会在这里补完整的「改前 → 改后」。

---

## Round O 结果（Claude 主会话，2026-10-09）——脚趾 / 脚掌 / 嘴 / 鼻周

用户（本会话）：「爪子很明显是不对的，脚趾太大了其实脚趾的骨骼比较小就是猫多一些，另外脚掌的贴图也不对，嘴巴效果不太好，
需要重新优化，鼻子四周有个长方形」——与 TASK-CLAUDE-round-o.md 的三条一致，一并做完。
**提交**：8e04b77 · 3a36627 · f91d2df · 946511c（只改 build_lingxi_v5.py）。**渲染**：`assets/characters/lingxi/v6/round-o/`
（knobs.txt 末尾写明哪些图来自哪个提交的构建；后两个提交只动趾头 / 舔爪伸趾）。审阅页：https://claude.ai/artifact/7fLTHVDwCd8pRXEXiiBGiW
（WorkBuddy 的 site 页你那边自己换图。）

| 项 | Round N | Round O | 说明 / 旋钮 |
|---|---|---|---|
| 趾头尺寸 | 34 x 42 x 42 mm、间距 27 | 26 x 28 x 27 mm、间距 19，埋进爪球（TOE_IN 2.0） | V6_TOE_W/L/H .90/.70/.62、V6_TOE_DX、V6_TOE_IN；爪形交给毛 |
| 趾缝（sym） | 4.5 / 5.3 mm | 2.0 / 2.4 mm | 参考是浅褶 |
| 爪球 | 顶压低 24 mm（方块） | 压低 10 mm（圆） | V6_PAW_LOW |
| 趾甲 | 固定尺寸 | 随趾缩放 | 小趾时不再戳出白点 |
| 肉垫 / 豆豆 | 平贴贴纸 | 遮罩当凹凸、粗糙度 .30 | V6_PAD_PUFF、V6_PAD_ROUGH |
| 舔爪的豆豆 | — | 抬爪时脚趾伸出 14 mm，四颗都可见；舌尖离趾 0.99 mm | V6_LICK_TOE_OUT；爪底毛绕开豆豆 |
| 鼻下到嘴线的毛 | ≈ 2.5 mm（秃白方板） | 上唇系数 .20 -> .45、口鼻 .42 -> .58 | V6_LIP_COAT、V6_MUZZLE_COAT |
| 嘴边毛伸进口腔 | 上唇毛帘、嘴角白帘、下缘毛尖成「小牙」 | 嘴缝上 10%，上 8 / 下 10 mm 恢复，延伸到嘴角外 12 mm | V6_LIP_CLEAR_UP/_DN |
| 哈欠口型 | 方盒子（线性 16 mm 渐变） | 椭圆分布，U 形；嘴缝 GAPE_W 1.45 | 口腔袋宽 = max(.042, GAPE_W+.006) |
| 哈欠舌头 | 只露舌尖（袋底挡在舌头前） | 可见舌面 1280 -> 4190 条射线 | V6_CAV_Y −.458 -> −.430、V6_CAV_RY .040 -> .065；舌宽 x2.1；Up 1.15 / 上翘 .10 / Out .40 |
| 犬齿露出（Yawn） | 上 8.5 / 下 6.25 mm | 上 12.4 / 下 1.7 mm | V6_UPPER_FANG 1.55、V6_LOWER_FANG .6；闭嘴不露（上犬齿尖前皮肤 8.9 -> 2.5 mm） |
| 开口（头宽） | Yawn .195 / Bite .132 | Yawn .186 / Bite .155 | Yawn 少的一点是嘴边的毛变短后不再被算作「开口里的东西」以外的部分；目视开口更大 |
| 闭嘴 | — | Rest 开口 0；口腔袋 1 条射线 | |

其余回归：15 个动作最低点不变（LieDown +0.8、SideLie +0.6、Sleep +0.2、Lick −6.4、Stretch +1.0）；走 / 跑滑移 ≤ 0.5 mm；闭眼不变。
**已知**：舔爪时加宽的舌头和头皮有 13 对三角面相交（嘴角擦边，渲染里看不到）；左眼瞳孔里能看到一点角膜反射的纹理。
v6_part_audit 的 lick.gap_mm 在爪球形状变化时可能取到爪球背面、符号判错（中间一版给过 −61.8），以三角面相交和渲染为准。

---

## Round P（Claude 主会话，2026-10-09 下午）——鼻周白圈 / 闭嘴 / 舌头 / 爪与袜子 / 躺姿骨骼

用户（本会话）：「1. 鼻子四周有个明显的白色区域，像是没有被毛覆盖住 2. 嘴巴效果在闭上的时候不是很明显，另外舌头有点短颜色也不对，
你需要调用 codex 生成素材 3. 爪子的指头有点大，爪子的肉垫有点小，爪子的毛覆盖的范围不太对，另外躺下去的动作太僵硬了，是不是骨骼的问题？
4. 帮我清理一下没有用的资源」。问「毛的覆盖范围」指哪种，答「两个都要改」：毛连续盖过趾头 + 腿改虎斑、白色只做袜子（按 codex 爪部参考图，
不按 turnaround-v1 的白前腿）。之后又说：「需要记住一条优先使用 codex 生成图片，尽量使用 codex 生成」——凡是能用图解决的先派 codex。
**渲染**：`assets/characters/lingxi/v6/round-p/`（run.sh 同 round-o，只换 OUT）。审阅页：https://claude.ai/artifact/7fLTHVDwCd8pRXEXiiBGiW
**codex 素材**：`v5-imagegen-sources/tongue_v3.png`（REF-BATCH3）、`reference/lingxi-ref-mouth-closed.png`（REF-BATCH3）、
`v5-imagegen-sources/muzzle_detail.png`（REF-BATCH4，对位模板 `templates/muzzle_template.png`）。staging 用 `stage_imagegen_textures.py --only <name>`。

| 项 | Round O | Round P | 原因 / 旋钮 |
|---|---|---|---|
| 鼻周光皮（鼻头外 1.0–1.6 倍一圈「亮且平滑」像素） | 8.1% | **0.9%** | 剃毛窗口是鼻头的外接椭圆，鼻头是倒三角：下半部两侧各多剃 5–6 mm，且毛从鼻子往外长、盖不回来。窗口改成鼻头真实轮廓（V6_NOSE_BALD .94 = 轮廓内 6%）+ 贴鼻头一圈 7.7k 根短绒毛（LX_Fur_under_LX_NoseVelvet，V6_NOSE_VELVET_N/_VELVET） |
| 闭嘴 ω | 浅粉细线，几乎看不见 | 深玫瑰灰 ω + 人中 + 粉下唇 | 嘴线色 (.76,.54,.55) -> (.50,.33,.36)、粗 .9 -> 1.2 mm（V6_LIP_TONE/_BEVEL）；codex 口鼻细节贴花按 multiply 叠到头部颜色（皮肤 + 毛根，muzzle_detail()，V6_MUZZLE_DETAIL）；程序化褶 lip_crease 在有贴花时降到 .20 |
| 舌色（渲染，哈欠舌面均值） | (199,141,144) | 暖玫瑰粉 | tongue_v3（codex）+ 材质里 Hue/Sat 1.18 / Value .86、Specular .40（V6_TONGUE_SAT/_VAL/_SPEC；1.45 试过，偏玫红） |
| 舌长 | 51 mm | 60 mm（x1.18，V6_TONGUE_L） | **舌尖静止位置不变，加长的部分在喉咙里**；Out 多滑同样长度（TONGUE_OUT .058 -> .067）。第一次往前加长，Rest 舌尖穿出下巴（开口 2.0 -> 4.5 mm，舌头 12 条射线），已改 |
| 舔爪舌头伸出唇外 | 16.6 mm | 24.7 mm | 舌–爪间隙 0.99 -> 1.33 mm；舌–头皮相交 13 -> 16 对（嘴角擦边，原有） |
| 哈欠 tongue_share / fur_in_mouth | .204 / .122 | .240 / .120 | 开口 .186 -> .187；犬齿不变 |
| Rest | 开口 2.0，舌 0 | 开口 2.0，舌 0（口腔袋 1 条射线） | |
| 腿色 | 白腿（painted side map 的白一直到肘） | 虎斑腿 + 白袜子 | leg_socks()：骨段 6 cm 内、z < .215 渐入；袜口 V6_SOCK_Z .088，前面高 16 mm；环纹用 coat grade 的焦糖 / 深棕 |
| 爪背毛 / 趾毛 | 7.3 / 6.3 mm，卷 | 4.3 / 6.3 mm，顺 | PAW_ZONE（z < 65 mm 全、95 mm 起无）：方向朝前下梳向趾头（原来是「往下」，在爪背上投影成朝后）、lift −35%、wave −65%、frizz −60%（V6_PAW_FLAT/_SLEEK）；V6_PAW_COAT .14 -> .12；趾护毛 7 -> 9 mm、700 -> 1100 根 |
| 趾头 | 28.8 x 25.2 x 27.3 mm | 25.6 x 23.0 x 24.6 mm | V6_TOE_W/L/H .90/.70/.62 -> .80/.64/.56；趾缝 2.0/2.4 -> 1.8/2.2 mm |
| 肉垫 / 豆豆 | 主垫 53 x 62 mm | 62 x 73 mm；豆豆椭圆 x1.2 | V6_PAD_S 1.2 -> 1.4（舔爪求解里的主垫也用 PAD_S 了，原来写死 1.0）、V6_BEAN_S 1.2；爪底毛 / 趾绒避让区随之放大 |
| 背部关节 | Pelvis > Spine（一个关节） | Pelvis > **Loin** > Spine | 新骨 Loin (0,.08,.33)->(0,-.04,.345)，与 Spine 共线，蒙皮把原 Spine 的权重在 y −.04 处分开。_back() 只对躺姿把弯曲按 BACK_CURVE .5 分给两节；其他动作 0 = 全在 Loin = **旧骨架完全等价**（15 个动作最低点除躺姿外与 round-o 逐一相同）。_fk 遇到只有 Spine 的 rots 自动映射到 Loin，所以 sit / lick 求解不变 |
| 躺姿动画 | 线性 1/3 段到位后静止 | 缓入缓出 .40（V6_LIE_T），头颈晚 .06、尾晚 .10 落定；躺着时背随呼吸 ±.03、尾尖摆（V6_LIE_BREATH/_TAIL） | |
| 侧躺 | 脸贴地、两眼上下叠、上侧腿竖向镜头 | 背弯 .35、头抬起并转回竖直（neck_side −.25、head_roll −1.0）、耳不折；前腿从胸、后腿从骨盆定位（V6_SL_FRAME）；add .45 | round-p-test s1–s6 |
| 最低点 | SideLie +0.6 / Sleep +0.2 | −0.3 / −0.6 mm | 都在毛里 |

**注意 / 下一步**：
- 胡须垫不够鼓，ω 的褶没有参考深；codex 贴花上的毛囊点被毛盖住看不到（毛根色只在根部），需要更短的口鼻毛或把点画到毛上。
- 侧躺四只爪子仍有点堆在胸前；Sleep 没重调（只是背改成两节弧）。
- `v6_gait_audit` 的 neck_fold_mm 用的是 Spine 的头部位置，Loin 拆出后这个数会变（Spine 头从 y .08 移到 −.04），不是姿态变化。
- 清理：删掉 250 个 .blend/.blend1（约 30 GB：lingxi-v5fix 31G -> 1.9G 等）。还剩 Rust target 11 GB 和 lingxi-lookdev 工作树 2.3 GB，等用户决定。
- 工作区里 `scripts/lookdev-v6/v6_part_audit.py` 的改动不是我的，没有提交。

---

## Round Q（Claude 主会话，2026-10-09 晚）——腿与爪的比例 / 骨架 / 躺姿

用户：「爪子是当前最严重的问题，并且侧躺和躺着姿势不对……每个爪子的大小比例不对可能是骨骼的问题？看起来有点分裂，突兀，不协调」；
又：「1. 查一下猫科动物的身材比例，骨骼特征，以及联动关系 2. 用 codex 生成对应的关键姿势，然后对比验证」。
**codex**：`reference/lingxi-ref-pose-{stand-side,stand-app,liedown-app,liedown-side,sidelie-app,sleep-app}.png`（REF-BATCH5；正侧面长焦 / app 机位 = 正前方俯 20°）。
**解剖数据**：Day & Jayne 2007（J Exp Biol 210:642）家猫：前肢 肱 / 桡 / 掌 / 指 = 36.8 / 34.2 / 14.6 / 14.1%，后肢 股 / 胫 / 跖 / 趾 = 34.7 / 32.4 / 22.1 / 10.5%；
站立中期 肘 127°、腕 176°、膝 115°、踝 114°、MTP 112°；肩高 ≈ 73% 前肢长、髋高 ≈ 76% 后肢长。
**渲染**：`v6/round-q/`。探针：`v6/round-q-test/probe.sh <dir> <frames>`（俯视 / 动作图相机 / app 机位三张，报各部件最低点）、`lie3.sh`、`q.sh`（preview 无毛构建）。

| 项 | Round P | Round Q | 说明 / 旋钮 |
|---|---|---|---|
| 胸底离地（中线） | 120 mm | 165 mm | V6_LEG_SHOW .045：Belly / Chest / Torso / Rump(.8) / Haunch(.7) 底部上收，顶不动；肘（.175）回到胸底 |
| 可见前腿 / 身长 | .168 | .231 | v6_gait_audit proportions.foreleg_midline_body |
| 腿粗 / 爪大 | — | 前臂 / 胫 x1.25（上臂 x√1.25），爪球、趾距、趾、豆豆、肉垫 x1.18 | V6_LEG_K、V6_PAW_SC；PAW 字典先定义、各处引用 |
| 爪球皮肤挂在躯干骨上的权重（max） | 19%（前爪前半，原本就有 22%） | **0.4%** | weights(): Paw 段核心不再受 y 窗口限制；核心半径 x LEG_K / x1.35·PAW_SC |
| 后腿关节角（站） | 膝 96° / 踝 72° | 膝 115° / 踝 114° | 实测比例反算（V6_HIND_ANAT），踝前移 39 mm，RearHock 跟着 |
| 袜口 | 18 mm 直线 | 30 mm 软边 ±6 mm 起伏；腿虎斑阈值随 LEG_K | |
| 肚下毛 | — | 朝下的皮肤毛长 −35% | V6_BELLY_TRIM |
| LieDown | drop .105 | .125 | 胸贴地；最低 −2.8 mm（尾 / 身体，在毛里） |
| SideLie | 整只侧翻 90°，从正面看像肚皮朝天 | 侧卧休息：髋转 1.5、胸 90% 摆正、yaw −.8、左后腿在下（−.2）右后腿搭下（.7） | SL_MODE=2 / SIDELOUNGE（V6_SG_*）；旧模式 V6_SL_MODE=1；最低 −7.1 mm（身体，在毛里） |
| Sleep | 脸朝下 | head_roll −1.4、neck_side −.25、head_side −.1 | 脸朝外闭眼 |
| 其他 12 个动作 | — | 最低点 / 滑移与 round-p 逐一相同；Lick 屁股 −6.4 -> +4.9 mm；舔爪求解 cost .41 -> .81、touch 2.2 -> 3.5 mm | |

**下一步 / 没做**：前肢按实测要「肘 127°、桡骨近竖直、爪在肩下」，前爪会后移 ~5 cm，牵动舔爪 / 坐姿 / 胸前毛的校准，未做；腿毛不如参考蓬、前腿白袜子可更高；
Sleep 爪子外露、尾巴没绕到前面；SideLie 身体陷进毛里 7 mm（可把 V6_SG_DROP .11 -> .103）。

---

## Round R（Claude 主会话，2026-10-10）——爪子改成一整块 / 空间腿 IK / 嘴型 / 清理

用户：「1. 从正面看爪子 N 轮效果更好…现在爪子和爪子上面的关节过渡非常不自然，肉垫的贴合也不好，N 轮的侧面非常不好，O 轮侧面也不好
2. 嘴巴…现在是形状是规则的形状似乎不太符合直觉 3. 躺下的姿势差的很多…整个骨架的轮廓可能真的有问题 4. 爪子的肉垫没有贴合进去，脚趾有点独立
5. 下次直接给我最新的结果」；要求查资料、参考别人的做法、清理没用的资源；之后转来 WorkBuddy 的 `round-q-wb/AUDIT-DEEP-QUANTIFIED.md`。
**渲染**：`v6/round-r/`。**审阅页只放 Round Q vs Round R**（用户要求，见记忆 report-latest-vs-previous）。
**参考了**：Blender 自带 Rigify 猫元骨架（`addons_core/rigify/metarigs/Animals/cat.py`：前臂下到离地 ~10% 肩高，爪 = 腿柱下前方一小段、
趾成弧）；建模社区对有机爪子的共识（一整块连续拓扑，不要布尔拼件）；猫爪解剖（掌垫三瓣心形、四个指垫成弧、肉垫是无毛的皮）。

| 项 | Round Q | Round R | 说明 / 旋钮 |
|---|---|---|---|
| 爪子几何 | 腿椭球 + 爪球椭球 + 4 个独立趾头物体（各自长毛）+ 贴上去的肉垫椭球 | 小腿 + 爪 + 4 趾 = 一个元球（metaball，部件之间平滑圆角），并入身体网格 | V6_PAW_META（0 = 旧）、MPAW / MTOE_*（round-r-test/pawmeta.py 原型 m1-m3 / n1-n3）；身体体素 7 -> 4.5 mm、平滑 5 -> 3（V6_BODY_VOXEL / _SMOOTH），否则趾褶被抹平 |
| 腕部 | 腿椭球收细 + 爪球鼓出 = 一圈细腰和环棱 | 胶囊腿柱平滑流进爪 | |
| 爪宽 / 腿柱 | ~1.0 | 1.27 | 参考 ~1.1-1.15；趾瓣 23x31x32 mm、间距 35 mm、刚度 5.5 |
| 肉垫 / 豆豆 | 椭球插进爪底，边缘一圈台阶 | skin_shell：下半个扁椭圆收缩包裹到爪底皮肤上，离皮 0.6 mm、中心鼓 1.3 mm、边缘贴平 | V6_PAD_LIFT / _DOME；豆豆在趾底后移 8 mm（正面看不到粉边） |
| 趾头动 | 趾头物体绑趾骨 | 身体蒙皮里趾瓣部分按距离分给趾骨 | 舔爪不再外伸 / 卷趾（V6_LICK_TOE_OUT / _TOE = 0；外伸 14 mm 会把爪皮拉进口鼻） |
| 趾缝 | — | 皮肤 + 毛根在趾缝处压暗（只在爪前下方） | paw_crease、V6_PAW_CREASE .25 |
| 爪底毛 | 爪底 26 mm 以下全算 | 只取朝下的面、12 mm 以下 | 圆爪上 26 mm 带包到侧面，往外梳的毛画出一圈沿 |
| 腿 IK | 平面 2 骨链，离面残差丢弃；躺姿靠 add_* 在 IK 之后硬甩 | leg_ik(abduct=True)：先绕身体前后轴外展到目标所在平面，再平面求解，外展角合成进上腿骨 | WorkBuddy 审计 #4；目前只用于 SideLie（SL_MODE 2 + PAW_META） |
| SideLie 落爪 | add_HL -.2 / add_HR .7（Q 审计：HL -109.7 mm…） | 世界坐标放爪：下后爪 z >= 45 mm、上后爪叠在下后爪上 +65 mm（后移 20 mm）、前爪腕 88 mm；add_* 归零 | h_floor / h_stack_dy / h_stack_dz / f_floor |
| 躺姿最低点（held，v6_lying_audit） | SideLie 身体 -7.1 | Idle -0.5、LieDown 2.2/2.2/24.7/24.7、SideLie 2.6/4.7/13.8/30.7、Sleep 13.5/132.6/12.6/129.6（后两只收起托下巴） | SideLie drop .11 -> .10；Sleep lift .2055 -> .2175 |
| 嘴（闭） | 人中 22 mm、嘴宽 .69 鼻宽、等粗 ω | 人中 ~15 mm（V6_LIP .98 -> .995，嘴的整套跟着动；codex 贴花跟着嘴线平移）、嘴宽 = 鼻宽（V6_MOUTH_W 1.0）、ω 往嘴角渐细（V6_LIP_TAPER .7）、粉下唇宽保持 .011（V6_LOWER_LIP_W） | run.sh 的 env 也改了 |
| 嘴（哈欠） | 宽方口（上沿直线） | 上唇抬起改成双拱（中间人中凹口），GAPE_W 1.45 -> 1.0、JAW_YAWN .62 -> .72 | V6_LIP_ARCH .35；round-r-test mo0-mo3 |
| 舔爪 | 举到嘴边 | 低头舔举在胸前的爪（新爪更宽，举到嘴边撞口鼻；cost 3.5，touch 1.0 mm，主要是 wrist 项） | 下一轮可放宽 wrist 限制或让求解器偏好抬头 |
| 其他 | 走 / 跑滑移、比例与 Q 相同；站立最低点 -0.5 mm（豆豆着地） | | v6_gait_audit 的比例尺改为没有趾头物体时用身体最低点 |

**清理**：lingxi 主仓库 13G -> 5.8G（`apps/lingxi/src-tauri/target/debug` 7.1G，可重建；release 保留）；lingxi-v5fix 5.6G -> 2.8G
（历轮 *-test 目录与 round-l/n/o/p 的 .blend，渲染图保留；各 test 目录的脚本收在 `round-r-test/tools/`）；lingxi-lookdev 只删 .blend1
（该工作树有未提交改动，没动）。WorkBuddy 的 round-q-wb / round-r-wb 没动。
**WorkBuddy 审计对照**：#1-#3（add_HL / add_HR / f_z）在 Q 的旧爪上量的，新爪改成世界坐标放爪后这三个旋钮不再决定落点；#4 已按「彻底改」做；
#5 确认；#6 爪高宽比：新爪 33 mm 高的爪体 + 32 mm 高的趾瓣，宽 148 mm（含趾），待用 paw_only 口径复测。

---

## Round U（Claude 主会话，2026-10-10 晚）——codex S 的外观并入生成器；codex T 的骨骼问题分析；躺下过程不再穿地

用户：「我让 codex 改了一下效果还不错，你继续改吧，后面骨骼他改的跟狗屎一样，你思考一下他的问题出在哪？」
codex 做了两轮后处理（都改的是已构建的 .blend，不是 build_lingxi_v5.py）：Round S（`reviews/ROUND-S-CONTACT-REPAIR.md`，
`repair_lingxi_contacts.py`）与 Round T（`ROUND-T-REFERENCE-ANATOMY.md`，`repair_reference_anatomy.py`）。

### codex Round T（骨骼）为什么坏
1. **改产物不改生成器**：加骨、改父子、重分权重、收窄躯干、逐帧重烘全部作用在构建好的文件上；build 不知道，下次构建全丢，
   坐姿 / 舔爪求解、按距离蒙皮、place_legs、审计全被绕开。
2. **加骨不重做蒙皮**：Chest 是把 Spine 对半切、权重按 y 线性挪；RearFoot 的关节在跖趾（爪前下方），权重却按高度水平切
   （z < 80 mm 归 RearFoot），一转就在爪中段一条水平线上剪切——权重分界和关节位置不一致。
3. **线性蒙皮 + 大弯曲**：Sleep 里 Loin .50 + Spine .45 + Chest .25 ≈ 1.2 rad 压在一个椭球躯干上，体积塌成褶（白色折痕）；
   关节越多褶越多。（Preserve Volume / DQS 在我们的弯曲幅度下几乎无差别，round-r-test/pv.jpg，未启用。）
4. **为过接触检查改角色**：躯干横向整体收窄 20%，腿与关节不动——细身子、腿长在身体外侧；毛只平移根部不重梳。
5. **数字摆姿**：roll 1.45、Loin .50、某脚 z .0015、头 z .165……每个数修一个接触，最后整体抬离地面；没有轮廓目标。
   S 报告自己写了「接触数值不能证明姿态好看」，T 仍以 15 项接触检查为验收。
6. **逐帧独立搜索 + 每帧全骨骼打关键帧**：曲线被打碎，有跳帧风险。

### 本轮
| 项 | 说明 / 旋钮 |
|---|---|
| S 的外观并入生成器 | 变换完成后、在最终空间对皮肤 / 全部形态键 / 毛根做与 S 相同的两个局部变形：爪横向 -8.5%、爪背 -13%、爪毛 -35%（V6_PAW_NARROW / _FLATTEN）；胡须垫前 3.5 mm 外 1.5 mm、人中沟后 1.5 mm、下巴中间 +6 mm、口鼻毛 -30%。V6_ROUND_S_LOOK=0 关闭。与 S 同机位对比几乎一致。S 重烘的姿势没有移植（Sleep 改成趴睡，与参考蜷睡不符；其余与 R/U 接近）。 |
| 躺下过程穿地（S 发现：R 第 259 帧 -41 mm） | 是下侧后爪的趾瓣在角度过渡中扫过地面：躺姿每帧解腿后用该爪真实皮肤（身体网格中 Paw/Toe 权重 > .5 的顶点，LBS）求最低点，低于地面就抬目标重解（_paw_low）；躯干同理（_lift_off_floor，躯干权重 > .7 的皮肤）。LieDown 尾巴晚到时先抬起（V6_LD_TAIL_LIFT .6）。全帧扫描：SideLie >= +1.1 mm、LieDown >= -2.6 mm（尾尖）、Sleep >= +5.7 mm。 |
| 舔爪 | 加了 V6_LICK_HEADUP（低头代价，默认同旧值）；试过 2.0 / 4.0、腕部上限 1.15 / 1.25：解不变——平面腿 IK 不能让爪内旋把肉垫转向嘴，需要 S 那样带完整朝向的空间解（下一步）。 |

---

## Round V（Claude 主会话，2026-10-11）——对照 codex 目标图逼近；舔爪空间求解；睡姿脸朝外

用户：「我需要跟 codex 生成效果对比，不是跟上一版比，我们要逼近这个目标，另外骨骼咋样了？继续优化吧」
审阅页改为「codex 目标图 | Round V 同机位」（记忆 report-latest-vs-previous）。目标机位脚本：`v6/round-v-test/render_target.py` / `tgt.sh`
（正侧面 = +X 长焦正交，猫朝左；app = 正前方俯 20°；按投影外轮廓取景）。迭代：`it.sh <dir> "ref frame view" ...`（无毛预览 + 目标对照）。

**骨骼现状**：站姿正侧面量下来与目标已接近（身长/身高 1.10 vs 1.06，可见腿 18% vs 17%，躯干厚 51% vs 51%）；差距主要在用骨骼
摆出的姿势（睡、侧卧、舔爪），本轮按目标逐个改：

| 项 | 改动 | 旋钮 |
|---|---|---|
| 舔爪 | 移植 codex S 的思路进生成器：_lick_reach——肩胛前移 65 mm / 下沉 20 mm，空间两骨臂 IK（保持肘的极向），爪朝向在「前臂带着的自然朝向」与「肉垫正对舌尖、趾朝上」之间取 55%（全转会把爪皮拧成长袜），迭代把肉垫中心放到舌尖前 3 mm（实测 0.4 mm）；头不再低头迁就（坐姿颈 / 头 + 点头 .06、转 .10、歪 .22）；坐姿髋 .170 -> .135、背 41 -> 52 deg（坐直） | V6_LICK_REACH / _PAW_TURN / _SCAP_FWD / _SCAP_DN / _HEAD_UP / _NOD / _TURN / _TILT；V6_SIT_HIP / _PITCH |
| 睡 | 背弯 .8 -> 1.4、颈 .6 -> .9、头 .5；后腿收到腹下（h_dy -.14 / h_dz .20）；尾巴绕前（tail_side 1.2、tail_k -.15）；_face_world：头的世界朝向直接设为脸朝镜头、低头 .30、歪 .35（否则是整条背弯曲累积出来的朝向，脸被转到背面） | V6_SP_*、V6_SP_FACE_* |
| 尾 | 静止尾形：从臀部下垂再上扬成一团（尾尖 160 -> 275 mm） | V6_TAIL_PLUME |
| 趴下 | 尾巴绕到身体一侧（tail_side -.45 -> -1.2） | V6_LD_TAIL_SIDE |
| 侧卧 | 前爪更前伸（f_dy .15 -> .22） | V6_SG_F_DY |
| 防穿地 | _tail_off_floor：舔爪 / 躺姿的尾巴皮肤低于地面就抬尾根（坐直后尾巴 -31.5 mm -> 在毛里）；_lick_reach 在 hold=0 时不动腿 | V6_TAIL_FLOOR |
| 量测 | 全帧最低点：Idle +1.1、LieDown +1.1、SideLie +1.1、Sleep +10.3、Lick -3.4（坐着的臀部，在毛里）、Walk +1.0 | |

**还差（见审阅页每组一句）**：站姿正面目标露出的腿更长（胸前毛垂得低）；趴下的前爪应伸在脸前；趴下 / 睡的尾巴还没绕到前面；
侧卧胸口偏高；爪子侧面目标更低更长；闭嘴胡须垫不够鼓；哈欠目标开口更小更圆、舌头伸出。

---

## Round W（Claude 主会话，2026-10-12）——按目标图差距再改一轮

用户：「再改一轮」。审阅页仍是「codex 目标图 | Round W 同机位」。渲染 `v6/round-w/`（target/ 下是 7 个目标机位）。

| 项 | 改动 | 旋钮 |
|---|---|---|
| 趴下 | 前爪伸到脸前（f_dy .15 -> .24）；尾巴沿身侧往前：转动集中在尾根（逐节权重 1 / .6 / .1 / .1 / .35，均匀分布会在臀后卷成小圈），tail_side -1.3（-1.75 卷到身下看不见） | V6_LD_F_DY、V6_LD_TAIL_SIDE、V6_LD_TAIL_WRAP |
| 侧卧 | 胸口扭转保留 .9 -> .7；脸用 _face_world 朝镜头（俯 .05、歪 -.22），随头颈的 settle 进入 | V6_SG_CHEST_KEEP、V6_SG_FACE_* |
| 站姿正面露腿 | 胸前加长 .8 -> .45、朝下毛缩短 .35 -> .55 | V6_BIB、V6_BELLY_TRIM |
| 爪 | 更长更低：前 r (.074,.070,.031)、前缘 -.294；后 (.071,.066,.030)、.171 | MPAW |
| 闭嘴 | 胡须垫前凸 3.5 -> 6 mm，人中沟后缩 1.5 -> 3 mm | V6_PAD_PUFF_MM、V6_CREASE_MM |
| 哈欠 | GAPE_W 1.0 -> .85、JAW_YAWN .72 -> .60、舌 Out .40 -> .85、舌俯仰 .10 -> -.05（舌伸出下唇外） | V6_GAPE_W、V6_JAW_YAWN、V6_YT_OUT、V6_YT_PITCH |
| 量测 | 最低点：站 / 走 / 跑 -0.4、LieDown +4.8、SideLie +2.1、Sleep +10.1、Lick -3.1（臀，在毛里）、PawPlay -4.4（原有） | |

**踩坑**：又一次在单行语句中间插注释，把 for 循环体截成了两行（只作用最后一节尾骨）。插注释一律放在语句上一行。
**还差**：趴下的尾巴停在耳边偏高（应平放在地）；睡姿尾巴太短绕不到脸前；侧卧后腿要更舒展；闭嘴的嘴线褶还浅；哈欠开口可再圆一点；
目标的头更大更圆（毛量）。

---

## Round X（Claude 主会话，2026-10-12）——骨架结构与联动重做

用户：「我总觉得动作不到位的原因是骨骼结构不合理，尤其是联动关系，坐 卧 躺 跑 跳 走，否则有很多动作根本无法做出来」；随后「有必要的话让 codex 给你调研一下骨骼结构和生成素材」。

### 诊断（骨架透视，`scripts/lookdev-v6/v6_xray_dump.py` + `v6_xray_draw.py`：无毛皮肤按主导骨上色 + 姿势骨线，侧 / 俯）

| # | 问题 | 证据 | 后果 |
|---|---|---|---|
| 1 | 颈骨没有皮肤 | LX_Body、LX_Head 上 Neck 权重和 = 0（codex 指南 3 早已指出） | 头是钉在胸前的球，低头 / 蜷睡 / 舔爪时脖子不弯 |
| 2 | 背只有 Pelvis / Loin / Spine 三个铰点 | 权重按 y 三段；跑步帧背线笔直 | 蜷睡两处折角，跑跳背不参与 |
| 3 | 大腿 / 上臂的肉按高度一刀切 | 腿 mask `(.31-z)/.12`：膝以上的大腿皮肤一半在骨盆上 | 坐、趴时后腿像从球下伸出的短棍 |
| 4 | 肩胛只在舔爪动、且太长 | 147 mm = 1.13 × 肱骨，上端在背线上；幼猫 .67、成猫 .72（Peters 1983，codex FELINE-RIG-NUMBERS） | 前腿从焊死的插座摆；抬爪拉大片胸毛 |
| 5 | 后腿骨短 | 股骨 / 胫骨 = .93 / .85 × 肱骨，8 周幼猫 1.03 / 1.01（同上） | 蹲不深、蹬不直 |
| 6 | 尾巴短、节少 | 5 节 316 mm ≈ 鼻—尾根投影的 .40；体表均值 .53–.56（Harper 2004） | 绕不到身前，弯成五段折线 |
| 7 | 跑 = 小跑 + 走路加速；跳 = 站姿上下平移 | 所有动作逐骨手写正弦，无躯干俯仰、无脊柱—腿耦合 | 对照 codex 跑跳分阶段图，每帧都像站着 |

### 改动

| 项 | 做法 | 旋钮 |
|---|---|---|
| 拆骨 | Loin→Loin+LoinB、Spine→Spine+Chest、Neck→Neck+NeckB、Tail0–4→各加 B，共线；肩胛挂 Chest。动作仍写 A 名，`_spread()`（姿势）/ `_spread_rots()`（`_fk` 内）把每个转角拆成两个半角（四元数开方，两段合成严格等于原转角） | V6_RIG_X |
| 躯干权重 | 沿背在相邻骨中点间线性过渡（Pelvis/Loin/LoinB/Spine/Chest），不再是三段 y 带 | — |
| 颈权重 | 沿颈线 t>.15 起渐入 Neck→NeckB，近颅骨一半给 Head | — |
| 大腿 / 上臂 | 股骨 / 肱骨周围、外侧、髋 / 肩顶以下的皮肤跟随该骨（`exp(-(d/R)^4)`） | V6_THIGH_R .075、V6_ARM_R .060 |
| 尾巴 | 绕根部放大 1.5 倍（474 mm，≈ .61），10 节，按沿尾弧长线性分权 | V6_TAIL_LEN |
| 肩胛 | 缩到 ~92 mm、上端入体；跟随前腿：转 .35 × 肩—腕摆角（绕身体左右轴——绕自身 x 轴会把整条前腿平面往里歪，趴姿两爪挤到 118 mm），折叠时沿肋上滑 .06 m × 折叠率 | V6_SCAP_SHORT、V6_SCAP_ROT、V6_SCAP_SLIDE |
| 后腿 | 股骨 135、胫骨 132 mm，髋 / 跗 / 趾不动，膝在两圆交点前侧重求 | V6_HIND_LONG、V6_FEMUR、V6_TIBIA |
| 跑 | 旋转 gallop（左后→右后→腾空→右前→左前→腾空，着地 u 0/.08/.45/.53，duty .30，stride .24）；脊柱屈伸 .35（收拢 u .95、舒展 u .45），骨盆反向一半；腾空腿前伸过落点再收回（前 .10）、后腿先拖后（.08）再收到腹下（.10） | V6_RUN_GALLOP、V6_RUN_* |
| 跳 | 六阶段：蹲（根 -80 mm）→ 蹬（二次上升，离地速度接抛物线）→ 起跳躯干抬头 43°（Pelvis -.75）→ 顶点放平收腿 → 落地前低头 17°、前爪先着 → 缓冲 -60 mm → 恢复；腾空腿目标在躯干坐标里给，离地 / 着地 .05 内淡入地面落点 | V6_JUMP_PHASED、JUMP_PITCH、JUMP_LEGS |
| 走 | 背随后爪支撑左右微弯 .035、髋滚 .03、尾反向 | — |
| 尾巴路径 | `_tail_wrap`：在世界里沿身体外轮廓（躯干 + 爪 + 头采样）贴地铺一条路径，每节骨依次指向路径上一节骨长处。趴下：经 +x 侧到前爪旁；蜷睡：自动穿过臀与脸之间的缺口（封环）到下巴。逐关节转角做不到：身体一滚，俯仰变成地面内扫、侧摆变成抬起 | V6_TAIL_WRAP、V6_LD_TAIL_LEAD .7、V6_SP_TAIL_LEAD .5 |
| 姿势参数 | 趴下 spine .06→.15、neck .12→-.05、head -.12→.05、f_dy .24→.18、h_dy .05→-.03、尾根垂 -.45；蜷睡 spine 1.4→2.2、neck .9→1.1；侧卧尾 .35/.55→0/0；坐 SIT_PITCH 52→58 | V6_LD_* V6_SP_* V6_SG_* V6_SIT_PITCH |
| 修 bug | Happy / Knead 的尾巴「向上」写成了负值（尾巴 + 才是上），1.5 倍尾后 Happy 穿地 39 mm；尾巴离地保护改为全动作 | — |

### codex（批次 6）

- `reviews/FELINE-RIG-NUMBERS-FOR-CLAUDE.md`：带出处的比例数字（Peters 1983 幼猫 / 成猫骨长、Day & Jayne 2007、InVet 2018 脊柱分段、Harper 2004 尾长）和对照结论；姿势关节角大多「未查到」，codex 没有编。
- 10 张图（`reference/`）：`lingxi-ref-pose-{liedown,sleep,sidelie}-top.png`、`lingxi-ref-run-{extended,gathered}-side.png`、`lingxi-ref-jump-{crouch,takeoff,air,land}-side.png`、`lingxi-ref-sit-side.png`。俯视图第一次给出尾巴在地上的走向。
- 对照渲染新增 `VIEW=top`（`round-v-test/render_target.py`，正上方、头朝下）。

### 量测（`v6/round-x/`，带毛构建；审计 review-clips / review-gait）

- 各动作代表帧最低点（mm）：Idle -0.4、Walk -1.1、Run 31.6（腾空帧，正常）、LieDown +1.4、SideLie -0.1、Sleep +2.8、Happy -0.4（上一稿 -38.6，尾巴）、Lick **-7.5**（坐着的大腿皮肤压进地面，毛里；上一轮 -3.1）、PawPlay -4.4（旧）。
- 奔跑着地打滑：前爪每帧 0.75 / 1.12 mm、鞋底 0.76 / 1.12（肩胛绕自身轴时是 3.2–3.5 / 6.0–6.5）、后爪 0；腾空帧 133–136、147–151 两段。走：前爪 0.77 / 0.58（W 1.12）。

### 还差（对照 codex 目标）

- 趴下的身体比目标长（俯视宽/长 .57 对 .82，侧面半高处长度/身高 1.24 对 1.09）：姿势只能缩一点，根子在躯干——codex P1：脊柱骨线在背线下 .32–.59D（骨盆处最深），躯干是圆筒；下一轮把骨线提到背线下 .20–.30D 并重看肋廓体积。
- 趴下尾巴绕到大腿旁为止（目标到右前爪）——和上一条同源，身体缩短后再看。
- 蜷睡尾巴封住了臀—头缺口，但在环的侧面，目标横在下巴正前方。
- 奔跑伸展相：目标四腿更平、完全腾空；可再加 reach 与 stride。
- 舔爪坐姿臀部 -7.5 mm：SIT_HIP 抬 5 mm 左右再试。
- 交付里没改的：爪、嘴、哈欠（Round W 状态）。

审阅页（目标 | Round X，含骨架透视）：https://claude.ai/artifact/7fLTHVDwCd8pRXEXiiBGiW（v14）。

---

## Round X2（Claude 主会话，2026-10-12）——尾尖、爪关节、卧/坐的软组织与腿的自由度

用户：「似乎尾巴被截断了？」「卧的相关效果还不好是不是需要再继续增加骨骼？腿部不够灵活也是这个原因吗？」「让 codex 给我们提供这些是对的，继续按照这个模型」。

回答（写在这里备查）：尾巴截断是网格问题（开口管子，毛垂直于侧面长，末端一刀切），不是骨骼。卧姿不好主要不是骨数（背 5 节、颈 2 节已够弯），而是躯干不会贴地压扁外摊、后腿只能在竖直平面折、脊柱骨线深；腿不灵活一半是缺关节（爪骨 = 掌/跖骨 + 整只爪，没有掌指/跖趾关节），一半是求解自由度（没有髋外展外旋）。

### codex 批次 7

- `reviews/FELINE-SOFT-TISSUE-AND-FOOT-FOR-CLAUDE.md`：修正形变的做法（PSD / 形态键 + 由骨变换驱动、毛根跟随最终皮肤、Corrective Smooth / Preserve Volume 的局限）、MTP 实测（Gregor 2006：步行落足 214°、支撑最大伸展 245°，论文自己的角度口径）、髋外展 / 旋转步行范围 ~13–15°（单只代表猫）、前臂旋前旋后（定义不一，不可相加）；卧 / 坐的关节角与截面变化「未查到」。优先级：P0 爪关节、髋外展 + 外旋、LieBellySpread / LieFlankThigh；P1 肩外展、前臂扭转、SitHaunch。
- 9 张参考图：`lingxi-ref-lie-{hind-closeup-side,front-low,back}.png`、`lingxi-ref-sit-{front,back,hindfoot-closeup}.png`、`lingxi-ref-hindfoot-pushoff-closeup.png`、`lingxi-ref-stretch-side.png`、`lingxi-ref-tail-tip-closeup.png`。

### 改动

| 项 | 做法 | 旋钮 |
|---|---|---|
| 尾尖 | 末端半球封口（5 圈 + 顶点），每圈垂直于尾巴自身走向（原来都是竖直 x-z 圈，上翘处被斜切）；尾毛顺尾巴折线的切向梳（原来全局 +y），封口处的毛继续伸出成圆尖 | V6_TAIL_CAP |
| 爪关节 | 每条腿加 Foot 骨（MCP / MTP）：前爪在原爪骨 55% 处分开、共线，后爪在原爪骨末端；趾、主垫挂 Foot。权重：沿足向过关节 ±1 cm 渐变，**整个爪底（z<5 cm）全给 Foot**（否则跖骨放平时爪跟半团甩成白刃）。`leg_ik(..., foot_ang)`：给定世界角时 Foot 单独转，None 时刚性（与旧版一致） | V6_FOOT |
| 平脚 | 趴下四爪、舔爪着地三爪、伸懒腰前爪：Foot 保持静止时的世界角（平贴地面），随姿势进度渐入 | — |
| 蹬地 | 起跳 .20 → 离地：跖骨上翻 .6 rad，跖趾关节钉在地面、爪平，跗部抬起（codex 蹬地特写）；离地后从这个落点淡出到空中目标 | — |
| 修正形变 | 三个形态键，身体 + 所有身体毛条同一静止空间映射（同 Breath）：LieSpread（腹线以上压低 20%、加宽 30%、沿身长收 8%，排除腿上的皮肤——不排除时折叠后腿被扯出白膜）、FlankThigh（股骨权重的皮肤外推 65 mm）、SitHaunch（臀中段 z .10–.34 鼓 25%，底边不动——底边最大时外翻成裙边）。权重由 `_correctives()` 每帧从骨架算：LieSpread = 胸低 × 骨盆低 × 躯干未侧翻 × 前臂平放（跳跃下蹲前臂竖直，不触发）；FlankThigh = 双髋屈 × max(骨盆低, 坐)；SitHaunch = 躯干竖起 25–45° × 骨盆低 | V6_SPREAD_X/Z/Y、V6_THIGH_DX、V6_HAUNCH_X |
| 膝外撇 | `_knee_out`：股骨绕「髋→跗」轴向外转（跗不动、爪保持世界朝向），趴下 .75、舔爪坐 .5；趴下后爪横向外放 6 cm（abduct） | V6_LD_KNEE_OUT、V6_SIT_KNEE_OUT、V6_LD_H_DX |
| 趴下后腿 | 跗高 .09 → .04、跗在髋后 2 cm：.09 是一体爪时代为不穿地垫高的，结果爪悬空、膝被抬到髋高、大腿翻上去把臀侧扯出棱 | V6_LD_H_Z、V6_LD_H_DY |
| 坐姿后腿 | 跗放到髋前 5 cm（原来髋后 3.5 cm：两段腿只能把膝折到地上、跗和爪翘起）；舔爪的跗额外抬高 .03 取消 | V6_SIT_HOCK_DY、V6_LH_DZ |
| 大腿肉 | Round X 的股骨 / 肱骨随动权重沿骨向膝 / 肘渐弱（t>.4 起，.75 处为 0） | V6_GIRDLE_END |
| 伸懒腰 | 改成弓背前伸：骨盆绕髋前倾 .42、胸口近地、前臂沿地面前伸 20 cm 平爪、后腿站、抬头、尾巴上翘（原来只是根骨降 4 cm、前爪滑 11 cm） | V6_STRETCH_BOW、V6_BOW_PITCH、V6_BOW_REACH |
| 对照工具 | `render_target.py` 新增 VIEW=front / back（平视）和 FOCUS=<骨> SPAN SHIFT 特写；`cv7.sh` 渲 codex 批次 7 的机位 | — |

注意：身体和身体毛条现在有 4 个形态键（Breath、LieSpread、FlankThigh、SitHaunch）。导出 GLB 时每个都是全顶点的变形目标，接入应用前要看体积，必要时只导出身体、不导出毛条上的这三个。

### 量测（`v6/round-x2/`，带毛）

- 最低点（mm）：Idle -0.4、Walk -1.1、Run 31.6（腾空帧）、LieDown **-2.7**（228 帧，躯干皮肤在毛里，过渡中）、SideLie -0.1、Sleep +2.5、Lick **-8.1**（坐的臀底，在毛里）、Stretch -0.4（第一稿前爪目标下压 25 mm、平爪穿地 -24.8，已改）、PawPlay -4.4（旧）。
- 步态打滑与 Round X 相同（走 前 .80/.61、后 1.04/1.05 mm/帧；跑 前 .75/1.12、后 0）——Foot 在走跑里是刚性的，不影响。
- 宽 / 长（俯视，带毛）：趴下明显变宽（Round X .57，目标 .78–.82），见审阅页 x2-liedown-top。

### 还差

- 无毛看：深屈的跗关节附近仍有线性蒙皮扯出的白膜（趴下后腿外侧、坐着的臀底边缘一圈皮边）；毛基本盖住。正解是 codex 说的局部修正形状 / 只在关节附近的 Corrective Smooth，下一轮做。
- 趴下正面两肩外侧的鼓包（肩胛折叠上滑 + 上臂随动），同上。
- 蜷睡尾巴未横到下巴正前方；趴下尾巴未绕到前爪旁。
- 坐姿只有舔爪里的坐（爪举着），目标端坐（两前腿并拢）没有对应动作；坐姿臀底 -8 mm。
- 肩外展、前臂旋前旋后（codex P1）未做。

审阅页（目标 | Round X2，26 组）：https://claude.ai/artifact/7fLTHVDwCd8pRXEXiiBGiW（v15）。

---

## Round Y（Claude 主会话，2026-10-12）——骨架 v1 定稿实施（冻结）

用户：「先一次性把骨骼足够后，我们再进行后续，否则一直补不完」→ 同意先盘点方块猫的动作和表情定需求，再一次实现、冻结；「面部我觉得很重要…我们会有很多表情动作」；确认清单后「继续按照这个干」。

- 需求与规格：`reviews/RIG-REQUIREMENTS-v1-DRAFT.md`；页面 https://claude.ai/artifact/CpnEaXru5fvyKmrQW5J6QE（含 v1 规格）。依据：主仓 `apps/lingxi/src/data/actions.json`（49 个动作）、`rig/art.ts`（五层表情：眼 13 / 眉 5 / 嘴 6 / 耳 4 / 符号 7，内置 30 种，可叠加在任何动作上）、`fx/performances.ts`、`anim/interactions.ts`、`anim/gait.ts`（应用内实时步态）。
- codex 批次 8：`reviews/FELINE-FACE-AND-DOF-FOR-CLAUDE.md`（CatFACS 动作单元 ↔ 五层表情；耳 / 瞳孔 / 胡须 / 舌的范围；实时脸部绑定与分层；新动作关节试值；three.js r186 的骨纹理与 morph 数组纹理机制——没有「最多 8 个」限制）；13 张参考图 `reference/lingxi-ref-face-{eyes-a,eyes-b,mouth,ears-brows}.png`、`lingxi-ref-act-{scratch-ear,wash-face,groom-side,loaf,belly-up,rear-up,hiss-arch,pant-sit,turn}.png`。

### 实施（`V6_FACE_V1`，默认开）

| 项 | 做法 |
|---|---|
| 耳 | Ear 骨从中间分出 EarTip；耳壳、耳内饰毛、耳毛按沿耳高度从根到尖渐变权重。控制：EarForward（绕 X，尖朝前）/ EarFlatten（绕 Y 向外压平）/ EarSwivel（绕耳轴，耳口外转）/ EarTipBend，四者在 `v6_face_apply.py` 里合成一次转动 |
| 舌 | Tongue 分三节（Tongue / TongueMid / TongueTip），权重沿舌长渐变；新形态 `Curl`（前 45% 向上回卷到 ~75°，codex：舔和喝水是 J 形，不是深勺） |
| 脸部控制骨（14） | BrowIn / BrowOut / MouthCorner / LipUp / NoseSide / Nostril 各左右 + LipLow（挂 Jaw）。权重 = 高斯场（`face_fields`：只在脸前面，眉避开眼睑缘，上唇只在嘴线以上、下唇只在以下，总和 ≤ .95），从 Head / Jaw / LipUpper 的份额里分出；脸上的毛按毛根自动跟随。**没用形态键**：头部毛条约 130 万点，18 个形态键要多占 ~300 MB |
| 眼睑 | 新形态键（眼睑 + 眼睑毛，同一套 `lid_turn` 精确旋转）：上睑 `Wide`（-.25，超开）/ `Smile`（.80）；下睑 `Lift`（.45）/ `Smile`（1.25，推过汇合线藏到上睑后，闭眼线成为更高的拱——^ ^） |
| 瞳孔 | 每只眼一份虹膜材质 `LX_IrisLayer.L/R`，节点 `LX_PupilW` / `LX_PupilH`（UV 半宽 / 半高，虹膜半径 .5）：竖缝 .05×.44、平常 .31×.34、放大 .37。**应用侧注意**：材质名从 `LX_IrisLayer` 变成了带 `.L/.R` |
| 高光 | 角膜高光节点命名 `LX_Catch*`，`Sparkle` 控制按倍数放大 |
| 前臂扭转 | `ForearmTwist.L/R`（前臂中点→腕，挂 FrontLower），前臂下半皮肤 30%→85% 渐变给它；`_forearm_twist` 每帧取爪子绕前臂轴的扭转（swing-twist）的一半给它。舔爪掌心转向 .55 → .85 |
| 三维腿 | `leg_ik(..., paw_dir=)`：掌 / 跖骨按世界方向，随外展平面一起换算（外展时用竖直平面里的角度会把脚尖指向内下） |
| 新动作 7 个 | Sit / Loaf / BellyUp / ScratchEar / WashFace / GroomSide / Turn（帧 777–1172，接在 PawPlay 后，原 15 个帧号不变）。坐姿类复用舔爪的坐解；香箱 = 趴下 + 前爪折到胸下（`_LOAF`）；翻肚 = 根骨滚 2.7 rad、胸反扭、四爪在躯干坐标里收起、脸用世界朝向、`_rest_on_floor`（双向贴地）+ `_head_off_floor`；挠耳 = 头向左下侧歪并上仰（**骨盆不翻**：骨盆是躯干根，翻它会把整只猫放倒）、左后脚**脚尖**到耳后（跗目标沿髋→耳退回一个跖 + 爪长、`paw_dir` 指向耳）；洗脸 = 舔爪的空间臂解 + 头部坐标里耳后→脸颊→嘴边两遍；转身 = 根骨偏航 90°、身体 C 弯、四爪按 FL→HR→FR→HL 依次抬起落到转后的位置 |
| 防穿地 | 躯干采样加入大腿（RearUpper）皮肤；坐姿类与舔爪开躯干防穿地，坐姿类开爪防穿地 |
| 接口导出 | 构建写 `face-controls.json`（语义控制 → 骨位移 / 骨转动 / 形态键 / 材质参数；五层每个状态的控制值；art.ts 的 30 种表情）；`scripts/lookdev-v6/v6_rig_export.py` 写 `rig-v1.json`（每根骨：父、静止头尾、长度、是否变形、分组；每个网格的顶点数、组数、形态键）；`v6_face_apply.py` 在 Blender 里套任意表情并出图，`v6_face_sheet.py` 拼表 |

骨数 86（预算 ≤128）：躯干 6、颈头 4、耳 4、眼 6、脸部控制 17、舌 3、前腿 20、后腿 16、尾 10。

### 量测（`v6/round-y/`，带毛）

- 22 个动作最低点（mm）：Idle -0.4、Walk -1.1、Run 31.6（腾空帧）、LieDown -2.7、SideLie +6.1、Sleep +2.1、Curious -0.4、Happy -0.4、Yawn -0.7、Lick **-7.9**、Bite -0.4、Knead -0.7、Stretch -0.4、PawPlay -4.4（旧）、Sit -0.9、Loaf -2.7、BellyUp +3.9、ScratchEar -1.3、WashFace -1.3、GroomSide -1.3、Turn +4.1。SideLie / Sleep 比 X2 高 2–6 mm：躯干防穿地采样加了大腿皮肤。
- 第一稿新动作穿地：BellyUp 头 -24.8（加 `_head_off_floor`）、GroomSide -37.1、ScratchEar -11.8、坐姿 -8.1（坐姿类开躯干 / 爪防穿地、采样加大腿）——都已修。
- 走 / 跑打滑与 X2 相同。原有 15 个动作回归通过。
- GLB（`export_lingxi_v5_glb.py`）：24.8 MB，1 个蒙皮 86 关节，22 个动作，身体 4 个形态键、眼睑 / 爪尖 / 舌各自的形态键。
- 表情：`face-expr/sheet.jpg`（30 种）、`face-layers/sheet.jpg`（28 个单层状态），带毛渲染；审阅页 v16。

### 冻结

- 冻结接口：`reviews/rig-v1/rig-v1.json`（`v6_rig_export.py`）与 `reviews/rig-v1/face-controls.json`（构建写出）。
- 规则：之后只调姿势和外观（幅度、关键帧、修正形态）；需要新骨 / 新控制时，先评估、改需求文档、出 v2，不随手加。
- 后续（不需要新骨）：立起来够、哈气弓背炸毛、坐着喘气这三个方块猫动作；眉和嘴角 ω 幅度；舔爪臀底 -7.9 mm（右肩胛下滑，舔爪求解之后再抬会破坏舌—肉垫接触）；挠耳和侧身理毛的头部朝向。
- **应用对接要点**：虹膜材质名变为 `LX_IrisLayer.L/.R`；表情按 `face-controls.json` 在动画混合之后叠加（身体片段里的脸部通道要么清零，要么按通道合成规则处理）；应用内实时步态要换成新的腿链（爪多了 Foot 节、背和颈各节拆成两段，转角对半分）。

审阅页：https://claude.ai/artifact/7fLTHVDwCd8pRXEXiiBGiW（v16）；规格页：https://claude.ai/artifact/CpnEaXru5fvyKmrQW5J6QE（v3）。

## Round Z（Claude 主会话，2026-10-12）——表情拉开、竖瞳、胸毛、尾尖；修骨架 v1 张嘴回归

用户：「表情不对，我看着所有表情都一样，另外胸前的毛是不是太多了？……尾巴尖还是秃的。……眼睛竖着的时候多了一个竖线这是啥？」
codex 批次 9：`assets/characters/lingxi/v5-imagegen-sources/iris_nopupil.png`（无瞳孔虹膜）、`reviews/FACE-STRICT-COMPARE-FOR-CLAUDE.md` + `reviews/face-target-measures.json`（四张九宫格 36 格量化、我们 28 个单层状态逐格差距、21 对近似表情、胸毛和尾尖审查）。

| 问题 | 原因 | 改法 |
|---|---|---|
| 竖瞳多一条线 | `iris_albedo.png` 中间画死了半径约 .25 UV 的黑洞，竖瞳时洞的边缘露成平涂圆盘 | 构建优先用 `v5/textures/iris_nopupil.png`（需从 v5-imagegen-sources 拷入；两处都在 .gitignore），没有时着色器把纹理半径映射成 .26+.48r 盖住洞；瞳孔在高宽比 1.8→4.3 之间过渡成梭形（半宽 ×(1−y²)）。竖瞳 W .058 / H .35（可见 .13×.80，目标 .11–.13×.77–.82） |
| **张嘴 / 哈气都一样（回归）** | 骨架 v1 的脸部控制骨把份额同时从 Head 和 Jaw 里扣：头部网格 `_hk=1−Σ`、`_with_face` 统一乘 (1−Σ)，嘴角骨（挂 Head）拿走下唇内侧 .5–.9 的权重，张嘴时这块皮肤留在头上挂成浅色帘子 | 每个控制骨只从自己一侧扣：LipLow（挂 Jaw）扣 Jaw 份额，其余扣 Head 一侧。审计：哈欠开口 84.5（X2）→ 34.5（Y）→ **82 mm**；咬 57 → 11 → **56.5 mm**；舌与头部交叉 57→38 对、与上唇 30→0 |
| 表情都一样 | 状态间只差瞳孔几个百分点；眉动在毛下看不见；嘴被帘子挡 | 按 codex 量值重定五层预设（见构建里 LAYERS 的注释）；新增上睑形态键 `SlantIn` / `SlantOut`（整片下压，内 / 外侧多：.12+.80·w^1.3），眉的 furrow / sad 通过它表现；`MouthWide` 控制；`Sparkle` 另点亮三颗额外高光（`LX_SparkX*`，平时强度 0）；`expression_extras`：方块猫只靠屏幕符号区分的表情给 3D 脸附加量。张嘴角度按审计换算（鼻宽 33.8 mm）：open .18、喵 .22、哈气 .45、吐舌 .10 |
| 胸前毛多 | 侧面投影的白色把胸前整面涂白；胸毛 bib 加长 | `chest_bib()`：胸前白色只留中间一道（半宽 30→58 mm 由下到上），两侧换成侧面虎斑；`V6_BIB` .45→0、`V6_HEAD_BIB` .5→.2、新 `V6_CHEST_TRIM` .50（胸前朝前的毛短一半） |
| 尾尖秃 | 尾端半球盖皮肤浅色，尾尖毛按毛根绑骨，尾尖一翘皮肤戳出毛外；主体尾毛 15 cm、立起 1.7，尾尖细毛刷与它体积断开 | 尾管最后 3.6 cm 收细（18→10 mm）、末端 10 cm 染深；尾尖毛刷（`groom(brush=)`，约 4500 根）沿尾巴收拢到尖外 4.5 cm；主体尾毛最后 12 cm 逐渐并入毛刷形（`V6_TAIL_BRUSH_L`）；两者都按点绑定（伸出尾尖的点只跟最后一节） |

### 量测（`v6/round-z/`，带毛）

- 21 对近似表情的脸部像素差（`expr-pair-mae.json`，同 codex 的框）：中位数 0.9 → 4.1，最小 0 → 1.5，低于 1.3 的对数 20 → 0。
- 眼睑斜切相对眨眼的比例（左眼外→内）：SlantIn .12→.92。带毛渲染里皱眉、委屈看得出，但幅度仍弱于目标（furrow 目标斜率 +.18 虹膜径）。
- 舔：舌尖贴肉垫 -0.03 mm 不变；脸部机位下嘴被爪挡住（开口读 0 是遮挡，不是帘子）。
- 新工具 `scripts/lookdev-v6/v6_face_try.py`：不重建，直接把任意控制值组合渲成脸部特写（`FACE_TRY` JSON，`ZOOM` / `ZOOM_Z`）。
- 接口：`reviews/rig-v1/face-controls.json` 更新（只增：LidSlantIn/Out、MouthWide、sparkx、expression_extras；骨架未变，rig-v1.json 不变）。

### 还差

- 笑眼弧线被眼睑毛压得淡；平嘴 / ω / 撇嘴差别小（嘴线被胡须垫的毛盖住）；含泪的湿亮下眼缘（材质）；单耳侧转无状态。
- 坐姿正面胸腹比目标鼓、前腿显短——坐姿身形，下一轮。

审阅页：https://claude.ai/artifact/7fLTHVDwCd8pRXEXiiBGiW（v17）。

## Round ZA（Claude 主会话，2026-10-13）——接触修复（codex 任务书 P0/P1）

依据：codex `reviews/CAT-REALISM-GAP-CLAUDE-BRIEF-2026-10-12.md`（Round Y 基线）与批次 10 `reviews/ROUND-Z-REMEASURE-2026-10-13.md`（Y→Z 重测，"Z 之后先改的 5 项"）。本轮做第 1、2 项和代表帧穿地；脸部 / 白胸（第 3–5 项）留下一轮。

| 问题 | 原因 | 改法 |
|---|---|---|
| Jump 足底 -15.12 mm、支撑滑移 7.24 mm | 爪从空中位置混回落点时高度和水平共用一条曲线：碰地时还在水平移动；落地那一帧爪角从空中姿态一次转回平放（~13°），绕骨头转，垫子跟着滑；高度只截到 0，而前爪站立时骨尾离地 48 mm | 水平位置与爪角在落地前（时间 .02 + 离地最后 3 cm）先到位，落地只剩竖直；转平后高度不低于站立高度（`V6_JUMP_PLANT`）。起跳对称 |
| Lick -7.9、Loaf / LieDown -2.7 mm | 都是后爪脚跟（RearPaw .77）：爪防穿地在膝外撇**之前**检查，外撇又把脚跟压下；Lick 不在名单；采样每 3 个顶点取 1 个，漏掉最低点 | 外撇之后再查、不够则抬目标并连同外撇重解；Lick、PawPlay 加入；采样取全部顶点并加肉垫 / 趾豆 |
| PawPlay -4.4 mm | 踩奶的脚趾屈伸也用在玩爪，撑地那只前爪的脚趾扣进地面 5 mm | 玩爪只屈拍打那只爪的脚趾（`V6_PAWPLAY_PLANT`） |
| Walk "滑移 5.36 mm" | 审计量的是最低 3 mm 带的中心，脚掌从跟滚到趾时它自然前移；同一批着地顶点只动 ≤1.2 mm | 审计新增 `sole_material_step_mm`（同一批顶点）与 `sole_low_frame`；修正过时注释：步行足落是同侧序列 RH→RF→LH→LF（与 Thibaudier 2014 一致），不是"对角"。新工具 `v6_stance_probe.py` |

### 量测（`v6/round-za/`，带毛，同口径）

| 项目 | Y / Z | ZA | 门槛 |
|---|---|---|---|
| Jump 足底最低 | -15.12 | **-0.37**（第 162 帧后爪） | ≥0（试行 ≥-2） |
| Jump 同点滑移 前 / 后（mm/帧） | 8.85 / 7.21 | **3.35 / 0.04** | ≤3（前爪剩起跳下蹲第 164 帧） |
| Walk 同点滑移（中心法） | —（5.36） | **≤1.23**（5.36，含滚动） | ≤3 |
| Run 同点滑移 | — | ≤1.12 | ≤3 |
| 代表帧最低：Lick / Loaf / LieDown / PawPlay | -7.9 / -2.7 / -2.7 / -4.4 | **-1.7 / +0.2 / -0.4 / -0.4** | ≥-2 |
| 代表帧最低：Sit / ScratchEar / WashFace / GroomSide | -0.9 / -1.3 / -1.3 / -1.3 | -1.2 / -1.7 / -1.7 / -1.7 | ≥-2 |
| 舔：舌尖—肉垫 / 舌与头部交叉 | -0.03 / 38 | -0.03 / 38 | 接触；交叉清零（未做） |
| 张嘴开口 Yawn / Bite | 82 / 56.5 | 82 / 56.5 | 不变 |

### 下一轮（codex 第 3–5 项与第二梯队）

喵口过宽（open 可见宽约 1.75 鼻宽，目标 .63：开口宽度来自嘴缝几何，用 MouthO 收）；笑眼闭弧 .04→.12（逐点眼睑分数做 ^ ^ 拱）；坐姿白胸 1.05→.64 头宽；吐舌外伸 .03→.25；brow:flat 与 none 同图；Jump 起跳下蹲前爪 3.35 mm；舔时舌与头部交叉 38 对。代表帧之外的全帧接触扫描尚未做。

## Round ZB（Claude 主会话，2026-10-13）——坐姿后腿、侧看穿模、嘴和舌

用户：「后腿的骨骼坐姿不对，眼睛 side 的时候好像会穿模，嘴巴和舌头，尤其是舌头不太对」。codex 批次 11：`reviews/SIT-EYE-TONGUE-AUDIT-2026-10-13.md`、`reference/lingxi-ref-sit-skeleton-side.png`、`reference/lingxi-ref-tongue-mouth.png`（blep / 喵 / 舔爪三联）。

| 问题 | 原因 | 改法 |
|---|---|---|
| 坐姿后腿 | 骨盆 17°（站 12°）只在腰上抬起；髋 .46H（目标 .55–.75H）、股骨水平而膝高于髋、跗在髋前 50 mm 离地 65 mm；膝外撇 .5 把后脚掌转向镜头（正面两个白圈） | 坐姿解默认：髋 .17、背 48°、跗在髋前 15 mm、跗高 .036、爪角 -170°、膝外撇 .2、不再给后爪 +13 mm（`V6_SIT_*`）。结果骨盆 27°、股骨向前略向下、膝在半高（109 mm）、胫骨折回、跖骨向前：髋—膝—跗的 Z。试过的：坐面接地约束（`V6_SIT_PELVIS`>0，`_seat_low`）——骨盆 35–40° 时胖臀沉地 50 mm，全身抬起后前爪悬空 30 mm；跗在髋后（codex 读图）——这只猫髋太低，膝落到地面（41 mm） |
| 侧看穿模 | 眼是一枚填满眼裂的浅圆顶，GazeYaw 绕 Eye 骨转 37°：一边翘出眼睑和毛（绿色月牙），一边缩进头里（黑楔） | GazeYaw / GazePitch 改为材质参数 `LX_GazeX/Y`（×.30 UV）：虹膜、瞳孔在圆顶上平移，露出的部分是浅色巩膜（`V6_SCLERA`）；圆顶不转。**接口变更**：face-controls.json 里两项从 rotarm 改为 mat |
| 吐舌看不见 | 舔用的 Out 键前送时下沉，小值时进下巴；舌尖只出下唇 6 mm，被唇下长毛盖住 | 新形态键 `Blep`（舌抬过下牙和唇、前段前送 28 mm、略垂在下唇上）；控制 `TongueBlep` = Blep 1 + Out .5；`tongue` 层：张口 .12、TongueBlep 1、下唇 .4 |
| 喵 / 张嘴看不见舌、口腔近黑 | 舌平躺口底，在下唇后；口腔太暗 | 新控制 `TongueUp`（Up 键）；open = 张口 .24 + MouthO .45 + TongueUp .7；喵喵附加 张口 .30 + MouthO .5 + TongueUp .8；哈气 TongueUp .4；口腔亮度 1.2→1.6 |

### 量测（`v6/round-zb/`，带毛）

- 坐类代表帧最低 -1.3 mm（尾，Sit / Lick / ScratchEar / WashFace / GroomSide），趴 -0.4、香箱 +0.2；舔：舌尖—肉垫 -0.4 mm、舌与头部交叉 38（不变）；Walk / Jump 同 ZA。
- 新工具：`v6_pose_numbers.py`（躯干各段俯仰、后 / 前腿关节位置）；`v6_face_try.py` 支持 `key:` / `rot:` / `mat:` 直接值。

### 还差（如实）

- **坐姿体型上限**：前腿只能把肩撑到 ~312 mm，按现身长背再陡胸要再高 ~150 mm，前腿够不着；脊柱弯成弧也只收 ~4 cm。要像参考那样竖直端坐，需要改体型（前腿加长或躯干缩短）——超出冻结范围，待用户定。
- 喵口仍比参考小、窄；blep 时上犬齿露出（参考不露牙）；舔爪正面爪挡住嘴、看不到舌带（codex 建议转头 / 让爪偏到口侧）。

## Round ZC（Claude 主会话，2026-10-13）——舔爪转头露舌、吐舌不露牙、喵口收窄；codex 素材批次 13 发起

codex 批次 12：`reviews/ROUND-ZB-AUDIT-2026-10-13.md`（ZB 之后 5 项：坐姿白胸 1.05 头宽 / 舔爪看不到舌带 / 喵口 1.55×1.25 鼻宽过大 / blep 露两枚犬齿 / Jump 前爪 3.35 mm）。

| 项 | 改法 | 结果 |
|---|---|---|
| 舔爪看不到舌 | 实际起作用的是 round V 的固定头颈（`V6_LICK_TURN` .10、`V6_LICK_TILT` .22），solve_lick 解出的头被覆盖。转向 .10 → .65，手臂仍由 `_lick_reach` 追到舌尖 | 头转向爪、爪移到口侧，正面看到张开的口和伸向爪的舌；舌尖—肉垫 -0.40 → -0.15 mm；舌—头部交叉仍 38 对。solve_lick 里加的"舌尖偏侧"项默认关（`V6_LICK_TIPX`=0，因为它的头部结果不被使用） |
| blep 露牙 | 张口 .12 → .06、下唇 .8、上唇压 -.8 | 正面只见舌尖，不露牙 |
| 喵口过大 | 我在 ZC 前段把张口加到 .38 是加反了；改为张口 .24、MouthO 1.0（嘴角收到底）、TongueUp .9；open 层 .18 / MouthO 1.0 / TongueUp .8 | 口缝本身宽（MOUTH_W），不加骨/形态只能收上唇两侧，仍偏宽 |

坐类代表帧最低 -1.3 mm、趴 -0.4、香箱 +0.2；Yawn / Bite 开口 82 / 56.5 mm 不变；Jump 前爪 3.35 mm 未处理。

**素材**（用户：「除了审计你还需要 codex 给你素材，精雕细琢」）：批次 13 发起——胸前白毛遮罩（对齐新模板 `templates/chest_front_template.png`：身体正面正交，x -0.30→0.30、z 0.62→0.02）、口鼻毛长遮罩（让 ω 嘴线露出）、tongue_v4、sclera、口腔黏膜平铺、按本猫体型的端坐参考两张。说明见 `reviews/ASSET-BATCH13-2026-10-13.md`（codex 写）。

## Round ZD（Claude 主会话，2026-10-13）——接入 codex 素材批次 13、笑眼拱形

素材（`reviews/ASSET-BATCH13-2026-10-13.md`，图在 `v5-imagegen-sources/`，拷入 `v5/textures/`；两处都在 .gitignore）：chest_bib_mask、muzzle_fur_mask、tongue_v4(+bump)、sclera、mouth_mucosa_tile；参考 `lingxi-ref-sit-ownbody-{side,front}.png`（按本猫体型的端坐）。接入代码都是"文件存在才启用"（`load_mask` / `mask_sample`，`V6_MASKS`=0 全关）。

| 项 | 做法 | 结果 |
|---|---|---|
| 胸前白毛（codex 遮罩） | 遮罩是沿 y 穿透全身的正面投影：只按前后位置限范围时，把两侧下腹染成虎斑、侧面丢了白肚；虎斑取样沿用旧法（胸口 y 后移 13 cm）取到的是侧面画里的白胸毛，结果更白。改为按朝向：胸口朝前（胸部椭球法线）用遮罩，朝下的腹面中间留 ±5.5 cm 白、两侧换虎斑（`V6_BELLY_WHITE_W`），侧面不动；虎斑 = 侧面画中段 z≥.33 与背部画同位各半 | 站 / 坐正面白色收成中间一道，侧面白肚保留；两侧仍偏奶油色，不如参考的条纹虎斑深 |
| 口鼻毛长（codex 遮罩） | 原遮罩的线 3–4 mm 宽，胡须垫 1–2 cm 的毛倒下来盖住；盒式模糊 8 px（~3 mm）×3 次、加深 ×2.2（`V6_MUZZLE_BLUR` / `V6_MUZZLE_FUR_K`），仅正面朝向的毛根 | 嘴线略清楚（ω、平嘴），差别仍小 |
| 舌 v4、眼白、口腔黏膜 | tongue_v4 自动替换 v3；sclera 贴图代替平色（用未偏移的 UV）；黏膜平铺（物体坐标 ×18）乘在玫瑰色上 | 侧看露出暖白眼白；舌面有中央沟和乳头纹 |
| 笑眼弧 .04 → 目标 .12 | Smile 键逐点比例：上睑 .80-.6k·sin^1.5、下睑 1.25+k·sin^1.5（越近眼中线上睑闭得越少、下睑推得越高），k=`V6_SMILE_ARCH` .5 | 闭合线成 ^ 形，带毛仍被睑毛压淡 |

### 下一轮

按 `lingxi-ref-sit-ownbody-side.png` 重做坐姿：codex 画出了本体型也能竖坐——脊柱 C 形、胸低落在前腿上、臀坐地、后掌在前。之前"体型上限"的结论偏悲观，先按这张图试脊柱弯曲 + 肩胛下沉，不动骨架。

## Round ZE（Claude 主会话，2026-10-13）——按本体型端坐重做坐姿、胸前涂装、跳跃前爪先离地

codex 批次 14：`reviews/ROUND-ZD-AUDIT-2026-10-13.md`（ZD 之后 5 项：胸侧仍奶油色 / 坐姿骨链与白胸 / 嘴角 / 喵口哈气轮廓 / 笑眼侧看 blep 收尾）、`reference/lingxi-ref-sit-ownbody-skeleton-side.png` + `reviews/SIT-OWNBODY-JOINTS-2026-10-13.json`（在本体型端坐图上标的关节）、`v5-imagegen-sources/chest_front_coat(_alpha).png`。

| 项 | 依据 / 做法 | 结果 |
|---|---|---|
| 坐姿 | 关节图按髋—肩 368 mm 换算：髋高 215 mm、髋—肩连线只上扬 ~20°、骨盆 37°、腰 23°（C 形）、跗在髋正下方 42 mm、膝在髋前下 122 mm——竖坐感来自高髋 + 陡骨盆 + 抬头，背并不陡。坐姿解加骨盆目标（`V6_SIT_PELVIS` 40，与髋高目标并用；坐面接地式改为 `V6_SIT_SEAT`=1 才用），默认髋 .19、背 28°、跗在髋正下（`V6_SIT_HOCK_DY` 0）。试过：髋 .20–.22 + 背 25–30° 但骨盆 18–22°（臀翘离地 7–10 cm，像蹲） | 骨盆 40° / 腰 31° / 背 26°；髋 180、跗 65 mm 在髋下、膝在前下 114 mm；正面竖直紧凑、与参考近；侧面仍比参考长。坐类代表帧最低 -1.3 → -0.3 mm；舔：舌尖—肉垫 +0.33 mm（触到）、交叉 38 对 |
| 胸侧奶油色 | codex 直接画了胸前涂装（白 V + 条纹虎斑）与 alpha；按 alpha × 朝前权重（比白胸遮罩宽：`V6_CHEST_COAT_FACE` 2.2，覆盖斜向 40–70° 的胸侧）上色，颜色过 coat_grade | 站 / 坐正面胸侧出现条纹虎斑，白 V 居中 |
| 跳跃前爪 3.35 mm | 不是脚趾角：第 163–164 帧躯干抬升前倾，前腿已伸直够不着地，爪被横向拖动，165 帧一下离地 77 mm。前爪离地 .27 → .22（`V6_JUMP_F_OFF`），前爪先于后爪离地（164 / 168 帧） | 2.93 mm/帧（≤3） |

下一轮：codex 第 3–5 项（嘴角量、喵口 / 哈气开口形状——要动口缝几何、笑眼 / 侧看 / blep 收尾）；坐姿侧面仍偏长（前腿前斜）。

## Round ZF（Claude 主会话，2026-10-13）——唇线贴图、表情收尾；愤怒脸诊断 → 骨架 v2 提议

- codex 批次 15：`reviews/ROUND-ZE-AUDIT-2026-10-13.md`（ZE 之后：坐侧身长与前腿轴 / 后掌与尾位 / 坐正白胸 .8–.9 → .65–.70 头宽 / 舔爪舌带与相交 38+123 / 嘴线）、`v5-imagegen-sources/lip_line_mask.png`（ω、人中下段、嘴角小勾，对齐 coat_head_front 帧）。
- 接入唇线：头部颜色按遮罩 × 正面朝向压深粉褐（`lip_line()`，`V6_LIP_LINE_K` .85），毛根取色同样变深。嘴角 ×1.4（cat / frown）、笑眼拱 .5 → .7、侧看 .65 → .55、blep Out .5 → .6。
- 结果：平嘴 / ω 嘴的线更深更清楚，撇嘴略可见；仍是"线"的变化，脸本身不动。
- **又一次注释吞代码**：ZF 的 cat 行把注释写在字典行中间，吞掉了同一行的 `'open'`（这次 ast 能过，face-controls 少了 open，表情表报 KeyError 才发现）。已改为注释另起一行，并在提交前扫描"注释后还有字典项"的行。

### 愤怒脸诊断（用户：「现在根本无法做出愤怒的表情……脸部骨骼和皮肤的拉扯关系不够，整个面部是一个整体」）

`reviews/angry-diagnosis-2026-10-13.jpg`：用全部现有控制做愤怒脸，再推到 2.5 倍——耳后压、眉眼内侧斜压、张口露牙能做；鼻梁不皱、胡须垫不鼓不后拉、上唇不整体掀起露牙龈、嘴角不后拉成横向咧嘴、颊不上提、下睑不上挤：口以外的脸不动，2.5 倍也几乎不变（控制已到头）。原因：v1 的脸部控制骨是小范围高斯（嘴角、上唇、鼻翼、眉），各管一小块，没有胡须垫 / 颊 / 鼻梁这类成片联动的结构，也没有控制间的耦合。用户同时问到：脚上的骨够不够、眼睛不传神是否因为没有眼窝和细节。三者都指向骨架 v2（脸部联动结构、眼球与眼窝几何、趾节）。codex 批次 16 正在调研（`reviews/RIG-V2-RESEARCH-2026-10-13.md` + 愤怒咆哮目标图 / 牵拉解剖图 / 眼特写 / 爪解剖图），之后写 v2 规格请用户确认（冻结规则：加骨先出规格）。

## Round ZG（Claude 主会话，2026-10-13）——骨架 v2 第一步：脸部成片联动

用户：「好的，继续吧」（对 v2 方向）。依据 codex 批次 16 `reviews/RIG-V2-RESEARCH-2026-10-13.md`（猫面部表情肌联动、CatFACS AU、推荐 9 根脸部变形骨与"咆哮"耦合表、眼与爪的最小实现）与目标 `reference/lingxi-ref-face-angry-snarl.png`。

- 新骨 9（`FACE_V2`，均挂 Head，按本头部的地标放置，作者空间）：MuzzlePad.L/R（口鼻隆起球心 x .034 z .462）、UpperLipSheet.L/R（唇线上 8 mm）、CheekLift.L/R（x .080 z .478）、OrbitLower.L/R（下睑下 8 mm）、NoseBridge（鼻皮上 8 mm）。权重：内核 r0 满权、到 r1 smoothstep 衰减（codex 4.2 的 r0/r1），成对的只在本侧、胡须垫与唇片只在唇线以上、颊与下眼眶避开眼本身；与 v1 字段一起按 ≤.95 归一，并按"头侧 / 颌侧"各取各的份额（不复发 Z2 的帘子）。
- 控制：PadLift / LipCurl / CheekLift / OrbitLift（×`V6_V2_K` 2.2 的 codex 起点位移）、MouthRetract（嘴角外 9 后 6 上 2 mm）、NoseBridgeWrinkle。宏（`_macro`，只展开骨位移 / 形态键 / 耳，不含材质）：SnarlMouth（嘴层哈气用）、Snarl（+眯眼、眉压、耳后压）、Sneer.L（单侧掀唇，嫌弃）。hiss 层 = SnarlMouth 1 + TongueUp .4；嫌弃 + Sneer.L；不爽 + 鼻梁皱 .35、胡须垫 .25、下眼眶 .3。
- 结果（带毛，`reviews/rig-v2/` 契约，95 骨）：咆哮时下睑被托起、眼从下面眯、眉眼斜压、耳后压、掀唇露尖牙，整张脸一起动，读得出生气；还差：横向咧嘴（我们偏竖口）、鼻梁皱与胡须垫鼓在毛下不明显、单侧冷笑弱。回归：哈欠 82 / 咬 56 mm 开口不变，舔舌尖—肉垫 0.33 mm。
- `v6_rig_export.py`：新增 face-sheet 分组、`RIG_VERSION`。规格页更新 v2 一节。

下一步（v2）：眼——眼球 + 角膜凸起 + 厚眼睑与湿润内缘 + 内眦凹口 + 浅眼窝（不加骨）；再趾中节 16 根。

## Round ZH（Claude 主会话，2026-10-13）——骨架 v2 第二步（眼）的第一部分：细节

依据：codex `reference/lingxi-ref-eye-closeup.png`、批次 17 素材 `cornea_reflection.png`（等距柱状摄影棚：柔光窗 + 补光条）与 `canthus.png`、`reviews/ROUND-ZG-AUDIT-2026-10-13.md`（ZG 之后：横向咧嘴 W/N≈2.4–2.5 / 上唇翻卷与牙龈 / 鼻褶与胡须垫保体积 / 生气预设别重复加通道 / 嫌弃单侧冷笑）。`V6_EYE_V2`=0 回到 v1 眼。

| 项 | 做法 | 结果 |
|---|---|---|
| 内眦泪阜 | 早有一枚，但放在眼外的毛上（两颗粉珠）且被 hide_render 藏了。改到眼裂内 .84 r、虹膜圆顶之前、压扁，湿润材质（粗糙 .14、次表面 .25，canthus.png） | 内眼角一小块湿粉色；首试放在 .90 r 后方 1.2 mm 时内半被圆顶挡住、只露外半，又成了珠子 |
| 高光 | 圆盘硬边像贴纸 → 椭圆（超椭圆指数 `V6_CATCH_SHAPE` 2）、线性长羽化（From Min 1.6）、强度 3.0。试过：指数 4（圆角方块，更像贴片）；角膜环境反射作唯一高光——两眼各外转 12° 的浅圆顶，远处的窗只落在一只眼上（需要球形眼球，留到眼球体积那步），现保留为淡湿亮层（`LX_CatchRef`，伽马 3 去掉房间的灰，强度 .8，`V6_CORNEA_REF_*`） | 柔和的圆亮斑；节点名注意：反射节点占了 LX_Catch 编号，大高光是 LX_Catch1 |
| 虹膜深度 | 外三分之一乘 .55 暖灰、limbus 环从 .48 加宽到 .46 | 外圈暗、内圈亮，有点立体 |
| 眼线 | 眼睑深色带 .09 → .12 环宽 | 略粗 |
| 眼窝 | `orbit_shade`：眼周 1.05–1.5 眼径的正面皮毛压暗 16% | 眼不再平浮在毛上（轻） |

还差（下一部分：眼球体积）：眼仍是正圆、静止瞳孔大虹膜少；要球形眼球 + 凸角膜（两眼都能映出同一扇窗）+ 厚眼睑包球 + 杏仁形内眦。

## Round ZI（Claude 主会话，2026-10-13）——骨架 v2 眼：体积（凸起）与高光

codex 批次 18：`reviews/ROUND-ZH-AUDIT-2026-10-13.md`（ZH 之后：杏仁眼裂由眼睑成形 / 球形眼球 + 凸角膜 + 包球厚眼睑、两眼映同一窗 / 暗内虹膜与瞳孔比 / 泪阜收进内眦凹窝、湿睑缘 / 方向性眼窝阴影）、`v5-imagegen-sources/eye_outline_template.png`（与现圆眼几乎同大，只在鼻侧下方收一个小尖角——要改圆顶本身，留到下一步）。

- **体积**：`LID_APEX`（`V6_LID_APEX`）4.8 → 10 mm，眼睑球 172 → ~86 mm；虹膜圆顶与角膜随之加深（各 + (APEX-.0048)），眼睑仍绕同一球闭合：闭眼 / 半睁 / 笑眼无穿插（预览 e48/e90/e130 对比）。侧面看角膜鼓出。
- **高光**：画的主高光缩小收紧（超椭圆 .052×.044、From Min 1.3）；角膜环境反射去色（RGBToBW，强度 1.2）——暖窗经伽马 3 后是橙色条，现在是白色弧光；只在一只眼出现（浅角膜 + 外转 12°，物理上如此），主高光两眼都有。
- **又一次注释吞代码**：ZH 的高光改动把 `;cl.new(...)` 连线留在了行内注释之后——Map Range 没接线，整片角膜发白（预览三档全白时才发现；ZH 的正式模型是构建后直接改节点值，所以没暴露）。新增 `scripts/blender/check_swallowed_code.py`（扫"注释里还有 `;代码(` / 字典项"的行），提交前跑。
- **核实**：瞳孔里看到的"竖线"是我并排拼图的接缝，不是模型问题（单张原图无线）；之后眼部对比改为从单张高分辨率渲染里裁出整只眼。

下一步（眼）：杏仁眼裂（鼻侧低尖角，由睑缘形成）、厚眼睑与湿睑缘、泪阜收进内眦凹窝。

## Round ZJ（Claude 主会话，2026-10-13）——骨架 v2 眼：杏仁眼裂、泪阜入内眦、去掉上缘白弧

codex 批次 19：`reviews/ROUND-ZI-AUDIT-2026-10-13.md`（P0 眼裂仍近圆；P1 wide 上缘新白弧；单眼竖亮痕；泪阜像外置粉珠）。批次 20 素材（未接入，下一轮）：`v5-imagegen-sources/lid_margin_upper.png` / `lid_margin_lower.png`（睑 UV：u 外眦→内眦，v 睑缘→毛下；湿粉内缘 + 深棕睑缘线 + 透明渐隐）、`orbit_shade_mask.png`（以眼为中心，1024 px = 3.2 眼半径，右=鼻侧：眉下深弧、内眦凹窝、下缘浅）；模板在 `templates/`。

- **杏仁眼裂**（`lid_base()`，`V6_EYE_ALMOND` 2.0，`V6_CANTHUS_DROP` 15°）：上下睑内缘半径随角度变化——向鼻侧低 15° 处外扩成小尖角（上睑 +.09k·g，下睑 +.05k·g，g = cos⁶），上睑中段下压 .025k；`lid_turn_angle` 用同一内缘算闭合角，闭眼、半睁、单眼眨仍沿同一球面闭合。全睁正脸和 codex `eye_outline_template` 一致（几乎是圆，鼻侧一个小角）；半睁 / 柔和出现明显的杏仁形，内眦朝鼻侧向下。
- **泪阜**：从虹膜上 .84 r 的水平位置挪到杏仁尖角（1.03 r、低 15°），尺寸 ×1.3——卡在内眦，不再是虹膜上的粉珠。
- **上缘白弧（codex P1，已核实）**：`eye:wide` 上睑抬起，角膜顶边的环境反射露成白弧（隐藏角膜或关反射都消失）。反射强度乘 UV 径向遮罩（.33 内全量，.45 外为零，`LX_CatchRefK`），强度 1.2 → .8。
- 单眼竖亮痕仍在（浅圆顶外转 12°，只一只眼映到窗）；笑眼闭弧仍被毛盖住。

下一步（眼）：接入批次 20 的睑缘贴图与眼窝遮罩（厚上睑、细湿下睑、方向性眼窝影），再看笑眼闭弧和瞳孔/暗内虹膜比例。
