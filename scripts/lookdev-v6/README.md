# scripts/lookdev-v6 —— 用照片级参考图反向校准 v5 造型

工作分支 `lookdev/v6-ref-match`，独立 worktree，不碰 main 上的 v5 管线。

## 目标

让 Blender 渲染出来的猫和 `assets/characters/lingxi/reference/lingxi-ref-*.png`
（照片级写实蓬松幼猫三张）是同一只猫。这取代了 v5 的对标对象
（`turnaround-v1.png` 半写实四视图 + `lingxi-icon-v3.png` logo）。

## 为什么需要一套新工具

v5 的验收回路是「重建整个模型（约 4.5 分钟）→ 渲染 15 个姿势 → 看 contact sheet」。
那个回路回答的是「动作有没有区分度」，回答不了「毛像不像照片」——
它太慢，而且出图构图和参考图对不上，没法比。

v6 的回路把它拆成两层：

| 层 | 成本 | 工具 |
|---|---|---|
| **着色 / 色调**（不重建） | 一次打开 blend，连渲 N 组变体，约 6 秒/张 | `v6_look_experiment.py` |
| **几何**（要重建） | 约 2–4 分钟 | `v6_render_views.py` + 构建脚本的环境变量旋钮 |
| **量化**（离线） | 秒级 | `v6_probe_gap.py` |
| **面部比例**（离线，**不需要看图**） | 秒级 | `v6_face_shape.py` / `v6_ascii_face.py` |

## 面部比例回路（2026-09-28 加）

原作者定这条回路的前提是"能看图"。图看不了的时候（无图像输入、无头执行、只看日志），
比例问题就得用数字回答。基准只能取一个：**瞳距 E**。参考图是把耳朵裁掉的紧裁切，
头的宽度在照片里量不到；E 是唯一跨越构图、镜头、裁切和物种都成立的尺子，
而且它本身就是眼睛大小的定义量，所以"鼻子 0.31E、两眼内角之间只有 0.52E"这种
**内部一致性检查**是成立的——不需要参考图的头宽。

```sh
PY=/Users/liepin/.workbuddy/venvs/lookdev/bin/python
# 一张表，全部以 E 归一化，并给出与参考图的偏差百分比
$PY scripts/lookdev-v6/v6_face_shape.py ref.png a/face.png b/face.png
# 看不清就把它读成字符：同一网格、同一区域打印参考图与渲染图
$PY scripts/lookdev-v6/v6_ascii_face.py ref.png --channel pink --crop face
```

参考图实测值（脚本自测自，见 `v6_face_shape.py` 的 `REFERENCE`）：

| 量 | 参考图 | 说明 |
|---|---|---|
| 瞳孔直径 / E | 0.194 | 最锐的指标 |
| 鼻镜宽 / E | 0.311 | 实心块，可靠 |
| 鼻镜高 / E | 0.160 | 鼻镜有软过渡，是最软的一个数 |
| 鼻心 dy / E | +0.320 | dy = 在瞳孔线**以下** |
| 嘴宽 / E | 0.288 | 实心块 |
| 嘴心 dy / E | +0.630 | |
| 鼻镜粉峰 Δ | 115 | Δ = R − max(G,B) |

## 用法

解释器：几何/渲染脚本用 Blender 自带的 python；离线分析用
`/usr/bin/python3`（有 numpy + Pillow）或新建的 venv
`/Users/liepin/.workbuddy/venvs/lookdev`（多了 scipy）。**PATH 里的 `python3` 没有 numpy。**

