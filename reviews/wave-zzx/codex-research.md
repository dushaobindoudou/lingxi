# Round ZZX 调研与美术资源建议

日期：2026-10-15。基线：lookdev/b4-review，84817be（Round ZZW）。本轮只阅读源码、JSON、记录及所附图片；未启动 Blender，未验证网格、动画或新表情渲染。下文“现值”是该提交源码默认值，结合 round-zzw/run.sh 与 knobs.txt 的显式环境覆盖核对；不是从 .blend 反读的运行值。knobs.txt 括号内历史说明不能当作当前默认值。建议区间均为待试验的美术搜索区间，非已经得到的改善。

源码行号以 scripts/blender/build_lingxi_v5.py 为准；表情消费端另标文件名。优先级按治愈/萌的可见收益与改动成本综合排序，拆开同一审计项中的低成本与结构问题。

## 口径与资源核验

正面桌宠机位沿用输入图的 app 机位。render_target.py:2、42 描述为前方、从水平线上方 20° 向下看（用户所称正面仰角 20°）；不能混用旧参考的俯拍。定量姿态验收固定相机矩阵、正交尺度/焦距、裁切、地面与灯光，不按猫的包围盒自动重新构图。脸用固定正面 200×200；全身用 420×420；爪用固定 paw-front 近景。三维米值乘 1000 得毫米，生成图不得反推骨长。毛缘像素忽略零散飞毛，以连续轮廓为准；阴影不算毛缘。

本轮内置 imagegen 生成（不是 CLI），再用 sips 等比规范到 1024×1024 PNG，未做姿态拼贴。图像工具内部生成缓存由工具管理；仓库只新增指定三图、此报告与提案 JSON。工具实际返回 1254×1254，交付尺寸已检查。

| 输出（相对 assets/characters/lingxi/reference/） | 次数/选择 | 目测核验与限制 |
|---|---|---|
| lingxi-ref-ourcam-belly-up.png | 1 次，首稿 | 保留头左、低正面、暖棕虎斑白胸白腹白爪、橄榄虹膜黑瞳；四爪可辨，白腹朝前，尾巴落地。缩至 420 后头部接触约 y=267，对模板约 274，相差约 −7 px。嘴总体闭合向下，细小末端与毛纹不能作为嘴形几何靶。 |
| lingxi-ref-ourcam-groom-side.png | 2 次，选择首稿 | 完整近眼、粉鼻和贴侧腹的舌尖可读；低正面、地面色与主光方向近似一致。首稿前爪接触约 y=328，对模板约 320，差约 +8 px；第二稿更低、更满，故弃选。头的角度变动较大，额头条纹不是逐条复刻。 |
| lingxi-ref-ourcam-sidelie.png | 2 次，选择第二稿 | 头右尾左、后腿向左平放、前爪并排、胸低，第二稿收回了首稿过满的构图，嘴角上钩也减弱。接触约 y=301，对模板约 330，仍差约 −29 px；脸/条纹存在重绘差异。严格同地线检查未通过，已达到本轮两次生成上限。 |

以上坐标是人工读图估计（约 ±5 px），不是分割测量。三图均无文字，色系、主光方向和低正面视角基本保留；**不能声称相机内外参、花纹 UV 或地线严格一致**。侧卧图只作姿态方向参考，不作直接叠图标尺。三图的温顺脸和长毛也不能覆盖模型已定稿的身份特征。严格任务 A 仍有这项残余偏差。

### 最终提示词记录（生成约束的中文对照）

共同提示：identity-preserve/precise pose edit；1024×1024 写实毛发摄影，无文字；输入渲染为机位、构图、地面、灯光和身份模板；低正面 20°，灰米色地面背景、左上柔光；暖棕虎斑、白胸白爪、幼猫大圆头、大黑瞳橄榄虹膜、粉鼻，闭口为向下“人”字；不改俯拍，不加肢体。

- 翻肚：头左身右，全仰躺、身体 C 形微弯且向镜头微滚，大白腹朝前；两眼看镜头、四爪松蜷、尾巴在右侧地面卷起；头部接触 y≈.65，保留留白。
- 舔侧身：坐着回头舔自己的侧腹；完整近眼和鼻尖可见，舌尖接触腹侧毛而非爪/胸；尾左、前爪接触 y≈.75。第二次补充恢复模板条纹与画幅、耳顶 y≈.12、猫 x≈.07–.89，结果未优于首稿。
- 侧卧：头右尾左、腹朝镜头、横向舒展、胸低贴地；两后腿向左放在地面，前爪并排；保留原图比例与脸位。第二次以原图为严格模板、首稿仅作姿态参考，要求猫 x≈.07–.90、头中心≈(.65,.50)、接触 y≈.78，强调嘴线由中央向下而无上钩。实际仍未完全遵守地线约束。

