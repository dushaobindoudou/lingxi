# 方块猫 / 真实猫运行时集成调研与实施方案

调研日期：2026-10-15。主代码按用户指定的 `/Users/liepin/workspace/lingxi` 工作目录读取；精模构建和 v6 配置按 `/Users/liepin/workspace/lingxi-v5fix` 读取。未执行 git，因此未独立核验分支名。仅静态读取源码、JSON 和 GLB JSON chunk；未运行 Blender、构建、测试、浏览器或 App。本文的性能数字是建议验收预算，不是实测。

## 结论与资源门槛

可以沿用现有 Renderer 契约接入第二种实现；先保留方块默认，通过管理主界面“外观 → 风格”切换真实猫。真实猫需要独立的 GLB 动画/表情适配层，不能直接套用方块骨骼通道。材质光照移植是第一步，还必须解决透明合成、屏幕坐标、命中、资源释放和异步切换。

**实物与清单有版本差异：**

- main 的 `apps/lingxi/public/v5/lingxi-v5.glb` 实际为 **14,144,640 bytes（14.14 MB / 13.49 MiB）**，103 个 glTF mesh，15 个动画：Idle、Walk、Run、Jump、LieDown、SideLie、Sleep、Curious、Happy、Yawn、Lick、Bite、Knead、Stretch、PawPlay。
- v5fix 的 `assets/characters/lingxi/v6/round-zzz2/animations.json` 有 22 个片段，新增 Sit、Loaf、BellyUp、ScratchEar、WashFace、GroomSide、Turn。该 worktree 的 `apps/lingxi/public/v5/lingxi-v5.glb` 不存在。因此不能声称现有 14 MB GLB 已有 22 段，或已匹配 round-zzz2 的脸部骨骼。
- `scripts/blender/export_lingxi_v5_glb.py` 使用当前打开的 Blender scene，默认输出 public/v5，可用 `LINGXI_GLB` 改路径；脚本名称不会自动选择 v6 模型。采用 NLA_TRACKS 合并同名骨骼/形变动画，Y-up、skin、morph、COLOR_0、逐帧采样，排除毛发曲线/毛发源网格，且 `export_extras=False`。
- 实施前需由资产产出环节提供与 round-zzz2 一致的 GLB，并校验动画名、骨骼名、形变键、材质和版本。本文不执行导出。建议随资源增加 manifest（版本、哈希、源配置、22 段及其时长、坐标约定、表情控制映射），不要只覆盖一个仍叫 v5 的旧文件。

## 1. 现有运行链路与对外接口

源码依据：`packages/desktop-host-contract/index.d.ts:94`、`packages/life-engine/src/index.d.mts`、`apps/lingxi/src/main.ts`、`app-harness.ts`、`renderer.ts`、`anim/director.ts`、`anim/motion.ts`、`anim/body-controller.ts`、`anim/gait.ts`。

### Renderer 契约

|接口|现有用途 / 新实现必须保留的语义|
|---|---|
|`mount(container: HTMLElement): void`|宿主拥有 stage，renderer 只加入自己的 canvas；canvas pointer-events:none|
|`resize(width: number, height: number): void`|工作区 CSS 逻辑像素；不能把 DPR 像素直接给 engine|
|`setScale(scale: number): void`|模型及命中范围一起缩放；现有下限 0.05|
|`render(state, deltaSeconds, cursor): void`|由宿主统一驱动，无内部 RAF；契约 state 目前是 snapshot 的小子集|
|`hitTest(point, precise?: boolean): boolean`|同一逻辑像素空间；precise 用于用户接触，宽松命中只给小尺寸抓取|
|`dispose(): void`|移除 canvas、释放模型/材质/纹理/GPU 对象及监听|
|`setCameraPreset?(id: string)`|复用 look-up、eye-level、game、shoulder、overhead、auto；默认 game|
|`headScreenPoint?()`|实际头顶世界位置投影到完整工作区；main 再减 18 px 锚定气泡|
|`screenExtent?()`|返回 above/below/halfWidth，给 engine 不对称屏幕边距|
|`playAction?(id): boolean`、`playExpression?(name, holdMs?): boolean`|未知项返回 false；不能静默成功|
|`playingAction`|`{id, remainingMs, legFree} | null`；main 用其 hold engine，阻止全身动作中走开|
|`currentExpression`、`headYaw`|外部 perception 查询实际展示内容|
|`setPerformanceScale?(heightFraction | null, seconds?)`|占屏幕高度比例，不是简单倍数；表演结束渐变恢复|
|`toyInteraction?(request)`|提供玩具接触位置和目标位置；不能绑定旧 renderer 实例|
|`capabilities`、`describeCapabilities?()`|运动、朝向、待机、精确命中及动作/表情/皮肤目录|
|`setSkin?`、`applyCustomAssets?`、`customBubbleStyle`|当前方块专用动作/皮肤不能直接应用到 GLB；气泡样式仍属于宿主|

