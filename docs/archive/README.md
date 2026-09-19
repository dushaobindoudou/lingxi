# 归档

这里的文档**不是错的，是过期的**——它们记录的是项目真实走过的路，但描述的流程已经不是
现在的实现方式了。保留而不是删除，因为其中的判断和取舍仍然有参考价值，而且以后如果要
重新做资产管线，这些是起点。

## 为什么过期

早期的猫是在 Blender 里建模、导出 glTF、再在运行时加载的。现在**整只猫是程序生成的**：
骨架来自 `apps/lingxi/src/data/skeleton.json`，花纹由 `src/rig/art.ts` 现画到一张图集上，
表情是一张 256×256 的贴花。没有 .blend、没有 glTF、没有资产导出步骤。

这么改的原因：一只程序生成的猫，换体型、换花纹、换配色都是改几行数据；而一条 Blender
管线里，每加一个皮肤都要重新导出一遍。用户可编辑的 `skins.json` 这个能力，在旧管线下是
做不到的。

| 文档 | 讲的是 |
|---|---|
| `10-blender-workflow.md` | Blender + MCP 的建模工作流 |
| `12-character-study-review.md` | 早期造型评审 |
| `13-threejs-preview.md` | 独立的 Three.js 预览页（已被调试台取代） |
| `15-approved-short-fur-assets.md` | 短毛资产定稿记录 |
| `16-blender-rig-v5.md` | Blender 里的 v5 绑定 |
| `17-reusable-cat-models.md` | 复用第三方猫模型的调研 |
| `19-voxel-style-kit-handoff.md` | 体素风格包交接 |

`scripts/blender/` 下的脚本同理：留着，但不在应用的构建路径上。