## 1. 表情区分：先修叠加与嘴角，再修笑眼（#2；收益高，数值成本低，笑眼成本中）

**根因。** 3950–3981 的 LAYERS / EXPR_EXTRA 把多个情绪映射到同一 eye/brow/ear；scripts/lookdev-v6/v6_face_apply.py:136–144 是相加，不是后者覆盖前者。譬如期待 UpperWide=.3+.45+.35=1.10，警觉=1+.45=1.45；该文件 apply():88–95 又按 shape key slider_max 截断，若 Wide 上限为 1，两者会饱和成相同开眼。需后续从 .blend 读实际 slider_max 确认。cat 嘴层 MouthCornerUp=1.4，开心再加 .35；3901 的上提向量 z=9 mm，导出的 JSON 因头尺度为 9.9 mm，层叠会把闭口嘴向上牵。照片格仍近似“人”字不能说明这个潜在位移合理。

**本轮 JSON 提案。** 保留 controls、30 个 expressions 的字符串映射、所有键/列表结构；只调既有 layers 和 extras 数字。cat/tongue 及全部 extras 的 MouthCornerUp 激活归零；frown 的 MouthCornerDown 1.4→.40，LowerLipDown .35→.10，以免闭口下唇裂开。眼睛主要靠上睑开合、斜度、视线、耳轮廓区分，不用提高嘴角表达开心。LowerLift 的 soft .60→.20、tearful .50→.18，减少浅色下睑占比。期待最终 UpperWide=.88、警觉/惊吓=.93、好奇=.28、清醒=.05；期待最终 EarForward=.62、好奇/清醒=.32。玩心保留独有吐舌并把 TongueBlep 1→1.15（若 key 被截断，需检验实际幅度）。得意保留单侧轻笑眼；困惑保留单耳转动。

**笑眼根因。** 1345–1346 的 V6_SHUT_ARCH=.10 决定 Blink 线；1357 的 V6_SMILE_ARCH=.15 与 1366 的 U=.99−.6*A*sin^1.5、L=1.00+A*sin^1.5，通过上下睑不同闭合量做拱。1359–1365 明记 .30/.45 已出现浅色鼓包。2250 的 V6_LID_FUR_L=.70 仍使下睑毛长基值 14 mm；增加 SmileArc 权重不会直接获得干净更高的线，可能让两层错位。开心还叠加 raise 的 UpperWide，使上睑 Smile 与 Wide 同时作用。

**现有旋钮首轮。** V6_SMILE_ARCH .15→只试 .16/.18/.20；V6_SMILE_U=.99、V6_SMILE_L=1.00、V6_SHUT_ARCH=.10 保持。V6_LID_FUR_L .70→.55–.65，先 .60；不要提高全局 V6_LID_FUR 数量。提案保持 happy 的 SmileArc=1，不依靠超 1 推挤眼皮。若 .20 仍达不到弧高，停止继续增幅。

**需要几何代码的可靠方案。** 在 1366 / 1466 的 Smile shape key 构建处给上下睑定义同一条闭眼接缝，而不是分别推动两个球壳：在眼局部坐标，以两端连线为基底，`z_seam(x)=z_chord(x)+h*(1-(x/r)^2)`，h 初试 4–8 mm，随后按固定 200 px 机位测到 3–6 px；`y_seam` 投到既有眼球安全外壳。上下睑内缘共享 x/z，y 方向留 0.3–0.8 mm 层次间隙；向外缘平滑衰减，固定内外眦，避免把整片下睑向前推。2250–2265 的毛发 Smile key 要沿相同根部变换同步更新。apply 端混合时对 SmileArc 与 Blink/Squint/Wide 设互斥或归一预算：完全笑闭眼时 Wide=0，部分笑眼则按 (1−SmileArc) 衰减 Wide。此项需要代码，未写入数值 JSON，也不能假称 JSON 已解决弧形。

**验收。** 固定正面 200 px：闭笑眼中点高于端点连线 3–6 px，连续暗线，不能出现高于周围毛面 2 px 的浅色圆包；闭口两端低于中央分叉≥1 px，末端不向上回钩；除喵喵/惊吓/生气/玩心外无牙舌意外露出。每对近似情绪至少有一个稳定轮廓信号：睑缘差≥3 px 或耳尖位移≥6 px；不能只以高光/瞳孔差算通过。隐藏名称/符号随机排序：设计目标 30/30 可分；最低阶段门槛沿审计为 24/30，且好奇/玩心/期待/清醒四者不能互混。由至少 3 人各盲标一次记录混淆表。本轮只确认 30 个控制向量不同，不能给出识别率。