main.ts:66 创建 `createThreeRenderer({fitCanvasToCat:true})`，mount 后按工作区 resize，把 `renderer.toyInteraction` 传给 engine。设置从 Rust status 恢复 scale/skin/camera，并通过事件和定期对账同步。每帧：precise hit → engine.tick → render → 气泡/特效锚点 → playingAction 决定 hold → 普通 hit 决定穿透/抓取。睡眠触发 curled-sleep，醒来 stretch-front；抚摸、玩具、Agent、debug、表演也可显式调用动作/表情。perception 每秒两次读 renderer 当前动作/表情。

app-harness.ts:25 使用同一实现，但默认完整 canvas、scale=0.5、固定初始 stage 宽高；直接 tick/render/hitTest，通过 `window.__lingxi` 暴露 engine/renderer/fx/performances。当前 harness 不完全复制 main：没有 precise 命中传给 tick、没有完整 resize/电源治理/原生穿透链路，必须补验证入口。

### snapshot 与方块动作

snapshot 的字段：`state`（idle / wander / follow_cursor / dragged / ai_directed / play_toy / sleep）、`position`、`facing`、`heading`、`turning`、`target`、`mode`、`pointer.engaged/byUser`、`intent{target,until,speed}`、`agentBusy`、`recoveredAt`、`toy{kind,position,velocity,charge,held}`、`batted`、`vitals{energy,sleepiness,nightness,sleepThreshold,asleep,sleptAt,wokeAt}`、`personality{independence,curiosity,gentleness,playfulness,sleepiness}`。

**snapshot 没有 actionId 或 expression 字段。**动作/表情属于 renderer 的 director 和外部调用，不能假设从 snapshot 直接读取。速度由相邻位置与 dt 推导，不应仅凭 state 判定走路。

方块每帧先重置 rig，叠加 idle 呼吸/眨眼和按实际位移推进的 gait，再由 director 输出 offsets/face/expressionName/blink/faceDirty，经 body-controller 做通道叠加、pose、脚掌 IK/地面接触，最后放置位置朝向。`data/actions.json` 实际有 **49 个动作**，不能沿用注释中的“40”。director 每 3–8 秒按分类权重选动作，运动时仅自动选 legFree；显式 forced 动作优先，拖拽触发 startle；约 0.22 秒混合。默认安然，显式表情默认 hold 4000 ms。director 只有五种 PetState，其余 rawState 回落 idle；真实猫应显式处理 sleep/follow_cursor，避免睡着还随机清洁。

## 2. v5-demo 可以复用什么、还缺什么

`apps/lingxi/src/v5-demo.ts` 用 GLTFLoader 加载 `/v5/lingxi-v5.glb`，创建 AnimationMixer，每段一个 action，0.25 秒 crossfade；loop/暂停/speed/scrub 是 DOM 控件，默认 Idle，独立 setAnimationLoop 驱动。前 15 个片段有中文标签，其余 GLB 动画仍会自动列出。换片时 reset，不能把这个逻辑原封不动放进每帧 render，否则永远播第一帧。

