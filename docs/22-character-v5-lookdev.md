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

## 2026-09-24：四个已修复的缺陷

上一轮的 contact sheet 上，15 张卡里有 10 张看不出区别，`build-report.json` 却报着
"actions: 495, clips: 15, frames: 776"——三个数字都是真的，因为它们数的是**容器**，不是姿势。
用 [`scripts/blender/diagnose_lingxi_v5.py`](../scripts/blender/diagnose_lingxi_v5.py)
逐帧量过之后，原因有四个，彼此独立：

| # | 缺陷 | 证据 | 修法 |
|---|---|---|---|
| 1 | **姿势表采样在正弦的过零点上** | 每个表情 clip 都用 `sin(phase)` 驱动，`phase = u·2π`；渲染脚本固定取 `u=0.55` → `sin(198°) = −0.31`。Curious 的 13° 抬头渲成 4.3°，与 Idle 的距离只有 9.7 | 改成**逐帧扫描、取离静止姿态最远的一帧**。contact sheet 要回答"这个动作长什么样"，答案是它的极值，不是它的均值 |
| 2 | **眼睛在 Blink≈1 时塌成一张水平面** | `add_eye_blink` 写的是 `center_z + (v.co.z - obj.data.vertices[i].co.z) * .035`，而新建 shape key 的 `key.data[i].co` **就等于** basis，括号恒为 0 → 每个顶点都落到 `center_z`。实测最大位移 0.0310 = 高度 0.0620 的**恰好一半**，正是塌成平面的特征 | 支点改回 `center_z`。修完最大位移 0.0299 = 0.965·h/2，符合"压扁到 3.5%"的本意 |
| 3 | **眼睑是零厚度的纸片** | 耳朵有 `SOLIDIFY`，眼睑没有；材质用的是亮白的 `cream`（腹部绒毛色），不是脸部皮肤 | 加 3.5 mm 的 `SOLIDIFY`，换成新的 `LidSkin` 材质 |
| 4 | **剪影几乎不变** | 所有站姿的包围盒都是 `0.421×1.199×0.75x`——1.2 m 上差 1~2 mm（0.1%）。LieDown 只比站着矮 3 cm：腿折了 117°，root 却只降了 11 cm，所以是"站着但腿弯了" | 躺姿 root 降到 −0.28；Curious 加前倾+压低+耳朵前转，Happy 加竖尾+挺胸+弹跳 |

缺陷 1 和 2 互相掩护：采样器永远避开过零点附近的极值，所以眼睛塌陷只在 Sleep（唯一全程
`Blink=1` 的 clip）露过一次，看起来像打光问题。

**修复前后，各 clip 与 Idle 的距离**（骨骼总位移角度 + 加权表情）：

| clip | 之前 | 之后 |
|---|---|---|
| Curious | 9.7（**判定为同一姿势**） | 172.2 |
| Happy | 421.7 | 656.2 |
| PawPlay | 120.4 | 180.6 |
| Knead | 524.8 | 669.5 |
| LieDown 剪影高 | 0.721（Idle 0.755） | 0.805 |
| Stretch 剪影深 | 1.219 | 1.225，高 0.818 |
| "同一姿势"的配对数 | 3 | 2 |

重建与复现：`scripts/blender/build_lingxi_v5.sh`（约 2 分 40 秒）。
诊断随时可单独跑：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background \
  assets/characters/lingxi/v5/lingxi-short-fur-rig-v5.blend \
  --python scripts/blender/diagnose_lingxi_v5.py
```

## 仍然没解决的

- **花纹不对。** 这仍然是本文最大的问题，和上面四个缺陷无关：模型是均匀的米白，
  `assets/brand/lingxi-icon-v3.png` 是灰棕虎斑 + 白色倒 V 脸纹 + 榛绿眼 + 粉鼻。
  现在只有尾巴有几道环纹。**在花纹补上之前，这个模型不是灵犀，是一只别的猫。**
- **Bite 和 Lick 仍然与 Idle 无法区分**（距离 15.3 / 38.2）。它们只动下颌和舌头，
  身体姿态没有配合，和修复前的 Curious 是同一类问题，只是还没改。
- 眼睑虽然有厚度了，闭合时仍是三角楔形，没有贴着眼球的球面走。
- 毛量、毛流和桌面小尺寸下的柔软感仍未达到目标。

## 当前审阅结论

- 动作数量足够进行第一轮覆盖检查；优先改善睡眠、趴卧、四肢支撑和脸部动作，不继续堆相似动作。
- 和 `assets/brand/lingxi-icon-v3.png` 相比，额头、眼周与脸颊的虎斑仍过于规律，尚未复刻 logo 花纹。
- 头身比例与腿部体积仍需根据统一正侧视参考校准。
- 睡眠已能滚到侧躺并闭眼；闭眼盖片在 2026-09-24 修掉了塌陷（见上），但楔形轮廓仍不自然，落地重心也还不对。
- 皮毛有初步轮廓；毛量、毛流和桌面小尺寸下的柔软感仍未达到电影级标准。
- Three.js 当前角色仍由 `apps/lingxi/src/rig/skeleton.ts` 的体素骨架生成；v5 是 Blender 离线中间版本，尚未导入应用。

因此，这一版用于查差距和继续迭代，不能作为最终桌宠资源。
