# 原始梳毛接入与动作慢放修复 · 2026-10-16

工作区：`lingxi-realcat`，分支 `feat/realcat-style`。源模型为 `lingxi-v5fix/assets/characters/lingxi/v6/round-zzz3/lingxi-short-fur-rig-v5.blend`。

## 已复现的问题

App 只导入皮肤，32 层程序壳毛没有保留 Blender 的梳毛。单纯改壳层毛长无法还原原始弧度、分区方向和聚束轮廓。

动作计时在 `main.ts` 和预览入口都执行 `Math.min(.1, elapsed)`。复现命令读取 main.ts 的原表达式，在 5 FPS 下推进 2 秒，结果动画仅推进 `0.9999999999999999` 秒，断言失败。这个缺陷在低帧率、WebKit 后台降频时会直接造成慢放。散步还会经过性格、转弯和到达减速，原先 1.3 的基础步速系数在默认性格下可降到约 .8 倍原始动画速度。

## 本轮实现

- 新增 `export_realtime_groom.py`。从 587,295 根源毛中确定性抽取 240,001 根，保留六点曲线、逐点线性颜色、原始渐细半径、逐点四骨骼权重和表面法线；转换为同模型的 glTF 静置坐标。尾尖按逐点权重变形。
- 新增 `groom.json/bin`，二进制 79,375,236 字节。使用原曲线的朝向绘制细窄、朝向相机的带状毛丝，不再用统一方向重建全身毛。根部固定，毛尖加小幅波动；这是视觉摆动，不是碰撞或物理毛发模拟。
- 眼睑毛根从源眼睑形态键采样位移，共享正式眼睑的 morph influences，保持眨眼闭合；它是最近顶点的位移近似。原始曲线模式不再叠加眼睑壳毛。
- 细毛用 MSAA alpha-to-coverage 平滑边缘，并显式设置 source-over RGB/alpha 混合。覆盖已有不透明皮肤时 alpha 保持 1，避免上一版透体问题；不使用 alphaHash 的颗粒裁切。降低地面硬轮廓阴影的浓度，保留接触阴影。
- 按实际桌宠尺寸复验后，修正亚像素覆盖率：MSAA mask 和 source-over 都乘透明度，原先线性覆盖率被平方，细毛在缩小时消失；现在输入平方根覆盖率，补偿重复衰减。
- 真实猫按完整帧间真实时间推进 AnimationMixer；休眠恢复继续重新锚定时钟，像素猫保留原积分上限。散步基础系数改为 2.1，继续按实际位移匹配步幅，没有给所有动作统一加速。
- 诊断数据增加毛发模式、根数、部件数、动画时间、帧率、绘制调用和三角形数；着色器错误会明确报错。
- 安装脚本支持第三参数指定 groom 目录，核对 cat.glb SHA-256 和二进制长度；切换没有 groom 的模型时移除旧 groom，避免混用。

## 验证

- TypeScript/Vite production build、`npm run check`、`git diff --check` 通过。
- 7 项相关测试通过：实际 AnimationMixer 在 5/10/30/60 FPS 均于 2 秒完成两秒片段；实际 GLB 后脚轨迹对照；步幅和大小；CSP；原始毛发与模型哈希配对及走路多个时点的根、中点、毛尖变形。眼睑测试加载正式 lids.glb，验证共享形态键位移。
- Safari/WebKit 使用正式 CSP 的页面实际显示成功：`fur.mode=original-curves`，240,001 根，16 个部件；`torsoAlpha=255`，四项虹膜/鼻/耳贴图正常。灰色和浅色背景均检查。后台浏览器降频下动画时间仍按真实时间推进；后台预览帧率不能作为前台桌面性能结论。
- 小尺寸走路预览：24 px/s、Walk 播放倍率 1.85；实际地速和动画地速均为 .0943，身体 alpha 为 255，原始曲线毛束保持加载。
- 实拍：`/Users/liepin/workspace/lingxi-realcat-build/groom-review-front.png`。
- 本机原生验证包构建通过，使用 `--config 'profile.release.package.lingxi.opt-level=2' --config 'profile.release.package.lingxi.codegen-units=16'` 缩短本机编译；没有修改仓库 release 配置。着色器与前端生产构建相同。已按项目 entitlements 本地签名，严格签名检查通过，并更新 `/Applications/灵犀.app`、重启成功。
- 安装前备份：`/Users/liepin/workspace/lingxi-realcat-build/灵犀-before-groom-20261016.app`。安装后可执行文件 SHA-256 为 `06902e15aa363e5220c66b149a7307e1df9d1967889027b23463145211b30850`。
- 重启后桥接和窗口正常，当前用户已选择 `voxel`，保持该选择。因此本轮毛发视觉验收来自 WebKit 正式 CSP 预览，尚未在安装版切换真实猫做最终观感验收；原生运行性能也未据后台预览帧率宣称达标。

## 重建资产

先把目标轮次的 cat.glb 安装到 current，再执行（Blender 路径可按机器调整）：

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b <round>/lingxi-short-fur-rig-v5.blend \
  --python scripts/blender/export_realtime_groom.py -- \
  --out apps/lingxi/public/characters/lingxi-realistic/current --budget 240000
```

导出的两个文件另存到 `<round>/export-groom`，或用 `node scripts/install-realcat-asset.mjs <round> <groom-dir>` 安装。本轮另存于 `/Users/liepin/workspace/lingxi-realcat-build/round-zzz3-groom`。

## 仍有的差距

曲线位置与颜色来自 Blender，毛发采样密度、着色、透光、遮蔽和抗锯齿仍与 Cycles 不同。眼周/胸口的细毛质感和受光尚未达到离线渲染；本轮不宣称完全还原或萌感已通过用户验收。启动要加载约 76 MiB 毛发，首次构建 GPU 几何也有成本。需要以原生桌面尺寸的实际观感继续判断。
