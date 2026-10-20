# Round ZE 差距审计与唇线素材（2026-10-13）

审计基点：提交 `4f7546d`、[HANDOFF 末节](HANDOFF.md)。逐张核对 [ZE 六张目标渲染](../assets/characters/lingxi/v6/round-ze/target/)、[ZE review-clips](../assets/characters/lingxi/v6/round-ze/review-clips.json)、[review-parts](../assets/characters/lingxi/v6/round-ze/review-parts.json)、[review-gait](../assets/characters/lingxi/v6/round-ze/review-gait.json)，与 [ZD 审计](ROUND-ZD-AUDIT-2026-10-13.md)及本体型坐姿正、侧面、[关节推定图](../assets/characters/lingxi/reference/lingxi-ref-sit-ownbody-skeleton-side.png)、[坐姿关节 JSON](SIT-OWNBODY-JOINTS-2026-10-13.json)、坐背、站正、舔爪参考对照。ZD 没有同机位坐侧、坐背、舔爪目标图；这些行的 ZD 栏只写当时审计或交接已有的结论。

以下比例是带毛静图的视觉估读；前后机位、景别和透视不同，不把照片上推定的髋膝跗点当成 rig 实测。关节参考 JSON 明确说髋、膝、跗、肩胛可能各有 20–40 px 偏差。

| 项目 | ZD | ZE | 目标 | 差距 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 坐侧躯干长度与 C 形 | ZD 无坐侧同机位图；交接记录坐姿前腿短、后腿外摊 | [坐侧](../assets/characters/lingxi/v6/round-ze/target/sit-side.png)已抬髋、坐地，但肩到臀的水平跨度仍大，背线长而平，头颈与躯干像横向接续 | [本体型坐侧](../assets/characters/lingxi/reference/lingxi-ref-sit-ownbody-side.png)：胸落在前腿上，腰背向臀连续弯成 C 形，臀坐地 | 端坐感仍不足；视觉上的前后掌水平距约比参考多 0.15–0.25 个头宽，受不同景别影响仅作方向判断 | **部分改善，未达目标**；先调整可见轮廓，再以同机位叠图复测 |
| 坐侧前腿倾斜 | ZD 正面前腿显短；无侧面可量 | 上臂及腕到掌整体向前斜，白前掌落在胸投影之前；前肢读成斜撑 | 关节参考中肩 `(374,613)`、肘 `(356,767)`、腕 `(365,962)`：肩至腕近乎竖直，前掌在末端向前伸 | ZE 毛图无法反推真实肩肘点，但可见腿轴比参考斜，胸体似被前脚撑到后方 | **未达标**；需坐侧无毛骨轴和带毛轮廓同时核验 |
| 坐侧后掌与跗 | ZD 正面后足在身侧成白团；无侧面可验 | 后掌缩在腹下，脚面仅露一小段，尾根与后腿叠在一起 | 关节参考中髋 `(824,775)`、膝 `(705,896)`、跗 `(829,999)`、后趾尖 `(589,1048)`；后跖、后掌由跗向前贴地 | 目标的后掌向前伸出并能辨认掌背；ZE 后掌短而藏于腹下 | **未达标**；不能用“跗在髋下”的求解数值替代可见掌位验收 |
| 坐正头身比例与白胸 | ZD3 连续白胸约 `0.78–0.85` 头宽，白前臂外团明显 | [坐正](../assets/characters/lingxi/v6/round-ze/target/act-sit.png)比 ZD 紧凑，肩外侧由白转棕；但胸白仍铺到两前腿上缘，视觉约 `0.8–0.9` 头宽，头显得偏小 | [本体型坐正](../assets/characters/lingxi/reference/lingxi-ref-sit-ownbody-front.png)白胸约 `0.65–0.70` 头宽，胸两侧暖棕，前腿独立竖直 | 白胸仍宽约 `0.1–0.2` 头宽；棕侧边虽出现，白围脖体积仍显大 | **涂装改善，宽度未达标**；以上为约 ±0.08 头宽的静图估读 |
| 正面胸侧条纹 | ZD3 胸侧浅奶油色，深纹仅肩外缘零星可见 | 站正和坐正胸白两侧出现深棕斜纹，站正比 ZD 明显；坐正肩下仍有两块连续浅棕/白前臂区 | 白 V 外侧立即读成暖棕虎斑，条纹沿胸侧包向前面 | ZE 已能读到虎斑，但纹在胸侧上半部更强，下半部接前腿处不连续 | **显著改善，尚需收尾**；同时检查侧面白肚不被染脏 |
| 坐背轮廓、尾和后腿 | ZD 无同机位坐背；正面后腿外摊 | [坐背](../assets/characters/lingxi/v6/round-ze/target/sit-back.png)背部虎斑清楚，臀坐地；尾主要压在正中下方，挡住臀和两后掌，右侧只露小块白足 | [坐背参考](../assets/characters/lingxi/reference/lingxi-ref-sit-back.png)尾向左横铺成扇，臀两侧与右后掌可分辨，背毛有连续层次 | ZE 的尾位使臀、跗、后掌的验收视线受阻；背部呈窄三角且比参考更规整 | **未达标**；先让尾让出后腿轮廓，再验坐背骨点 |
| 站正白胸及头胸关系 | ZD3 白胸约 `0.70–0.76` 头宽，胸侧奶油色 | [站正](../assets/characters/lingxi/v6/round-ze/target/stand-app.png)中央白胸仍是圆底围脖，外侧虎斑明显；头显宽、四肢短粗 | [站正参考](../assets/characters/lingxi/reference/lingxi-ref-pose-stand-app.png)白胸约 `0.73` 头宽，V 底较尖，前腿与胸分离 | 白胸外宽接近既有目标，底端圆、胸前厚重和头身比例仍有差距 | **宽度基本保住，形状待修** |
| 站侧白腹与虎斑 | ZD3 站侧已有清楚躯干竖纹、白腹 | [站侧](../assets/characters/lingxi/v6/round-ze/target/stand-side.png)腹白仍在，胸侧深色块和身体竖纹可读，未见明显误染白袜 | 侧白腹连续、深虎斑从肩侧向身体过渡 | 胸前的深纹到侧视仍略像独立深色贴片，和躯干条纹连接弱 | **侧白腹保留；条纹过渡待修** |
| 舔爪的舌、爪与接触 | ZD 前已将头转向爪；舌尖到肉垫约 `−0.15` 到 `−0.4 mm`，正面仍易被爪挡 | [舔爪](../assets/characters/lingxi/v6/round-ze/target/lick-paw.png)爪遮住口部，几乎看不到完整舌带或肉垫；ZE review-parts：舌尖到右前掌垫 `+0.33 mm`、头部相交 `38` 对、身体相交 `123` 对 | [舔爪参考](../assets/characters/lingxi/reference/lingxi-ref-lick-paw.png)：粉舌从口边伸到朝镜头的肉垫，爪与舌均可见 | 数值接触近零，但视觉动作不成立；相交对仍未清零 | **接触数值可接受，画面未达标**；必须同时改露垫朝向与舌的可见路径 |
| 闭口嘴线及表情区分 | ZD2 `cat` 嘴角上扬仅 `0.03–0.05`、`frown` 下沉 `0–0.03` 鼻宽 | ZE 六张是姿态目标图，没有 `flat/cat/frown` 单层同机位复测；静帧闭口线仍被胡须垫毛盖住 | 嘴参考第 0–2 格有深粉褐的清楚 ω；`cat` +`0.13`、`frown` −`0.12` 鼻宽 | 现有资料不能宣称嘴角骨位移已改善；估计仍分别少 `0.08–0.10`、`0.09–0.12` 鼻宽 | **未验收**；本次只交付唇线遮罩以改善可见性，位移仍需模型侧单层复测 |

