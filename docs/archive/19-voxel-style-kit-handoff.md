# 灵犀：简洁 3D 皮肤、表情与动作开发交接

本方案以仓库 `voxel_cat_face_layer_composer.html` 为美术参考，复用现有 `lingxi-cat-v1` 方块骨架。目标是暖色、干净、表情可读的桌面猫；保留方块结构，不回到高保真毛发或写实材质。

> 后续需求已修正为**任意 PNG 导入后覆盖全身**。该功能现已在实验室实现，支持平铺、整图铺面和局部 UV JSON；详细用法与接入代码见 [任意 PNG 导入方案](../20-arbitrary-png-skin-import.md)。

## 1. 先看已经做好的内容

```sh
cd apps/lingxi
npm run dev
# 浏览器打开 http://localhost:1420/style-lab.html
```

实验室独立于正式宠物窗口。现有 Vite production input 不包含这个开发页面；`npm run build` 会检查其 TypeScript，但不会把页面发布到正式应用。

| 交付 | 路径 | 当前状态 |
|---|---|---|
| 3D 实验室 | `apps/lingxi/style-lab.html` | 可运行：六套换肤、视角、走路、表情组合、八个小动作 |
| 三维接入示例 | `apps/lingxi/src/style-lab/main.ts` | 复用真实骨架，替换材质、挂载面部贴片、换肤、PNG 试穿与导出 |
| 美术绘制代码 | `apps/lingxi/src/style-lab/art.ts` | 身体 atlas、五官 Canvas 合成、十套表情预设 |
| 动作采样代码 | `apps/lingxi/src/style-lab/motion.ts` | 按秒采样关键帧，输出相对基础姿态的旋转偏移 |
| 六套皮肤源配置 | `apps/lingxi/src/style-lab/skins.json` | 颜色、花纹种类与名称 |
| 可直接使用的素材 | `assets/characters/lingxi/voxel-style-kit/` | 六张身体 PNG、六张透明表情 PNG、六份含 UV 的皮肤 JSON、表情与动作 JSON、配色总览 |
| 离线导出脚本 | `scripts/export-voxel-style-kit.mjs` | 使用相同绘制代码生成素材，不维护第二份绘图逻辑 |

**正式 Tauri 管理页和桌面猫尚未接入本套皮肤。** 实验室的选择保存在独立的 `lingxi-style-lab-skin` localStorage 键中，PNG 试穿只在本次页面有效。下一位开发模型需要按第 7 节完成正式接入。

## 2. 参考设计为什么成立

参考文件的关键颜色直接保留在“杏糖来信”中：

| 色彩职责 | 颜色 | 使用位置 |
|---|---|---|
| 暖杏橘 | `#E29A46` | 毛色主体 |
| 奶油色 | `#F3E2C4` | 围嘴、胸口、袜子、胡须 |
| 豆沙粉 | `#DE8C8C` | 鼻子、内耳 |
| 浅米金 | `#F2E7C9` | 虹膜 |
| 深可可 | `#2E2118` | 瞳孔、嘴线 |
| 低对比焦糖 | `#B97835` | 少量条纹 |

执行原则：

1. 主色形成大面积连续形状，花纹是局部身份特征。禁止对每个躯干关节重复刷横纹，禁止用黑条纹切碎身体。
2. 面部先保证小尺寸可读，再增加细节。瞳孔、嘴线、浅色围嘴形成主要对比；眉毛默认可以隐藏。
3. 鼻子和内耳共用同一粉色，围嘴和脚袜共用奶油色。不要每一部位独立选色。
4. 身体用清晰的像素图案，脸部允许抗锯齿曲线。简洁 3D 不要求把每根嘴线也做成实体盒子。
5. 毛色贴图不烘焙方向光、不画强高光。光照由场景统一提供。使用 sRGB 颜色贴图，非金属、粗糙材质。
6. 色卡是准确配色，三维最终颜色仍受光照影响。对照固定灯光、固定相机的预览检查，不能只检查 HEX。

现有 `atlas.ts` 的绘制器会对多个身体、颈部和腿部节点逐段刷条纹；本套 `paintSkin()` 改为躯干两处小纹、头顶细纹和少量尾纹。六套皮肤共享骨架，不通过随机噪声制造“毛发”。

## 3. 六套皮肤

