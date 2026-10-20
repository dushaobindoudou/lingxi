# 灵犀骨架数字调研（Round W 对照）

## 口径与证据等级

本表区分 **实测解剖/运动学数据**、**由原始数据计算的比值**、**Round W 项目坐标**和**待试的美术目标**。这四类不可互换。猫的毛皮轮廓不是骨性标志；二维皮肤标记也不能精确还原被遮挡的关节。`+y` 向臀、`−y` 向头，`z` 向上，单位 mm。Round W 数字取自 [rigdump-round-w.txt](../assets/characters/lingxi/v6/round-x-audit/rigdump-round-w.txt)；脚本对应 [build_lingxi_v5.py](../scripts/blender/build_lingxi_v5.py)。以下 `H` 是肱骨长，`D=430−210=220 mm` 是项目给定的站姿躯干毛皮深度，`T=222−(−138)=360 mm` 是本次定义的项目躯干前后参照跨度。这些项目值不是生理学常数。

## 1. 比例

### 脊柱及尾

[原始离体骨测量](https://sedici.unlp.edu.ar/bitstream/handle/10915/108108/Documento_completo.pdf-PDFA.pdf?isAllowed=y&sequence=1)对**两只成年母家猫**的整条骨性脊柱给出以下均值。分母是颈椎到尾椎末端的骨性总长 **56 cm**，**不是**鼻尖到尾尖或头体长；研究未同时测头骨和体表头体长，因此后两种分母的分段比例均**未查到**。样本极小，仅作结构量级参考。

| 骨性段 | 实测均长 | 占骨性脊柱总长 | 占鼻尖—尾尖 / 头体长 | 来源 |
|---|---:|---:|---|---|
| 颈 C1–7 | 6 cm | 11% | 未查到 | [InVet 2018 表 1](https://sedici.unlp.edu.ar/bitstream/handle/10915/108108/Documento_completo.pdf-PDFA.pdf?isAllowed=y&sequence=1) |
| 胸 T1–13 | 12 cm | 21% | 未查到 | [同上](https://sedici.unlp.edu.ar/bitstream/handle/10915/108108/Documento_completo.pdf-PDFA.pdf?isAllowed=y&sequence=1) |
| 腰 L1–7 | 10 cm | 18% | 未查到 | [同上](https://sedici.unlp.edu.ar/bitstream/handle/10915/108108/Documento_completo.pdf-PDFA.pdf?isAllowed=y&sequence=1) |
| 骶 S1–3 | 1.5 cm | 3% | 未查到 | [同上](https://sedici.unlp.edu.ar/bitstream/handle/10915/108108/Documento_completo.pdf-PDFA.pdf?isAllowed=y&sequence=1) |
| 尾椎 | 26.5 cm | 47% | 未查到 | [同上](https://sedici.unlp.edu.ar/bitstream/handle/10915/108108/Documento_completo.pdf-PDFA.pdf?isAllowed=y&sequence=1) |

尾/头体长另有**同一野外种群的体表测量**：雄猫尾 `275.4`、头体 `518.1 mm`，两组均值之比 **0.532**；雌猫尾 `257.1`、头体 `460.7 mm`，均值之比 **0.558**。这是两组均值的商，非个体比值的均值；附录混有少量幼体，不能称为纯成体样本。[Harper 2004 附录 1](https://www.doc.govt.nz/Documents/science-and-technical/dsis174.pdf)。Round W 尾骨总长 `86+73+56+51+50=316 mm`；取鼻骨末端 `y≈−450` 至尾根 `y=330` 的**项目投影长度** `780 mm`，约 **0.405**；作者脚本注释称约 `0.43`，测量端点不同。拟议 `1.35×` 后尾骨约 `427 mm`，按同一投影分母为 **0.547**。尾骨曲线弧长与体表尾长仍须分别验收。[项目骨架](../assets/characters/lingxi/v6/round-x-audit/rigdump-round-w.txt)、[Harper 附录](https://www.doc.govt.nz/Documents/science-and-technical/dsis174.pdf)。

### 肢体骨长（成年步行猫）

Day 与 Jayne 的**4 只家猫**视频标注所得比例，分母分别为前/后肢所有所列段的长度和，均值±SEM；它不是以胸腰段为分母，也不是卧姿关节长。转换到 `H=1` 时用 `该段% / 36.8%`；只在同一前肢内部转换。后肢与前肢跨链比值另用下文 Peters 同体测量。[Day & Jayne 2007 表 3](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf)。

| 前肢段 | 占前肢总长 | 相对 H | 后肢段 | 占后肢总长 | 来源 |
|---|---:|---:|---|---:|---|
| 肱骨 | 36.8±1.0% | 1.000 | 股骨 | 34.7±1.0% | [Day & Jayne 表 3](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf) |
| 桡/尺 | 34.2±0.3% | 0.929 | 胫/腓 | 32.4±1.3% | [同上](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf) |
| 掌骨 | 14.6±0.3% | 0.397 | 跖骨 | 22.1±0.3% | [同上](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf) |
| 趾骨 | 14.1±0.7% | 0.383 | 趾骨 | 10.5±0.3% | [同上](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf) |

**肩胛及幼猫单列。** Peters 用卡尺测得下表；`胸腰参考`实为从 **T1 到骶末端的 postcervical length**，不是单独的胸+腰椎骨长。前足/后足是腕/跗附近至趾端的**整段足长**，不可再与 Day & Jayne 的掌、跖、趾数据直接相加。[Peters 1983 原始论文表 II、方法](https://doi.org/10.1111/j.1469-7998.1983.tb05100.x)。每行的比值由该表均值除以同龄肱骨均值计算，保留两位；龄组的样本数见表头。

| 年龄（n） | T1—骶末端 / H | 肩胛 / H | 桡骨 / H | 尺骨 / H | 前足 / H | 股骨 / H | 胫骨 / H | 后足 / H | 来源 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 4 周（19） | 2.92 | 0.68 | 0.86 | 0.87 | 0.81 | 0.98 | 0.96 | 1.23 | [Peters 表 II](https://doi.org/10.1111/j.1469-7998.1983.tb05100.x) |
| 8 周（17） | 2.85 | 0.67 | 0.87 | 0.91 | 0.79 | 1.03 | 1.01 | 1.20 | [同上](https://doi.org/10.1111/j.1469-7998.1983.tb05100.x) |
| 20 周（20） | 3.19 | 0.71 | 0.94 | 0.98 | 0.70 | 1.10 | 1.12 | 1.13 | [同上](https://doi.org/10.1111/j.1469-7998.1983.tb05100.x) |
| 成年（16） | 3.12 | 0.72 | 0.97 | 1.00 | 0.65 | 1.10 | 1.15 | 1.05 | [同上](https://doi.org/10.1111/j.1469-7998.1983.tb05100.x) |

注意 Peters 的后足整体包括跗/跖/趾，**幼猫的掌、指、跖、趾各自长度未查到**；成年肩胛骨长用 Peters，成年掌/趾/跖/趾相对份额用 Day & Jayne，但不要把两个样本拼成精确的一条腿。[Peters](https://doi.org/10.1111/j.1469-7998.1983.tb05100.x)、[Day & Jayne](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf)。

## 2. 站姿关节相对体表及 Round W 坐标

成年家猫的脊椎**骨体中心距背部皮肤深度/躯干深度**、肩肘髋膝跗相对**体表轮廓**的统一统计值均**未查到**。现有研究量的是骨、关节或肢体段，不是长毛猫的毛皮轮廓；不得把下面的项目数误标为生理数据。坐标中的前后位置 `u=(y+138)/360`，0=Round W 胸前脊柱点，1=骨盆后端；高度 `v=(z−210)/220`，0=腹线、1=背线，负值表示腹线以下。[项目 rigdump](../assets/characters/lingxi/v6/round-x-audit/rigdump-round-w.txt)。

| 标志 | Round W (y,z) mm | u | v 或地面高 | 对真实猫可核实的约束 |
|---|---:|---:|---:|---|
| 胸脊柱 `Spine.tail` | (−138,360) | 0.000 | v=0.682；距背线70 mm =0.318D | 骨性中心距毛皮背线的群体比值未查到；[猫脊柱影像综述](https://pmc.ncbi.nlm.nih.gov/articles/PMC11148912/) |
| 腰脊柱 `Loin.head` | (78,330) | 0.600 | v=0.545；距背线100 mm =0.455D | 同上；项目背线在不同 y 的局部值须重测 |
| 骨盆后端 `Pelvis.head` | (222,300) | 1.000 | v=0.409；距背线130 mm =0.591D | 同上；该点不是骶骨节段标注 |
| 肩胛上端 `Scap.head` | (−88,425) | 0.139 | 距背线5 mm =0.023D | 安静端坐的猫，其肩胛椎缘在胸椎棘突的**背侧**；与皮肤的距离未给。[原始立体透视研究](https://pubmed.ncbi.nlm.nih.gov/9302614/) |
| 肩/盂肱 `FrontUpper.head` | (−160,300) | −0.061 | v=0.409；地面高300 mm | 步行中肩高是总前肢骨长的 `72±1%`（落足）、`74±2%`（中支撑）；不是相对腹线的值。[Day & Jayne 表 6](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf) |
| 肘 `FrontUpper.tail` | (−124,175) | 0.039 | v=−0.159；地面高175 mm | 步行中肱骨远端位于肩的后方。[Day & Jayne 图 5/表 6](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf) |
| 腕 `FrontLower.tail` | (−165,65) | −0.075 | v=−0.659；地面高65 mm | 步行中支撑桡尺段近竖直；体表归一高度未查到。[Day & Jayne 表 6](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf) |
| 髋 `RearUpper.head` | (208,305) | 0.961 | v=0.432；地面高305 mm | 步行中髋高是总后肢骨长的 `75±2%`（落足）、`77±2%`（中支撑）。[Day & Jayne 表 6](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf) |
| 膝 `RearUpper.tail` | (169,191) | 0.853 | v=−0.086；地面高191 mm | 股骨远端在髋的**前方**，膝在毛皮大腿内常被遮挡。[Day & Jayne 图 5/表 6](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf) |
| 跗 `RearLower.tail` | (241,108) | 1.053 | v=−0.464；地面高108 mm | 胫骨远端在膝的**后方**。[Day & Jayne 图 5/表 6](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf) |

最可确认的偏差是**同体骨长关系**，而非未经测量的体表深度：Round W 肩胛 `147/H130=1.13`，对照 Peters 8 周 `0.67`、成年 `0.72`；其上端几乎压在给定毛皮背线上。其余关节折向（肘后、膝前、跗后）在 rest 坐标上正确，不能把毛皮大腿没有受股骨权重误诊成膝骨方向错误。[项目 rigdump](../assets/characters/lingxi/v6/round-x-audit/rigdump-round-w.txt)、[Peters 表 II](https://doi.org/10.1111/j.1469-7998.1983.tb05100.x)。

## 3. 姿势中的关节工作角

角度口径：下表「步行」是**相邻肢骨的二维内角，伸直近 180°**，来自成年猫落足与中支撑，**不能当作趴卧、端坐或睡姿的硬限位**。[Day & Jayne 2007 表 5](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf)。

| 情境 | 肩 | 肘 | 腕 | 髋 | 膝 | 跗 | 脊柱/骨盆 | 来源与适用范围 |
|---|---|---|---|---|---|---|---|---|
| 成年猫步行落足（**对照，不是目标卧姿**） | 未查到关节内角 | 129±2° | 184±2° | 未查到关节内角 | 130±3° | 118±3° | 未查到 | [Day & Jayne 表 5](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf) |
| 成年猫步行中支撑（对照） | 未查到关节内角 | 127±2° | 176±3° | 未查到关节内角 | 115±3° | 114±3° | 未查到 | [同上](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf) |
| 狮身人面式腹卧 | 未查到 | 未查到 | 未查到 | 未查到 | 未查到 | 未查到 | 未查到 | 未找到可复核的家猫同一定义关节角样本；只能按接地、可达性和三视图验收。 |
| 端坐 | 未查到 | 未查到；研究证实肘保持屈曲 | 未查到 | 未查到 | 未查到 | 未查到 | 骨盆倾角、腰屈曲角未查到 | [安静坐姿的立体透视研究](https://pubmed.ncbi.nlm.nih.gov/9302614/)测载荷与朝向，摘要未提供角度；不可填造。 |
| 侧卧 | 未查到 | 未查到 | 未查到 | 未查到 | 未查到 | 未查到 | 未查到 | 家猫侧卧定量关节范围未查到。 |
| 蜷睡 | 未查到 | 未查到 | 未查到 | 未查到 | 未查到 | 未查到 | 总侧屈角、颈/胸/腰分配、头—尾根距离未查到 | 猫睡姿图只能定性观察环形轮廓，不能反推出椎间角。 |

蜷睡在俯视参考中主要表现为**侧屈**；若头俯向前爪，另叠加颈部腹屈。这是基于所需造型的**动画分析**，不是论文测得的角度。不要把某个骨的旋转值当成「整条脊柱屈曲量」。

## 4. 联动规律：能落地的量与缺口

| 联动 | 已有定量证据 | 未查到 / 不可推导 | 绑定含义 |
|---|---|---|---|
| 肩胛—肱骨，步/跑 | 8 只成年猫的原始研究记录：肩关节每步呈**双相**屈伸，肩胛相对胸廓呈**单相**前后转动；摆动相肩胛中心前移，支撑相后移，并有上下位移。[English 1978](https://doi.org/10.1002/jmor.1051560209) | 摘要没有肩胛转角/肱骨摆角的固定比、平移 mm 或占躯干百分比；未查到可访问的原文表值。 | 肩胛旋转与局部平移分开驱动；不可设一个有文献支持的 `1:x` 固定比。 |
| gallop 胸腰—骨盆 | 家猫动捕研究在某次后肢支撑区间 `0.495–0.600 s` 报告其**定义的脊柱角** `118.86–168.00°` 与**骨盆段角** `46.35–91.13°`，同步变化，速度 `3.2→4.33 m/s`。[Kim 等 2014 原始研究摘要](https://doi.org/10.1016/S1672-6529(14)60064-0) | 这两个是论文自己的段姿态变量，**不是**可直接灌入 `Loin` 的 49.14° 或腰椎 ROM；四足触地精确相位、椎间分配未查到。 | 收拢与舒展要用多段胸腰及骨盆联合曲线，按足接触事件调相；不把 49° 写成单骨转角。 |
| gallop 足落相位 | 原始跑台研究在其所采几种 gallop 中，两个前足着地相隔约 **25% 步周期**；两后足相隔 **11%** 或同时着地（half-bound）。[1977 原始论文](https://doi.org/10.1016/S0091-6773(77)92279-9) | 不能由此固定所有猫的四足绝对相位；脊柱峰值与每足接触的相位角未查到。 | 用所选 gait 的接触表驱动，不用四脚同时锁地。 |
| 骨盆前后倾—腰椎 | 上述动捕研究显示后肢支撑期两段角同步变化；另有腰肌 EMG 在 gallop 呈一次相位性爆发，步/小跑则有双相活动。[Kim 2014](https://doi.org/10.1016/S1672-6529(14)60064-0)、[English 1980 原始研究](https://pubmed.ncbi.nlm.nih.gov/30184992/) | 静态坐姿骨盆倾角、腰椎屈曲角及二者传动比未查到。 | 允许骨盆俯仰随腰段改变，保留独立微调。 |
| 头颈—躯干俯仰 | 3 只猫步行时，头俯仰周期幅度约 **2–4°**、垂直平移约 **1.5 cm**；头最高点比胸/肩峰值迟 **20–90°** 步周期相位，俯仰又迟头升降 **40–90°**；常态鼻向下 **10–30°**。[原始 3D 运动研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC4986613/) | 这不是简单的躯干角 `−1×` 补偿，也不能直接移植到跳跃。 | 头颈用空间目标和延迟控制，颈皮肤必须跟随。 |
| 尾巴平衡/转身/跳跃 | 4 只成年猫在稳定窄道上尾侧偏通常 **<15°/侧**；跑道横移 **2.5 或 5 cm** 时尾向扰动反向摆动。[原始实验](https://doi.org/10.1016/S0166-4328(97)00101-0) | **家猫跳跃/急转的固定尾角、力矩占比与相位未查到**；窄道值不能当跳跃硬限位。 | 尾根可做反向姿态补偿，末端滞后；依镜头/接触实测调幅。 |

## 5. 对照结论与建议 rest 草案

下表的「建议」是**给灵犀造型的待验证试值**，不是生理学测量；分母用本项目 `H=130 mm`、`D=220 mm`、鼻—尾根投影 `780 mm`。灵犀看起来是大眼幼猫，优先拿 Peters 的 **8 周**列做视觉起点，再对照 `turnaround-v1.png` 和无毛皮肤。不能据成年数值强行把幼猫改成成年骨架。[Peters 1983](https://doi.org/10.1111/j.1469-7998.1983.tb05100.x)、[项目 rigdump](../assets/characters/lingxi/v6/round-x-audit/rigdump-round-w.txt)。

| 优先级 | 当前偏差（证据） | 视觉后果 | 建议 rest / 权重试值及验收 |
|---|---|---|---|
| P0 | `Neck` 长 **156 mm**、主导权重表为空；`Head` **109 mm** 承载主要头部毛皮。[rigdump](../assets/characters/lingxi/v6/round-x-audit/rigdump-round-w.txt) | 低头、抬头、侧卧时头成整球绕胸口铰链运动；颈根开缝或被拉细。 | 给颈根—颈中—枕下连续权重与分段控制；保持实测头部轮廓，颈区段按骨性脊柱的 **11%** 仅检查量级，不把 6 cm 绝对值套到本模型。[InVet 表 1](https://sedici.unlp.edu.ar/bitstream/handle/10915/108108/Documento_completo.pdf-PDFA.pdf?isAllowed=y&sequence=1) |
| P0 | 肩胛 `147/130=1.13 H`；8 周 **0.67 H**、成年 **0.72 H**。[rigdump](../assets/characters/lingxi/v6/round-x-audit/rigdump-round-w.txt)、[Peters 表 II](https://doi.org/10.1111/j.1469-7998.1983.tb05100.x) | 肩胛像从背线垂挂到肩的大长杆，抬前爪拉动大块胸毛；肩峰过高。 | 先试 **0.67–0.72 H**（约 **87–94 mm**）；固定肩关节 `(x≈108,y≈−160,z≈300)` 时，上端试 `(x≈88,y≈−120,z≈380)`，骨线约 **92 mm**，距本地背线 `50/220=0.23D`。这组坐标是**美术试值**，先看侧/俯无毛形变，再定。肩胛旋转+平移可独立。[English 1978](https://doi.org/10.1002/jmor.1051560209) |
| P0 | 股骨 `121/130=0.93 H`、胫骨 `110/130=0.85 H`；8 周样本 **1.03/1.01 H**、成年 **1.10/1.15 H**。[rigdump](../assets/characters/lingxi/v6/round-x-audit/rigdump-round-w.txt)、[Peters 表 II](https://doi.org/10.1111/j.1469-7998.1983.tb05100.x) | 膝/跗折线短而急，跳蹲深度和后蹬伸展不足；大腿皮肤留在躯干更显断裂。 | 8 周造型起点股骨 **1.03 H≈134 mm**、胫骨 **1.01 H≈131 mm**；先把大腿蒙皮从高度硬切改为髋—膝过渡，再重解足底接地；不要只拉长骨头。 |
| P1 | 胸腰/骨盆当前主干 `147+109+109=365 mm=2.81 H`，与 Peters 8 周 T1—骶末端 `2.85 H` 接近；**长度未证实偏差**，问题主要是仅三大段、骨线多处距给定背线 **0.32–0.59D**。[rigdump](../assets/characters/lingxi/v6/round-x-audit/rigdump-round-w.txt)、[Peters](https://doi.org/10.1111/j.1469-7998.1983.tb05100.x) | 奔跑拱背集中折在少数铰点；背部高处皮肤不跟骨线走，躯干像圆筒。 | 保留整体长度，拆腰/胸控制并重分权重；胸腰骨线可先试背线下 **0.20–0.30D** 的几何位置，逐段查看肋廓体积。**这个深度没有可信猫群体比值支持，仅为模型内试值。** |
| P1 | 尾骨 **316 mm≈0.405** 倍本项目鼻—尾根投影；野外体表均值之比 **0.532–0.558**。[rigdump](../assets/characters/lingxi/v6/round-x-audit/rigdump-round-w.txt)、[Harper 附录](https://www.doc.govt.nz/Documents/science-and-technical/dsis174.pdf) | 趴卧尾尖到不了前爪、蜷睡不能横过下巴，尾弯成五段折线。 | 拟议 **1.35×≈427 mm≈0.547** 倍同一投影量级合理；尾各节拆分后检查弧长、尾毛外缘与接地，不把体表和骨长视为相等。 |
| P1 | 前肢肱骨 `130 mm`、桡尺控制段 `117 mm=0.90H`，接近 Day & Jayne 成年 `0.929H`；但 `FrontPaw` **62 mm** 与趾骨 **35 mm** 的 rest 坐标彼此重叠，不能简单相加。[rigdump](../assets/characters/lingxi/v6/round-x-audit/rigdump-round-w.txt)、[Day & Jayne 表 3](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf) | 爪心、掌指根与趾端难以独立折叠，舔爪及落地掌面容易失真。 | 保留近端长度，先明确腕—掌指—趾端沿足面连续的 rest 轴，再分别权重和掌面目标；以 8 周整体前足 **0.79H** 作轮廓参考，不把现有重叠骨长相加。[Peters 表 II](https://doi.org/10.1111/j.1469-7998.1983.tb05100.x) |

**待测而不填假的清单：**真实长毛幼猫的背皮—脊椎深度占 `D` 比值；四肢五大关节相对毛皮边界的统计坐标；腹卧、端坐、侧卧、蜷睡各关节 ROM；蜷睡总侧屈角与颈/胸/腰分配、头—尾根距；步跑肩胛转角/肱骨摆角的通用传动比及平移 mm；家猫 gallop 每节腰椎 ROM 与四足接触相位；跳跃和急转的尾部力矩占比。这些应由**同一只猫**的校准侧/俯视频或 X 光/CT 标注后再补，不能从本批生成图读取骨性角度。[Day & Jayne 方法](https://webcentral.uc.edu/eprof/media/attachment/eprofmediafile_74.pdf)、[猫脊柱影像综述](https://pmc.ncbi.nlm.nih.gov/articles/PMC11148912/)。