材质：AgX、exposure=1.1、RoomEnvironment PMREM（环境强度 .55）、主方向光 2.4、轮廓光 1.6、半球光 .9；VSM 2048 阴影、blurSamples=16；圆形 ShadowMaterial 接地。顶点色网格改 MeshStandardMaterial；虹膜 shader 当前只有固定圆瞳 `uPupil=.33`；角膜材质 opacity=0，应实测是否真能显示想要的高光，不能当成表情控制已经完成。

壳毛：仅 Head/Body/Tail，对应长度 .022/.045/.060 m，密度 520/380/360；每个基底建 32 个 SkinnedMesh，复用 geometry/skeleton、共享 morph influences；沿蒙皮法线挤出、重力弯曲、三维噪声 discard，根深梢浅。眼鼻附近 furScale 缩短毛。层选择 `i % round(32/n)` 只近似请求值，例如请求 24 层实际可能仍显示 32；正式实现需明确 N 层与 t=i/N。骨骼位置取 world，顶点取 local 的距离运算也需统一空间。

|缺口|接入要求|
|---|---|
|透明窗口|WebGLRenderer alpha:true、透明 clear、scene.background=null；只保留环境照明，不绘制米色背景；避免全屏不透明地面和后处理 alpha 污染|
|相机/缩放|demo 是 32°透视 + OrbitControls，桌宠用正交与 CSS 像素投影；提取既有投影/fitCanvas 逻辑，标定 GLB 米制到统一猫身高，脚底锚定 snapshot.position|
|命中|只检测基底可见网格，排除壳、地面、辅助骨架；先投影包围盒粗筛，再蒙皮网格 raycast；检查动画后的 bounds，不能复用静态 rest box|
|头顶/范围|Head 骨骼局部顶部偏移随姿态投影；睡觉/跳跃不使用固定屏幕偏移。裁剪框包含尾/耳/毛长/跳高/阴影，缓存各动作包络而非每帧遍历所有顶点|
|生命周期|由 main render(dt) 统一 mixer.update；提供 ready/error/dispose，释放 PMREM generator/target、环境贴图、替换前材质、壳材质、骨骼 GPU 资源，避免共享 geometry 重复释放|
|交互与表演|保留玩具绘制和 toyInteraction、performance scale/camera；不能因为真实猫已显示，就声称逗猫和所有表演完整支持|
|性能|没有 fitted canvas、电源档位、资源释放和复杂动画命中优化，不能照搬 demo 的全屏 32 壳 + VSM|

## 3. 状态、动作、根运动和表情

### 状态映射建议

|输入|真实猫行为|
|---|---|
|idle 静止|Idle 循环，间隔插入适合的休息/清洁动作|
|wander / follow_cursor / ai_directed|根据实际地面速度选择 Walk / Run；停止回 Idle，非仅根据 state 播 Walk|
|play_toy|追逐 Walk/Run；batted → PawPlay 单次；扑跳显式触发 Jump|
|dragged|暂停路径推进；初期 Idle + 惊吓表情（近似，没有被提起片段）|
|sleep|Sleep 持续循环；醒来 Stretch 单次；屏蔽随机动作|
|heading/turning|容器朝向以 engine 为准；Turn 可用于原地转身，但不得重复叠加片段根旋转|

### 22 个目标片段与旧动作映射

以下“对应”是语义建议，非声称动作逐帧等价。新增七段在现存 main GLB 中缺失；降级仅用于旧资源开发预览，正式资源应齐全。