| ID | 名称 | 风格 | 主色 / 花纹 / 浅色 / 虹膜 |
|---|---|---|---|
| apricot-letter | 杏糖来信 | 暖杏虎斑 | `#E29A46` / `#B97835` / `#F3E2C4` / `#F2E7C9` |
| moon-oat | 月光燕麦 | 燕麦重点色 | `#D7C7AE` / `#9B8774` / `#F4EBDD` / `#9AABA3` |
| mist-blue | 雾蓝眠眠 | 雾蓝纯色、白袜 | `#8E9DA8` / `#6D7D89` / `#E6E8E3` / `#B9CBB3` |
| cocoa-snow | 可可落雪 | 香草身体、可可重点色 | `#DAC6AD` / `#786051` / `#F3E7D7` / `#A8C9CC` |
| peach-cloud | 桃酥云朵 | 奶白与杏桃双色 | `#EEE3D2` / `#D49A76` / `#FFF4E4` / `#C9B37F` |
| ink-sesame | 芝麻夜航 | 柔墨燕尾服 | `#555A61` / `#40464E` / `#EDE8DC` / `#D6C38D` |

`collection.png` 是配色与面部插画总览，不是三维截图，也不表示身体花纹分布。身体花纹以 PNG atlas 与实验室三维预览为准。

## 4. PNG + JSON 资源协议

采用 Minecraft 式的“方块骨架 + 六面 UV + PNG + 声明式配置”思想。**这是 Lingxi 自定义格式，不是 Minecraft Java / Bedrock 的原生模型文件，不能承诺直接导入任意 Minecraft JSON。** 若后续需要 Blockbench、Bedrock 兼容，应独立开发转换器，并处理坐标、旋转轴、pivot、UV 镜像与尺寸单位。

每套最小资源包：

```text
apricot-letter.json
apricot-letter.png         # 身体六面 atlas
apricot-letter-face.png    # 256×256 透明五官合成贴片
```

每份已导出的皮肤 JSON 包含：

- `format: "lingxi-skin"`、`schemaVersion: 1`。
- `rigId: "lingxi-cat-v1"`：骨架拓扑身份。
- `layoutId: "lingxi-cat-v1-default-4tpu-v1"`：本批次固定体型与 UV 版本。
- `texture`：相对文件名、实际宽高、sRGB、nearest、左上原点。
- `uv[nodeId]`：每个盒子的 `px/nx/py/ny/pz/nz` 六个 `[x,y,width,height]` 像素矩形。
- `materials`：语义颜色，程序合成脸部也从这里取色。
- `face`：文件、尺寸、当前表情状态、父节点 `head` 与正面 `+Z`。

**本批次 layoutId 只适用于默认骨架尺寸。** 当前 `computeAtlasLayout()` 会读取尺寸并重排。正式 PNG 加载器必须使用清单的显式 UV，或者强制完全匹配布局版本；不能改体型后重新打包 UV 再套原 PNG。用同一张纹理拉伸盒子可保持花纹位置，但像素密度会变化。需要不同密度时，给该体型另发 layoutId 和 PNG。

UV 原点在 PNG 左上；Three.js 的 UV 为左下原点，公式为：

```ts
u = pixelX / textureWidth;
v = 1 - pixelY / textureHeight;
```

具体六面方向复用现有 `faceRects()` 和 `applyAtlasUVs()`，不要重新猜测 BoxGeometry 面顺序。现有注释说 half-texel inset，但代码实际用的是 `0.01` 像素，不能把它当作完整的半像素保护。当前 nearest + 无 mipmap；后续开启线性过滤或 mipmap 时，必须加 gutter 和边缘扩展，并更新布局版本。

正式导入校验：

1. 文件大小上限、PNG 文件签名、解码成功、宽高上限与清单相等。
2. JSON 格式版本、rigId、layoutId 必须受支持；名称长度与颜色格式应受限。
3. UV 只包含已知节点和六面；坐标为有限非负整数，矩形面积大于零，不能越界，所有可见盒子均有映射。
4. 相对资源路径只能在导入目录内解析，不接受 `../`、绝对路径或远程 URL。
5. 如果支持体型 overrides，检查 size/segmentLength > 0、pivot 有限、节点存在、父子关系无环。
6. 完成所有加载与校验后才替换当前资源。失败保留原皮肤，快速连续选择时用请求序号丢弃过期结果。

