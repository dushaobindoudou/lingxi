# 灵犀软组织与足部绑定调研（Round X 后）

## 口径

本文把 **实测数据**（原始猫研究）、**工程做法**（图形学 / Blender 文档支持的实现）、**美术试值**（灵犀验收目标）严格分开。角度若未特别说明，不互相换算：不同论文的零位、内角、掌侧角及坐标轴不同。生成参考图只作轮廓目标，不能量骨角或证明皮下接触。项目现状来自 [Round X 交接](HANDOFF.md#round-xclaude-主会话2026-10-12骨架结构与联动重做)、[骨架透视图](../assets/characters/lingxi/v6/round-x-audit/xray-x4.png)；已有成年和幼猫骨长见[批次 6 调研](FELINE-RIG-NUMBERS-FOR-CLAUDE.md)。

| 项目实测 / 观察 | 当前值或约束 | 性质 | 来源 |
|---|---|---|---|
| 趴姿俯视宽/长 | 模型 **0.57**；参考 `lingxi-ref-pose-liedown-top.png` **0.82**；差 **0.25**，参考约为模型的 **1.44 倍** | **项目图像量测**，不是家猫群体常模；毛轮廓包含大腿与长毛 | [Round X 交接](HANDOFF.md#round-xclaude-主会话2026-10-12骨架结构与联动重做)、[俯视目标](../assets/characters/lingxi/reference/lingxi-ref-pose-liedown-top.png) |
| 趴姿侧面半高处长度/身高 | 模型 **1.24**，参考 **1.09** | 项目图像量测 | [Round X 交接](HANDOFF.md#round-xclaude-主会话2026-10-12骨架结构与联动重做) |
| 当前骨架/皮肤 | 主干已拆为胸、腰小段；肩胛约 92 mm、股骨/胫骨 135/132 mm、10 段长尾；腿仍在固定竖直平面求解，`FrontPaw` / `RearPaw` 包含掌/跖与趾 | 项目事实 | [Round X 交接](HANDOFF.md#round-xclaude-主会话2026-10-12骨架结构与联动重做)、[xray-x4](../assets/characters/lingxi/v6/round-x-audit/xray-x4.png) |

## 1. 修正形变：骨骼姿态驱动，而非帧号

**证据边界：**未查到能证明四足动物卧倒腹部、大腿修正形状存在统一“业界标准配方”的原始制作资料。下表的卧姿/坐姿样本是把有文献支持的通用 PSD 与 Blender 驱动方法用于本项目的**工程方案**，不是声称每个四足绑定都这样实现。[PSD 原论文](https://doi.org/10.1145/344779.344862)、[Blender 官方形态键驱动示例](https://docs.blender.org/manual/en/4.1/animation/drivers/workflow_examples.html)。

| 方法 | 有出处的能力 / 局限 | 对灵犀的工程做法（非生理解剖数据） | 来源 |
|---|---|---|---|
| Pose-space deformation（PSD）、RBF 插值 | 在骨架姿态空间按若干雕刻示例插值局部顶点位移；可造出肌肉鼓起、胸廓体积等线性蒙皮不会自动产生的形变。它是姿态映射，不求解真实软组织接触。 | 以髋外展、髋屈曲、躯干离地高度、骨盆/胸段旋转、足接触等**骨变换/骨矩阵衍生量**构成姿态向量；采样站、趴、坐及过渡姿态。给每个样本一套相同拓扑的皮肤增量，按局部区域混合。高度应由骨的世界矩阵求，不由动作名或帧号求。 | [Lewis、Cordner、Fong 2000 原论文](https://doi.org/10.1145/344779.344862)、[原文 PDF](https://www.cs.toronto.edu/~jacobson/seminar/lewis-et-al-2000.pdf) |
| Blender 形态键 + Driver | 官方示例用骨的**局部旋转通道**或骨与目标骨的**旋转差**驱动形态键；驱动曲线横轴为旋转弧度，不是帧。单一通道不足以表达复合姿态。 | 少量状态先用驱动器：`LieBellySpread` 受骨盆/胸段压低和双髋外展共同门控；`SitHaunch` 受双髋屈曲、骨盆俯仰、臀部低位共同门控。复合条件可由控制骨/自定义姿态参数预先计算，仍须每帧从骨矩阵产生。 | [Blender 官方：Shape Key Drivers](https://docs.blender.org/manual/en/4.1/animation/drivers/workflow_examples.html)、[Driver 变量及 swing/twist](https://docs.blender.org/manual/en/4.0/animation/drivers/drivers_panel.html) |
| Corrective Smooth / Delta Mush 类平滑 | Blender Corrective Smooth 通常置于 Armature **之后**，减轻关节附近扭曲；可能丢体积，需要 scale 补偿；前面若有改变拓扑的修改器需 Bind Coordinates。它平滑已有形变，**不会知道腹部应贴地或大腿应向外鼓**。 | 只作肘、腋、髋的局部清理，限 vertex group，不能代替卧姿/坐姿形态键。先完成接地与正确外轮廓，再微调平滑，防止把趾缝和毛根抹平。 | [Blender 官方：Corrective Smooth](https://docs.blender.org/manual/en/latest/modeling/modifiers/deform/corrective_smooth.html) |
| Armature Preserve Volume | 四元数蒙皮能减少大角度关节收缩；官方说明接近 180° 时仍可能出现不连续。它只改变旋转混合，不能按地面压力把圆筒压成扁椭圆。 | 可和修正形状组合对照；不要指望开关解决宽/长 0.57 的趴姿。若用 Blender 旧版 Corrective Shape Keys 插件烘焙，Preserve Volume 需其较慢的全修改器路径，快速路径会禁用它。 | [Blender 官方：Armature Preserve Volume](https://docs.blender.org/manual/en/latest/modeling/modifiers/deform/armature.html)、[Corrective Shape Keys 插件说明](https://docs.blender.org/manual/en/4.1/addons/animation/corrective_shape_keys.html) |
| 皮肤带动毛根 | Blender Surface Deform 可让一个网格跟随另一网格的形变；其绑定依赖有效目标拓扑，离目标表面越远越易失真。 | **首选于现有程序毛条：**稳定记录每条毛根所在皮肤三角面及重心坐标。先算皮肤 `形态键 → 骨蒙皮` 的最终顶点，再重建毛根位置/切线/法线，把原毛条相对根的局部坐标搬到新框架；或给毛条根部及近根顶点写同一修正位移并沿毛长衰减。避免皮肤已修正而毛条只走原骨权重造成“露根”，也避免同时 Surface Deform 和重复增量导致双变形。 | [Blender 官方：Surface Deform](https://docs.blender.org/manual/en/latest/modeling/modifiers/deform/surface_deform.html)、[PSD 原论文](https://doi.org/10.1145/344779.344862)；毛条方案是**本项目工程推导** |

**形状样本与验收（均为美术试值，不是猫的实测软组织伸长率）：**

| 样本 | 触发量（从骨变换导出） | 雕刻重点 | 三视验收 |
|---|---|---|---|
| `LieBellySpread` | 胸骨/骨盆下降、腹侧接近地面，且前后肢折叠；单看骨盆高度会误触跳跃蹲伏 | 腹侧压平且不穿地；胸腹侧下缘向左右展开、背侧宽度变化较小；骨盆到肋廓渐变 | 正前低机位、正后、正俯视；先让 **总毛轮廓** 宽/长从 0.57 朝目标 0.82 接近，勿直接把无毛胸廓乘 1.44；检查站姿和离地帧为零影响。[项目量测](HANDOFF.md#round-xclaude-主会话2026-10-12骨架结构与联动重做) |
| `LieFlankThigh` | 双髋屈曲+外展/外旋、双膝折叠、臀部低位 | 两侧大腿肉接在髋旁，外侧鼓而非两根短棍；裆部过渡平滑 | [卧姿正后/正前目标](../assets/characters/lingxi/reference/lingxi-ref-lie-back.png)；遮住毛看皮肤，再看根毛是否跟随 |
| `SitHaunch` | 骨盆坐低且俯仰、双髋屈曲、跗/跖姿态 | 臀部着地变宽、左右大腿肌群从前腿外侧可见；腹股沟不破洞 | [端坐正面](../assets/characters/lingxi/reference/lingxi-ref-sit-front.png)、[端坐背面](../assets/characters/lingxi/reference/lingxi-ref-sit-back.png)；从坐转站连续 |

实现次序：生成固定拓扑的皮肤与毛根索引 → 增加骨/IK 自由度并验证接地 → 采样无修正的目标姿势 → 在相同顶点索引上做 3–5 个区域形态键 → 由姿态向量驱动其权重 → 在最终皮肤上重建毛根与毛条方向 → 逐姿态核查轮廓、接地和毛根。RBF 不是首日必需；少量关键姿态用门控驱动可先验收。[PSD](https://doi.org/10.1145/344779.344862)、[Blender Driver 示例](https://docs.blender.org/manual/en/4.1/animation/drivers/workflow_examples.html)。

## 2. 掌指 MCP / 跖趾 MTP 与接地

下表的 **MTP 数字只适用于成年家猫行走**。Gregor 等的角是论文图 2 定义的**反折掌侧角**，自然超伸可大于 180°；不能当 Blender 骨的旋转角直接输入。研究没有端坐、腹卧、跳跃和落地的同一口径极值。[Gregor 等 2006，图 2/表 2](https://analisedemarcha.com/papers/med_vet/Gregor_etal_JN_2006.pdf)。

| 姿势 / 关节 | 实测数据 | 工程目标 / 美术试值 | 来源及边界 |
|---|---|---|---|
| 行走：后足 MTP | 平地落足 **214±14°**、支撑期最大伸展 **245±20°**、摆动期最大屈曲 **190±20°**；上坡落足 **213±5°**、最大伸展 **248±6°**；下坡对应 **214±8°**、**225±10°**。 | 跖骨和趾段需为两段，可在支撑后期相对折、趾尖最后离地；Toe IK/接触点应独立于 `RearPaw`。 | [Gregor 等 2006 表 2](https://analisedemarcha.com/papers/med_vet/Gregor_etal_JN_2006.pdf)；坡度和成年步行限定。另一原始实验同样记录前行支撑期 MTP 伸展、离地前快速屈曲：[Trank & Smith 1996](https://doi.org/10.1152/jn.1996.75.2.678)。 |
| 行走：前足 MCP | 找到成年步行 MCP 随步周期变化曲线，**可复核的站/坐/卧/蹬/落分姿势数值未查到**。 | 单独 `FrontDigits`/MCP 铰点；腕—掌骨与趾垫分别定位，撑地伸懒腰时趾垫平贴，舔爪允许趾段折起。 | [原始猫步态验证研究，图 7B 含 MCP 曲线](https://pmc.ncbi.nlm.nih.gov/articles/PMC8417424/)、[猫步行足轨迹研究将 MCP/MTP 分别放标记](https://pmc.ncbi.nlm.nih.gov/articles/PMC4137248/)；曲线不可读成姿势 ROM。 |
| 站立时跖骨对地夹角 | **未查到**同一方法的健康猫群体数值。行走/站立猫为趾行，跗与跖近端通常离地；趾垫承担落足。 | 保留独立跗—跖段与跖趾段；先按本猫侧面实拍和足底接地调试，不用任意固定“45°”。 | [Gregor 等图 2 标记踝与 MTP](https://analisedemarcha.com/papers/med_vet/Gregor_etal_JN_2006.pdf)、[猫足接触研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC3362317/)；“通常离地”是趾行定义的解剖推论。 |
| 端坐时跗—跖是否全段贴地 | **未查到**有压力板/侧 X 光同时证明“跗骨、整段跖骨都贴地”的家猫数据。长毛侧照只能证明外轮廓低而近水平，不能看穿毛判断每一骨点接触；不同坐法也可能不同。 | 给跗低位与跖近水平的**可选姿势**，趾垫保持朝前接地；以 [本批端坐后脚特写](../assets/characters/lingxi/reference/lingxi-ref-sit-hindfoot-closeup.png) 作**美术目标**，不强制所有坐姿跗骨零高度。 | [同侧端坐参考](../assets/characters/lingxi/reference/lingxi-ref-sit-side.png)、[本批图](../assets/characters/lingxi/reference/lingxi-ref-sit-hindfoot-closeup.png) 均为生成图，不是生理证据。 |
| 腹卧 | MCP/MTP 工作角 **未查到**；跗—跖骨性接地范围 **未查到**。 | 后腿可向外折到身体两侧，后足低放、爪面朝前；脚跟和趾分别求接地，避免爪子与跖骨被一骨锁死。 | [本批卧姿后腿特写](../assets/characters/lingxi/reference/lingxi-ref-lie-hind-closeup-side.png) 仅造型目标。 |
| 跳跃蹬地 / 落地 | 同一口径 MCP/MTP 极值 **未查到**。步行后期伸展不能当跳跃极限。 | 蹬地设趾垫为最后接触点，跗和主掌垫抬起；落地依接触解算允许趾垫→掌垫承重，别把关节角硬设为 Gregor 的 245°。 | [Trank & Smith 1996 行走 MTP 动力学](https://doi.org/10.1152/jn.1996.75.2.678)、[本批蹬地目标](../assets/characters/lingxi/reference/lingxi-ref-hindfoot-pushoff-closeup.png)。该生成图毛遮挡跗折点，**不得用于量角**。 |

**骨定义：**`RearLower` 到跗，另有 `RearMetatarsus`（跗→MTP），再有 `RearDigits`（MTP→趾垫/趾尖）；前足用 `FrontMetacarpus`（腕→MCP）及 `FrontDigits`（MCP→趾垫）。现有单块爪体可保留为外观部件，但其权重要跨掌/跖与趾关节过渡；四个趾可先共用一个主趾关节，必要时再做独立趾骨。[猫步行足轨迹研究的标记位置](https://pmc.ncbi.nlm.nih.gov/articles/PMC4137248/)、[项目当前骨架](../assets/characters/lingxi/v6/round-x-audit/xray-x4.png)。

## 3. 三维关节自由度

| 自由度 | 实测或观察 | 对灵犀的工程含义 | 来源 / 不能外推之处 |
|---|---|---|---|
| 髋外展/内收、外旋/内旋 | 3 只成年猫行走；其中**一只代表猫**表 2 左髋外展/内收范围 **14.9°**、旋转范围 **14.6°**；右髋分别 **12.7°**、**12.9°**。左右零位偏移受标记轴定义影响，不能把表中 ± 绝对端点当生理极限。 | IK 目标要有横向坐标；股骨及膝可出固定竖直平面，允许髋的独立外展和轴向旋转。先用 10–15° 量级做**行走单元测试**，腹卧/坐姿另按接地目标调整。 | [原始三维猫后肢步态研究，表 2 及讨论](https://pmc.ncbi.nlm.nih.gov/articles/PMC6078300/)。**非被动 ROM、非卧姿极值**。 |
| 肩外展与旋转 | 两只猫跑台植入标记 X 光：肩胛有外展/内收，盂肱关节摆动后期外展+内旋；摘要未给可复用的度数。 | 肩与肩胛的横向旋转保留独立通道；前腿伸懒腰时能向前且略向外落足。**家猫肩外展通用 ROM 数字未查到**。 | [Boczek-Funcke 等 1996 原始 X 光运动研究](https://doi.org/10.1111/j.1460-9568.1996.tb01210.x)。 |
| 前臂旋前 / 旋后 | 一篇猫腕损伤综述汇总约 **115° 总旋前旋后范围**；一项尸体模型论文回顾既有报告的旋前 **40–50°**、旋后 **90–128°**，但本实验控制组按力矩加载实测均值仅旋前 **13.6°**、旋后 **17.86°**。这些定义和加载条件不同，不能相加为统一动画限位。 | 为抬爪、舔爪、落地加沿前臂轴的 roll/twist，自前臂近端向腕分布扭转；保持爪垫面可朝身体或地。试值从小幅旋转逐步看皮肤与足垫，别直接套被动极限。 | [猫腕综述](https://pmc.ncbi.nlm.nih.gov/articles/PMC10814143/)、[尸体前臂研究及其表 1](https://pmc.ncbi.nlm.nih.gov/articles/PMC7821726/)。 |
| 腹卧、侧卧、端坐的大腿/膝朝向 | **未查到**以同一骨性坐标测得的“膝向外多少度”或三种姿势 ROM。长毛图的可见宽度含软组织、毛量和股骨角，不能直接反解髋角。 | 在三维 IK 中以膝极点/髋外展决定膝朝向；腹卧双大腿外撑，端坐大腿在前腿外侧，侧卧上下侧腿可有不同外展/外旋。用正面、背面和正俯视联合验收。 | [三维步态论文明确单平面模型看不到外展/轴旋](https://pmc.ncbi.nlm.nih.gov/articles/PMC6078300/)、[本批正面端坐](../assets/characters/lingxi/reference/lingxi-ref-sit-front.png)、[本批卧姿背面](../assets/characters/lingxi/reference/lingxi-ref-lie-back.png)；后两项是美术观察。 |

## 4. 腹卧时胸腹截面

| 问题 | 结论 | 证据与限制 |
|---|---|---|
| 站→腹卧同一肋位的**真实胸廓宽/高变化百分比** | **未查到**家猫多姿态、同截面、排除毛和腿的实测值。不能由“0.57→0.82”推算肋骨扩张 44%。 | [Round X](HANDOFF.md#round-xclaude-主会话2026-10-12骨架结构与联动重做)的比值量的是**全身带毛俯视外轮廓**；[卧姿俯视目标](../assets/characters/lingxi/reference/lingxi-ref-pose-liedown-top.png)中大腿、长毛、尾巴均可影响宽度。 |
| 可用的视觉观察 | 卧姿前/后机位显示低腹线和两侧外扩轮廓；侧面显示腹部贴近地面。应拆分成腹侧软组织压平、侧腹向外位移、髋旁大腿外展、毛根随之偏移四项。 | [卧姿正面低机位](../assets/characters/lingxi/reference/lingxi-ref-lie-front-low.png)、[卧姿背面](../assets/characters/lingxi/reference/lingxi-ref-lie-back.png)、[原侧面目标](../assets/characters/lingxi/reference/lingxi-ref-pose-liedown-side.png)；这些是生成图的**造型依据**，不是生理量测。 |
| 美术试值 | 以站姿无修正为零，先把趴姿**下半截软组织**横向增宽、纵向压低；顶部骨性胸廓少动。按侧/前/后/俯四视图逐次调权，目标是总轮廓和零穿地，不设生理百分比。 | [PSD](https://doi.org/10.1145/344779.344862)允许姿势条件下的局部位移；精确位移数值待本模型迭代测量。 |

## 5. 对照结论：实现优先级

| 优先级 | 加什么 | 性质 | 预期解决的视觉问题与验收 |
|---|---|---|---|
| P0 | 后足加**跗→跖骨段→MTP→趾段**；前足加**腕→掌骨段→MCP→趾段**；各有足垫接触点 | 工程做法，有真实 MCP/MTP 运动依据 | 坐姿能独立摆跖骨与趾垫，蹬地仅趾尖接触，落地能滚动承重；正侧面检查跗、MTP、趾尖不共一刚体。[Gregor](https://analisedemarcha.com/papers/med_vet/Gregor_etal_JN_2006.pdf)、[Trank & Smith](https://doi.org/10.1152/jn.1996.75.2.678) |
| P0 | 双髋**外展 + 外旋**和三维膝极点；足目标加横向坐标 | 工程做法；行走有 3D 实测，卧坐角为美术调节 | 腹卧/端坐大腿能在身体两侧形成宽轮廓，消除两根腿只在竖平面折的狭窄背影。[3D 猫后肢研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC6078300/) |
| P0 | `LieBellySpread` 与 `LieFlankThigh` 修正形状；毛根跟最终皮肤 | 工程做法 + 美术试值 | 解决圆筒腹部悬空、侧腹不摊、毛皮脱离；目标宽/长 0.82 是带毛图像目标，不是肋廓倍率。[PSD](https://doi.org/10.1145/344779.344862)、[Round X](HANDOFF.md#round-xclaude-主会话2026-10-12骨架结构与联动重做) |
| P1 | 肩外展 / 肩胛横向运动、前臂旋前旋后分布扭转 | 工程做法，有定性 X 光和尸体活动依据 | 伸懒腰前爪能向前外落地；舔爪能把掌垫转向脸；避免整条前腿拧成橡皮筋。[肩胛 X 光](https://doi.org/10.1111/j.1460-9568.1996.tb01210.x)、[猫腕综述](https://pmc.ncbi.nlm.nih.gov/articles/PMC10814143/) |
| P1 | `SitHaunch` 臀/大腿修正形状 | 工程做法 + 美术试值 | 端坐时臀部变宽、外侧大腿可见，前腿保持直立；从正面和背面验收。[Blender Shape Key Driver](https://docs.blender.org/manual/en/4.1/animation/drivers/workflow_examples.html)、[本批端坐图](../assets/characters/lingxi/reference/lingxi-ref-sit-front.png) |

**仍未查到：**健康猫坐、趴、侧卧、蹬地、落地的统一 MCP/MTP 关节工作角；端坐全跖骨骨性贴地比例；趴卧和站立同肋位的宽高变化；卧/坐大腿膝的骨性外摆角；家猫肩外展被动极限。要把这些从试值提升为生理数据，需要同一只猫的标定正侧/正前/俯视视频或透视/CT 与同步地面接触数据，而不是量本批生成图。[猫 3D 后肢方法的标记与皮肤误差讨论](https://pmc.ncbi.nlm.nih.gov/articles/PMC6078300/)。