ZE review-clips 的 Sit 代表帧 `789`、Lick `537` 最低点均为 `−0.3 mm`；这只证明代表帧接地近零。ZE review-gait 的 Jump 前掌同点接触位移 `2.93 mm/帧`、后掌 `0.04 mm/帧`，达到既定 `≤3 mm/帧` 门槛；均不能替代本次坐姿与舔爪的视觉验收。

## ZE 之后最该先改的 5 项

| 顺位 | 位置 | 下一步验收动作 |
| --- | --- | --- |
| 1 | 坐侧身长、前腿轴 | 用与本体型坐侧参考同朝向的带毛/无毛双图叠关节；缩短可见肩臀跨度、让肩至腕近竖直，保持前掌落地 |
| 2 | 后掌、坐背尾位 | 让后跖和后掌从跗向前贴地且在侧图可辨；坐背将尾移出臀部与后掌视线，复核对称接地 |
| 3 | 坐正白胸/头宽 | 将连续白胸从约 `0.8–0.9` 头宽收至 `0.65–0.70`，保留中央 V、两侧虎斑及侧白腹 |
| 4 | 舔爪可读性与相交 | 调手腕/爪面朝向，让肉垫和舌带同时入镜；保持舌尖到垫近零并清掉头部 `38`、身体 `123` 对相交 |
| 5 | 嘴线与三种闭口嘴角 | 将新遮罩接入头部前向采样，复测 `flat/cat/frown` 带毛单层；按鼻宽量足 `cat` 与 `frown` 嘴角变化，检查小尺寸仍能分辨 |

## 素材自查

[lip_line_mask.png](../assets/characters/lingxi/v5-imagegen-sources/lip_line_mask.png) 为 **1024×1024、8 位灰度 `L`**；背景 `0`，ω 两弧、人中沟下段与嘴角短勾的芯部 `255`。同 [frames.json](../assets/characters/lingxi/v5-imagegen-sources/templates/frames.json) 的 `coat_head_front` 作者空间对齐：`x −0.21→0.21` 左到右、`z 0.76→0.34` 上到下；中心 `x=512`，嘴线尖点约 `y=738`，两侧谷约 `y=751`，与现有 [muzzle_fur_mask.png](../assets/characters/lingxi/v5-imagegen-sources/muzzle_fur_mask.png) 的暗线同位，并核对 [muzzle_template.png](../assets/characters/lingxi/v5-imagegen-sources/templates/muzzle_template.png) 和 v5 `muzzle_detail.png` 的 ω 方向。普通线芯宽约 `6 px`（`2.46 mm`，按 `0.42 m/1024 px`），嘴角勾约 `7 px`；抗锯齿加约 `2 px` 软边。两端从原嘴角向外各约 `10 px`（`4.1 mm`），下段人中沟止于 ω 尖点。遮罩只编码位置/强度；深粉褐颜色由材质采样，表情嘴角的上扬/下撇仍需骨骼或变形控制。
