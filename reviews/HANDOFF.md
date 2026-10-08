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
