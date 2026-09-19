# 角色试作与视觉验收

2026-09-12。本文记录通过官方 Blender MCP（`uvx blender-mcp` 插件，`blender-mcp` 1.9.1，与 v1-v3 使用的 "Blender Lab" MCP 构建版本不同，见[v4 证据](../evidence/blender-anatomy-study-v4.json)的说明）进行的原生 3D 试作。**视觉验收未通过；试作不替换品牌主图，也不作为最终角色。**

## 目标没有改变

身份依据始终是[用户概念板](../source/peipei-concept-board.png)左上角的主猫。需要灰棕虎斑与暖白、自然的白色倒 V 面纹、短口鼻、湿润榛绿眼、柔软蓬松的轮廓，以及头和前爪放松地靠在一起的趴姿。用户明确要求“非常治愈”；工具连接成功、网格数量和渲染完成都不能替代这一评价。

## 四次实际 3D 试作

| 版本 | 改动与实物证据 | 结论 |
| --- | --- | --- |
| v1 | [Blender 源文件](../../assets/characters/lingxi/source/lingxi-anatomy-study.blend)、[渲染](../../assets/characters/lingxi/reference/anatomy-study-v1.png)；椭球体积、眼睛、曲线尾巴、粒子毛发 | 脸部拼接明显，眼睛突出，毛发偏硬；不符合目标 |
| v2 | [Blender 源文件](../../assets/characters/lingxi/source/lingxi-anatomy-study-v2.blend)、[渲染](../../assets/characters/lingxi/reference/anatomy-study-v2.png)；合并脸部体积、制作眼窝、重新设置毛发材质、调整面纹与趴姿 | 工程试作，仍需角色雕刻与分区毛流制作；未经用户接受 |
| v3 | [Blender 源文件](../../assets/characters/lingxi/source/lingxi-anatomy-study-v3.blend)、[渲染](../../assets/characters/lingxi/reference/anatomy-study-v3.png)；214,819 根原生曲线毛发，分区梳理、避开眼周，替换粗眼框 | 毛流更明显；表情仍僵硬、眼周仍像圆片、耳朵过薄，未达参考质量 |
| v4 | [Blender 源文件](../../assets/characters/lingxi/source/lingxi-anatomy-study-v4.blend)、[渲染](../../assets/characters/lingxi/reference/anatomy-study-v4.png)、[脚本](../../scripts/blender/polish_cat_study_v4.py)、[证据](../evidence/blender-anatomy-study-v4.json)；重做眼睛（巩膜+放射状虹膜+瞳孔+双层眼睑折线+烘焙高光点，修正 v2 遗留的双眼不等高错误）、面纹改为柔和渐变、耳朵改为 16×11 参数网格（内凹、加厚、导角）、毛发改为分层护毛+底绒共约 116 万根曲线并把每根颜色烘焙到曲线属性（修了一个隐藏 bug：毛发的 "Generated" 纹理坐标不像网格坐标那样工作，之前一直在悄悄抹平虎斑）、新增后腿几何体、新增下颌+舌头网格与一处布尔切出的口腔、新增 24 骨骨架并完成刚性骨骼绑定与尾部自动权重蒙皮、**并在同一轮里把全部 36 个毛发对象改成绑定表面 UV 的曲线（BVH 最近点+重心坐标算出 UV，再叠加 "Deform Curves on Surface" 几何节点），用摆尾巴和摆腿两组姿态渲染验证过毛发确实会跟着骨骼走** | 治愈感、毛发密度、眼神、毛发跟随骨骼四项都有质的提升；同一轮又校准了腿部骨骼 roll 轴，站姿伸腿验证通过；但布尔切出的口腔太浅太小，张嘴看不出效果，还留了一块用补丁网格盖住的秃斑（近距离仍有细缝）；没有表情混合形状；发现脊柱旋转幅度过大会让眼睛偏离头部的挖孔眼窝；未获用户验收 |

四版均为 Blender Cycles 对真实网格和毛发的离线渲染。没有用图片平面冒充猫，也没有证明实时桌面效果。各版保留为制作参照，不能作为降低质量目标的理由。曲线数量仅说明试作结构，不代表质量或性能达标。

## 已发现的具体问题

