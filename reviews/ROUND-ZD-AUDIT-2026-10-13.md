# Round ZD 差距审计与素材交付（2026-10-13）

审计基点为提交 `40cbfd9`（[交接末节](HANDOFF.md)）。姿态读 [ZD3 站正](../assets/characters/lingxi/v6/round-zd3/target/stand-app.png)、[坐正](../assets/characters/lingxi/v6/round-zd3/target/act-sit.png)、[站侧](../assets/characters/lingxi/v6/round-zd3/target/stand-side.png)；表情读 [ZD2 单层](../assets/characters/lingxi/v6/round-zd2/face-layers/sheet.jpg)、[组合](../assets/characters/lingxi/v6/round-zd2/face-expr/sheet.jpg)及对应单图。已核对两份 `items.json`：单层 `03/05/18/19/20/21/22/23` 依次为 `eye:side` / `eye:happy` / `mouth:flat` / `mouth:cat` / `mouth:open` / `mouth:frown` / `mouth:hiss` / `mouth:tongue`；组合 `16` 是“喵喵”，`24` 是“警惕”，`04` 是“不爽”。对照 [站姿](../assets/characters/lingxi/reference/lingxi-ref-pose-stand-app.png)、[站侧](../assets/characters/lingxi/reference/lingxi-ref-pose-stand-side.png)、[本体型坐正](../assets/characters/lingxi/reference/lingxi-ref-sit-ownbody-front.png)、[坐侧](../assets/characters/lingxi/reference/lingxi-ref-sit-ownbody-side.png)、[眼 A](../assets/characters/lingxi/reference/lingxi-ref-face-eyes-a.png)、[眼 B](../assets/characters/lingxi/reference/lingxi-ref-face-eyes-b.png)、[嘴](../assets/characters/lingxi/reference/lingxi-ref-face-mouth.png)、[耳眉](../assets/characters/lingxi/reference/lingxi-ref-face-ears-brows.png)、[舌/口三联](../assets/characters/lingxi/reference/lingxi-ref-tongue-mouth.png)。

沿用 [ZB 审计](ROUND-ZB-AUDIT-2026-10-13.md)口径：白胸最大连续白毛宽除同图头部毛外轮廓宽；脸部以鼻头可见宽归一，嘴角量为相对 `flat` 的竖直升降；笑眼拱高除该眼宽。以下均是带毛静帧的**视觉估读**，胸宽误差约 ±0.06～0.08 头宽，脸部约 ±0.05～0.10 鼻宽，笑眼约 ±0.03 眼宽。前后不同脸部样图取同一 300×300 单图比较；透视、毛遮挡和不同帧不可解释为骨点或三维间距。

