# 灵犀面部与自由度调研：v1 骨架冻结前核对（2026-10-12）

## 口径与结论先行

本文对照[需求草案第 2、3 节](RIG-REQUIREMENTS-v1-DRAFT.md)。**实测 / 文献**只指猫的原始研究或 CatFACS 的观察编码；**工程做法**指格式、引擎或绑定实现；**美术试值**只供这只灵犀的姿势迭代，绝非猫的被动关节极限。生成参考图不用于量角。CatFACS 是可见动作的**编码系统**，一个 AU 不能直接翻译为一种情绪；眉、`ω` 嘴和爱心瞳是角色风格层。[CatFACS 作者论文及表 1][C]、[猫慢眨实验][SB]。

**冻结建议：新增耳尖 L/R、舌中/尖、前臂扭转 L/R 共 6 根变形骨；其余重点在已有骨接线、三维 IK 与脸部小网格形态键。**每个身体 clip 只写身体通道；表情控制在运行时对脸部骨、形态键与材质单独施加。面部动作若属于“喵、哈欠、舔、喘”等动作所需，动作输出的是可与用户表情合成的*请求轨*，不把最终脸值烘焙进 clip。[草案](RIG-REQUIREMENTS-v1-DRAFT.md)、[three.js 动画混合文档][TANIM]。这是**工程建议**，不是 CatFACS 的规定。

## 1. CatFACS → 五层表情

下表编号、肌肉与运动来自 CatFACS 作者论文表 1；方向为该动作的可见运动概述。`AU109+110` 在猫的编码中成对处理；AD / EAD 不是独立肌肉 AU。猫的“眉 5 态”没有可直接照搬的人类 AU1/2/4；不要将风格化眉型误标为猫的实测表情。[C]

| 编码 / 名称 | 肌肉或部位；可见运动 | 草案第 3 节对应 / 缺口 | 性质与出处 |
|---|---|---|---|
| AU143 眼闭合；AU145 眨眼；AU47 半眨 | 眼轮匝肌、外眼角回缩肌、提上睑肌相关；上睑下行、下睑参与，半眨只部分闭合 | 眼：闭、左/右眨、半眯、柔和、慢眨；需左右独立上/下睑与时间曲线 | 文献 [C][SB] |
| AU5 上睑提升 | 提上睑肌、内侧皱眉肌；上睑上行，露眼面积增大 | 眼：睁大、惊讶；现有 Blink/Squint 无“超开” | 文献 [C] |
| AU109+110 皱鼻＋上唇提升 | 鼻唇提肌、上颌唇提肌、犬齿肌、鼻外侧肌；鼻部起皱、上唇上提露牙 | 嘴：哈气；需左右上唇、皱鼻；鼻翼轻动可共用局部区域 | 文献 [C] |
| AU12 嘴角后拉 | 颧大肌；嘴角向后/上外拉 | 嘴：`ω` 微笑**仅风格映射**，不是标准猫“微笑” | 文献 [C]；映射为工程/美术判断 |
| AU16 下唇下压；AU17 下唇上提 | 下唇降肌、颏肌；下唇向下或向上 | 嘴：哈气、张口、撇嘴的下唇轮廓；需要下唇下拉 | 文献 [C] |
| AU118 撮唇 | 口轮匝肌、颊肌；两侧嘴角向前、向口中线 | 嘴：喵的 `o` 口；和 AU26 搭配 | 文献 [C] |
| AU25 双唇分离；AU26 下颌下落；AU27 口部大张 | AU25 口轮匝等；AU26/27 为咀嚼肌群相关非表情肌运动；口裂分开、下颌下转、口张至大幅 | 嘴：微张、喵、哈欠、喘气；Jaw 骨＋口型形态 | 文献 [C] |
| AU200 胡须后收；AU201 胡须前伸；AU202 胡须上抬 | 鼻外侧肌、犬齿肌、口轮匝肌等关联胡须垫；胡须向后贴面、向前张、向上提 | **五层外缺项**：嗅闻/好奇/害怕的胡须控制；已有 Whisker 骨要接线 | 文献 [C] |
| AD48 瞬膜显露 | 第三眼睑可见；非表情肌 AU | 眼：目前无；v1 可不做，勿用灰白眼睑替代 | 文献 [C] |
| AD68 扩瞳；AD69 缩瞳 | 虹膜瞳孔变化；猫眼可由圆大变竖缝 | 眼：圆/竖瞳/放大；应单列瞳孔参数而非改整颗眼 | 文献 [C][P1] |
| AD19 露舌；AD190 舌向下；AD37 舔唇；AD137 舔鼻 | 舌及接触路径；舌露出、下垂、扫过唇/鼻 | 嘴：吐舌、舔；需伸缩、舌尖卷曲、左右扫掠 | 文献 [C] |
| AD40 嗅闻；AD119 舔；AD126 喘气（手册） | 行为描述，非单一肌肉控制 | 动作：闻、舔、疯跑后喘；由鼻/舌/下颌/呼吸组合 | 文献 [C][CM] |
| EAD101 前指；102 内收；103 压平；104 旋转 | 耳廓肌群；耳口朝前、两耳尖靠拢、耳廓贴平、耳口绕轴转向 | 耳：前倾/飞机耳/单只侧耳；现有各一节刚性不够表现耳尖弧 | 文献 [C] |
| EAD105 下垂；106 后转；107 耳廓收窄 | 耳廓肌群；耳尖降低、耳口朝后、耳廓收窄 | 耳：后贴；105/107 为清单外形变，107 可只做轻微形状修正 | 文献 [C] |
| 人类式眉内抬/外抬/压低、嘴角下撇、爱心/闪亮/泪光 | **未查到**同名 CatFACS AU。可作为角色化造型或特效 | 眉 5 态、嘴“撇”、眼爱心/闪亮/含泪、符号 7 态；符号保持屏幕贴片，不加骨 | CatFACS 可对照 [C]；本项为工程/美术设计 |

