# 真实猫集成运行时修复 · 2026-10-16

用户实测：走路速度和步态不匹配、身体透、白眼，整体不萌也不治愈。工作区是 `lingxi-realcat` / `feat/realcat-style`。

## 已复现的原因

- **白眼**：安装包里虹膜、鼻子和耳内全部丢贴图；开发服务器的 Chrome 能显示。同一 GLB 在 `app-runtime-audit.html` 使用正式 CSP 后稳定复现：`LX_Tex_Ear`、`LX_IrisLayer.L/R`、`LX_Tex_Nose` 的 map 均为 null。Three 的 GLTFLoader 把内嵌 PNG 转成 blob URL，再由 ImageBitmapLoader 用 fetch 读取；正式 CSP 的 img-src 允许 blob，connect-src 未允许。
- **身体透**：壳毛使用 alphaToCoverage，外层输出分数 alpha。它覆盖了底下已画实的皮肤/厚绒像素，透明窗口再与桌面合成时，身体变淡、背景透进来。资产 COLOR_0 的身体/头/尾顶点 alpha 都是 65535/65535，并非模型顶点半透明。
- **滑步**：GLB 的 Walk 每 1.958333 s 只前进 .157895 m，Run 每 1.291667 s 前进 .933333 m。旧逻辑到 300 px/s 才选 Run，并将播放速度限制为 .35–2.5；小尺寸下 90 px/s 的地速远超 Walk 的步幅，腿却被卡在 2.5 倍。速度平滑还让腿在刚起步、刚停下时跟不上实际位移。已有未提交的 setPace 接口尚无真实猫实现；26 px/s 的转身门槛会令放慢的小猫横着滑。

## 修改

- 正式/开发 CSP 的 connect-src 允许本地 blob 读取；关键贴图缺失时 ready 拒绝，风格切换保留原猫并报错，避免白眼也被当成加载成功。正式 CSP 的测试页和配置由回归检查保持一致。
- 壳毛改为 alphaHash：空隙丢弃，保留的毛丝样本保持不透明，内层厚绒保留。透明画布与皮肤仍按原用途渲染。
- 动画时钟由本帧实际地面位移决定，低速可降到 0；按模型大小、相机和方向计算 Walk 的自然地速，超过步幅时选择 Run，并有切换滞回。闲逛速度通过已有 setPace 接到真实猫的舒服步速；低速也按 heading 转身。
- `app-harness` 支持 `walk=<px/s>&audit=1`，显示实际/动画地速、关键贴图和躯干 alpha；原生 perception 增加 renderDiagnostics，供实际桌面复验。

## 验证记录

- TypeScript / Vite production build 通过；步态、CSP、生命引擎相关 69 项通过；check-project 通过。资产回归直接读取当前 GLB 的骨架与动画，用 Three AnimationMixer 对照原始带位移片段，四个大小/速度组合的后脚轨迹附加误差均小于 .2 mm。
- 全套测试首次并行运行 252/256，通过串行复跑确认另外 4 项启动/钩子时限用例通过。未修改这些钩子。
- 旧应用备份：`/Users/liepin/workspace/lingxi-realcat-build/灵犀-runtime-before-20261016.app`。
- 原生 release 包构建通过，使用项目现有 entitlements 做本地 ad-hoc 签名，codesign strict 验证通过；已更新 `/Applications/灵犀.app` 并重启。
- 原生 perception 复验（用户尺寸 .25、自动视角）：Walk 的 actual groundSpeed **.0266**、animatedGroundSpeed **.0266**、timeScale **1.05**。四项贴图均加载：`ear_fur_v2`、两张 `iris_nopupil`、`nose_skin`。
- 最终视觉验收尚未完成：本轮后段原生窗口截图返回 `cgWindowNotFound`，此时 perception 为 `power: stalled`；不能把诊断数据当作“萌感达标”。已请用户直接反馈更新后的桌面画面。

## 外观验收

先让 App 正确呈现已有模型的瞳孔、虹膜、粉鼻、暖棕毛和实体轮廓。再按实际桌宠尺寸看眼神、软阴影、脸颊和走停节奏。Blender 的长毛静帧不能代替透明原生窗口的验收，也不能用“比例数字接近”宣布萌感达标。