```sh
B=/Applications/Blender.app/Contents/MacOS/Blender
SHOT=assets/characters/lingxi/v6/look

# 1. 参考同构图渲染（默认 640px / 24spp / 85mm，隐藏 Studio ground 黑条）
V6_VIEWS=front,side,face V6_RES=512 V6_SAMPLES=64 V6_DENOISE=0 \
  $B --background <blend> --python scripts/lookdev-v6/v6_render_views.py

# 2. 着色/色调扫描：一次打开，连渲多组
V6_VIEWS=face V6_RES=512 V6_SAMPLES=64 \
  V6_VARIANTS='[{"name":"a","fur":{"sheen":0.6}},
                {"name":"b","view_transform":"Standard","skin":{"fuzz":{"scale":320}}}]' \
  $B --background <blend> --python scripts/lookdev-v6/v6_look_experiment.py

# 3. 量化对比（剪影归一化到同高）
python scripts/lookdev-v6/v6_probe_gap.py ref.png render.png --json out.json

# 4. 拼对照表
python scripts/lookdev-v6/v6_montage.py --out sheet.png --cols 3 "参考=ref.png" "v1=a.png"
```

## 几何旋钮（`build_lingxi_v5.py` 读环境变量，默认 1.0，不设就完全等同改造前）

| 变量 | 作用 |
|---|---|
| `V6_LEN_BODY` / `V6_LEN_HEAD` / `V6_LEN_TAIL` | 三层毛长倍率（保护毛） |
| `V6_LEN_UNDER` | 底绒额外长度倍率 |
| `V6_N` | 全部毛数倍率 |
| `V6_N_UNDER` | 底绒额外数量倍率 |
| `V6_R_GUARD` / `V6_R_UNDER` | 毛根半径倍率 |
| `V6_LIFT` / `V6_STAND` | 毛尖离皮肤的距离（1.0 时毛尖探出 0.44×毛长） |
| `V6_CLUMP` | 成簇强度 |
| `V6_TAPER_LO` / `V6_TAPER_HI` | 毛根 / 毛尖的明度（默认 .86 / 1.10） |
| `V6_WAVE` / `V6_FRIZZ` | 卷曲 / 散乱幅度 |
| `V6_SKIP_PORTRAIT=1`（native_fur） | 跳过 1200×1200 肖像渲染，实验快很多 |
| `V6_BALD=1`（渲染脚本） | 把毛整层摘出渲染，**打基础几何的脸**；取景仍按带毛包围盒算 |
| `V6_HIDE=前缀,...`（渲染脚本） | 按名称前缀隐藏任意物件 |
| `V6_FACE_E_PX`（渲染脚本） | 面部两视图把瞳距钉成这个像素数（默认 220，0 = 关掉） |

## 面部旋钮（默认值即当前最佳，全部已量化校准）

| 变量 | 默认 | 依据 |
|---|---|---|
| `V6_EYE_R` | 0.84 | 瞳孔直径 / E 对上参考 |
| `V6_MOUTH_W` | 0.54 | 嘴宽回到 ≈ 一个鼻镜宽 |
| `V6_NOSE_W` / `V6_NOSE_H` / `V6_NOSE_D` | 1.28 / 1.50 / 1.35 | 鼻镜宽高深 |
| `V6_NOSE_DZ` | −0.0088 m | 鼻心下移（目标 dy +0.320） |
| `V6_MOUTH_DZ` | −0.0102 m | 嘴、口腔袋、舌、牙、下唇、人中**一起**下移 |
| `V6_HEAD_SX` / `V6_HEAD_SZ` / `V6_EAR` | 1.06 / 0.95 / 0.82 | 颊宽 / 下颌高 / 耳长（上一轮视觉比对） |

> ⚠️ `V6_MOUTH_DZ` 必须同时作用于 `LX_MouthCavity` / `LX_MouthFloor` / `LX_Tongue` /
> `LX_Tooth` / 下唇 / 人中。只挪唇线不挪口腔袋，闭嘴时粉色会从新唇线**上方**露出来。
> 牙的位置也从硬编码改成 `MOUTH_W` 的比例，否则嘴一收窄牙就挂到唇外。

## 诊断结论（2026-09-28）

见 `.workbuddy/memory/2026-09-28.md`。要点：