**回归。** 全 30 格、左右眨眼、Yawn/Bite/Lick/Happy/Knead，半闭到全闭的过渡、正侧三分之四眼球穿插。共享层调整会联动多格，必须整张重拍。原始表情 JSON 未替换；下次重建脚本会重新导出旧数值，接入提案时须由模型进程另行落实导出源。

## 2. 颊、胸、尾局部毛量（#3；收益高，成本低）

**根因。** groom():2066–2067 局部 V6_CHEEK_FLUFF=.45 / V6_HEAD_BIB=.20；2075–2079 的 V6_BIB=0、V6_CHEST_TRIM=.50 对胸前强裁剪；2186 的基础长毛 body=.085、head=.064、tail=.150 m，但朝向、立毛、裁剪共同决定投影，不等于毛缘增加量。2097 的 tail stand=1.7，盲目全局加长/立毛会成刺；2195 下绒还额外乘 2014 附近 scale=.55，因此 .100 m 的尾下绒并非直接 100 mm。

| 旋钮 | 现值→首选/搜索 | 预期 |
|---|---|---|
| V6_CHEEK_FLUFF | .45→.60（.55–.70） | 外颊下缘增软，不动中央口鼻 |
| V6_CHEST_TRIM | .50→.38（.32–.42） | 释放局部白胸毛，不加深胸腔 |
| V6_BIB | 0→.10（.06–.16） | 白胸中部轻蓬；与 trim 分步试验 |
| V6_HEAD_BIB | .20→.24（.20–.28） | 下颌至胸衔接；防围兜遮前腿 |
| V6_LEN_TAIL | 1→1.10（1.08–1.16） | 尾外径更软，不增加骨尾长 |
| V6_LEN_BODY / HEAD / UNDER | 1→1（保持） | 避免全身变胖、眼口被盖 |

V6_N / N_UNDER / DENSITY 暂保持，16 GB 机器不以全局加根数解决局部轮廓。若只有尾尖缺量，在 groom 的 tail 分支新增沿尾轴末段 smoothstep 蒙版，`ln*=1+0.10*tip_mask`；尾根不加，避免坐姿结块。此为新增代码，不是已有旋钮。

**验收。** 同尺度 420 px 正面/侧面：外颊、胸缘相对基线外移 5–12 px；尾尖外径加 8–16 px；躯干中段厚度变化≤3 px。嘴线连续可见，虹膜不被毛遮>1 px；前爪间仍有分离。若达不到，先看毛方向与 root mask，不提高全局长度。回归 Sit/Loaf/LieDown、Sleep 尾环、SideLie 尾脚关系、BellyUp 白腹和起跳尾影；全身加毛会抹平虎斑、吞掉趾缝。

## 3. 舔侧身露脸、舔爪接触（#5；收益高，成本中）

**GroomSide 根因。** GS 定义 3212：fyaw=1.45（约83°）、fpitch=.90（约52°）；3760–3765 最终 _face_world 覆盖链式头朝向。因此只调 GS head/head_yaw 不一定改变最终面朝方向。3699 附近还 blink=.5，近眼被进一步压窄。舌 Up=lk、Out=.4*lk 是时间波，没有对腹侧表面求接触。

**先调已有参数。** V6_GS_FYAW 1.45→1.10（.95–1.25）；FPITCH .90→.50（.40–.65）；FROLL 0→−.08（−.15–.10）。保留 FACE=1。先露脸再调 V6_GS_SPINE_SIDE .55→.65（.55–.75）、NECK_SIDE .55→.65（.55–.75）、TWIST .35→.40（.30–.50）把侧腹送到口前，不用把头重新埋下去。方向最终必须看正面渲染，不能仅凭欧拉角正负认定可见性。

**需代码。** GroomSide 的 blink .5→.10–.20（建议新增 V6_GS_BLINK=.15）。在最终 _face_world 之后做小幅接触优化：取可见侧腹的已变形网格候选点，过滤法线朝向口部的点，约束舌尖到表面≤2 mm，允许颈侧弯/躯干侧弯的小改；目标函数加入近眼可见面积与鼻尖可见性，不能单纯最小化口腹距离。舌伸出峰值 .4→搜索 .45–.65，先测真实距离再增加；禁止把舌根拉长来补几十毫米的错位。