**缺口优先级：**耳的左右独立旋转与压平、AU200–202 胡须、AD68/69 瞳孔、AU109+110 皱鼻上唇、AU118 `o` 口、AD19/37/137 舌尖轨迹应列入冻结接口；AD48 瞬膜与 EAD107 耳廓收窄可在 v1 不做。五层里的**符号层**是屏幕视觉效果，不属于面部骨架。[C]、[草案](RIG-REQUIREMENTS-v1-DRAFT.md)。

## 2. 耳、眼、瞳孔、胡须、舌：数据边界与试值

| 结构 / 问题 | 可核的实测 / 文献 | 可试的 v1 控制（**美术试值**，非生理极限） | 来源 |
|---|---|---|---|
| 耳转角与独立性 | 6 只猫的定位任务中，耳廓运动**可达约 20°**；18°/23°视觉目标诱发约 10°耳运动。听声反应含约 **25 ms** 的短潜伏成分，偏向声源同侧，证实两耳可不同步；研究只解释相对 yaw/pitch，**全活动范围未查到**。 | 每耳根 pitch 前 +25°/后 −35°、yaw 左右 ±35°、压平 roll 0–55°，耳尖滞后 0–15°；分轴限位，听声先动同侧耳。 | 原始线圈实验 [E]；试值依据 EAD101–106 的形态 [C] |
| 耳后贴 / 飞机耳 | EAD103 压平、104 旋转、106 后转是**不同**可叠加动作；压平时耳廓方向及外缘形状都变化。精确耳尖对头骨角 **未查到**。 | 后贴 = 根部后转＋下压＋轻微耳尖弯；飞机耳 = 向外旋＋侧压，避免只把整个刚性耳向后翻。左右可不对称。 | [C][CM] |
| 眼睑 / 眼球 | AU5、143、145、47 与猫慢眨均有观察；眼球注视和眨眼可同时发生。健康猫眼球旋转、上下眼睑毫米级 ROM 在本次资料中**未查到**。 | 眼球 L/R 看向目标，瞳孔仍在虹膜中心；上睑闭合 0–1、超开 0–0.25，下睑上推 0–1；闭眼时上睑沿球面弧线落到下睑而非平板直线。 | [C][SB]；弧线设计参照实时脸部眼睑权重实践 [MH] |
| 瞳孔竖缝→圆：宽度比 | 清醒成年猫有光照与瞳孔**高、宽、面积**的测量，但摘要未给可核的端点宽度值；轻麻醉实验报告面积从 **>120 mm² 到 <1 mm²**，即面积跨度大于 120 倍，**不能**开方得到竖缝宽度比。可靠的“最窄宽/虹膜直径”与“全圆宽/虹膜直径”数字**未查到**。 | 虹膜直径归一 1 时，黑色瞳孔横宽先试 **0.08→0.30→0.65**，竖向从长椭圆/竖缝过渡至近圆；两眼同一基值，可微小错时。 | 清醒测量 [P1]、麻醉测量 [P2]；数字为美术试值 |
| 瞳孔变化速度 | 本次**未查到清醒健康猫在同一刺激下从竖缝到全圆的可靠秒数**；人的约 200 ms 潜伏不能代入猫。 | 亮暗驱动平滑时间先试收缩 **0.3–0.7 s**、扩张 **0.5–1.2 s**；惊吓可另加短促放大，需动态看片校准。 | 猫研究 [P1][P2] 未给该指标；数值纯美术试值 |
| 胡须前张/后贴 | CatFACS 明确三个方向 AU200/201/202，胡须可相对上唇独立运动；**猫的统一角度范围未查到**。不能用鼠类 whisking 角直接当猫值。 | 每侧胡须根簇 yaw 前张/后收约 ±20°、上抬约 10°，2 组根骨共用或略错时；根毛须跟随胡须垫。 | [C]；试值为工程起点 |
| 舌舔 / 喝 | 高速摄影：饮水只以**向后弯的舌尖背侧**轻触水面，拉起液柱，**不是狗式深勺舀水**；10 只成年家猫饮水频率 **3.5±0.4 次/s**。梳毛时舌乳头向后，具有吸液/理毛作用；舌弯曲角、舔嘴极限未查到。 | 舌根平移/伸出、舌中和舌尖两节做 J 形回卷；舔鼻沿唇面扫掠；“勺形”形态键可做轻微横向凹陷，**饮水不做深凹勺**。舔嘴试值舌尖卷 25–55°，饮水节奏按 3.5 Hz 起步仅供喝水动作。 | 原始高速实验 [L]、舌乳头研究 [G]；角度为美术试值 |

