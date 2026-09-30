# 灵犀完整技术方案

版本：v0.1（按当前实现重写，2026-09-24）

这份文档描述**现在仓库里的灵犀**：一只安静住在 macOS 桌面上的实时 3D 小猫。它替代立项期那份「陪陪 Desktop Demo」草案。那份草案按预渲染序列、Blender GLB 和八个待机片段来规划第一版；产品已经改名，运行时也已经换成实时体素骨架。下文只写已经落地的结构和仍然有效的边界。

接口细节以专题文档和运行中的应用为准，不在这里再抄一份：

| 要查的事 | 权威来源 |
|---|---|
| Agent 契约、词汇表、反应映射 | [`19-agent-integration.md`](19-agent-integration.md)；运行时 `GET /integration` |
| 行为状态机的设计意图与尚未实现的部分 | [`04-life-engine.md`](04-life-engine.md) |
| 三层模块边界 | [`05-technical-architecture.md`](05-technical-architecture.md) |
| 主界面六页、托盘七行 | [`18-main-interface-design.md`](18-main-interface-design.md)、[`21-tray-menu-and-home-surface.md`](21-tray-menu-and-home-surface.md) |
| 皮肤导入 | [`20-arbitrary-png-skin-import.md`](20-arbitrary-png-skin-import.md) |
| 短毛骨架 v5（未接入应用） | [`22-character-v5-lookdev.md`](22-character-v5-lookdev.md) |

---

## 1. 产品

**灵犀**（Lingxi）的意思是心有灵犀。品牌短句是：**你忙你的，我在这里。**

它不是聊天窗口，也不是任务状态灯。用户不必持续喂养、对话或照料，桌面上仍有一只认得出的猫在自己过日子：沿屏幕边缘走动、停下做动作、躲开鼠标正在工作的地方；被逗就玩；Agent 干完活或做砸了，它按事情的心情接住，而不是跟着烦。

视觉基准是 [`assets/brand/lingxi-icon-v3.png`](../assets/brand/lingxi-icon-v3.png)：灰棕虎斑、暖白倒 V 脸、两只白色前爪、榛绿眼、小粉鼻。旧材料里的「陪陪 / Peipei」只保留为概念历史，不再是产品名。

### 体验原则

- **猫优先。** 温柔、独立、懒散、适度好奇。它不突然变成客服。
- **默认安静。** 主动说话、全屏特效和玩具都有预算。坏情绪接住，好情绪一起；私人的事陪着就好。
- **不妨碍工作。** 透明区域穿透，不抢焦点，随时能隐藏或退出。鼠标所在处是禁区，连落脚点都不往那儿选。
- **无网络仍能生活。** 作息、走动、抚摸、玩具都在本机。Agent 桥只监听回环。
- **报告事情，不指挥表演。** Agent 报 `state` / `kind` / `mood`，猫按用户可改的 `reactions.json` 决定表情和动作。

### 明确不做

完整 360° 游戏角色、攀爬真实窗口、喂养经济、多宠物、商城、账号云同步、读取屏幕或邮件内容、替用户批准 Agent 操作、把 LLM 当成生活闭环的前提。麦克风、全局键盘记录也不在范围内。

---

## 2. 总体架构

三层只通过契约通信，任何一层都可以单独换掉。

```text
packages/life-engine          纯行为状态机。没有 DOM、没有渲染、没有 Tauri。
        │                     只知道一个 2D 世界和一个光标。可单元测试。
        │  snapshot { state, position, heading, toy, vitals, ... }
        ▼
apps/lingxi/src               Three.js 场景。不知道桌面宿主的存在。
        │                     骨架 / 步态 / 导演 / 相机 / 皮肤 / 特效层
        ▼
apps/lingxi/src-tauri         窗口、托盘、设置持久化、本机 HTTP 桥
```