**Lick 根因。** 3080–3096 _lick_reach 用 LX_FrontPad.R 顶点均值作接触代理，goal=预存 lick_l 经过 Head 变换+.003*方向，未在此处按当前 Tongue Up/Out/Curl 评估真实舌尖。3670 附近舌随 fac 动，而 3790 的手爪使用独立 hold 包络，故“抬爪到嘴”不代表每个舔舐峰值接触。现 V6_LICK_PAD_GAP=.003→先试 .001–.002；V6_LICK_TURN=.65→.50–.65、TILT=.22→.12–.22 可提高舌爪可见性，但要重求手爪。这里 _lick_reach 最终用自算 orient，V6_LICK_PAW_TURN 不能当作它的最终朝向旋钮。

**需代码。** 在舌 key 与最终头姿态更新后读舌尖和掌面候选点；以舌尖到掌面最近点代替掌垫中心；只在舔出峰值进入接触，回收时允许分离。伪码：`tip=eval_tongue_tip(); target=closest_visible_pad_surface(tip); solve_arm(target + normal*gap);` 保留腕转限位与肩部正则，最多迭代至 .8 mm 停止。不要让近眼被爪遮住来换接触。

**验收。** app 正面 420 px：GroomSide 完整一眼轮廓及鼻尖，舌侧腹间距≤5 px；Lick 峰值舌爪间距≤3 px，连续至少2帧可见触点。真实变形表面最近距离 0–2 mm、穿插≤1 mm；单张二维重叠不能算接触已成立。回归 Sit/ScratchEar/WashFace、Lick 全周期与 Yawn 舌根，检查肩腋拉裂、掌垫朝外和露齿。

## 4. 侧卧舒展与低机位翻肚（#4；收益高，成本中至高）

**侧卧根因。** 2982–2989：yaw=1.35 / hip_roll=−1.5 已符合头右尾左，不应反转；spine=.65 与 chest_keep=.78 使胸回扭偏直立（3568–3572）。h_dy=−.10 仍把后脚往前收。3385 用 max 提高下侧后足，不能将已经悬高的足目标压回地面；3386 上足又随之抬高。PAW_META 分支已把 add_HL/HR/FL/FR 默认归零，改前面字典的 .7 等不会生效。世界 z 接触要从变形掌底计算，不是直接把骨头 z 设 0。

| 旋钮 | 现值→建议 | 预期 |
|---|---|---|
| V6_SG_SPINE | .65→.35（.25–.45） | 拉开胸臀，减蜷曲 |
| V6_SG_CHEST_KEEP | .78→.55（.45–.65） | 胸跟随侧倒，降低前胸 |
| V6_SG_H_DY | −.10→.02（0–.08） | 后腿向后伸；经 pelvis 变换后确认画面向左 |
| V6_SG_H_PA | .30→.15（.05–.25） | 后掌放松，减少亮掌面对镜头 |
| V6_SG_H_STACK_DY / DZ | .07/0→.04–.06/0 | 两后足轻错开且同地面 |
| V6_SG_F_FLOOR | .080→.065（.055–.075） | 降前足骨目标；必须以掌底校准 |
| V6_SG_F_HALF | .025→.030（.025–.035） | 前爪中心50–70 mm，避免相穿 |
| V6_SG_DROP / BEND | .10/0→先保持 | 先解决扭转和足目标，防靠整猫下移穿地 |

若后足仍悬空，3385–3386 改为：计算各自目标朝向下的 skin-to-bone 垂向偏移，将目标 z 设到地面+该偏移+1–2 mm，再与原目标按 fr 平滑混合；另一足独立求掌底接触，保留水平错位。必要时在最终腿 solve 后再次接触修正。降低 f_floor 不能替代此逻辑。

**翻肚根因。** 3214 / 3706–3717：roll=2.7、turn=−1.3、twist=−.45，身体和胸段滚转不同；3434 起四爪目标又可能遮腹；3750 独立定脸朝向，这能露脸却不能保证腹面朝相机。旧俯拍目标的白腹竖高≥100 px 不适合作为此低机位硬门槛，不能为凑高度抬相机。

建议固定 V6_BU_TURN=−1.3、FACE_PITCH=.15，ROLL 2.7→搜索 2.45/2.60/2.75/2.90；TWIST −.45→−.25（−.15至−.35），SPINE .25→.35（.25–.40）。不是越接近 π 越好：低机位要看见腹面法线朝镜头。F_DZ .13→.16（.15–.18）、H_DZ .15→.17（.15–.19），只抬到松弛可见且不挡腹；F_PA=1.2、H_PA=.8 先保持。WIGGLE .12→.06–.08 保持安稳。尾部 3717 的 Tail0–2 固定 .35 无 BU 专用落地卷绕目标；如尾仍翘起，在 _rest_on_floor 后复用 _tail_wrap，并以腹臀外侧地面点为路径，最后 _tail_off_floor。不要用全局尾长补卷曲。