## 3. 实时脸部绑定与分层实现

下表是**工程方案**。官方引擎/MetaHuman 文档证明这些控制模式可行，不表示“所有动物角色都必须如此”。MetaHuman 是人脸实例，只取其关节＋细节形态、眼睑沿眼球体积变形和瞳孔缩放的工程经验；猫的形状仍以 [C] 和参考图验收。[MetaHuman 混合关节与细节形态][MH0]、[眼睑权重][MH]。

| 区域 | 建议控制 | 选择理由、组合约束 | 出处 |
|---|---|---|---|
| 耳、眼球、下巴、舌 | 耳根＋耳尖、Eye.L/R、Jaw、舌根＋中＋尖骨；耳尖权重由根到尖平滑，眼球整体转 | 大块刚体/链用骨；面部表情无需对这些部位每个方向复制全顶点形态。舌仍须局部形态表现卷边。 | [MH0]（眼、下颌、舌用关节的实例）、[C]（动作方向） |
| 上下眼睑与笑眼 | 小头/脸皮肤网格的 `Blink.L/R`、`UpperWide.L/R`、`LowerLift.L/R`、`SmileArc.L/R`；已有 Lid 骨可只作眼角/眼睑轮廓辅助，别同时双倍变形 | 闭合时上睑顶点沿眼球包络滑到下睑，降低穿球；笑眼由下睑上推＋上睑曲率而非整眼缩放。若用 Lid 骨，需校验截面圆度。 | [MH]；独立左右为 [C] 对应的工程实现 |
| 嘴角、眉区、皱鼻、鼻翼 | 局部形态键；每侧可独立，左右同名成对；Jaw 骨开合与嘴角/上唇形态叠加 | 小范围非刚性位移适合形态；猫眉区只小幅移动皮毛/眉须，不画人类硬眉。`o` 口与 Jaw 分开，避免开口只有上下拉。 | [Unity BlendShape 官方][UB]、[MH0]、[C] |
| 瞳孔 | **优先虹膜/瞳孔材质参数** `pupilWidth/roundness` 或眼球独立局部几何；不在 10 万顶点皮肤上做瞳孔形态 | 现有应用有独立 IrisLayer 材质；着色器/UV 可连续改竖缝与圆，不增加头皮 morph 数据。MetaHuman 也用瞳孔关节缩放，表明不是必须用形态键。需保证左右参数。 | [应用 IrisLayer 接线](../apps/lingxi/src/v5-demo.ts)、[MH0]；材质选择为本项目工程判断 |
| 身体动作＋任意表情 | Body mixer 只影响身体骨；每帧 `mixer.update(dt)` 后应用注视/脸骨控制，再设脸部 morph 权重与材质参数；动作“喵”等输出面部请求，与表情层按**通道级合成规则**混合（例如 Jaw 取较大开口，Blink 由显式眨眼覆盖而非两次相加） | glTF 动画可分别包含节点 TRS 与 morph weights；three.js 支持 additive clip，但若身体 clip 已含脸 track，运行时直接写值会被 mixer 覆盖。应制定单一写入顺序和命名空间，回归“49 动作×任意表情”。 | [glTF 规范][GLTF]、[three.js 动画混合][TANIM]、[草案](RIG-REQUIREMENTS-v1-DRAFT.md) |

