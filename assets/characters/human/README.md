# 可复用人形模型与骨架

已下载并在 Blender 5.2.1 中检查，2026-10-13。优先用 Quaternius 的原有网格、骨架和权重。
这是一组独立工作资产，还不是已接入灵犀的物种包。

## 直接打开

- [银月换装测试](yinyue-study.md)：在女性骨架上做的银发、兽耳、毛领、宽袖和红腰封造型，附真实模型渲染与动画 GLB。
- [男性 Blender 工程](work/human-male.blend)：原网格与 65 节点骨架，16 段已转移、烘焙的动画，贴图内嵌，默认待机。
- [女性 Blender 工程](work/human-female.blend)：同样保留原骨架和权重。
- [男性 GLB](work/human-male.glb)、[女性 GLB](work/human-female.glb)：贴图、蒙皮和 16 段动画均在单个文件里。
- [交互预览页面](viewer.html)：切换角色/动作、显示骨架、暂停并转动关节，观察 FK 父子联动。

通过仓库根目录的本机 HTTP 服务打开预览，不能直接用 `file://`：

```sh
python3 -m http.server 8818 --bind 127.0.0.1
# http://127.0.0.1:8818/assets/characters/human/viewer.html
```

查看 Blender 动作时选中骨架，在 Action Editor 的动作选择器中选择 `Human_动作名`。
NLA 中保留所有动作，每段原始时域独立；默认 NLA track 静音、当前 action 为 Idle_Loop。
工程默认进入 Pose 模式，按躯干、左右手臂、腿和手指整理骨骼集合，隐藏末端辅助节点；原骨骼层级不变。
骨骼可以直接以 FK 摆姿。GLB 没有 Blender IK 控制器，不能把动画骨架误当成实时 IK 系统。

## 原始下载内容