1. **脸部解剖还不自然。** 椭球合并与眼窝布尔只解决了接缝和突眼的部分问题；眼睑、额头、颧部和短吻仍缺少连续的雕刻关系。
2. **毛流仍不够自然。** v1/v2 粒子毛主要从表面向外生长；v3 已实现额头、脸颊、胸口、脚爪和身体的不同梳理方向，但毛束、底绒与护毛缺少层次，耳缘也还不自然。
3. **虎斑是程序条纹试验。** 尚未校准额头纹、两侧脸纹与背部纹；运行时皮肤应使用可核对的 UV/遮罩，不能依赖每个基本体各自的坐标。
4. **眼睛仍需完整结构。** v3 用细轮廓替换了粗眼框，但这不是完整眼睑，眼睛仍有圆片感。小尺寸可读性应由虹膜、角膜、眼睑覆盖和目光方向共同获得；不能继续无限放大球体和高光。
5. **尚无生产绑定。** v1 身体缩放关键帧只是呼吸占位。没有眨眼变形、四足骨架、动作混合或运行时毛发资产。

v4（[证据](../evidence/blender-anatomy-study-v4.json)）针对 1/2/3/4 分别做了实质修改：眼睛换成巩膜+虹膜+瞳孔+双层眼睑折线+烘焙高光的完整结构，并修正了 v2 遗留的双眼不等高错误；面纹改成柔和渐变；毛发按护毛+底绒分层，总量增到约 116 万根，并烘焙了逐根颜色（修掉了一个让虎斑在渲染里被悄悄抹平的坐标系 bug）。第 5 条从"完全没有"推进到"有部分"：新增了 24 骨骨架、尾部自动权重蒙皮、下颌骨与舌头网格；用户在同一轮追加要求了走/跑/跳/卧/躺、表情、舌头、耳朵/尾巴/腹部起伏等完整可感知形态后，同一轮又把**毛发绑定到骨骼形变**这个当时最大的缺口解决了——36 个毛发对象全部改成表面 UV 绑定曲线，用摆尾巴、摆前后腿两组姿态渲染验证过（截图见证据文件），确认毛发会跟着网格形变走、不再脱离。剩下没做到位的：布尔切出的口腔太浅太小，张嘴视觉上不可信，切口本身还留了一块要用补丁网格盖住的秃斑；没有做任何表情混合形状；尝试给站姿/蹲姿摆腿部动作时发现腿骨的 roll 轴向没有校准，爪子甩到了脸上，已复原为静息姿态、没有采用。

## 下一步应先解决什么

腿部骨骼的 roll 轴向校准已经在同一轮追加解决：给 10 根腿部骨骼显式设置了 `align_roll`，用三级递增的姿态渲染验证过（单腿小角度 → 前后腿大角度 → 完整伸腿站姿），爪子现在会正确往下/往前摆，不会再甩到脸上。这个过程中也发现了一条新的约束：髋部/脊柱骨骼旋转超过几度（测过 -8°/+4°）就会通过 Neck→Head→Eye 骨骼链把眼睛带得偏离头部网格上那个固定的布尔挖孔眼窝，露出空洞——这不是绑定坏了（眼睛确实跟着 Head 骨骼在走），而是眼窝的挖孔深度只能容忍很小的头部旋转范围，走/跑动作如果要转动更多脊柱，需要先把眼窝挖深或者把脊柱旋转预算收窄。

腿部骨骼可摆姿势之后，同一轮又做出了第一版真正的走路循环：`LX_v4_WalkCycle` 动作，24 帧/1 秒、首尾相接，前左+后右、前右+后左两组对角腿反相摆动，后腿在抬起阶段膝盖多弯一些让爪子离地，脊柱摆动幅度刻意控制在 2°（远低于前面发现的眼窝暴露阈值）。用循环内 4 个相位渲染验证过：腿的姿态确实在变化、毛发跟着走、眼睛没有偏出眼窝。这是绑定第一次真正承载了动作，而不只是摆一个静态姿势——但这版走路循环是一次性做出来的第一版，没有对步态自然度（落地时机、重心转移、触地反馈）做任何打磨，不能当成成品动画。

v4 之后，下一步的优先级是：（1）在头部网格上把口腔切得更深、更贴合下颌运动轨迹，或者用雕刻代替粗暴布尔，让张嘴看起来可信，同时把下巴补丁的缝隙处理得更干净，顺带把眼窝也挖深一些，为以后更大幅度的脊柱动作（跑、跳）留出空间；（2）补充面部表情所需的混合形状（眯眼、耳朵贴伏、张嘴喘气等，参照用户概念板里"开心/好奇/困倦/委屈/傲娇/撒娇"六种表情）；（3）在走路循环基础上打磨步态自然度，并制作跑/跳/卧/躺几组动作循环。在此之前继续暂缓量产更多皮肤和行为动画，避免在未通过验收的形象上累计资产。

