# 人形骨架：人体联动与现成资产适配

日期：2026-10-13。用途：给下载的带骨骼人形模型制定适配和动作验收依据。本文没有创建人体网格、重绑下载模型、实现人形运行时，也没有替换当前猫。人体解剖事实与本项目的工程建议分别标明。

## 结论与项目边界

建议保留现成模型的网格、权重、变形骨及可用动画，建立一层骨骼角色映射，再按需要补足动作。人体结构研究用于检查抬手、走路、下蹲是否自然；没有必要按解剖图重新造完整骨架。

仓库的[决策 005](../decisions/005-species-packs.md)和[物种包设计](../24-species-pack-design.md)已选择“共享意图、分别适配身体结构”。文档中的人形方案仍标注未实现。当前 `gait.ts` 的 `LEG_PHASE` 和四条 `describeLeg` 链，以及 `skeleton.json` 的 `lingxi-cat-v1`，说明当前猫的运动数据不能靠换文件直接驱动双足人形。`rig/skeleton.ts` 还检查皮肤的 `rigId`。

对现成资产的工程建议是：先在独立预览中核对骨架、动作和接地，再决定如何接入应用。VRM 是值得优先支持的角色语义标准；普通 GLB/FBX 游戏模型仍需核对自己的骨名、绑定姿势和动作，不能仅凭文件后缀认定兼容。

## 真实人体与游戏骨架的差别

