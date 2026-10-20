你是灵犀桌宠（Tauri + three.js，仓库 /Users/liepin/workspace/lingxi，分支 main）的集成调研助手。只读代码，**不要改任何文件、不要运行 Blender、不要 git 操作、不要启动 App**；只把报告写到 /Users/liepin/workspace/lingxi-v5fix/reviews/integration/codex-integration-plan.md（中文）。

## 目标
用户要求：「调整材质和光照各种渲染效果，就可以集成进来测试了，在主界面中支持切换风格，当前我们的方块和真实猫咪风格」。
- 方块风格 = 现有 apps/lingxi/src/renderer.ts（盒子骨架 + 画出来的皮肤）。
- 真实猫风格 = Blender 精模（另一分支 lookdev/b4-review 的 worktree /Users/liepin/workspace/lingxi-v5fix，构建脚本 scripts/blender/build_lingxi_v5.py，动作片段见 assets/characters/lingxi/v6/round-zzz2/animations.json，表情映射 face-controls.json），经 scripts/blender/export_lingxi_v5_glb.py 导出 GLB（网格 + 骨骼 + 形变键 + 毛色顶点色 + 每个片段一个 glTF 动画，不含渲染毛发），浏览器里用 apps/lingxi/src/v5-demo.ts 的壳毛（shell fur）显示。

## 请调研并写清楚
1. 现有渲染器的对外接口：main.ts / app-harness.ts 如何调用 renderer（mount、resize、setScale、render(snapshot, dt, cursor)、hitTest、headScreenPoint、setCameraPreset 等），life-engine 的 snapshot 里有哪些状态 / 动作 / 表情字段，director / 动作库如何驱动方块猫。
2. v5-demo.ts 现在怎么加载 GLB、做壳毛、播动画；离"可在桌宠里用"还差什么（透明背景窗口、相机与缩放、点击命中、头顶气泡锚点、性能）。
3. 状态 / 动作 → GLB 片段的映射表（列出 GLB 里的片段名：Idle Walk Run Jump LieDown SideLie Sleep Curious Happy Yawn Lick Bite Knead PawPlay Stretch Sit Loaf BellyUp ScratchEar WashFace GroomSide Turn），哪些动作没有对应片段、建议用什么替代；表情（30 个，face-controls.json 的 layers / expressions / extras）如何在 three.js 里驱动形变键与骨骼（v6_face_apply.py 是 Blender 侧的参考实现）。Walk / Run / Jump 带根骨骼位移，需要提取。
4. 风格切换：设置存在哪里（management 窗口 / 设置项 / 持久化），切换时如何热替换渲染器而不重启；默认值建议。
5. 性能与资源：GLB 14 MB 左右、壳毛层数、16 GB 机器上的 CPU / GPU 预算（仓库里有测 App CPU 的方法，见 docs 或 scripts）；Tauri 下 GLB 放在哪里、如何打包。
6. 给出**分步实施方案**：每步改哪些文件、新增哪些文件、函数签名、验收方法（可在浏览器 harness 里验证的优先），以及风险。按"先能切换看到真实猫待机 → 动作映射 → 表情 → 性能"排序。