桌面壳把环境收成归一化事件交给行为层；行为层请求语义状态，不指定骨骼；渲染器按自己的能力把状态画出来。渲染器做不到的事（例如不会走）就忽略位移，引擎不因此改决策。

选这条结构的理由记在三份决策里：

- [001](decisions/001-realtime-desktop.md)：桌面端是真实网格和骨骼的实时渲染。预渲染只用于宣传和对照，不能拿图片平面冒充角色。
- [002](decisions/002-physics-and-game-libraries.md)：不引入 Rapier 或游戏框架。毛线球用解析式运动留在生命引擎里；逗猫棒尾端用 Verlet 绳。
- [003](decisions/003-multi-agent-arbitration.md)：多个 Agent 同时接入时，按**事件**的紧急程度仲裁，不按 Agent 身份。

运行时栈已经定下来，不再是「Tauri 或小奥式壳二选一」：

| 层 | 选型 | 说明 |
|---|---|---|
| 桌面壳 | Tauri 2 + Rust，macOS AppKit | 透明、无边框、置顶、托盘、穿透、开机相关能力 |
| 画面 | TypeScript + Three.js `^0.186`，WebGL2 | 正交相机。动画循环不走 React |
| 行为 | `packages/life-engine`，纯 JS | Node 里直接测 |
| 接入 | 本机 HTTP `127.0.0.1:47811` | CLI、MCP、宿主 hook 共用同一座桥 |
| 管理界面 | `management.html` + `management.ts` | 六个页面，不是猫窗口里的 UI |

第三方运行时依赖只有 `three` 和 Tauri 本体。Node.js 22+，Rust 版本由仓库里的 `rust-toolchain.toml` 锁定。

---

## 3. 仓库地图

```text
apps/lingxi/                 桌面应用
  src/                       渲染、动画、主界面、探针页
  src/data/                  内置骨架、动作、皮肤
  src-tauri/                 窗口、托盘、桥、配置目录
packages/life-engine/        行为状态机与生活变量
packages/mcp-server/         MCP 工具（13 个）
packages/contracts/          皮肤、性格、任务事件的校验
packages/perception/         感知契约的实现侧
packages/desktop-host-contract/
integrations/                CLI、skill、各宿主插件
  hosts/claude|codex|dsh|workbuddy/
  cli/lingxi
  schema/task-event.schema.json
assets/brand/                图标、设计变量
assets/characters/lingxi/    参考图、体素风格包、未接入的 v5 look-dev
presets/                     皮肤与性格预设
scripts/                     工程检查、Blender 构建（v5，不进应用）
docs/                        规格、决策、证据
```

开发与打包：

```sh
npm ci --ignore-scripts
cd apps/lingxi && npm ci
npm run tauri dev
npm run tauri build
```

`npm test` 跑全部包的单元测试。`npm run check` 查项目规范。渲染和步态不靠单元测试收口，靠 `apps/lingxi` 里的探针页（见第 10 节）。

---

## 4. 角色与渲染

### 4.1 现在画在桌面上的是体素骨架

应用内的猫由 `apps/lingxi/src/rig/skeleton.ts` 从 `src/data/skeleton.json` 生成：盒子拼成的关节体，枢轴在关节上，不在盒子中心。`anatomy.ts` 让相邻段在弯曲处重叠，躯干读起来是一整块，而不是一串分开的方块。

这条纪律决定了换体型的方式：步态、IK、姿势**不许写死尺寸**。段长、站立高度、关节位置都从建好的骨架读回来。皮肤可以用稀疏的 `proportions` 改盒子大小；短腿、大体型这类变化不用重写动画。`hiddenNodes` 可以拿掉某套剪影不需要的部位（例如耳或尾）。

脸不是一堆方块。眼、鼻、嘴、胡须画在贴花上，几何由 `face.json` 描述，默认值在 `rig/art.ts`。方块脸仍留着枢轴，供待机动画驱动，网格本身隐藏。