| 部位 | 解剖事实 | 对下载骨架的工程建议 |
|---|---|---|
| 骨盆 | 左右髋骨与骶骨等形成承重结构，把躯干载荷传给支撑腿。[OpenStax：骨盆](https://openstax.org/books/anatomy-and-physiology-2e/pages/8-3-the-pelvic-girdle-and-pelvis) | 保留独立 `hips/pelvis`，用于身体升降、左右移重和骨盆朝向；无需拆出每块骨盆骨。 |
| 腰胸脊柱 | 相邻椎节的小幅活动累积成躯干弯曲，脊柱有生理曲线。[OpenStax：脊柱](https://openstax.org/books/anatomy-and-physiology-2e/pages/7-3-the-vertebral-column) | 保留现成脊柱链，把弯腰、挺胸和扭身分散到多个节点。可用较短链，无需逐块模拟椎骨。 |
| 颈与头 | 颈部能屈伸、侧屈和旋转；头部点头与摇头涉及不同上颈关节。腰椎与颈椎的活动特性也不同。[OpenStax：关节](https://openstax.org/books/anatomy-and-physiology-2e/pages/9-6-anatomy-of-selected-synovial-joints) | 视线跟随在胸、颈、头之间分配。不要把“扭头”和“转腰”应用同一组轴向角度限制。 |
| 肩带 | 锁骨和肩胛骨构成肩带，为上肢连接和活动提供基础。[OpenStax：肩带](https://openstax.org/books/anatomy-and-physiology-2e/pages/8-1-the-pectoral-girdle) | 有肩骨时保留。标准游戏骨架的 `shoulder/clavicle` 往往是肩带的简化代理，不是完整解剖重建。 |
| 上臂、前臂 | 上臂是肱骨，前臂包括桡骨和尺骨；手含腕骨、掌骨及指骨。[OpenStax：上肢骨](https://openstax.org/books/anatomy-and-physiology-2e/pages/8-2-bones-of-the-upper-limb) | 通常保留 `upperArm → lowerArm → hand`；前臂可有额外 twist 辅助骨，不必强行改成两根解剖骨。 |
| 腿与足 | 大腿为股骨，小腿包括胫骨和腓骨，足包括跗骨、跖骨与趾骨，足弓参与载荷分配。[OpenStax：下肢骨](https://openstax.org/books/anatomy-and-physiology-2e/pages/8-4-bones-of-the-lower-limb) | 通常保留 `upperLeg → lowerLeg → foot → toes`。低模足可合并部分结构；足底接地点仍需单独测量。 |

`root` 是动画工程节点，不对应某块人体骨。它管理整体位移/朝向或动作的根运动；`hips` 管理身体相对 root 的摆动。两者分开便于保持脚接地。Rigify 的根控制节点也是其骨架的共同父节点。[Blender：Rigify 根控制器](https://docs.blender.org/manual/en/4.1/addons/rigging/rigify/rig_features.html#root-bone)

## 上肢如何联动

**抬手需要肩带参与。** 肩胛位置由肩带肌肉控制，它为肱骨运动提供可移动的基座；耸肩、向前伸手与抬臂不应只转肱骨。[OpenStax：肩带与上肢肌肉](https://openstax.org/books/anatomy-and-physiology-2e/pages/11-5-muscles-of-the-pectoral-girdle-and-upper-limbs)

不要把“肱骨转 2 度、肩胛转 1 度”写成全程固定规则。McQuade 与 Smidt 的动态实验发现比例随抬臂阶段和负荷改变；另一项骨固定传感器实验还发现抬起/放下的节律并不相同。[1998 年原研究](https://pubmed.ncbi.nlm.nih.gov/9475136/)，[2009 年原研究](https://pubmed.ncbi.nlm.nih.gov/19395283/)

工程建议：优先复用资产已制作的抬手动画；程序化补偿时用可调曲线和姿势范围，观察肩部轮廓、腋下挤压以及左右一致性。模型没有独立肩胛骨时可通过肩带骨、胸部和权重获得合理视觉效果，不需为了术语齐全而破坏原绑骨。

**肘的弯曲与前臂的扭转分开。** 旋前/旋后会改变桡尺骨关系及手掌方向，并不是手腕绕自身随意旋转；腕部还有屈伸及侧向偏移，拇指有对掌动作。[OpenStax：身体运动类型](https://openstax.org/books/anatomy-and-physiology-2e/pages/9-5-types-of-body-movements)

工程建议：手掌翻转时让扭转分配到前臂，避免所有变化集中到手腕接缝。肘主要用于屈伸，IK 的 pole target 确定弯曲平面。手指可复用“握拳/张手/指向”姿势或现成指骨；拇指单独调，不把五指当同一弯曲轴的复制品。

## 下肢与常见动作

髋和肩都能多轴活动，但髋的结构与韧带更强调站立承重稳定性；膝也不能被当作可在所有方向自由旋转的球关节。[OpenStax：选定滑膜关节](https://openstax.org/books/anatomy-and-physiology-2e/pages/9-6-anatomy-of-selected-synovial-joints)

下表是动作制作建议，不是人体训练、诊疗或固定的生理角度标准。

| 动作 | 建议检查的联动 | 在资产预览中如何验收 |
|---|---|---|
| 站立与待机 | 身体有支撑、足底不浮动；呼吸主要体现在躯干，头部保持舒适朝向。 | 正面/侧面检查 foot 的局部原点与真实足底距离；循环首尾连续，脚没有随待机漂移。 |
| 步行 | 两腿交替支撑和摆动，骨盆、胸部和手臂参与。摆臂与全身角动量及地面反作用力矩有关，并非只为装饰。[Collins 等：步行摆臂原研究](https://pubmed.ncbi.nlm.nih.gov/19640879/) | 左腿向前时右臂通常向前；双脚接触切换连续，步幅与移动距离匹配；不要把骨盆/胸部反向摆动做成始终严格等幅。 |
| 下蹲 | 髋、膝、踝与躯干共同改变身体位置。健康成人实验显示下蹲深度和重心前后位移涉及不同关节贡献。[Kasahara 等：下蹲重心原研究](https://pubmed.ncbi.nlm.nih.gov/39132411/) | 同时检查骨盆下降与后移、膝弯曲、踝背屈及躯干倾斜；脚保持支撑，膝弯曲方向稳定。按模型比例调姿势，不固定关节联动比例。 |
| 抬手、挥手 | 胸部、肩带、肱骨、肘和手掌方向协调，动作强度越大越要检查全身。 | 手举过头时肩部不塌陷，腋下不撕裂，肘不翻转；挥手的主要表达可用现成 FK 动作，触碰对象才补 IK。 |
| 踮脚与迈步落脚 | 踝的跖屈/背屈与前脚掌、脚趾接触有关；足底内外翻不能只当作踝屈伸。[OpenStax：身体运动类型](https://openstax.org/books/anatomy-and-physiology-2e/pages/9-5-types-of-body-movements) | 观察脚跟抬起时的支点是否落在前脚掌，落脚时有没有穿地或滑动；toe/heel pivot 是控制支点，不一定是导出的变形骨。 |

## 动画控制：IK、FK、锁脚与 twist

- **FK**：逐级转动父子链，适合摆臂、挥手和自由动作。**IK**：给手/脚末端目标，由解算器影响整条链；pole target 管理肘/膝朝向，链长和 stretching 需要正确设置。[Blender：IK 约束](https://docs.blender.org/manual/en/4.4/animation/constraints/tracking/ik_solver.html)
- **切换要保持姿势**：IK/FK 混合或切换时应先对齐当前姿态，避免手脚瞬移。Rigify 提供切换、snapping、父级切换及足部 roll 控制。[Blender：Rigify 控制功能](https://docs.blender.org/manual/en/4.1/addons/rigging/rigify/rig_features.html#ik-and-fk-switching)
- **锁脚**是本项目建议的动画策略：接触阶段把 foot IK 目标固定在地面/支撑面坐标，身体继续移动；离地时解锁并平滑转入摆动。单纯按时间循环腿动画不能保证脚不滑。对于带根运动的下载动画，应选定“动画驱动移动”或“应用移动 + 原地动画”，避免两边同时平移。
- **Twist 辅助骨**是变形策略，不是新增人体骨。长段肢体扭转若集中在单一节点，蒙皮可能缩瘪；Blender 官方展示了旋转时不同体积保持方式的差别。[Blender：Armature modifier](https://docs.blender.org/manual/en/latest/modeling/modifiers/deform/armature.html) 工程建议是先保留下载资产已有 twist 骨及权重，检查极端手掌翻转，再决定是否补分段扭转。不要承诺 Blender 的体积保持选项会自动变成所有引擎里的同等效果。
- **控制骨与变形骨分开**：Blender 的 IK target、pole、heel 控制器管理姿势；网格实际由变形骨和权重驱动。导出资产前应将约束动作烘焙为目标格式可保存的节点动画。Rigify 控制器本身不能被当成 GLB 已经自带的运行时解算器。

## 骨骼角色映射草案

以下是给资产适配器的建议，**不是当前运行时已支持的 schema**。以下载模型实际存在的节点为准；不要为了统一名称重命名到破坏动画轨道。

| 项目语义 | 人形来源候选 | 用途 |
|---|---|---|
| `root` | 模型/骨架公共父节点 | 整体移动；不是 hips 的解剖别名 |
| `pelvis`（建议补充） | `hips` / `pelvis` | 骨盆姿势；与 root 分离 |
| `spine[]` | 从下往上的现成躯干链 | 弯腰、呼吸、扭身 |
| `neck[]`, `head` | 现成颈链、头 | 视线和点头 |
| `shoulder.L/R`（建议补充） | 肩带/锁骨代理 | 抬手、耸肩 |
| `limb.armL/R` | 上臂、前臂、手 | 手臂链；肩带另列便于适配 |
| `limb.legL/R` | 大腿、小腿、足、可选趾 | 脚部支撑和迈步 |
| `finger.*`（可选扩展） | 现成指骨链 | 手势；拇指单独处理 |
| `jaw`, `eye.L/R` | 可选变形骨或独立表情通道 | 不强制用骨骼做所有表情 |
| `twist.*`（可选扩展） | 保留资产辅助骨 | 网格变形，不参与核心肢体语义链 |

VRM 1.0 的 humanoid 字段正式规定了 `hips`、`spine`、`head`、左右上/下臂与手、左右上/下腿与足等必需骨；胸、颈、肩、趾与指骨等为可选骨。可选父骨不存在时向上寻找父级，且语义骨之间允许夹有非 humanoid 节点。因此映射时应保留中间辅助节点，不能通过“直接父节点必须是上臂”这种检查误拒有效资产。[VRM 1.0 官方规范](https://github.com/vrm-c/vrm-specification/blob/master/specification/VRMC_vrm-1.0/humanoid.md)

项目旧设计把 `root` 同时描述成“身体重心、整体平移”。真正适配双足资产时建议澄清这两个职责：root 是定位/运动控制，pelvis 是骨盆，真实重心是整个身体质量分布的结果，并不天然等于某一根骨的位置。也不要求下载资产恰好采用 VRM 命名；只需建立可追溯的角色映射。

## 复用资产时的最小交付

1. 留存原始模型、作者、原始下载页、许可证、下载校验值。可下载不等于可打包发行；网格与动画的来源和授权分别登记。
2. 记录实际骨架层级、变形骨数、角色映射、比例/单位、绑定姿势与前向轴。没有的角色明确标缺失，不猜骨名。
3. 展示站立、步行、下蹲、挥手四段预览；每段至少检查接地、肩/肘/膝变形、首尾衔接。
4. 记录 root motion 的处理方式，以及足底、前脚掌、脚跟的接触点。IK/锁脚可以随后补，已有烘焙动画先验证可独立播放。
5. 将模型接入放在独立人形实验路径；后续再按照物种包设计把意图映射到人形动作。猫的模型、动作和生活引擎不因资产研究而被替换。

以上是基于解剖与标准的资产适配建议。具体角色表、动作覆盖和许可证结论仍需在实际下载文件上核验；拥有带骨骼模型不等于已经支持人形桌宠。