1. **毛长是主因**：脸 64 mm / 身 85 mm，等于脸上长 6 cm 的毛；`lift` 让毛尖再探出 28 mm。
2. **底绒加密看不见**：under 半径 0.38–0.45 mm，512 px 取景下不足半像素。
3. **轮廓飞毛其实已经接近参考**（≈9 mm vs ≈10 mm，都按剪影高归一化）——问题在表面，不在轮廓。
4. **渲染质量会翻转结论**：16 spp + 降噪把细毛抹平，看起来像"光滑塑料"；
   同一模型 64 spp 关降噪就长出毛来。**任何"毛够不够"的判断都必须在 64 spp 关降噪下做。**
5. 白毛不白是 AgX + Medium High Contrast；换 Standard 变白但高光溢出。
6. 身体几乎全白，虎斑只在下巴以上——是 coat 贴图的问题。

## 坑

### 取景由包围盒推导 → 无关几何改动会污染所有比例量（2026-09-28，最贵的一个）

`v6_render_views.py` 原本按「目标物件包围盒」算相机距离。结果是：改鼻子、改下颌、
换毛量都会改变头盒尺寸 → 相机前后移动 → **瞳距（所有比例的分母）跟着变**。
曾经在一轮里完全没碰眼睛，瞳距却从 174 px 变成 127 px（−27%），
所有面部数字一起漂，再叠上"鼻子大了/小了"完全分不清。

修法：面部两视图把取景**钉在眼对上**（`V6_FACE_E_PX`，默认 220 px，
相机对准 `Eye.L`/`Eye.R` 骨的中点）。E 由此变成构造出来的常数，
量的时候再用 `--e-px 220` 传进去，**不要去"检测"它**。
残余检测误差实测 3.7%（裸脸）/ 16%（毛脸，眼周的暗毛让暗区重心外移），
足以把毛脸的结论整体拉偏一成。

### 「防御性阈值」比没有阈值更危险

第一版面部诊断用**绝对**粉色阈值在参考图上找鼻镜，抓到的是失焦背景，
于是得到"鼻子几乎宽一倍"——照着它把 `V6_NOSE_W` 收到 0.62，
**把本来接近的鼻子改小了一半**。改用「以鼻轴自身峰值的相对比例切」之后，
参考图实测是 0.311E，而当时模型是 0.196E（画出来）——方向是**略微偏小**，不是宽一倍。

同一条教训的第二次：用"最宽的一行"找鼻子，在参考图上得到 0.63E 的"鼻子"——
那是一圈散落的粉色像素（实心度 13%），不是鼻镜（实心度 100%）。
**行宽度必须和实心度一起看**，只看宽度会稳定地量错。

### 其它

- `build_lingxi_v5.py` 全篇 **1 空格缩进**。用编辑器精确匹配改这个文件很容易把行首空格吃掉
  （已踩：`stand=`/`lift=` 变顶格 → `IndentationError`）。改完必须 `py_compile`；
  批量替换用 Python 读-替换-写并 `assert count == 1`，别依赖编辑器的模糊匹配。
- 渲染图底部有 `Studio ground` 黑条，会污染任何基于剪影的度量。渲染脚本已隐藏它，
  离线分析 `v6_probe_gap.py` 也会剔除贴边的极暗长条。
- 贴图会被 `pack()` 进 blend（`build_lingxi_v5.py` 末尾）→ **换了贴图必须重构建**，
  改盘上的 PNG 再重渲是没用的。
- `nose_skin.png` 等来自 `assets/characters/lingxi/v5-imagegen-sources/`（imagegen 原稿），
  被 `make_skin_textures.py` 缩放后烘焙。**别手改烘焙产物**（会被 `build_lingxi_v5.sh` 覆盖），
  校正写在 `ALBEDO_SATURATION` 里。
- macOS 没有 `timeout`。
- `git worktree add` 只给干净的 HEAD，**拿不到别人未提交的改动**，要自己 rsync 过去。