**验收。** 侧卧 app 420 px：后足最低点离地0–3 px，腹侧连续毛缘离地≤5 px；胸臀投影轴不出现折角>20°；后腿不跨在腹上，前/后足各至少一只完整可辨，身体投影水平跨度较基线增8–15%，不改变相机或头尺度。翻肚 app 420 px：连续白腹（排除胸/爪）占胸至髋躯干投影≥30%，白腹最厚处≥50 px，建议范围50–80 px；四爪各有独立轮廓/缝隙≥3 px，两眼与鼻尖可辨。该门槛取代错误机位的100 px，不声称当前已测达标。模型中腹面代表法线与看向相机方向点积优先>.45，并同时保持背侧支撑地面。

**回归。** SideLie 入场/退场、Sleep/LieDown 共用 _back 与接触函数；BellyUp 滚入滚出、四爪/头/耳/尾穿地、腹股沟拉伸。网格最低点≥−2 mm，稳定支撑面离地0–3 mm；要全帧复核，旧记录 frame265 的穿地不是本轮已确认或已修复。

## 5. 趾缝深度（#6；收益中，成本中）

**根因。** 329–333：V6_TOE_CLEFT=2 放大负 metaball 的 x 和 z，默认负球有效半轴为 RX .006×2=.012 m、RZ .014×2=.028 m；它不是“2 mm 缝深”。347 附近 merge 的 V6_BODY_VOXEL=.0045、SMOOTH=3 会抹细缝，groom:2087 的 V6_PAW_COAT=.12（基础85 mm乘局部因子、随机长度等）再次填缝。现有 2–4 mm 深度是旧审计记录，不是新 ZZW 网格量测。

先保持 V6_TOE_CLEFT=2；V6_CLEFT_RZ .014→.016–.018、V6_CLEFT_Z .006→.008–.010；V6_CLEFT_RX .006→.005–.006 保持窄缝；STIFF=4 保持，必要时试4.5，不同时猛增半轴与 stiffness。V6_CLEFT_DY 0→.002–.004 只把切口轻移到趾前。V6_PAW_COAT .12→.10–.11；不做全爪剃毛。若裸皮仍没有缝，才试 BODY_VOXEL .0045→.0035–.004、BODY_SMOOTH 3→2；这些全身 remesh 参数成本高，16 GB 限制下优先改局部负球，重建由占用 Blender 的进程统一安排。

**验收。** paw-front 固定机位裸皮及带毛各一张，沿趾端轮廓量相邻凸点到谷底的局部深度，带毛有效深6–8 mm，三缝均可见，四趾不分离成独立球；同机位像素转毫米用渲染相机/模型尺度标定，不能拿420全身比例套近景。侧面趾端楔坡≤足长25%，非翻掌图粉垫外露≤2 px，前3/4坐后脚≥3趾可分。回归 Walk/Run 接地、Knead、Lick 翻掌、Sit 后脚；风险是趾皮裂开、透光、脚底悬空和负球使掌垫连接变薄。

## 6. 起跳后蹬与伸懒腰（#7；收益中高，成本高）

**起跳根因。** 2875 后足 off=.30；2886–2887 的 H 首关键点 (.33,.10,.02,.6) 是身体坐标偏移；3345–3367 在离地后 .05 相位混合，V6_JUMP_PLANT=1 又延迟水平释放 .02，再用高度限制水平权重。u=.31–.33 的截图因此很可能尚靠近原地面标记，并非把 H dy 加大就能立即出现后蹬。3533–3535 的 root 轨迹与髋俯仰共同影响髋足距离。

已有旋钮：V6_JUMP_CROUCH_DROP .10→.11–.12 仅增强蓄力，不当作后蹬修复；V6_JUMP_F_OFF=.22 / PLANT=1 保持。后足离地 .30、水平释放延迟 .02、H 关键点目前是硬编码。建议在2887把 H 首点 dy .10→.14–.18、dz .02→.00–.02，并增加 u=.30 的后伸过渡点；在3359把后足水平释放延迟 .02→.005–.010，仅在掌底真实离地>2 mm 后启用，前足落地逻辑保持。可新增 V6_JUMP_H_BACK=.15、V6_JUMP_H_RELEASE_DELAY=.01，不是假称已有旋钮。若离地前髋仍在后足上方，应改 .20–.30 的髋向前轨迹/后腿伸展约束，保持趾支点世界位置不动；不能令 planted 脚在地上向后滑出好看的剪影。