|目标片段|现有动作 / 触发|兼容或限制|
|---|---|---|
|Idle|idle；tail-sweep/tail-tip 等微动作的基底|微动作需要额外骨骼层；仅 Idle 是降级|
|Walk|实际慢速移动|提取根平移、按实际距离同步相位|
|Run|实际快速移动/追逐|同上，速度阈值需标定|
|Jump|pounce、hop-catch|两者都只是近似；保留视觉跳高|
|LieDown|play-bow、stalk-crouch|仅近似伏低，不等于潜伏或邀玩|
|SideLie|side-nap|roll-left/right 无翻滚片段，仅以 SideLie 近似|
|Sleep|curled-sleep|核对是否真蜷身；语义为睡眠|
|Curious|curious-tilt、ear-listen、play-peek、sniff-floor、sniff-air、look-at-you、notice-you|后七项缺精确片段，只能观察动作近似|
|Happy|greeting、affection、tail-greeting、head-bump、kiss-nuzzle、purr-settle|无专门蹭头/亲吻/呼噜，应标 approx|
|Yawn|yawn、sleepy-nod|点头为近似|
|Lick|lick-paw、groom-chest|理胸毛为近似|
|Bite|hiss|咬与哈气不等价，优先 Idle + 生气表情；Bite 单独作为新增能力|
|Knead|knead|单次/有限重复|
|PawPlay|paw-wave、paw-reach、toy-swat、claw-screen、rear-up|全为近似；toy-swat 不能照搬旧 .7 秒时长|
|Stretch|stretch-front、stretch-back|后腿伸展为近似|
|Sit|sit|旧 GLB 回退 LieDown|
|Loaf|loaf|旧 GLB 回退 LieDown|
|BellyUp|belly-up|旧 GLB 回退 SideLie；左右打滚仍不是 BellyUp|
|ScratchEar|scratch-ear|旧 GLB 回退 Lick，但明确不是挠耳|
|WashFace|wash-face|旧 GLB 回退 Lick|
|GroomSide|groom-side|旧 GLB 回退 Lick|
|Turn|原地转向|不将 shake-head 映成全身 Turn；旧 GLB 用容器渐变朝向|

其余无精确片段动作：slow-blink → Idle + 眨眼；startle → Idle + 惊吓；meow → Idle + 喵喵；shake-head → Idle + 小幅头部摇动；shake-fur → Idle（暂不支持抖毛）；tail-sweep/tail-tip/tail-wrap/tail-alert → Idle + 后续尾巴局部控制。与表内映射合并覆盖现有 49 个 ID。自定义方块通道动作没有自动重定向能力；返回不支持原因或仅列出有效能力，不能假报成功。

GLB 基础循环 Idle/Walk/Run/Sleep 不应作为“阻塞动作”暴露 playingAction，否则 main 会一直 hold 猫、也无法进入静息降帧。离散动作 remainingMs 应使用 GLB duration / timeScale，而不是旧动作 JSON 的时长；连续同 ID 重播还需 action instance/序号或可靠的结束空档，避免 main 的 heldForAction 只按 ID 去重导致第二次不 hold。全身片段不能继承旧动作 legFree=true；真正局部层需剔除无关 tracks 后再声明 legFree。

### 根运动提取

已在 main GLB JSON 中确认 Walk/Run/Jump 均有 Root translation/rotation/scale tracks。构建脚本的 Root 局部 y 是向上，不可按 Blender 全局 z 或 GLB 字段名凭猜测删除轴。

建议 `extractRootMotion(clip, rigBasis): {inPlaceClip, trajectory, strideDistance}`：通过 Root rest 矩阵与 glTF 坐标转换，把位移转到角色地面空间，分离水平累计移动和垂直起伏。Walk/Run 去除水平行进，保留 bob；屏幕平移唯一由 engine.position 驱动。相位按实际世界距离/周期步长推进，避免脚滑；循环接缝累积位移要展开。Jump 同样去水平推进、保留垂直跳高，不能把整条 Root.position 删除，亦不能每帧 root.position=0。若未来需要扑到目标，先在 engine/表演路径规划水平位移，再播放 in-place Jump。Turn 的根 yaw 同样明确唯一所有者。校验至少 3 个循环不漂移、跳跃落回锚点，拖拽/休眠恢复不累积 dt。

