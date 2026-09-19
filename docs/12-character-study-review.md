# 角色试作与视觉验收

2026-09-11。本文记录通过用户指定的 Blender Lab 官方 MCP 进行的原生 3D 试作。**视觉验收未通过；试作不替换品牌主图，也不作为最终角色。**

## 目标没有改变

身份依据始终是[用户概念板](source/peipei-concept-board.png)左上角的主猫。需要灰棕虎斑与暖白、自然的白色倒 V 面纹、短口鼻、湿润榛绿眼、柔软蓬松的轮廓，以及头和前爪放松地靠在一起的趴姿。用户明确要求“非常治愈”；工具连接成功、网格数量和渲染完成都不能替代这一评价。

## 三次实际 3D 试作

| 版本 | 改动与实物证据 | 结论 |
| --- | --- | --- |
| v1 | [Blender 源文件](../assets/characters/lingxi/source/lingxi-anatomy-study.blend)、[渲染](../assets/characters/lingxi/reference/anatomy-study-v1.png)；椭球体积、眼睛、曲线尾巴、粒子毛发 | 脸部拼接明显，眼睛突出，毛发偏硬；不符合目标 |
| v2 | [Blender 源文件](../assets/characters/lingxi/source/lingxi-anatomy-study-v2.blend)、[渲染](../assets/characters/lingxi/reference/anatomy-study-v2.png)；合并脸部体积、制作眼窝、重新设置毛发材质、调整面纹与趴姿 | 工程试作，仍需角色雕刻与分区毛流制作；未经用户接受 |
| v3 | [Blender 源文件](../assets/characters/lingxi/source/lingxi-anatomy-study-v3.blend)、[渲染](../assets/characters/lingxi/reference/anatomy-study-v3.png)；214,819 根原生曲线毛发，分区梳理、避开眼周，替换粗眼框 | 毛流更明显；表情仍僵硬、眼周仍像圆片、耳朵过薄，未达参考质量 |

三版均为 Blender Cycles 对真实网格和毛发的离线渲染。没有用图片平面冒充猫，也没有证明实时桌面效果。各版保留为制作参照，不能作为降低质量目标的理由。第三版曲线数量仅说明试作结构，不代表质量或性能达标。

## 已发现的具体问题

1. **脸部解剖还不自然。** 椭球合并与眼窝布尔只解决了接缝和突眼的部分问题；眼睑、额头、颧部和短吻仍缺少连续的雕刻关系。
2. **毛流仍不够自然。** v1/v2 粒子毛主要从表面向外生长；v3 已实现额头、脸颊、胸口、脚爪和身体的不同梳理方向，但毛束、底绒与护毛缺少层次，耳缘也还不自然。
3. **虎斑是程序条纹试验。** 尚未校准额头纹、两侧脸纹与背部纹；运行时皮肤应使用可核对的 UV/遮罩，不能依赖每个基本体各自的坐标。
4. **眼睛仍需完整结构。** v3 用细轮廓替换了粗眼框，但这不是完整眼睑，眼睛仍有圆片感。小尺寸可读性应由虹膜、角膜、眼睑覆盖和目光方向共同获得；不能继续无限放大球体和高光。
5. **尚无生产绑定。** v1 身体缩放关键帧只是呼吸占位。没有眨眼变形、四足骨架、动作混合或运行时毛发资产。

## 下一步应先解决什么

先校正同一只猫的正面、侧面与趴姿比例，完成一颗有真实眼睑和短吻结构的头，再制作分区 Groom。头部与原始主图相符后才扩展全身拓扑、骨骼和动作。先暂缓更多皮肤和行为动画，避免在未通过的形象上累计资产。

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

本次调用证据：[v1 创建](evidence/blender-anatomy-study.json)、[v1 渲染](evidence/blender-anatomy-render.json)、[v2 创建](evidence/blender-anatomy-study-v2.json)、[v2 面纹修正](evidence/blender-face-mask-fix.json)、[v2 渲染](evidence/blender-anatomy-render-v2.json)。最终脚本包含面纹修正。脚本语法和工程测试能验证可执行结构；角色外观、动作质量、GPU 开销仍需分别验收。

第三版证据：[创建](evidence/blender-anatomy-study-v3.json)、[渲染](evidence/blender-anatomy-render-v3.json)、[独立后台重新打开验证](evidence/blender-study-reopen.json)。保存文件重新打开后确认 19 个网格对象、214,819 根曲线毛发、有效相机和透明渲染设置；当前角色材质没有参考图片节点。原生曲线目前没有绑定表面变形；不能直接给身体加动作后假定毛发会正确跟随。
