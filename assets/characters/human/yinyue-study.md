# 银月：女性骨架换装测试

2026-10-13。用户指定《凡人修仙传》的银月，以已下载女性模型做造型测试。

## 看效果

- [正面实渲](preview/yinyue-front.png)、[三分之四视角](preview/yinyue-three-quarter.png)、[脸部近照](preview/yinyue-portrait.png)、[行走实渲](preview/yinyue-walk.png)。这些图由实际模型在 Blender 中渲染，不是 AI 生成的人物效果图。
- [可编辑 Blender 工程](work/yinyue/yinyue-study.blend)、[带动画 GLB](work/yinyue/yinyue-study.glb)。
- 本机服务运行时打开 `http://127.0.0.1:8818/assets/characters/human/viewer.html?model=yinyue`，可转动、缩放、播放动作和显示骨架。

## 参考与实现

以[动画播放页「是我呀，银月」](https://www.bilibili.com/bangumi/play/ep1872690)确认动画角色版本。
造型参考为[动画截图报道](https://www.sohu.com/a/911020562_100235981)与[角色页面图](https://m.baike.com/wikiid/3337992681172705184)：银白长发、兽耳、耳上的银环、银饰、灰白纹样衣料、毛领、离肩宽袖和红色腰封。
参考图主要覆盖上半身；本次长裙与鞋为在这些元素基础上的补全，不冒充原作完整三视图。

复用 Quaternius 的女性网格、原有变形权重、65 个骨骼节点、Hair_Long 的头顶部分及 Universal Animation Library 的 16 个已准备动作。
新增衣裙、宽袖、红腰带、毛领、兽耳、银环与发束，全部绑定到同一骨架；没有导入官方动画模型。
对基础脸型做轻量柔化、眼部及眉形调整；遮掉衣服下永久不可见的身体面以减少穿模，源女性工程保留。
在本版本的动作中柔化手指握拳程度与待机低头程度。模型仍保留成年基础人体的比例与面部特征，不能当作已经精确还原原作。

衣料纹样使用内置 `image_gen` 生成，是真正用于模型的贴图。保存于 [silver-cloud-jacquard.png](work/yinyue/textures/silver-cloud-jacquard.png)；完整提示词、执行方式、角色与模型来源在 [provenance.json](work/yinyue/provenance.json)。
Blender 程序噪声用于发丝/毛领/丝带的轻微微表面起伏，GLB 保留对应基础 PBR 材质，不携带这些 Blender 程序节点。
眼色调整使用 Blender 将材质颜色烘焙回原 UV 的 PNG，避免 GLB 丢弃 Hue/Saturation 节点后还原成原始棕色眼睛。

## 验证与局限

使用 Blender 实渲检查待机正面、侧面、近照及行走；使用项目实际 Three.js GLTFLoader、AnimationMixer 与 CPU 蒙皮验证 GLB，结果见 [threejs-validation.json](work/yinyue/threejs-validation.json)。
检查范围包括一个 65 节点骨架、16 段不重复的命名动画、内嵌资源、衣服与饰物的蒙皮权重，以及全部 16 段动作各 3 个时间点的有限坐标。
另将导出的 GLB 在空白 Blender 场景中重新导入，核对材质和动画，并保存 [导出后重新导入的实渲](preview/yinyue-glb-roundtrip.png)。
浏览器 UI 未自动验收，CPU 检查不代表 WebGL 按钮交互已经通过。

这是一版换装/骨架测试。长发、裙子与宽袖目前靠骨骼变形，没有布料或头发动力学；大幅蹲坐、舞蹈、跳跃及手臂极端姿势还需要针对衣服修权重和碰撞。
待机与慢走已实渲，其余动作可用于观察骨架，不代表服装碰撞验收。基础资源的接地误差、缺少实时 foot IK、面部动画控制等边界仍然存在。
当前桌宠外观和猫的运行模型未被替换。

## 重跑

先完成基础女性资源准备，并保留此处已生成的贴图：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --disable-autoexec --python-exit-code 1 --python scripts/blender/make_yinyue_study.py
node scripts/check-yinyue-study.mjs
```

资产许可和原始模型下载记录继承 [人形资源说明](README.md)。新增角色研究、参考截图和所有派生二进制留在本机工作目录，未公开发布。