默认皮肤是 `honey-mittens`。内置九款，都在 `src/data/skins.json`：`apricot-letter`、`moon-oat`、`mist-blue`、`cocoa-snow`、`peach-cloud`、`ink-sesame`、`honey-mittens`、`silver-brook`、`calico-poem`。用户皮肤与内置 id 相同时，用户的那份生效。

一帧的叠加顺序写在 `renderer.ts` 开头：

1. 全身回到静止姿势
2. 不由自主的底噪：呼吸、眨眼、尾巴、步态
3. 当前表情带上的耳和头倾斜
4. 导演选出的动作片段，交叉淡入
5. 加法通道、姿势展开、爪子 IK、着地
6. 最后才放屏幕位置和朝向——因为第 1 步会清掉根变换

### 4.2 相机是正交的，角度按场合换

`rig/cameras.ts` 用正交相机。正交投影没有透视畸变，俯仰可以自由选；裁剪面放得很宽，浅角度不会把猫裁出屏幕。默认预设是 `game`（约 24°，经典 3/4）。另外还有仰视、平视、俯身、俯视，以及 `auto`：停下或被拖时切到平视，走动或玩玩具时切回 3/4。

灯光是角色自带的，不读取桌面像素来假装环境光。全屏特效是 DOM/SVG，全程 `pointer-events: none`，不会吞掉点击。

### 4.3 短毛骨架 v5 还不是这只猫

`docs/22-character-v5-lookdev.md` 和 `scripts/blender/` 在做一只可编辑的短毛网格（Blender 5.2+，约 47 根骨骼）。它**没有**批准为品牌母版，也**没有**导入 Three.js。花纹仍和图标对不上：模型偏均匀米白，图标是灰棕虎斑加白色脸纹。在花纹、闭眼和桌面小尺寸的柔软感过关之前，桌面上的灵犀继续用体素骨架。

Blender 母版里的 Groom 不能假设原样变成运行时毛发。真要换运行时角色，先过同一机位的对照，再谈导入。

---

## 5. 运动

这几条是稳定性的根，改动画之前先保住它们。

**朝向由引擎持有，不从位移反推。** 猫只能沿着 `heading` 前进。转向有角速度上限和最小转弯半径。朝向一旦变成位置的导数，位置抖动就会变成朝向抖动，再被透视放大。

**步态由走过的距离驱动，不是时钟。** `anim/gait.ts` 里，一个步幅的地面距离推进一个步态周期。支撑相的脚在世界坐标里静止，所以任何速度下都不打滑。步态是侧序行走（左后、左前、右后、右前），占空比约 0.62，同一时刻大致三只脚着地。腿链短且在矢状面内，用两骨闭式 IK，不用迭代求解器。

**落地高度是姿态的属性**，不是「这一帧哪只爪子最低」。

**边界按身体算，而且分两层。** 引擎操纵的点是脚，身体画在脚的上方。渲染器量出身体在屏幕上的实际跨度（`screenExtent()`），宿主给出两个盒子：

- **极限**：拖拽、玩具、全屏特效能到的地方，允许身体的一半出屏。
- **自由活动**：猫自己决定去哪。左右仍可露一半；上下则整只猫留在屏幕内。猫高大约是宽的三倍，同样的比例切在侧面是身侧，切在上面是脑袋，而表情是核心。

**躲鼠标会绕，不只是逃。** 选目标时避开光标；光标压上来就跑，而且一次逃跑目标至少保持约 1.4 秒，避免每帧重抽方向导致原地发抖。行进中若目标在光标另一边，瞄准禁区的切线绕过去，只改期望朝向，不改转向速率、过弯减速和步态。

已知的运动缺口：摆动中的爪子会低于地平面，最多大约 0.7 体素。桌面没有画地板，所以通常看不出来。完整解法是世界空间踩地锁定加双骨 IK。部分蜷缩动作（打滚、侧卧、挠耳朵）后腿和躯干有重叠，用 `probe-clips.html` 按严重程度看。

