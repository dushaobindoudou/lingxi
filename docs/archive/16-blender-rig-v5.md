# 灵犀 v5 模型与动作交付记录

## 结果与验收状态

生成了 [Blender 模型](../../assets/characters/lingxi/v5/lingxi-short-fur-rig-v5.blend)，包含 47 根骨骼、18 组动画、原生毛发、眼睑与呼吸等形态键，并使用此前生成的三张纹理来源。

**这是功能原型，未达到用户认可的摄影级小猫外观，不能标为最终完整成品。** 当前欠缺包括更自然的脸部比例、眼神、耳毛与毛发层次、平滑且符合猫解剖的步态、脚掌锁地、完善口腔、引擎用 UV 烘焙。最终休息姿态渲染仍有前爪变形及不自然悬空，卧躺动作未通过视觉验收。

- [实际模型渲染](../../assets/characters/lingxi/v5/portrait.png)
- [动作预览页](../../assets/characters/lingxi/v5/preview.html)
- [功能对应表与使用说明](../../assets/characters/lingxi/v5/README.md)
- [动画时间轴](../../assets/characters/lingxi/v5/animations.json)
- [毛发跟随验证](../../assets/characters/lingxi/v5/final-verification.json)
- [下颌世界坐标位移验证](../../assets/characters/lingxi/v5/jaw-verification.json)
- [地面修正记录](../../assets/characters/lingxi/v5/ground-correction.json)

## 第四版评估

检查了 [第四版导出脚本](../../scripts/blender/export_three_preview_v4.py) 和实际 `.blend`。脚本导出的是静止姿态的评估几何，未导出骨骼动画。第四版外观和绑定方式不足以直接支持本次的全身动作目标，因此保留第四版原件，以新文件重建身体、头脸、骨骼和毛发变形。

复用的是此前生成的材质库和三张图像素材，以及项目已有制作方法。没有宣称将静态概念图自动转成同等质量的 3D 模型。

## 制作与复现

在 Blender 5.2.1 中按顺序执行以下脚本。各步会保存 v5 文件；首次构建使用材质库作为输入，其余步骤打开上一阶段 v5。脚本为一次性构建步骤，勿在同一阶段结果上重复执行追加操作。

1. `scripts/blender/build_lingxi_v5.py`：创建几何、骨骼、权重、纹理和初始动画。
2. `scripts/blender/refine_lingxi_v5.py`：底层毛色与虹膜调整。
3. `scripts/blender/verify_animate_lingxi_v5.py`：重建并验证初始动画。
4. `scripts/blender/native_fur_lingxi_v5.py`：建立真正的原生毛发曲线，通过 Geometry Nodes 读取蒙皮点位置。
5. `scripts/blender/polish_lingxi_v5.py`：每根毛发的材质、头脸与耳部调整。
6. `scripts/blender/finalize_lingxi_v5.py`：独立瞳孔、18 组动作和实际下颌位移验证。
7. `scripts/blender/repose_lingxi_v5.py`：重做休息姿态，使用腿段缩放近似收拢；仍非解剖正确的折腿。
8. `scripts/blender/ground_lingxi_v5.py`：逐帧地面高度修正；尚无 IK 锁脚。
9. `scripts/blender/check_lingxi_v5_final.py`：重新读取模型，验证动作及毛发实际跟随。
10. `scripts/blender/render_lingxi_v5_demo.py`：渲染 18 × 16 帧预览。

`fix_fur_lingxi_v5.py` 记录了中间诊断尝试，已由原生曲线方案替代，复现时无需执行。

主要制作与单图验证通过项目已安装的官方 Blender MCP 执行。超过其默认超时的批量渲染使用同一 Blender 可执行程序的后台模式；没有改用社区 MCP。