### 30 表情：从 layers + expressions + expression_extras 到运行时

配置实际键名是 `expression_extras`，不是 `extras`。以下为 round-zzz2 expressions 原始组合；extras 在组合后按控制名相加。

|表情|eye|brow|mouth|ear|symbol|
|---|---|---|---|---|---|
|安然|calm|none|cat|neutral|none|
|好奇|round|raise|flat|forward|question|
|满足|happy|none|cat|neutral|none|
|警觉|wide|raise|flat|forward|exclaim|
|不爽|side|furrow|frown|airplane|none|
|惊吓|wide|raise|open|back|sweat|
|困困|half|sad|flat|neutral|sleep|
|玩心|round|raise|tongue|forward|none|
|生气|slit|furrow|hiss|back|anger|
|撒娇|heart|raise|cat|forward|heart|
|闭眼休息|closed|none|cat|neutral|sleep|
|开心|happy|raise|cat|forward|none|
|放松|soft|none|cat|neutral|none|
|认真|focus|flat|flat|forward|none|
|陶醉|happy|none|cat|neutral|heart|
|期待|sparkle|raise|cat|forward|none|
|喵喵|round|none|cat|neutral|none|
|清醒|round|flat|flat|forward|none|
|安心|soft|none|cat|neutral|heart|
|温柔|soft|raise|cat|forward|none|
|委屈|tearful|sad|frown|back|none|
|害羞|half|sad|cat|neutral|heart|
|求抱抱|round|sad|cat|forward|heart|
|困惑|round|raise|frown|neutral|question|
|警惕|side|raise|flat|forward|exclaim|
|嫌弃|half|furrow|frown|airplane|none|
|得意|half|raise|cat|forward|none|
|左眼眨|wink-left|raise|cat|neutral|none|
|右眼眨|wink-right|raise|cat|neutral|none|
|闪亮|sparkle|none|cat|forward|heart|

实现参考 `scripts/lookdev-v6/v6_face_apply.py` 的 expression/apply/reset/_turn，而非照抄 Blender API：

1. expression(name) 累加 eye/brow/mouth/ear 四层，再加 expression_extras；控制值允许负值或 >1（如嘴角 1.4、Sparkle 1.4），不要统一 clamp 到 [0,1]。瞳孔 mat 最终是绝对赋值，其他控制多数相加。
2. `key`：定位目标 mesh 和 morphTargetDictionary，累加影响值；配置省略系数则 1，TongueOut 对 Up 的系数为 2。需保存形变滑块范围元数据；export_extras=False 不保证保留 Blender slider_max。名称必须建显式映射，GLTFLoader 会清理点号，网格还可能被拆 primitive，不能简单 getObjectByName 原名。
3. `loc` 是 armature 空间向量经 rest bone inverse 转成本地位移；`loc_local` 是骨骼本地位移。用 bind/rest 基变换推导 three 父节点空间增量，含 Blender→glTF 坐标转换；不能把 JSON 三元组直接加到 bone.position。
4. `rot` 是 XYZ 本地 Euler 增量，`rotarm` 是 armature 轴转骨骼局部后的四元数前乘；保留 Python 的顺序与乘法方向。耳朵累计 fwd/flat/swivel/tip，按 swivel→flat→fwd 顺序，左右符号 L=-1/R=+1，EarTip 反向弯；耳长轴依据 rest head/tail，必要时 manifest 补 tail/axis 信息。
5. `mat`：重建虹膜 uPupilW/H、uGazeX/Y，不再只有固定圆瞳；`catch`/`sparkx` 对角膜高光基值做乘性/加性变化，需要 shader uniform 或受控高光层。heart/tearful 在配置 notes 中仍是运行时材质变体，不应声称 Blender 已内置爱心/泪眼。
6. symbol 是屏幕特效，用 fx 锚定头部表现 question/exclaim/sweat/sleep/anger/heart，不能试图找同名 morph。
7. 更新顺序明确为 body mixer → 表情受控通道还原到本帧基准 → 表情层 → 短暂眨眼/注视 → world matrices → 锚点/绘制。每帧先撤销上次叠加，避免漂移。GLB 可能给所有脸骨/shape keys 烘焙轨道；显式 hold 需 mask 掉冲突 tracks 或接管指定通道，否则 mixer 会覆盖表情。Yawn/Lick/Bite 的嘴部应有动作优先策略，释放 hold 后恢复片段脸，避免两个 JawOpen 叠加张过头。

