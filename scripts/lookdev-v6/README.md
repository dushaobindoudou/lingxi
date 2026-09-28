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

- `build_lingxi_v5.py` 全篇 **1 空格缩进**。用编辑器精确匹配改这个文件很容易把行首空格吃掉
  （已踩：`stand=`/`lift=` 变顶格 → `IndentationError`）。改完必须 `py_compile`；
  批量替换用 Python 读-替换-写并 `assert count == 1`，别依赖编辑器的模糊匹配。
- 渲染图底部有 `Studio ground` 黑条，会污染任何基于剪影的度量。渲染脚本已隐藏它，
  离线分析 `v6_probe_gap.py` 也会剔除贴边的极暗长条。
- macOS 没有 `timeout`。
- `git worktree add` 只给干净的 HEAD，**拿不到别人未提交的改动**，要自己 rsync 过去。