实验室 PNG 导入已支持普通图片自动全身覆盖，以及 lingxi-texture / 旧 lingxi-skin 显式 UV JSON 导入。校验包含 PNG 签名、8 MB 限制、1–4096 宽高、UV 边界和异步请求序号。JSON+PNG 配对文件可同时选择；未实现 ZIP 资源包导入。详细协议见第 20 号文档。

## 5. 表情采用语义分层

层次为底色与花纹 → 围嘴/鼻子 → 眼睛 → 眉毛 → 嘴巴 → 情绪符号；耳朵仍驱动真实 3D 关节。

| 层 | 状态数 | 例子 |
|---|---:|---|
| 眼睛 | 8 | 竖瞳、圆瞳、睁大、侧看、半闭、笑眼、闭眼、爱心 |
| 眉毛 | 5 | 平、无、皱、扬、委屈 |
| 嘴巴 | 6 | 平线、猫嘴、张嘴、不满、哈气、吐舌 |
| 耳朵 | 4 | 自然、向前、飞机耳、后压 |
| 符号 | 7 | 无、汗滴、问号、感叹号、心、睡意、怒气 |

理论上为 `8×5×6×4×7 = 6,720` 种组合，但不能宣传为 6,720 种经过美术验证的情绪。先提供十个有语义的预设，再开放高级自定义。现有参考中的皱眉与悲伤几何非常接近，本实现将悲伤眉倾斜方向反转。

实现参见 `paintFace()`：同一个 256×256 Canvas 重画；只在状态或眨眼状态变化时 `texture.needsUpdate=true`，不每帧生成纹理。半闭眼使用较小虹膜区域，不把橙色眼皮写死到蓝猫脸上。

三维贴合：

```ts
const headSpec = skeleton.nodes.find(n => n.id === 'head')!;
const [w, h, d] = headSpec.box.size;
const face = new THREE.Mesh(
  new THREE.PlaneGeometry(w, h),
  new THREE.MeshBasicMaterial({
    map: faceTexture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }),
);
face.position.set(
  headSpec.box.offset[0],
  headSpec.box.offset[1],
  headSpec.box.offset[2] + d / 2 + 0.025,
);
rig.node('head').add(face);
```

隐藏原 eye / pupil / brow / nose / mouth / whisker / jaw / tongue 的 Mesh，保留 pivot；否则旧眉毛和瞳孔会浮在新表情前面。贴片随头转动，不是永远朝向屏幕的 billboard。当前情绪符号在贴片内，后续若改成头顶浮动图标，可单独挂 sprite。

五官目前是**逻辑分层后合成一张 PNG**，不是多个重叠的透明平面。后续美术可以改用各层透明 PNG，通过 `drawImage()` 按固定锚点合成，语义状态无需改变。素材坐标保持 256×256，禁止每个层文件自行裁边而不记录 offset。

## 6. 动作与自然感

实验室已有八个可点击小动作：慢眨眼、歪头观察、侧耳倾听、困倦点头、抬头问好、贴贴歪头、受惊收耳、左右探看。配置在 `actions.json`，采样器在 `motion.ts`，关键帧单位为秒/弧度。

当前演示策略：手动点击覆盖正在播放的动作；到时动作偏移归零，表情保持所选状态。priority 字段供正式调度器使用，演示不做优先级队列。慢眨眼曲线在当前面部绘制中转换成开闭两态；平滑眼睑开合是下一步扩展。

正式每帧执行顺序：

```text
rest pose → 站/走/坐的基础姿态 → 呼吸与尾巴 idle
          → 表情耳姿/头姿 → 动作偏移 → 必要的足部 IK → 渲染
```

每帧必须从新的基础姿态采样再叠加，不能对上一帧最终旋转反复 `+=`，否则会越转越歪。实验室复用 idle 重置耳朵，并显式重置头部旋转，再添加 action offsets。

正式动作优先级建议：拖拽/边缘安全 > 受惊 > 用户互动 > 自发小动作 > idle。一个部位同时只有一个主控制者；可叠加的小幅 idle 限幅。拖拽打断时 120–200 ms 淡出动作，落地后重新建立足部接触，不从旧关键帧硬跳回来。

自然感参数建议（设计值，需在实际桌面尺寸下调优）：