## 4. 主界面、持久化与热切换

现有主界面是 `apps/lingxi/management.html` + `src/management.ts`，外观页已有 skin/camera。Rust `src-tauri/src/lib.rs` 的 PersistedSettings（约 207 行）、TrayState（322 行）、set_skin（568 行）、status 和事件负责权威状态；app_config_dir/settings.json（约 6825 行）持久化，写临时文件再 rename。不要另用 localStorage 保存正式风格，与 Rust 形成双真源。

新增独立 `renderStyle: 'voxel' | 'realistic'`，默认 voxel；与 skin 分开，切回来保留方块皮肤。Rust 持久化字段建议 render_style（serde default），前端 status 按现有命名约定暴露 renderStyle。加 `set_render_style` 命令、`set-render-style` 事件、sanitization、invoke handler 注册和启动恢复；管理页卡片显示“方块 / 真实猫（测试）”、加载/失败/实际生效状态。真实猫暂不支持方块皮肤时禁用对应卡片并说明；不要丢掉用户 skin 值。

建议稳定 Renderer facade 持有 active 实现，让 main、performance runner、engine.toyInteraction 始终引用 facade。单纯把 `const renderer` 改成 `let` 不够，runner 创建时已捕获对象，toyInteraction 也可能捕获旧回调。所有方法和 getter 都动态转发。

切换流程：请求递增 generation → 后台准备新实现（期间旧猫继续显示）→ await ready → 应用最新尺寸/scale/camera/资产策略 → 用最新 snapshot 渲染首帧成功 → 原子交换 active/canvas → 更新边距、能力目录、实际风格及 perception → dispose 旧实现。过期请求即使加载完成也释放，不允许迟到结果覆盖新选择。失败保留旧猫并显示错误，desired 与 active 分开；持久化失败回退策略需明确，不能 UI 勾选真实猫却无提示地显示方块。切换不中断 engine/位置/vitals/Agent 状态；正在执行表演时选择明确取消并复位 camera/performanceScale，或延迟到结束，不留下旧实例引用。

## 5. 性能、资源和 Tauri 打包

16 GB 只说明内存容量，不说明 GPU/芯片/分辨率；不能据此保证 CPU/GPU 百分比。先记录芯片、系统/WebKit、DPR、256/384/512 CSS px、相机、毛层数和电源状态，再冻结预算。