---

## 6. 行为

生命引擎的状态是：`idle`、`wander`、`dragged`、`ai_directed`、`play_toy`、`sleep`。

以前有过「工作模式 / 逗猫模式」。这个分裂是错的：用户把玩具放出来就是在玩，收起来就是让它自己待着。现在只剩自由活动。激光笔覆盖了旧「逗猫模式」里「追光标」那一件事，而且它是屏幕上的东西，不是菜单里的隐式状态。

### 6.1 自己过日子

猫沿屏幕边缘巡逻，有转弯半径，不是原地掉头。四条边不是等价的：macOS 上右边最空，左边次之，底下有 Dock，顶上是菜单栏。默认权重是右 1.6、左 1.15、下 0.7、上 0.25，左上角再额外惩罚。它更愿意沿着当前这条边继续走，而不是横穿屏幕中部——中部是人正在工作的地方。

停下才会做动作。休息被故意拉长，否则大部分时间都在走，看起来没有生活。

### 6.2 一天，而不只是循环

两个 0～1 的生活变量，按小时变化，不按帧：

| 变量 | 含义 |
|---|---|
| `energy` | 还能花多少。清醒时消耗，走路更快；睡觉恢复。低精力会走得慢、歇得久 |
| `sleepiness` | 有多想停下来。清醒时上升，夜里更快。越过阈值且已经安定约 6 秒，才躺下 |

二者分开：可以精神好但没体力，也可以休息够了但仍然犯困。夜里的峰值放在凌晨 3 点，模型的是陪在人身边的节奏，不是真实猫的晨昏活跃。一次 tick 对生活变量最多推进 15 分钟，合盖八小时不会让它瞬间累垮或瞬间睡饱。

人格五项滑杆进入引擎：`independence`、`curiosity`、`gentleness`、`playfulness`、`sleepiness`，都是 0～1，0.5 表示不偏。它们把已经调过的默认值弯一弯（大约 0.6～1.6 倍），不替换掉。

仍然只是设计、代码里还没有的：`comfort`、作为涨落量的好奇心、按生活变量打分的 Utility AI、动作级冷却和最短驻留、独立的情绪层、生活变量落盘。动作选择目前在渲染层的导演里。重启后生活变量从初值开始。

### 6.3 人和猫

鼠标停在身上会抬头看。来回摸会眯眼呼噜，双击会用头蹭。路过不算抚摸：接触要读成「是人伸过来的」，指针移动得比猫更多才算。猫自己走到静止光标上，不会当成被摸。

三个玩具，差别在于谁在移动它：

| 玩具 | 谁动 | 猫做什么 |
|---|---|---|
| 毛线球 `yarn` | 抛出后自己滚、减速、碰边反弹 | 追、拍，拍完可以自己继续玩 |
| 逗猫棒 `feather` | 跟着光标，带滞后 | 潜伏、立起来够、起跳，抓不住 |
| 激光笔 `laser` | 钉在光标上 | 追，拍了也没用 |

系统鼠标指针藏不掉，所以逗猫棒和激光笔画在光标位置上，不是替换指针。逗猫棒的软尾端是 Verlet 绳（`rig/rope.ts`），只影响画面，不影响猫追的那个点。

头顶漫画气泡钉在头骨投影上，蹲下、跳起、换视角都跟着。说话有预算：气泡大约每小时不超过三次，同一句不重复。

内置动作库在 `src/data/actions.json`，约 49 条，状态是 `playable-stylized`。片段用秒和弧度，相对静止姿势混合。导演负责选片、交叉淡化和安全切出；猫在走路时，动作推迟到停下再播。

---

## 7. 桌面壳

只支持 macOS。窗口、托盘、光标读取走 AppKit。多显示器下光标的 y 翻转只按主屏算，副屏会不准。