验收固定 side 420 px 与 rig：在 u=.28/.30/.32/.34 连续取样，至少一个离地前后峰值后足相对髋沿前进反方向≥60 mm；伸展率=髋至踝直线距离/(股骨长+胫骨长)≥.95且<.995，不混入掌骨；趾支点接地时帧间滑移≤2 mm，无一步跳变>5 mm。投影侧视应能直接读出向后蹬，不靠主观换帧。落地再验前掌支撑与缓冲。

**伸懒腰根因。** 3414 前爪 V6_BOW_REACH=.20；3602–3607 注明当前 BOW_PITCH=.73、BOW_SPINE=−.52，胸腔深度限制下背线只有约13.3°；该数是源码历史注释，不能当 ZZW 新测值。负 spine 抵消髋的前俯，仅加 pitch 曾让胸穿地。

先小步联合搜索：V6_BOW_PITCH .73→.76–.82；V6_BOW_SPINE −.52→−.46至−.38；V6_BOW_REACH .20→.22–.25。每组必须测胸腹最低点，不能直接全取极值。颈−.35、头−.15 先保持，看脸和脖颈是否被拉长。若骨胸先触地而背线仍<25°，在3607附近改为带约束的髋/胸/肩解算：后掌固定、前掌前伸，降低胸心并允许肩胛沿肋面移动，优化背线倾角且满足胸腹皮面z≥2 mm；必要时做仅 Stretch 激活的胸腹软组织压扁 corrective，幅度5–10 mm且局部保体积。不要再全局缩体或改头1.10来规避动作问题。

验收 side 固定420 px：胸至髋背线下俯25–35°，前爪和胸前连续毛缘最低点离地≤5 px，皮面不穿地超过2 mm；尾巴舒展不成硬直杆。回归 Jump 四阶段、Run 伸展/收拢、Walk、Stretch 进出和 Yawn；跑步原审计790/77 mm仅作旧基线，ZZW应重新实测，不把旧数字宣称为本轮结果。膝反折、肘锁死、脚掌滑动和接触修正造成弹跳为否决项。

## 表情提案验收记录与逐项变更

文件：face-controls-proposal.json。自动检查：原文件与提案递归键顺序、列表长度、所有字符串相同；仅数值变化；30 个 expression 均保留；按消费端加法合成后30组控制向量唯一；MouthCornerUp 的最终激活全部为0。未导入 Blender，未验证200 px可辨度、嘴形实际投影和笑眼弧。controls 向量不改，JSON没有新笑眼几何。

下表列出每个表情受共享层与 extras 影响后的**有效控制值**变化，L/R分别列出，便于复算；这不是直接覆盖 extras 的指令。