- 初始质量建议 8 壳、DPR≤1.5、无实时 VSM，用廉价接地阴影；低档 0/4 壳，中档 8，高档 16，32 只用于外观对照。若每个 Head/Body/Tail 恰一个 primitive，32 壳增加 96 次 mesh 绘制；实际需 renderer.info.render.calls 校验，不能用 103 meshes 直接推断 draw calls。共享几何不等于共享顶点计算，每壳仍重复蒙皮与片元计算。
- 延续 main 电源治理：静止约 10 秒后降为 idle，现有注释/逻辑为静息 30 fps、活跃全速，隐藏/锁屏 dormant 暂停；不要用内部 setAnimationLoop 绕过。Idle 基础循环不能阻止 catIsStill。
- 建议试运行门槛：互动 60 fps 时 p95 总帧时间≤16.7 ms，静息 30 fps 无持续长任务；renderer JS 提交 p95≤4 ms，GPU 渲染预算≤8 ms（可测时）。先以总增量内存≤300 MB 为目标，超标必须记录对象/贴图/双实例加载峰值，再决定降低质量，不以 14 MB 文件大小推算运行内存。
- `docs/05-technical-architecture.md:59` 明确 CPU<2%、GPU<5%、内存<300 MB 是待测愿望；v5fix 完整方案另有 idle CPU<3%、GPU<10% 的目标，口径不一致，不应当成已通过结果。此次搜索两目录 docs/scripts 没找到可确认的专用 App CPU 采样脚本，因此不虚构脚本路径。
- 后续测量方法：在同机 Release App 下预热 30 秒，静息/行走/交互各采 60 秒，另测隐藏/锁屏；以 Activity Monitor 或定时 `ps -p <PID列表> -o pid,pcpu,rss,comm` 采样，统计主进程及归属 WebKit WebContent/GPU 进程的平均/p95，记录单核百分比口径；WebKit 共享进程用无猫基线作差并说明归属不确定性。GPU 另用系统 GPU History/可用 profiler；renderer.info 只报告调用数，不能当 GPU 使用率。本文未执行这些测量。
- 反复切换 20 次：纹理/geometry 数、JS heap、进程 RSS 应在预热后趋稳，检查 context lost/restored、被取消加载和 PMREM 泄漏。

资源建议放 `apps/lingxi/public/characters/lingxi-realistic/<version>/cat.glb`，同目录 face-controls.json、manifest.json；main 默认 GLB 路径虽已存在，但 exporter 注释明确 git-ignored，需要制定独立资产交付/构建预检，不能期待干净构建自动拥有它。Vite public 进入 dist，Tauri `frontendDist: ../dist` 打入前端资源；无需把同一 GLB 再加入 bundle.resources。使用统一 base URL 构造资源 URL，绝不依赖 worktree 绝对路径。

**打包风险：**当前 production CSP 的 connect-src 只有 `ipc: http://ipc.localhost`，devCsp 才有 self。GLTFLoader 的 fetch 加载包内 GLB/JSON 需在正式 CSP 为 connect-src 增加 `'self'` 并验证平台 asset origin；外置贴图/blob 解码亦要实测现有 img-src。不要关闭 CSP。Vite build inputs 只含 main/management/debug，harness/demo 是开发页，不必为了上线真实猫把 demo 打包。首发优先原始 GLB，压缩后再测解析峰值与解码器 CSP/资源路径。

## 6. 分步实施清单与验收

以下都是建议新增/修改，调研没有实施。

### P0：能切换，看到透明真实猫待机

修改：`main.ts`、`app-harness.ts`、`management.ts`、`management.html`、必要的 management.css、`src-tauri/src/lib.rs`、`src-tauri/tauri.conf.json`。新增 `src/renderers/renderer-switcher.ts`、`realistic-renderer.ts`、`realistic-materials.ts`、`shell-fur.ts`、`viewport.ts`、上述 public 版本资源。viewport 可先抽取 renderer.ts 的投影/fitCanvas 辅助，保证方块测试不退化；不强行重写方块动画。

建议签名：

```ts
type RenderStyle = 'voxel' | 'realistic';
type ReadyRenderer = Renderer & { ready: Promise<void> };
createRealisticRenderer(options: {
  assetUrl: string; faceUrl: string; fitCanvasToCat?: boolean;
  quality: 'low' | 'balanced' | 'high';
}): ReadyRenderer;
createRendererSwitcher(options: SwitcherOptions): Renderer & {
  readonly activeStyle: RenderStyle;
  switchStyle(style: RenderStyle): Promise<{ applied: boolean; error?: string }>;
};
```

真实猫首阶段只声明已实现的 Idle、尺寸、相机、命中、头顶和 extent 能力。main 的动作请求允许 false，debug 显示不支持，避免假成功。材质参数集中配置，保留顶点色；以暖/冷/深浅桌面背景检查毛色、眼睛高光、透明边缘。相机用 game，体型按可见高度归一，切换不跳位置。