猫窗口：透明、无边框、置顶、不抢焦点。命中按角色区域，不是按整个窗口。透明处操作底层应用。拖动时暂停自主移动，松手后落在安全区域。隐藏、锁屏或系统睡眠时停掉无意义的渲染和决策；退出优先于任何动画。

托盘是随手照看，不是功能目录。七行：状态摘要两行、显示/隐藏、大小（小/中/大）、互动（逗一逗 / 收起玩具）、打开灵犀…、退出灵犀。调试台从主界面的设置进入。

主界面是 960×680 逻辑像素的管理窗（最小 860×620），侧栏六页：

| 页 | 干什么 |
|---|---|
| 首页 | 先看见猫在窗边，再看状态和任务摘要 |
| Agent 接入 | Claude / Codex / DSH 的折叠面板、权限、任务流 |
| 性格行为 | 人格滑杆和相关预设 |
| 玩法 | 玩具与互动 |
| 外观 | 大小、皮肤；可把内置资源导出成可编辑模板 |
| 设置 | 通用、MCP、大脑（LLM 控件在，后端未接）、调试入口 |

顶栏是当前页名、大小、找回猫咪。没有全局「工作 / 逗猫」开关，也没有免打扰时段。

配置在：

```text
~/Library/Application Support/com.dushaobin.lingxi-desktop/
```

桥的 token 在该目录的 `bridge-token`，权限 `0600`。应用每次启动把 CLI 写到同目录的 `bin/lingxi`。标识是 `com.dushaobin.lingxi-desktop`。

---

## 8. 接 Agent

桥只听 `127.0.0.1:47811`。回环是网络边界，不是信任边界：本机任何进程都能连上来，所以除 `GET /health` 外都要 token。token 放在 `Authorization: Bearer` 或 `X-Lingxi-Token`，不要放进 URL。

三种接法打到同一座桥：

| 路径 | 谁触发 | 知道心情吗 |
|---|---|---|
| 宿主插件 / hook | 宿主，确定性 | 看不到内容，`mood` 留空，应用按 `focused` |
| skill + CLI | 模型自己决定用不用 | 能判断 `mood`，这是接入里最有价值的字段 |
| MCP server | 模型，带类型 | 同上。CLI 是它的超集 |

插件保证「有事发生就有反应」；skill 让反应知道这件事是关于什么的。适配器不猜心情。

正确的一跳是：

```bash
lingxi task <state> <kind> <mood> "一句话"
```

`state` 取 `queued` `running` `blocked` `needs_input` `needs_approval` `completed` `failed` `cancelled`。`kind` 取 `build` `test` `deploy` `review` `search` `write` `chat` `other`。`mood` 取 `focused` `proud` `tender` `sad` `frustrated` `anxious` `weary` `playful` `curious`。

`running` 的进度只有第一次和跨过 50% 会产生可见反应，终态不会被吞。优先级按事情：`alert` 可以打断，`report` 排队，`status` 和 `ambient` 在忙时丢掉。多个 Agent 各自注册一个小 logo，显示在气泡上，随气泡消失。冲突时失败高于完成，完成高于状态，状态高于氛围。

MCP 的十三个工具：`lingxi_register`、`lingxi_task`、`lingxi_capabilities`、`lingxi_state`、`lingxi_say`、`lingxi_express`、`lingxi_perform`、`lingxi_play`、`lingxi_remember`、`lingxi_recall`、`lingxi_remind`、`lingxi_look`、`lingxi_reload_assets`。