| 资产 | 本次取得的文件 | 已核对内容 |
|---|---|---|
| [Quaternius Universal Base Characters](https://quaternius.itch.io/universal-base-characters) | [Standard ZIP](downloads/universal-base-characters-standard.zip) | 免费包实际为 Superhero Male/Female 两个全身模型，另有头发与贴图；65 个 joint 节点，其中 12 个末端辅助节点。不是商品介绍中完整版的全部 6 种体型。 |
| [Quaternius Universal Animation Library](https://quaternius.itch.io/universal-animation-library) | [Standard ZIP](downloads/universal-animation-library-standard.zip) | 实际 43 个动画条目，包含 T-pose；分别提供根运动关闭和 `_RM` 根运动版本的 GLB/FBX。不是完整版宣传的 120+ 动画。 |
| [Kenney Animated Characters Protagonists](https://kenney.nl/assets/animated-characters-protagonists) | [ZIP](downloads/kenney_animated-characters-protagonists.zip) | 轻量备用：804 顶点，58 个骨骼节点，4 张角色皮肤，独立 idle/run/jump FBX。模型与动作 FBX 的绑定姿势不同，未把这些动作盲目拼到网格上。 |
| [CesiumMan / Khronos 样例](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/CesiumMan) | [原始 GLB](downloads/cesium-man/CesiumMan.glb) | 成人比例的技术对照：19 个 skin joints、1 个动画。模型 CC BY 4.0，Cesium 标志另有使用条款，不选为伙伴外观。 |

所有下载哈希、作者与来源见 [asset-manifest.json](asset-manifest.json)。原始二进制、派生工程和预览图是本地工作材料，未放入 git 发布。

## 人形结构与联动

实际角色表见 [humanoid-rig-map.json](humanoid-rig-map.json)。

```text
root                         整体定位/根运动
└─ pelvis                    骨盆与身体升降
   ├─ spine_01/02/03         腰胸脊柱
   │  ├─ neck_01 → Head      颈头
   │  ├─ clavicle_l → upperarm_l → lowerarm_l → hand_l → 五指
   │  └─ clavicle_r → upperarm_r → lowerarm_r → hand_r → 五指
   ├─ thigh_l → calf_l → foot_l → ball_l
   └─ thigh_r → calf_r → foot_r → ball_r
```

这是游戏动画骨架，并非逐块复原人体解剖骨。保留脊柱分段、肩带、左右四肢、五指及前脚掌，
可以研究抬臂、转身、屈膝、接地的协调。肩胛/肱骨不能固定成全程 2:1；前臂旋前旋后不能全部挤到腕部。
证据与详细建议在 [人体骨骼联动研究](../../../docs/research/2026-10-13-human-rig-anatomy.md)。

## 已完成的适配

1. 保留下载网格、蒙皮与全部 65 节点；没有重新生成或重绑人体网格。
2. 修复原 glTF 中 `T_Hair_1_Normal_png.png`、`T_Eye_Normal_png.png` 等引用：指向包内确实存在的正常文件名，原始包不修改。
3. 角色和动画虽然骨名相同，绑定姿势及腿长仍不同。按源绑定姿势的旋转差转移姿态，保留目标骨段偏移，并按腿长缩放 root/pelvis 位移。
4. 导出 16 段常用动作：待机、说话待机、走路、正式走路、慢跑、冲刺、蹲姿/蹲走、坐下/坐姿/起身、交互、舞蹈及三段跳跃骨骼动作。
5. 内嵌贴图，保存可编辑 Blender 工程及 GLB，记录实际骨架与姿态包围盒。

可重跑的准备脚本（需先解压上方两个 Quaternius ZIP）：

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
  --disable-autoexec --python-exit-code 1 \
  --python scripts/blender/prepare_human_asset.py -- --gender Male
# Female 同理
```

## 验收与边界

- 检查原 mesh 顶点数保持不变、骨角色完整、所有姿态坐标有限、贴图无缺失；输出 GLB 都有 65 个 skin joints 和 16 个命名动画，没有外部贴图/缓冲 URI。
- [男性审计](work/human-male-audit.json)、[女性审计](work/human-female-audit.json)记录每段动作的实际时长、腿长缩放及三个抽样帧的包围盒。
- `node scripts/check-human-assets.mjs` 使用项目真实 Three.js GLTFLoader、AnimationMixer 和 CPU 蒙皮读取两个 GLB，验证待机、走路、蹲姿、交互的姿态包围盒与 Blender 结果一致，动画并非重复占位。结果在 [threejs-validation.json](work/threejs-validation.json)。贴图像素由 Blender 实渲验证，Node 仅检查 PNG 尺寸，不假装完成浏览器渲染。
- [待机](preview/human-male-Idle_Loop.png)、[行走](preview/human-male-Walk_Loop.png)、[蹲姿](preview/human-male-Crouch_Idle_Loop.png)、[交互](preview/human-male-Interact.png)已从真实网格渲染，另有女性对照图。
- 本机预览服务已运行于 8818，页面及模块语法检查通过。当前没有可用的电脑控制浏览器，因此未完成页面按钮/滑块的浏览器自动交互验收。
- 目前为 FK/烘焙骨架，没有锁脚、双足运动控制器、关节医学角度限制或 Blender 控制 rig；坐姿需要外部座椅。
- 原地动画不包含应用的跳跃轨迹。当前姿态测量发现待机脚底约低于参考地面 1–2 cm，跳跃原地骨骼片段可低于参考面约 13 cm；不能宣称已通过运行时接地或跳跃验收。后续应使用 `_RM` 动画或运动控制器提供位移，并配合 foot IK 修正接触；不要把简单整体抬高当成锁脚。
- 当前模型没有 jaw、眼球骨、面部形状键或独立 twist 骨。完整五指与身体骨架可复用；面部表情及更精细的扭转控制需另行选资源或适配。
- 当前猫的四足步态、表情和运行模型未被替换。人形进入桌宠前需实现独立双足适配，不能把猫的腿链改名就当做人形。

## 许可原件

下载的 Quaternius Standard 包中 `License_Standard.txt` / `License.txt` 都明确标注 CC0，具体商品页也标注 CC0。
但作者[当前通用许可页](https://quaternius.com/license.html)已改为 QAL v1.0（2026-08-28），禁止资产包形式的独立再分发。
本次保留两处信息和包内许可原件，资产均作为本机工作材料，不在这里作公开再分发的授权承诺。
Kenney 的包内 `License.txt` 明确为 CC0；Cesium 样例的署名与标志说明保留在其下载目录。
