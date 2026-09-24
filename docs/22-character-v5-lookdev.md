# 灵犀短毛骨架模型 v5（工作中）

状态：可编辑的 Blender 角色 look-dev，未批准为品牌母版，也尚未接入 Three.js 应用。生成的大型 `.blend` 和 PNG 检查图按仓库 `.gitignore` 规则保留在本地工作区，不纳入 Git。

## 重新生成

需要 Blender 5.2+ 和 Pillow。macOS 默认使用官方应用路径；其他安装位置可通过 `BLENDER_BIN` 指定。

```sh
scripts/blender/build_lingxi_v5.sh
```

输出位于 `assets/characters/lingxi/v5/`：

- `lingxi-short-fur-rig-v5.blend`：可编辑网格、47 根骨骼、表情形状键和动画。
- `portrait.png`：常态 3/4 视图。
- `animations.json`：15 个具名动作与时间范围。
- `poses/*.png`、`poses/contact-sheet.png`：每个动作的代表帧及总览。
- `build-report.json`：构建数量摘要。

短毛由网格表面采样后跟随骨架变形；这仍是离线 look-dev，不能视为最终实时毛发方案。

## 当前审阅结论

- 动作数量足够进行第一轮覆盖检查；优先改善睡眠、趴卧、四肢支撑和脸部动作，不继续堆相似动作。
- 和 `assets/brand/lingxi-icon-v3.png` 相比，额头、眼周与脸颊的虎斑仍过于规律，尚未复刻 logo 花纹。
- 头身比例与腿部体积仍需根据统一正侧视参考校准。
- 睡眠已能滚到侧躺并闭眼，但闭眼盖片、落地重心还不自然。
- 皮毛有初步轮廓；毛量、毛流和桌面小尺寸下的柔软感仍未达到电影级标准。
- Three.js 当前角色仍由 `apps/lingxi/src/rig/skeleton.ts` 的体素骨架生成；v5 是 Blender 离线中间版本，尚未导入应用。

因此，这一版用于查差距和继续迭代，不能作为最终桌宠资源。