另外，仓库里同时出现了另一个工具/会话在做同一个方向的探索（`docs/14-daily-life-action-atlas.md` 的 2D 动作图集、`assets/characters/lingxi/reference/short-fur/` 的短毛参考），时间上与本轮 3D 工作重叠。两条路线（3D 长毛骨架 vs 2D 短毛图集）尚未收敛，动手前应先确认方向。

制作验收使用下列检查，不将审美判断伪装成精确分数：

| 检查 | 通过条件 |
| --- | --- |
| 身份 | 与原始主猫并排看，面纹、脸型、耳朵和眼神仍像同一只猫 |
| 放松感 | 默认趴姿有重量和承托，肩颈放松，眼神不惊恐、不索取关注 |
| 柔软感 | 可见连续毛流与分层轮廓，不出现硬刷、光滑塑料面和生硬接缝 |
| 脱离布景 | 在深色、浅色桌面及透明背景仍自然，不依赖暖色房间照片 |
| 实际尺寸 | 160–240px 高度下仍能辨认脸、眼神和前爪；该尺寸是原型检查范围 |
| 动态连续 | 后续呼吸、眨眼和休息循环不穿插、不滑动、不频繁抢注意 |
| 用户反馈 | 用户愿意每天把它留在桌面；不能由自动测试宣布“治愈达标” |

## 复现与验证边界

在已启动的独立 Blender 官方 MCP 设计会话中依次运行：

```sh
.local/blender-mcp-venv/bin/python scripts/blender/mcp_client.py --tool execute_blender_code --code-file scripts/blender/create_cat_study.py
.local/blender-mcp-venv/bin/python scripts/blender/mcp_client.py --tool execute_blender_code --code-file scripts/blender/refine_cat_study.py
.local/blender-mcp-venv/bin/python scripts/blender/mcp_client.py --tool execute_blender_code --code-file scripts/blender/groom_cat_study.py
.local/blender-mcp-venv/bin/python scripts/blender/mcp_client.py --tool render_viewport_to_path --arguments '{"output_path":"anatomy-study-v3.png"}'
```

建议在新的独立设计会话中复现；脚本每次新建场景，反复调用会保留旧版本并增加文件体积。官方渲染工具将输出写入 Blender 临时目录，忽略传入目录，仅保留文件名；应按返回的 `filepath` 保存产物，不能仅根据请求路径声称文件已写入仓库。

本次调用证据：[v1 创建](../evidence/blender-anatomy-study.json)、[v1 渲染](../evidence/blender-anatomy-render.json)、[v2 创建](../evidence/blender-anatomy-study-v2.json)、[v2 面纹修正](../evidence/blender-face-mask-fix.json)、[v2 渲染](../evidence/blender-anatomy-render-v2.json)。最终脚本包含面纹修正。脚本语法和工程测试能验证可执行结构；角色外观、动作质量、GPU 开销仍需分别验收。

第三版证据：[创建](../evidence/blender-anatomy-study-v3.json)、[渲染](../evidence/blender-anatomy-render-v3.json)、[独立后台重新打开验证](../evidence/blender-study-reopen.json)。保存文件重新打开后确认 19 个网格对象、214,819 根曲线毛发、有效相机和透明渲染设置；当前角色材质没有参考图片节点。原生曲线目前没有绑定表面变形；不能直接给身体加动作后假定毛发会正确跟随。

第四版通过官方 `blender-mcp`（`uvx blender-mcp`，与前三版使用的 MCP 构建不同，见上文与[证据文件](../evidence/blender-anatomy-study-v4.json)）在同一 GUI 会话中交互式执行，脚本 [polish_cat_study_v4.py](../../scripts/blender/polish_cat_study_v4.py) 是对交互过程的整理复现，不是逐条操作日志——交互过程中出现过并修正了两次"新建集合/场景重名导致对象被误链接到旧场景"的 Bug，脚本里是修正后的正确写法；脚本也不包含后续追加的表面绑定毛发、口腔布尔和补丁的探索性步骤，那部分仍停留在交互记录里。保存后直接查询确认：32 个网格对象、37 个毛发曲线对象（其中 36 个已绑定到表面变形）、约 115.8 万根曲线、24 根骨骼。复现建议在新的独立会话中依次运行 `create_cat_study.py` → `refine_cat_study.py` → `groom_cat_study.py` → `polish_cat_study_v4.py`，再手动补做表面绑定（做法见[证据文件](../evidence/blender-anatomy-study-v4.json)里的 changes_from_v3 说明）。