## 4. 新动作所需关节与姿势试值

**角度坐标：**下表所有试值均为相对本猫中立姿的局部/目标姿态**可调搜索范围**，不是被动 ROM 或硬关节限制；左右镜像时符号相反。先求爪、耳、地面的目标位置，再由三维 IK 解角，检查毛下皮肤、接地、肢体连续性。批次 7 仅有行走髋外展/旋转约 13–15°（一只代表猫）、前臂不同实验定义下的旋前旋后数据；**不能**把行走范围当挠耳/洗脸极限。[批次 7](FELINE-SOFT-TISSUE-AND-FOOT-FOR-CLAUDE.md#3-三维关节自由度)、[原始三维步态][HIP]。

| 动作 | 可复核实测 / 文献 | 工程做法与美术试值（先验收目标位置） | 来源 |
|---|---|---|---|
| 同侧后足挠耳 | 健康猫髋屈曲＋外展到耳边的统一关节角**未查到**；行走髋外展/轴旋约 13–15°不能外推。 | 髋目标相对站姿先试屈 60–100°、外展 25–55°，膝/跗折到爪垫轻触同侧耳后；骨盆坐稳、颈向爪侧倾；动态反复触耳而不穿头。不可只让膝在原竖平面摆。 | [HIP]、[批次 7](FELINE-SOFT-TISSUE-AND-FOOT-FOR-CLAUDE.md)、[本批姿势图](../assets/characters/lingxi/reference/lingxi-ref-act-scratch-ear.png)；角为美术试值 |
| 前爪抹脸 | 洗脸时肩内收、前臂旋前旋后的同口径角**未查到**；猫前臂被动/尸体及综述的定义差异见批次 7，不可加总。 | 三维前腿 IK 让腕先到耳后再沿脸弧扫到口旁；肩内收试 10–30°，前臂 twist 分布试 20–50°，腕旋转让掌垫面贴脸；头略配合，支撑爪留地。 | [前臂原研究][FORE]、[批次 7](FELINE-SOFT-TISSUE-AND-FOOT-FOR-CLAUDE.md)、[本批姿势图](../assets/characters/lingxi/reference/lingxi-ref-act-wash-face.png)；角为美术试值 |
| 香箱揣手 | 腕/肘在香箱姿势的骨性 ROM **未查到**。 | 前臂朝胸下收，肘屈＋腕屈，Foot/MCP 让爪缘转入胸下；腕屈先试 45–85°，爪不可从胸前露出、也不可穿腹，支撑由胸腹与折入的前臂共同形成。已有 Foot 可用，不必每趾加骨。 | [批次 7 足部](FELINE-SOFT-TISSUE-AND-FOOT-FOR-CLAUDE.md#2-掌指-mcp--跖趾-mtp-与接地)、[本批香箱图](../assets/characters/lingxi/reference/lingxi-ref-act-loaf.png)；角为美术试值 |
| 仰卧 / 打滚 | 猫打滚时各椎节轴转角与后仰 ROM **未查到**；CatFACS 论文只给“腹部暴露”的行为定义。 | **世界系转过 180° 不等于相邻椎节扭 180°。** Root/骨盆承担大部分整体滚转，胸腰段 5 节只分摊剩余少量扭转，颈保持脸可见；前后腿改向上收，低侧毛/软组织修正避免压成圆筒。姿势试值：根部滚转 100–160°，脊柱总相对扭转 20–50°，最终整体腹面朝上。 | [C]、[本批仰卧图](../assets/characters/lingxi/reference/lingxi-ref-act-belly-up.png)；角为美术试值 |
| 侧身理毛 | 侧弯＋轴扭在理侧腹姿势的分节角**未查到**。 | 胸腰连续侧弯总 25–45°、轴扭总 10–30°先试，颈头继续朝侧腹，舌尖触毛；五段分散，不在一节折出尖角。允许骨盆和肩有不同朝向，四爪/臀保持支撑。 | [脊柱与动作指南](FELINE-ANATOMY-AND-MOTION-GUIDE-FOR-CLAUDE.md)、[本批侧理毛图](../assets/characters/lingxi/reference/lingxi-ref-act-groom-side.png)；角为美术试值 |
| 原地转身 | 家猫原地转身的胸腰侧弯与骨盆相位的统一数字**未查到**。 | 身体侧弯总 15–35°起步，前后腿目标朝向分相位转，支撑爪在世界固定，摆动爪重落；头先看转向，尾后随。不能只转 Root 把四爪横拖。 | [应用步态要求](RIG-REQUIREMENTS-v1-DRAFT.md)、[本批俯视图](../assets/characters/lingxi/reference/lingxi-ref-act-turn.png)；角为美术试值 |
| 后腿立起、哈气弓背、跑后坐喘 | 这些动作的专用关节极值**未查到**。 | 立起靠踝/髋与尾作平衡，前爪用 3D IK；哈气在已有脊柱弓背上叠耳后贴、上唇、鼻、壳层毛；喘气由端坐＋Jaw、TongueOut、呼吸频率合成，不加专用骨。 | [C]、[草案](RIG-REQUIREMENTS-v1-DRAFT.md)、[本批姿势图目录](../assets/characters/lingxi/reference/)；工程/美术建议 |

## 5. three.js r186 / glTF 预算与限制

主仓实际安装的 [`three@0.186.0`](../apps/lingxi/node_modules/three/package.json)，不能沿用旧版“最多 8 个 morph 同时生效”的说法。以下以当前 WebGLRenderer 源码为准，设备限制仍需运行时查询。[three.js `WebGLMorphtargets.js`](../apps/lingxi/node_modules/three/src/renderers/webgl/WebGLMorphtargets.js)、[着色器循环](../apps/lingxi/node_modules/three/src/renderers/shaders/ShaderChunk/morphtarget_vertex.glsl.js)、[glTF 规范][GLTF]。

| 问题 | 当前机制与可核上限 | 对本项目的预算 / 计算 | 性质与出处 |
|---|---|---|---|
| 一个蒙皮网格的骨数 | `Skeleton.computeBoneTexture()` 每骨矩阵 **4 个 RGBA texel**，自动取足够边长的浮点 DataTexture；three.js **没有写死 64/128 骨限**。理论纹理装载上限约 `floor(MAX_TEXTURE_SIZE²/4)` 骨，但显存、着色器、蒙皮权重与更新开销先成为瓶颈。 | **项目预算**：单个 skin 的 joint palette 目标 ≤128；超出先测实际设备而非宣称 API 限制。核对全部 mesh 的 skin.joints 数与浏览器 `renderer.capabilities.maxTextureSize`。 | 工程事实 [`Skeleton.js`](../apps/lingxi/node_modules/three/src/objects/Skeleton.js)、[官方 Skeleton][TSK] |
| Morph 数量 / 同时生效 | r186 把每个目标放入 **2D array texture 一层**，shader 循环 `MORPHTARGETS_COUNT`，权重非零才采样；因此**无固定“8 个同时”限制**。受 `MAX_ARRAY_TEXTURE_LAYERS`、纹理宽/高和 shader 性能约束；glTF 本身不限目标数，但仅建议客户端至少支持 8 个 morphed attributes，不能读作 three.js 上限。 | 脸部小网格目标 ≤32、常态非零 ≤6、极端组合 ≤10，均为**待基准测试的项目预算**。运行时查询 `gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS)`，并针对最低目标设备测 32 壳层毛同时存在时的帧时。 | [`WebGLMorphtargets.js`](../apps/lingxi/node_modules/three/src/renderers/webgl/WebGLMorphtargets.js)、[shader](../apps/lingxi/node_modules/three/src/renderers/shaders/ShaderChunk/morphtarget_vertex.glsl.js)、[WebGL2 规范][WGL]、[GLTF] |
| 文件与显存示例 | `POSITION` 每目标每顶点 3×float32：**100,000 顶点 = 1,200,000 B ≈1.14 MiB / 目标**；若另带 `NORMAL` 又约 1.14 MiB。r186 GPU 打包为 RGBA32F，每 100,000 顶点每层 **1,600,000 B ≈1.53 MiB**，若同时带法线约 3.05 MiB；对齐与副本另计。 | 20 个全身 POSITION 目标未压缩约 **22.9 MiB**，GPU 约 **30.5 MiB**；若改为 10,000 顶点脸区，则约 2.29 / 3.05 MiB。以上是线性数据量例子，非现有 GLB 实测值。 | 按 [glTF VEC3 float32][GLTF] 与 [`WebGLMorphtargets.js`](../apps/lingxi/node_modules/three/src/renderers/webgl/WebGLMorphtargets.js) 的 `Float32Array × RGBA` 计算 |
| 缩小数据 | glTF `sparse accessor` 可只在文件中存改变的顶点；但 GLTFLoader 会展开成完整 BufferAttribute，当前 three.js 渲染仍建立**密集 GPU array texture**，不能把 sparse 当运行时显存节省。 | 脸部独立小网格/较低面数、仅导出实际用的 POSITION 目标、按需分离身体修正；可验证 sparse/KHR_mesh_quantization 对**文件**体积的收益，注意导出器支持与精度。壳层毛与 base 共享 geometry，增加脸形态会重复绘制成本而不必重复存 32 份 morph 数据。 | [glTF sparse 规范][GLTF]、[KHR_mesh_quantization][Q]、[`GLTFLoader.js`](../apps/lingxi/node_modules/three/examples/jsm/loaders/GLTFLoader.js)、[应用壳层共享](../apps/lingxi/src/v5-demo.ts) |

## 6. v1 骨架冻结规格（建议清单）

**控制命名为建议的导出契约**，`L/R` 均左右独立；具体 Blender/GLB 节点名允许映射表，但语义、局部轴、rest 矩阵和取值域必须固定。项目已有骨/形态的“现状”来自[草案](RIG-REQUIREMENTS-v1-DRAFT.md)与[Round X2 交接](HANDOFF.md#round-x2claude-主会话2026-10-12尾尖爪关节卧坐的软组织与腿的自由度)，不是已验收的功能。

| 项目与建议名 | 新增 / 接已有 / 可省 | 对应动作或表情；冻结验收 |
|---|---|---|
| `EarRoot.L/R` 三轴＋`EarTip.L/R` | **接已有 Ear 根，新增耳尖 ×2** | 前倾、飞机耳、后贴、单耳倾听；耳尖连续弯而非刚板；根 pitch/yaw/roll 分轴限制。[C] |
| `TongueRoot`＋`TongueMid`＋`TongueTip` | 接已有 1 节，**新增中/尖 ×2** | 吐舌、舔嘴/鼻、舔毛、饮水 J 形、喘气；舌尖可独立卷与偏左右。[L][C] |
| `ForearmTwist.L/R` | **新增 ×2**，夹于既有前臂段皮肤权重中，不改变肩肘腕中心 | 洗脸、舔爪、拍击掌向；输入为前臂轴转角，近远段分配避免袜筒扭结。[FORE] |
| `Eye.L/R`、`Jaw`、`Nose`、`Whisker.L/R` 根簇、`Lid.L/R`、`LipUpper` | **接已有骨与权重/驱动**；Lid 可仅辅助眼角 | 注视/独眼斜看、开口、嗅闻、胡须三向、眼睑；`LipUpper` 整体骨保留但哈气左右细节交给 morph。[C]、[草案](RIG-REQUIREMENTS-v1-DRAFT.md) |
| `Neck/NeckB/Head`、五段背、肩胛与四肢链、四个 `Foot`/MCP-MTP、10 段尾、爪伸出 | **接已有，扩三维解算**；不为每个新动作加专用骨 | 挠耳、香箱、仰卧、理毛、转身、立起；导出每骨父级、rest、主屈伸轴、可旋/可平移轴、IK 极点与趾垫接触点。[批次 7](FELINE-SOFT-TISSUE-AND-FOOT-FOR-CLAUDE.md)、[草案](RIG-REQUIREMENTS-v1-DRAFT.md) |
| `Blink.L/R`、`UpperWide.L/R`、`LowerLift.L/R`、`SmileArc.L/R` | **脸部 morph 8 个**；已有 Blink/Squint 可重映射，不重复制 | 圆、睁大、半眯、笑眼、闭、单眼眨、慢眨；笑眼不强迫出现人类眉形。[C][MH] |
| `BrowInnerUp.L/R`、`BrowOuterUp.L/R`、`BrowInnerDown.L/R` | **角色化脸部 morph 6 个**，小幅；不加眉骨 | 眉平/扬/皱/委屈；须跟随眉区皮肤；明确这些不是同名 CatFACS AU。[C] |
| `MouthCornerUp.L/R`、`MouthCornerDown.L/R`、`UpperLipRaise.L/R`、`LowerLipDown`、`MouthO`、`NoseWrinkle.L/R`、`NostrilFlare.L/R` | **脸部 morph 12 个**（2+2+2+1+1+2+2）；鼻翼也可由现有 Nose 骨微动 | `ω`、撇、喵、哈气露牙皱鼻、嗅闻；与 Jaw 同时激活仍闭合无裂口。[C] |
| `TongueCurl`（舌小网格） | **1 个 morph**；必要时后加 `TongueScoop` 但饮水不做深勺 | 舔嘴和饮水浅 J 形；与舌骨合成时不翻面。[L] |
| `Breath`、`LieSpread`、`FlankThigh`、`SitHaunch`、关节/仰卧局部修正 | **保留已有 4 个身体形态**；只补经姿势测试证实需要的肘/膝/跗/颈/仰卧修正，不列为脸预算 | 卧、坐、打滚、深折腿；权重由骨姿态与接地导出，非 clip 帧号；毛根随最终皮肤。[批次 7](FELINE-SOFT-TISSUE-AND-FOOT-FOR-CLAUDE.md) |
| `pupilWidth.L/R`、`pupilRoundness.L/R`、`irisVariant`、`eyeSparkle`、`tearWetness.L/R`、`furErect`、`tailFurErect` | **材质/特效参数**，不做全身 morph | 竖瞳/圆瞳、爱心/闪亮/含泪、哈气/愤怒炸毛炸尾；爱心和符号属于角色效果。[GLTF]（morph/材质分工为工程判断）、[草案](RIG-REQUIREMENTS-v1-DRAFT.md) |
| `face.set(eye,brow,mouth,ear,symbol)`、`face.gaze(target)`、`pose.solveLeg(side, target, pole, pawNormal)`、`pose.turn(yaw)`、`pose.bodyRoll(angle)` | **运行时接口**，控制语义冻结，应用具体函数名可变 | 五层表情套任意 49 动作；眼/头看指针、实时步态接地、转身、打滚。合成器统一归一化和优先级，表情更新在 mixer 之后。[TANIM][GLTF]、[草案](RIG-REQUIREMENTS-v1-DRAFT.md) |
| 每趾独立骨、后小腿 twist、瞬膜骨、EAD107 专用耳廓收窄骨、独立“喘气骨” | **v1 可不做**；如权重审阅证明需要再加小腿 twist | 四趾形状由现有共用趾段/爪伸出控制；其余需求可由已有骨、局部 morph、材质与动作参数完成。[C]、[批次 7](FELINE-SOFT-TISSUE-AND-FOOT-FOR-CLAUDE.md) |

**冻结门槛（工程验收）：**（1）导出骨名/父子/rest/局部轴/权重图与 morph 字典；（2）对 49 个动作抽样并对 30 个表情与所有五层极端组合做运行时叠加；（3）四个新姿势的爪/耳/脸接触与无毛皮肤都不过穿，转身支撑爪不拖地；（4）真实目标设备读取骨纹理和 array-layer 上限、计量 GLB 大小/显存/帧时，若超预算先缩脸网格与目标；（5）确认“脸部 clip 通道为零”或明确动作面部请求轨的合成规则。[草案](RIG-REQUIREMENTS-v1-DRAFT.md)、[three.js 机制][TSK][TANIM]。这是项目验收建议，不是文献测值。

## 来源

[C]: https://pure.port.ac.uk/ws/portalfiles/portal/5970434/Development_and_application_of_CatFACS.pdf "CatFACS 作者原始论文，表 1 与动作定义"
[CM]: https://www.scribd.com/document/863419731/1-Intro-CatFACS-Manual "Caeiro、Waller、Burrows，CatFACS 2013 手册扫描件；以作者论文交叉核对"
[SB]: https://www.nature.com/articles/s41598-020-73426-0 "猫慢眨实验，Scientific Reports 2020"
[E]: https://pmc.ncbi.nlm.nih.gov/articles/PMC6792787/ "Populin 与 Yin，猫耳定位运动线圈实验，1998"
[P1]: https://pubmed.ncbi.nlm.nih.gov/4029324/ "Hammond 与 Mouat，清醒成年猫瞳孔与亮度，1985"
[P2]: https://www.sciencedirect.com/science/article/pii/0042698975901911 "Wilcox 与 Barlow，轻麻醉猫瞳孔面积，1975"
[L]: https://www.epfl.ch/labs/flexlab/wp-content/uploads/2017/12/27_2010_Reis_Science_CatsLapWaterUptake.pdf "Reis 等，猫饮水高速摄影，Science 2010"
[G]: https://pmc.ncbi.nlm.nih.gov/articles/PMC6298077/ "Noel 等，猫舌乳头与理毛，PNAS 2018"
[HIP]: https://pmc.ncbi.nlm.nih.gov/articles/PMC6078300/ "家猫三维后肢步态原始研究"
[FORE]: https://pmc.ncbi.nlm.nih.gov/articles/PMC7821726/ "猫前臂尸体运动学与既有范围综述"
[MH0]: https://dev.epicgames.com/documentation/metahuman/metahuman-dna-rig-definition-and-rig-operation "Epic MetaHuman 关节、形态与瞳孔关节设计"
[MH]: https://dev.epicgames.com/documentation/metahuman/skin-weights "Epic 眼睑沿眼球权重检查"
[UB]: https://docs.unity3d.com/Manual/BlendShapes.html "Unity Blend Shapes 官方文档"
[GLTF]: https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc "Khronos glTF 2.0 规范，morph/skin/sparse"
[Q]: https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_mesh_quantization/README.md "KHR_mesh_quantization 官方扩展"
[TSK]: https://threejs.org/docs/pages/Skeleton.html "three.js Skeleton 官方文档"
[TANIM]: https://threejs.org/docs/pages/AnimationClip.html "three.js AnimationClip 混合模式官方文档"
[WGL]: https://registry.khronos.org/webgl/specs/latest/2.0/ "Khronos WebGL 2.0 规范"