| 项目 | ZB/ZC | ZD | 目标 | 差距 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 站正白胸最大宽 / 头宽 | ZB 坐白胸≈1.05；站正旧口径约 0.88（Z 前） | ZD3 站正≈0.70～0.76，中央围脖收成 V 形，前臂上缘露出 | 站姿参考≈0.73 | 约 −0.03～+0.03，落在估读误差内 | **宽度基本到位**；底端仍偏圆，不能据此断言胸毛体积也到位 |
| 坐正白胸最大宽 / 头宽 | ZB≈1.05；ZC 未见同口径新坐正图 | ZD3≈0.78～0.85；比 ZB 收窄，但两侧白毛仍压到上臂内缘 | 本体型坐正约 0.65～0.70；九宫格原坐正≈0.64 | 仍宽约 +0.10～0.21 | **改善未达标**；需继续局部收两侧，保留中央尖端 |
| 胸两侧毛色及条纹 | ZB/ZC 前胸白团大；ZD 接入 bib 遮罩前无新胸侧贴图 | 站/坐正面白胸外侧变成浅奶油棕，深条纹仅肩外缘零星可见；[ZD3 站侧](../assets/characters/lingxi/v6/round-zd3/target/stand-side.png)仍有清晰躯干竖纹和白腹 | 白 V 外立即读到**暖棕虎斑**，深纹沿胸侧竖斜向环绕；侧白腹不被误染 | 正面胸侧条纹对比明显不足，毛色比身体侧片浅 | **未达标**；本批 `chest_front_coat` 与独立 alpha 用于改这一项，尚未接入渲染 |
| 坐姿侧面骨链与后掌 | ZB 毛轮廓约 20～25°、髋膝跗不可从毛图量；ZC 无新同机位量测 | 本次仅有 ZD3 **站侧**，没有 ZD 坐侧/无毛骨轴；坐正后足在身体两侧仍成白团 | [本体型坐侧](../assets/characters/lingxi/reference/lingxi-ref-sit-ownbody-side.png)：C 形躯干、臀坐地、后足向前平贴；固定骨长 | 骨点、跗相对髋、跖骨角与后掌接触均 `null` | **未验收**；附骨骼推定叠图和坐标，可供下一次同姿态对齐，不能冒充模型真骨点 |
| `mouth:flat/cat/frown` 嘴角量 | ZB：`cat` 上扬≈0.03、`frown` 下沉≈0.02 鼻宽；ZC 嘴线仍淡 | ZD2 口鼻毛短后 `cat` 两角暗线稍可见，约上扬 0.03～0.05；`flat` 中性；`frown` 约下沉 0～0.03，和 `flat` 近似 | `flat` 0；`cat` +0.13；`frown` −0.12 鼻宽（[目标量表](FACE-STRICT-COMPARE-FOR-CLAUDE.md)） | `cat` 少约 0.08～0.10；`frown` 少约 0.09～0.12 | **未达标**；毛长遮罩改善可见性，没有拉开嘴角位移；组合“安心/温柔/委屈”也不够分明 |
| `eye:happy` 笑眼闭弧拱高 | ZB 约 0.03～0.04 眼宽，带毛近似普通闭眼 | ZD2 闭合线中部略抬，约 0.06～0.08 眼宽；“满足/开心”有拱势但睑毛压淡 | 参考眼 A 笑眼约 0.12 眼宽，清楚的双 ^ 弧 | 少约 0.04～0.06 眼宽 | **几何方向正确，视觉仍偏弱**；需在带毛、桌面尺寸验证 |
| `eye:side` 眼白与相交 | ZB 黑楔已消失，瞳心横移≈0.27 虹膜径，浅色月牙偏宽 | ZD2 暖白眼白连续可见，未见黑楔或绿色穿睑；两侧露白仍较大，`不爽/警惕` 的斜视也如此 | 眼 A:8 浅色巩膜连续、虹膜被睑包住；横移≈0.20 虹膜径 | 正面露白宽度和横移仍约多 0.07 虹膜径；三维深度差 `null` | **静帧材质改善**；仍需左右 45° 和动态相交检查 |
| `mouth:tongue` 微吐舌 | ZB 外露≈0.20、宽≈0.55 鼻宽，露两枚犬齿；ZC 收口、正面牙不再醒目 | ZD2 亮粉短舌易认，外露仍约 0.18～0.20；上犬齿不再突出，但舌像横平短条、下缘有深色小点 | 三联 blep：外露≈0.25，圆端宽约 0.60～1.10，不露牙 | 外露少约 0.05～0.07，宽距下限约 0.05 | **去牙进步，形状未达**；舌 v4 细纹在这个机位/尺寸几乎看不出 |
| `mouth:open` 与“喵喵” | ZB 单层≈1.60×1.05、组合≈1.55×1.25 鼻宽；ZC 收张口幅度 | ZD2 单层约 1.45～1.60×0.75～0.90；组合“喵喵”仍是横宽、露齿小口，舌在底端可见 | 小圆角喵口约 0.63×0.70；舌宽占口宽 0.50～0.75 | 宽仍多约 0.82～0.97 鼻宽；高度靠近但形不对 | **未达标**；继续收口缝横宽、让口底舌比犬齿更醒目 |
| `mouth:hiss` 口腔与牙 | ZB≈2.20×1.85 鼻宽，长白牙悬挂感 | ZD2 宽高主体近似未变；黏膜更暖，但犬齿与口侧壁仍偏硬 | 参考嘴:6 约 1.80×1.22，牙龈包牙、暗暖深腔 | 宽约 +0.40、高约 +0.63 | **未达标**；贴图只改善色层，口形和牙龈仍需修 |