主要 HTTP 路由：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/health` | 免鉴权。应用是否在、CLI 路径、token 文件在哪 |
| GET | `/integration` | 当前契约和生效中的反应映射 |
| GET | `/status` `/capabilities` `/agents` `/activity` | 外观、能力、谁在驱动、最近活动 |
| POST | `/task-event` `/intent` `/control` | 任务、高层意图、低层控制 |
| GET/POST | `/memory` | 读回和写下记忆 |
| GET/POST/DELETE | `/reminders` | 提醒 |

记忆只有四类：`owner`、`project`、`preference`、`moment`。明文 JSON，不写密码、健康和财务细节。提醒可以带心情和重复间隔，最短五分钟；同时到期只说一条。

写记忆和提醒要带身份。`X-Lingxi-Agent` 优先，否则用 body 里的 `agent`。档位是 observer / performer / trusted，外加字段白名单和每分钟写入次数限制。猫对 Agent 的任务只观察：不批准、不取消、不代答。

应用没开时，CLI 的 `lingxi up`、MCP 的会话开始、Claude 的 SessionStart、DSH 插件都会用 `open -g` 在后台拉起，不抢焦点，每个进程只试一次。`LINGXI_AUTOSTART=0` 表示这次不要开。接不通先跑 `lingxi doctor`。

直接 `POST /control {"action": ...}` 仍然开放，给调试用。日常接入不要自己点动作名。

---

## 9. 可改的资源

主界面 → 外观 → 「导出内置资源为模板」，写到上面的配置目录：

```text
assets/
  actions.json
  expressions.json
  skins.json
  reactions.json
  bubble.json
  face.json
  textures/*.png
  README.md          应用自己写的格式说明
```

每个文件先完整校验再生效。格式不对就留着内置版本，界面上指出具体错误，不会出现半张脸或关节拧断。动作和表情文件是整份替换：Agent 要加一条时，必须先知道用户是否已经改过这份文件，否则会把用户写的清掉。`/capabilities` 会标明每条的 `source`。

手绘身体图集和表情图可以换。任意 PNG 皮肤的约束见 `docs/20`。ZIP 资源包和 Minecraft 皮肤转换器还没有。

---

## 10. 怎么确认它还是好的

```sh
npm test
npm run check
cd apps/lingxi && npx tsc --noEmit && cd src-tauri && cargo test
```

`npm run dev`（在 `apps/lingxi`）之后，这些页面不进打包产物：

| 页面 | 用途 |
|---|---|
| `/app-harness.html` | 不经 Tauri，走真实渲染路径 |
| `/probe-gait.html` | 身体抖动、脚底打滑、自由活动统计 |
| `/probe-clips.html` | 逐个动作查穿模 |
| `/probe-framing.html` | 各视角、各尺寸下四边裁掉多少 |
| `/probe-unproject.html` | 屏幕坐标和世界坐标是否可逆 |

改动画系统之前先看 `probe-gait.html` 头部的健康值。

Agent 侧的自证是 `lingxi state`、`lingxi status`、`lingxi agents`。单次采样看到的 `action` 可能是上一个自主动作：走路时新动作会推迟。看到 `stage busy` 就丢掉，不要重试。

---

## 11. 边界与还没做完的

已经能在日常里用。下面这些是现在的边界，不是路线图上的愿望清单：

- 只有 macOS。Windows 没有承诺。
- 副屏光标坐标不准。
- 支撑相以外的爪子可能略微低于地平面；部分蜷缩动作有重叠。
- 系统指针不能隐藏。
- 生活变量不落盘。Utility AI、动作冷却、舒适度还在设计里。
- 主界面的 LLM「大脑」控件是禁用的，没有后端。
- 陪伴时长没有可靠累计，首页该项隐藏。
- Agent 没有心跳，只能看到「已登记 / 最近有报告」，不能判断断连。
- DSH 接入是手工步骤，没有一键按钮。
- 气泡的居中方式和 icon 位置还没有配置字段；多色只有正文色和强调色。
- 外观页的皮肤是色块，不是统一镜头下的角色缩略图。
- 短毛 v5 未接入。在它同时满足花纹、小尺寸轮廓和性能之前，体素骨架就是产品角色。

性能不写跨机器的 CPU/GPU 百分比保证。要验收时，在指定芯片、内存、缩放和接电状态下，分别量静息、互动和隐藏，并对照无猫基线。隐藏和锁屏应暂停渲染。