- 随机眨眼间隔约 2.4–6.2 s；普通闭眼约 130 ms。
- 耳姿采用 `1-exp(-dt/0.16)` 平滑逼近目标。
- 歪头约 6–10°，观察停留后归位；避免持续大摆头。
- 玩心可以有快动作，困倦应更慢；不要所有情绪共用同一节拍。
- 不同时调度舔爪、走路和睡觉；按姿态前置条件选择动作。
- 尊重 reduced-motion 设置，关闭自发大动作、保留可选的微弱眨眼。

现有 idle 中呼吸频率为 1.55 Hz、尾巴驱动 2.3 Hz，适合先当调试基线。想要安静陪伴可试呼吸 0.35–0.55 Hz、尾巴 0.2–0.5 Hz；这是美术节奏建议，不作为动物生理模拟。

坐下、伸懒腰、舔爪洗脸、小扑跃只在 actions.json 中列为后续动作。现有 walk 仍是摆腿占位，尚无 planted-feet IK；不要为了增加按钮数量伪装已经完成接地动作。

## 7. 给开发模型的正式接入任务

按以下顺序交付，每一步都能单独验收：

1. **皮肤与资源加载。** 为 `VoxelSkin` 增加经过校验的 texture/uv/layoutId 支持。将六套本地资源注册到 `rig/skins.ts`，保留旧 ID 的回退。`buildRig()` 不应自己启动无法追踪的异步请求；新增异步资源加载层，再把已加载 Texture/UV 传给 builder。
2. **面部模块。** 将实验室贴片逻辑封装成 `createFaceController(rig, skin)`，提供 `setExpression`、`setLayers`、`update`、`dispose`；尺寸从应用 overrides 后的 headSpec 读取。皮肤换色时同时更新身体与面部。
3. **动作模块。** 从 `motion.ts` 的纯采样器起步，增加 channel 白名单、关键帧严格递增校验、priority、取消与淡出。先接八个头耳小动作，再做需要 IK 的全身动作。
4. **管理界面。** 以六张缩略卡展示名称、毛色、选中态；点击预览，加载成功后保存 `skinId`。通过现有 Tauri 事件/设置通道通知宠物窗口，不能假定两个 webview 的 localStorage 自动同步。
5. **切换保持状态。** 不重建生命引擎，不清空任务或拖拽状态；同体型只换 map 和 face palette。体型变化需要重建 rig/IK/animator，并重新计算 groundOffset，再原子替换旧猫。
6. **资源生命周期。** 替换完成后释放旧纹理；缓存的共享资源使用引用计数或统一所有者。现有 `Rig.dispose()` 只知道它创建的旧材质；新增资源必须由新控制器显式释放。
7. **导入与持久化。** 增加 PNG+JSON 本地包导入；导入成功复制到应用资源目录，再写设置。应用重启后不能依赖用户原文件仍在临时路径。

性能注意：现有 skeleton.ts 注释称共享材质会“一次 draw call”，这并不成立。多个独立 Mesh 通常仍分别绘制。先测 `renderer.info.render.calls`；不要在交付说明中把共用 atlas 等同于合并几何。若后续优化，必须兼顾独立关节动画，可考虑骨骼合并网格，不能简单静态 merge 后丢失动作。

## 8. 验收

- 六套皮肤在正面、侧面和旋转中无旧瞳孔残留、无面部悬浮、无贴片闪烁。
- 从橙色换到蓝色时，眼皮、眉毛、胡须同步变色；半闭眼没有橙色补丁。
- PNG 导出重新试穿视觉一致；坏签名、错误尺寸、过期异步结果不能覆盖当前皮肤。
- 十个表情与自定义组合可用，随机眨眼结束后恢复情绪眼型。
- 八个动作播完关节归位；连续播放不累积漂移；更换表情可取消动作。
- 正式管理页换肤后宠物窗口同步，重启恢复；未知 skinId 有默认回退。
- 反复切换与销毁后检查 GPU texture/geometry 数量，不应持续增长。
- 新体型须单独测 UV、groundOffset 和足部 IK，不用默认体型测试代替。

本轮已运行应用 TypeScript + Vite build，并在浏览器查看真实 3D、切换皮肤和表情。后续已补充浏览器 PNG+JSON 文件导入；正式 Tauri 双窗口同步、导入皮肤持久化与 IK 全身动作仍须由正式接入实现后单独验收。