ZD2 `face-layers` / `face-expr` 是表情静图，ZD3 `target` 是姿态静图；这批图不能验证实时混合、法线穿插、全帧接触或应用尺寸。坐姿侧骨骼图的关节是对参考照片的**约束推定**，不代表当前 rig 已达到这些点。

## ZD 之后最该先改的 5 项

| 顺位 | 位置 | 现在与目标的差 | 建议 |
| --- | --- | --- | --- |
| 1 | 胸侧毛色、条纹 | 正面仍像奶油色，而侧身已有清楚虎斑 | 先按新 RGB/alpha 在模板坐标采样接入胸前，白 V 保持；站/坐正侧三视图复核，避免污染袜子和白腹 |
| 2 | 坐姿骨链及白胸外宽 | 白胸仍约宽 +0.10～0.21 头宽；跗/后掌位置未有侧图可验 | 按新坐侧骨点叠图输出同机位坐姿与无毛骨轴；固定骨长，先调脊柱 C 弯和肩胛，再局部收白胸与后足外展 |
| 3 | `flat/cat/frown` 嘴角 | `cat` 上扬少约 0.08～0.10、`frown` 下沉少约 0.09～0.12 鼻宽 | 放大嘴角位移并检查唇线相对胡须垫毛的遮挡；以三单层和“安心/温柔/委屈”组合复查 |
| 4 | `open/喵喵/hiss` 开口轮廓 | 喵口宽多约 0.82～0.97 鼻宽；哈气宽高仍多约 0.40/0.63 | 改几何口缝横宽与圆角形，不再只压 Jaw；同步摆舌、牙龈和口腔暖暗层次 |
| 5 | 笑眼、侧看眼、blep 小幅收尾 | 笑弧少约 0.04～0.06 眼宽；侧看露白偏宽；blep 外露少约 0.05～0.07 鼻宽 | 在带毛桌面尺寸调笑眼闭弧、侧看虹膜偏移和短舌圆端，再补 45°、眨眼/张嘴动态静帧 |

## 新素材与自查

| 文件 | 尺寸/模式 | 自查 |
| --- | --- | --- |
| [chest_front_coat.png](../assets/characters/lingxi/v5-imagegen-sources/chest_front_coat.png) | 1024×1024 RGB | 按 `templates/chest_front_template.png` 正交坐标（x −0.30→+0.30 m；z 0.62→0.02 m）排版；白 V 取原 `chest_bib_mask.png` 边界，胸侧为同色系暖棕竖斜虎斑；目视检查形状与纹向。alpha 为 0 的区域里 RGB 只作填充，不参与合成。 |
| [chest_front_coat_alpha.png](../assets/characters/lingxi/v5-imagegen-sources/chest_front_coat_alpha.png) | 1024×1024 灰度 L | 胸内主体为 255，沿模板身体外缘约 10 px 柔化；y≤242、y≥733、腿/袜及模板外为 0。由模板 RGBA 轮廓限定，V 白/棕交界没有 alpha 裂缝。 |
| [lingxi-ref-sit-ownbody-skeleton-side.png](../assets/characters/lingxi/reference/lingxi-ref-sit-ownbody-skeleton-side.png) | 1254×1254 RGB | 在**同一张** `lingxi-ref-sit-ownbody-side.png` 上透明叠线；青色前肢/脊柱、橙色骨盆/后肢，虚线表示毛下推定；关节点与各骨段有标名。 |
| [SIT-OWNBODY-JOINTS-2026-10-13.json](SIT-OWNBODY-JOINTS-2026-10-13.json) | UTF-8 JSON | 列出全部标注点像素坐标、地线 y=1054、前/后趾尖 x=272/589、头顶 y=119；肩髋 368 mm 标尺下股骨 130.6、胫骨 124.0、跖骨 77.3 mm，距给定骨长各约 1%；所有毛下骨点标为推定并说明约 ±20～40 px 风险。 |

两张 `v5-imagegen-sources` PNG 位于仓库忽略范围内，若需随提交交付，须显式加入版本控制。只生成上述四项素材/数据与本审计；未改模型、脚本或其他文档，也未将新贴图接入模型重新渲染。
