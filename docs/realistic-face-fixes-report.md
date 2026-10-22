# 写实猫脸部三处硬伤排查报告（2026-10-22）

## 结论

本分支只修改运行时 TypeScript，没有修改或发布 GLB、`groom.bin`、Blender 文件。运行时改动减轻了三处问题，但脸颊椭球轮廓和耳壳的实际厚度仍由已发布资产决定。若目标是彻底消除这两处轮廓，需要在资产源文件中重建并重新审核模型与 groom。

## 根因和处理

| 问题 | 排查证据 | 本次运行时处理 | 资产层面的剩余工作 |
| --- | --- | --- | --- |
| 脸颊圆盘 | 关闭 `faceFuzzRegion` 后，圆形轮廓仍在；改用纯 shells 后明显减弱。Blender 源脚本把左右 `Cheek` 椭球并入 `LX_Head`，再按头部表面生成 guard 和 under groom。 | 将短绒的球形截断范围从 105 mm 扩到 150 mm，过渡宽度从 30 mm 扩到 75 mm；降低色差，向外接近长毛长度。 | 在 `scripts/blender/build_lingxi_v5.py` 中重塑 cheek 与 cranium 的连接，重新梳理、重导出头部 groom。现有椭球形状仍可能在近景下显现。 |
| 闭眼皮平滑 | 临时将 `createLidFuzz` 染红后，短毛确实覆盖闭眼皮，但其不透的卡片叠成同色平面；原始 lid groom 因规则行纹已被运行时省略。 | 毛覆盖提前到睫毛线外，缩窄裸露边；改用更短的透空毛卡片，在底绒上加入稳定的细短毛纹理，压低底色亮度。 | 若仍需照片级近景，应重新制作不成行的 lid groom。当前睡觉镜头的浅棕区域仍可辨认。 |
| 耳朵塑料边 | 分别隐藏耳内白毛和耳背 groom，厚边仍在；将 `LX_ShortFur_EarOuterTabby` 临时染绿后，厚边整圈变绿。Blender 的 `Ear shell` Solidify 厚度为 6.5 mm。 | 将外缘改为哑光棕色，压低环境反射；耳面贴图的近白边带渐变到棕色，耳内补一点掠射暖光。保留原有耳背短毛和内侧长白毛。 | 将 Solidify 厚度和 rim 材质在源资产中重做，重新导出匹配的耳背 groom；只改材质不能使几何真正变薄。 |

资产源脚本仅作只读核对：`~/workspace/lingxi-v5fix/scripts/blender/build_lingxi_v5.py`，关键位置约第 384、1080 和 1090 行。

## 同镜头对比

截图根目录：`/private/tmp/claude-501/-Users-liepin-workspace-dsh-workspace-dsh-hyperliquid/3204c094-d8f8-446e-9989-1feaef376fd2/scratchpad/sculpt/codex-a/`

- 脸颊：`comparison/cheek-face-front.jpg`、`comparison/cheek-face-34.jpg`
- 闭眼：`comparison/eyelid-sleep.jpg`。`comparison/eyelid-loaf.jpg` 用于检查香箱姿态；该镜头末帧的眼睛是睁开的。
- 耳缘：`comparison/ear-face-front.jpg`
- 默认桌面比例 0.5：`final/final-desk/00001.png`

每张对比图左右两侧分别来自相同镜头配置的基线和最终渲染，后处理只加了相同的灰底和相同裁剪。

## 性能与验证

脸部短绒增加 8,000 根，眼皮短毛减少约 7,200 根（四片眼皮合计），净增约 800 根毛卡片，即约 1,600 个三角形。没有新增渲染网格或绘制调用；耳朵着色器只作用于两片小面积耳面。默认比例 0.5 的截图可正常渲染。截图服务使用虚拟时间逐帧渲染，不能据此宣称实测达到 60 fps；仍需在真实桌面应用中测量帧时。

`cd apps/lingxi && npx tsc --noEmit` 通过；`node --test test/realistic-*.test.mjs` 共 41 项通过。