| 表情 | 有效控制值：原→提案 | 原因（共同：禁止上提嘴角） |
|---|---|---|
| 安然 | Blink.L/R 0.15→0.12；LowerLift.L/R 0.25→0.12；MouthCornerUp.L/R 1.4→0 | 安静基准，减少下睑抬升 |
| 好奇 | PupilW.L/R 0.32→0.33；PupilH.L/R 0.33→0.34；BrowInnerUp.L/R 0.7→0.75；BrowOuterUp.L/R 1→0.85；UpperWide.L/R 0.45→0.28；EarForward.L/R 0.4→0.32 | 抬眉开眼区别清醒 |
| 满足 | MouthCornerUp.L/R 1.4→0；EarFlatten.L/R 0.15→0.25 | 笑闭眼配侧耳区别开心 |
| 警觉 | UpperWide.L/R 1.45→0.93；PupilW.L/R 0.4→0.38；PupilH.L/R 0.4→0.39；BrowInnerUp.L/R 0.7→0.75；BrowOuterUp.L/R 1→0.85；EarForward.L/R 0.4→0.32 | 大开眼前耳且避免饱和 |
| 不爽 | GazeYaw.L/R 0.55→0.72；Blink.L/R 0.25→0.32；BrowInnerDown.L/R 1→0.75；LidSlantIn.L/R 1→0.7；LowerLipDown 0.35→0.1；MouthCornerDown.L/R 1.4→0.4；EarFlatten.L/R 0.55→0.65；EarSwivel.L/R 0.45→0.48；EarForward.L/R -0.25→-0.2；EarTipBend.L/R 0→0.1；NoseBridgeWrinkle 0.35→0.22；PadLift.L/R 0.25→0.12；OrbitLift.L/R 0.3→0.12 | 侧视压眉飞机耳，减口鼻挤压 |
| 惊吓 | UpperWide.L/R 1.45→0.93；PupilW.L/R 0.4→0.38；PupilH.L/R 0.4→0.39；BrowInnerUp.L/R 0.7→0.75；BrowOuterUp.L/R 1→0.85；EarForward.L/R -0.55→-0.48；EarFlatten.L/R 0.45→0.4；EarSwivel.L/R 0.5→0.4；EarTipBend.L/R 0.3→0.22 | 张嘴后耳区别警觉 |
| 困困 | Blink.L/R 0.6→0.68；BrowInnerUp.L/R 1→0.85；BrowOuterUp.L/R -0.3→-0.22；LidSlantOut.L/R 1→0.48 | 深半闭与悲伤眉表达困倦 |
| 玩心 | PupilW.L/R 0.32→0.33；PupilH.L/R 0.33→0.34；BrowInnerUp.L/R 0.7→0.75；BrowOuterUp.L/R 1→0.85；UpperWide.L/R 0.45→0.28；TongueBlep 1→1.15；MouthCornerUp.L/R 0.2→0；EarForward.L/R 0.4→0.32 | 独有吐舌信号 |
| 生气 | BrowInnerDown.L/R 1→0.75；LidSlantIn.L/R 1→0.7；EarForward.L/R -0.55→-0.48；EarFlatten.L/R 0.45→0.4；EarSwivel.L/R 0.5→0.4；EarTipBend.L/R 0.3→0.22 | 细瞳压眉张嘴，收敛过凶耳幅 |
| 撒娇 | PupilW.L/R 0.35→0.37；PupilH.L/R 0.36→0.38；Sparkle 1.4→0.65；BrowInnerUp.L/R 0.7→0.75；BrowOuterUp.L/R 1→0.85；UpperWide.L/R 0.45→0.28；MouthCornerUp.L/R 1.75→0；EarForward.L/R 0.4→0.32；SmileArc.L/R 0.2→0.32 | 部分笑眼大圆瞳，减少高光依赖 |
| 闭眼休息 | MouthCornerUp.L/R 1.4→0 | 完整Blink基准 |
| 开心 | BrowInnerUp.L/R 0.7→0.75；BrowOuterUp.L/R 1→0.85；UpperWide.L/R 0.45→0.28；MouthCornerUp.L/R 1.75→0；EarForward.L/R 0.4→0.32 | 完整笑眼前耳区别满足 |
| 放松 | Blink.L/R 0.26→0.32；LowerLift.L/R 0.6→0.2；MouthCornerUp.L/R 1.4→0 | 中等闭合避免鼓包 |
| 认真 | Squint.L/R 0.22→0.36；PupilW.L/R 0.26→0.27；EarForward.L/R 0.4→0.32；LidSlantIn.L/R 0.6→0.3 | 窄眼裂轻内斜区别生气 |
| 陶醉 | MouthCornerUp.L/R 1.9→0；EarFlatten.L/R 0.3→0.38；EarForward.L/R -0.15→-0.23 | 闭眼后放侧耳区别休息 |
| 期待 | PupilW.L/R 0.32→0.35；PupilH.L/R 0.33→0.36；UpperWide.L/R 1.1→0.88；Sparkle 1→0.65；BrowInnerUp.L/R 0.7→0.75；BrowOuterUp.L/R 1→0.85；MouthCornerUp.L/R 1.4→0；EarForward.L/R 0.65→0.62 | 强前耳开眼区别好奇 |
| 喵喵 | PupilW.L/R 0.32→0.33；PupilH.L/R 0.33→0.34；MouthCornerUp.L/R 1.4→0；JawOpen 0.24→0.2；TongueUp 0.9→0.65；LowerLipDown 0.3→0.22 | O口发声，收小舌下唇 |
| 清醒 | PupilW.L/R 0.32→0.33；PupilH.L/R 0.33→0.34；EarForward.L/R 0.4→0.32；UpperWide.L/R 0.25→0.05 | 近中性睑幅区别好奇期待 |
| 安心 | Blink.L/R 0.26→0.32；LowerLift.L/R 0.85→0.48；MouthCornerUp.L/R 1.85→0 | 比放松多一档轻下睑 |
| 温柔 | Blink.L/R 0.26→0.32；LowerLift.L/R 0.6→0.2；BrowInnerUp.L/R 0.7→0.75；BrowOuterUp.L/R 1→0.85；UpperWide.L/R 0.45→0.28；MouthCornerUp.L/R 1.65→0；EarForward.L/R 0.52→0.14 | 软眼抬眉减少前倾耳 |
| 委屈 | LowerLift.L/R 0.5→0.18；LidSlantOut.L/R 1.8→0.76；PupilW.L/R 0.34→0.37；PupilH.L/R 0.35→0.38；BrowInnerUp.L/R 1→0.85；BrowOuterUp.L/R -0.3→-0.22；LowerLipDown 0.35→0.1；MouthCornerDown.L/R 1.4→0.4；EarForward.L/R -0.55→-0.48；EarFlatten.L/R 0.45→0.4；EarSwivel.L/R 0.5→0.4；EarTipBend.L/R 0.3→0.22 | 圆瞳悲伤眼斜减低下睑填充 |
| 害羞 | Blink.L/R 0.6→0.68；BrowInnerUp.L/R 1→0.85；BrowOuterUp.L/R -0.3→-0.22；LidSlantOut.L/R 1→0.48；MouthCornerUp.L/R 1.7→0；LowerLift.L/R 0.3→0.08；GazeYaw.L/R -0.35→-0.65 | 深半闭侧看 |
| 求抱抱 | PupilW.L/R 0.32→0.33；PupilH.L/R 0.33→0.34；BrowInnerUp.L/R 1→0.85；BrowOuterUp.L/R -0.3→-0.22；LidSlantOut.L/R 1.4→0.66；MouthCornerUp.L/R 1.4→0；EarForward.L/R 0.4→0.32；UpperWide.L/R 0.2→0.12 | 内高眉悲伤睑斜正视圆眼 |
| 困惑 | PupilW.L/R 0.32→0.33；PupilH.L/R 0.33→0.34；BrowInnerUp.L 1.4→1.15；BrowInnerUp.R 0.7→0.75；BrowOuterUp.L/R 1→0.85；UpperWide.L/R 0.45→0.28；LowerLipDown 0.35→0.1；MouthCornerDown.L/R 1.4→0.4；EarSwivel.R 0.9→0.65；EarFlatten.R 0.45→0.35；LidSlantIn.R 0.5→0.55 | 单耳旋转单眼斜度 |
| 警惕 | GazeYaw.L/R 0.55→0.72；Blink.L/R 0.25→0.32；BrowInnerUp.L/R 0.7→0.75；BrowOuterUp.L/R 1→0.85；UpperWide.L/R 0.45→0.28；EarForward.L/R 0.4→0.32；LidSlantIn.L/R 0.35→0.18 | 侧看轻压睑区别警觉 |
| 嫌弃 | Blink.L/R 0.6→0.68；BrowInnerDown.L/R 1→0.75；LidSlantIn.L/R 1→0.7；LowerLipDown 0.35→0.1；MouthCornerDown.L/R 1.4→0.4；EarFlatten.L/R 0.55→0.65；EarSwivel.L/R 0.45→0.48；EarForward.L/R -0.25→-0.2；EarTipBend.L/R 0→0.1；Sneer.L 1→0.55 | 半闭压眉单侧轻嫌弃 |
| 得意 | Blink.L/R 0.6→0.68；BrowInnerUp.L/R 0.7→0.75；BrowOuterUp.L/R 1→0.85；UpperWide.L/R 0.45→0.28；MouthCornerUp.L 2.1→0；MouthCornerUp.R 1.4→0；EarForward.L/R 0.4→0.32；SmileArc.R 0.2→0.12 | 单眼轻笑不对称 |
| 左眼眨 | SmileArc.R 0.35→0.1；LowerLift.R 0.3→0.08；BrowInnerUp.L/R 0.7→0.75；BrowOuterUp.L/R 1→0.85；UpperWide.L/R 0.45→0.28；MouthCornerUp.L/R 1.4→0 | 左闭右开，降低开眼侧闭合 |
| 右眼眨 | SmileArc.L 0.35→0.1；LowerLift.L 0.3→0.08；BrowInnerUp.L/R 0.7→0.75；BrowOuterUp.L/R 1→0.85；UpperWide.L/R 0.45→0.28；MouthCornerUp.L/R 1.4→0 | 右闭左开，降低开眼侧闭合 |
| 闪亮 | PupilW.L/R 0.32→0.35；PupilH.L/R 0.33→0.36；UpperWide.L/R 0.3→0.12；MouthCornerUp.L/R 1.4→0；EarForward.L/R 0.4→0.32 | 高光圆瞳较小开眼区别期待 |