验收优先浏览器 harness：加风格选择、加载状态、棋盘背景、窗口 resize、固定 snapshot 模式；验证 404/损坏资源/快速连点切换、首帧透明、不同 DPR/尺寸、点击空白不命中、头顶气泡随镜头正确定位。之后才在 Tauri 验证持久化重启、透明穿透和 CSP；浏览器不能证明原生不抢焦点。风险为旧 GLB 与新 face 不配套、加载竞争、裁剪掉尾巴、旧实例未释放。

### P1：动作与根运动映射

新增 `src/renderers/realistic-animation.ts`、`realistic-action-map.ts`、`root-motion.ts`；修改 realistic-renderer、main 的动作实例 hold 逻辑和必要的契约。复用 director 的调度策略，不把 voxel offsets 直接应用到 GLB；如抽出公共策略，放 `anim/action-policy.ts` 并保留旧导演行为。

```ts
createRealisticAnimator(root, clips, mapping): {
  update(snapshot: LifeEngineSnapshot, dt: number): void;
  play(id: string): boolean;
  readonly playing: { id: string; remainingMs: number; legFree: boolean } | null;
  dispose(): void;
};
extractRootMotion(clip: THREE.AnimationClip, basis: RigBasis): RootMotionResult;
```

增加只读资产检查脚本（未来实施）和 root-motion/映射测试；harness 可枚举 22 段、49 兼容 ID，显示 native/approx/unsupported、实际 clip/time/remaining。固定路径走跑 3 圈检查脚滑/漂移，跳跃落点、姿态 crossfade、睡眠唤醒、玩具 batted、显式动作覆盖自动行为。验收时 22 个目标片段不得缺失；映射没有精确片段的项必须清楚标记。风险为根轴误判、LoopRepeat 接缝、全身动作被错误 legFree、旧 duration 让 engine 提前移动。

### P2：表情与注视

新增 `src/renderers/realistic-face.ts`、`realistic-rig-map.ts`，修改 realistic-materials/animator；资源增加 bind basis/滑块范围等必要元数据。`createFaceController(root, spec, rigMap)` 提供 `playExpression(name, holdMs): boolean`、`update(dt, frame): void`、`currentExpression`、`dispose()`；`compileExpression(name, spec): Record<string, number>` 纯函数复现 layers+extras。

harness 做 30 表情网格/逐个切换、左右眨眼、嘴/瞳孔近景、任意动作上 hold 后释放；自动对照控制和目标是否存在，持续数千帧检查骨骼不漂移。以 Blender 已有参考图人工对照，不要求本轮运行 Blender。优先验收安然、开心、生气、惊吓、困困、喵喵，再遍历全部。风险为 rest 坐标/旋转顺序、材质控制缺失、动画覆盖表情、舌头穿模和双重张嘴。

### P3：性能、资源收尾与正式测试

新增 `src/renderers/realistic-quality.ts` 和后续性能采样脚本；修改 shell-fur、viewport、main 电源档位联动及资源预检。建议 `setQuality({shells, dprCap, shadows})`，质量切换尽量复用对象；需要销毁的对象走明确所有权，不重复 dispose 共享几何。

按第 5 节目标机矩阵测 0/4/8/16/32 壳、不同尺寸和各个电源状态，先减少 fill-rate、壳层、阴影，再考虑网格简化/动画轨道精简/压缩。保存材质参数、基线与峰值数据后确定默认质量；16 GB 本身不足以决定高档。Release 包断网首次加载、切换重启、隐藏唤醒、20 次反复切换全部通过后再把真实猫去掉“测试”标记；是否改默认风格留到视觉/性能验收之后。

## 交付判断

最小可测试里程碑是 P0：主界面能切换、透明真实猫 Idle、比例/位置/命中/气泡正确、失败可回退。P1 完成才称“行为接入”，P2 完成才称“30 表情接入”，P3 有目标机数据才称“性能达标”。不能用 demo 单页成功替代桌宠集成验收。
