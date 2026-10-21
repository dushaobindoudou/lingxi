# WorkBuddy 技能市场发布包

这里是灵犀在 **WorkBuddy 技能市场**上架用的产物，和隔壁的 `../plugin/`（marketplace 插件包）
不是一回事：插件能带 hooks、能自动装应用；技能包只能带 SKILL.md + 脚本 + 资料。

```
marketplace/
├── PUBLISH-GUIDE.md              # 发布流程：账号 → 打包 → 提交 → 审核 → 发布 → 验证
├── README.md                     # 本文件：结构、边界、维护
├── pack.sh                       # 打包 + 四项前置校验
├── avatar-512.jpg                # 平台头像（512×512，44 KB）
├── dist/                         # 产物，dist/ 在 .gitignore 里
│   ├── lingxi-desktop-cat-v1.0.1.zip        # 首选：{skill}/SKILL.md
│   └── lingxi-desktop-cat-v1.0.1-flat.zip   # 备选：SKILL.md 在根
└── lingxi-desktop-cat/
    ├── SKILL.md                  # 发布版技能定义（自包含，不引用宿主层）
    ├── references/
    │   ├── cli-reference.md      # 命令、枚举、优先级、预算
    │   └── troubleshooting.md    # 猫没反应时的排查顺序
    └── scripts/
        ├── check.sh              # 只读体检：装没装、启没启动、桥通不通
        └── lingxi.sh             # 定位 CLI + 拉应用 + 转发参数
```

## 为什么是"改写"而不是"拷贝"

现有两份 skill 面向的是**已经跑过 `install.sh` 的人**：

| 现有 skill | 里面写了什么 | 为什么不能直接发 |
|---|---|---|
| `integrations/skills/lingxi` | 系统层，但反复出现「宿主层写着…」「插件负责安装」 | 市场上装技能的人没有宿主层 |
| `integrations/hosts/workbuddy/skills/lingxi-workbuddy` | hooks 已装好、MCP 信任闸门、额度守卫 | 技能包不装 hooks、不带 MCP，这些前提不成立 |

所以 `lingxi-desktop-cat/SKILL.md` 是**按同样的行为契约重写的自包含版本**：
去掉所有"宿主层会告诉你"的分叉，把"先查环境、没装就征得同意后代为安装"写进正文，
并新增 `scripts/lingxi.sh` 解决 CLI 不在 PATH 上的问题。

## 必须与系统层一致的（行为契约）

改这些的时候两边一起改，否则同一个 Agent 在不同接入方式下表现不一样：

- `state` / `kind` / `mood` 的**枚举值**
- mood 的语义（"判断的是这件事的心情，不是你的把握程度"）
- 「坏情绪接住、好情绪一起」的回应原则
- `summary` 最多 140 字、结论在前、复用同一个 `taskId`
- 预算表（气泡 / 表情 / 动作 / 特效 / 玩具）
- `stage busy` 丢弃不重试
- 不改 `skin` / `camera` / `scale` / `visible`

## 故意不同的（发布版特有）

| 差异 | 原因 |
|---|---|
| 没有「宿主层」概念 | 技能市场里只有这一份，模型读不到第二份 |
| 正文要求先跑 `scripts/lingxi.sh doctor` | 没有插件替它检查应用 |
| 不在后台自动安装；问一句、同意后才跑 `scripts/install.sh` | 用户不会自己去 GitHub 找 dmg；但下载安装是对用户机器的动作，必须先得到同意 |
| 不写 hooks / MCP / 信任闸门 | 技能包没有这些能力，写了就是误导 |
| 命令统一写成 `bash scripts/lingxi.sh ...` | CLI 不在 PATH，且技能目录位置由平台决定 |
| `LINGXI_AGENT` 默认 `workbuddy` | 在 WorkBuddy 里跑，署名应与宿主一致 |

## 检查与安装分开：`check.sh` 只看，`install.sh` 经同意才装

`scripts/check.sh` **只观察，不动作**：不下载、不挂载、不复制 `.app`、不写任何宿主配置、不启动应用。
它把「到底缺什么」分成六种结论，写在最后一行：

| RESULT | 含义 | 谁来解决 |
|---|---|---|
| `ready` | 环境完整，桥接在跑 | — |
| `app-not-running` | 装了，当前没开 | `lingxi.sh` 会拉起一次 |
| `app-missing` | 没装 | 模型问一句，**用户同意后跑 `install.sh`** |
| `app-not-started` | 装了但没启动过，CLI 还没生成 | 用户打开一次，或 `lingxi.sh` 拉起 |
| `token-missing` | 桥接 token 没生成 | 同上 |
| `unsupported-os` | 不是 macOS | 说明不支持，不找替代 |

为什么要单独一个脚本，而不是直接用 `lingxi doctor`：**CLI 本身是应用首次运行时才写出来的**，
而"没装 / 装了没启动"恰恰是最需要诊断的两种情况——那时候 `doctor` 根本跑不起来。
`check.sh` 不依赖 CLI，用文件系统、`Info.plist` 和 `/health` 就能判断。
两者分工：应用没装或没启动用 `check.sh`；已经在跑、要看更深的前置条件时用 `doctor`。

安装由 `scripts/install.sh` 负责：它把宿主身份定成 `workbuddy`，再调用同目录的 `install-app.sh`
（`integrations/shared/install-app.sh` 的逐字副本，与各插件同一份）：从 GitHub Releases 取最新版，
校验 SHA256、bundle id 与代码签名，复制到旁边再原子替换，然后打开。`SKILL.md` 要求模型**先问一句、
用户同意后才跑**，失败才退回下载页；不许自己拼 curl / hdiutil，也不许在成功前说「已经装好了」。
`integrations/test/marketplace-package.test.mjs` 守着 `check.sh` 只读，`shared-copies.test.mjs` 守着副本不漂移。

## 改完怎么验

```bash
./pack.sh                                      # 四项校验 + 出包
bash lingxi-desktop-cat/scripts/lingxi.sh doctor
bash lingxi-desktop-cat/scripts/lingxi.sh state | head
```

`doctor` 全绿、`state` 能返回 JSON，说明脚本这条路是通的。
真机验证要覆盖三种情况：应用在跑、应用装了没跑、应用没装（最后一种看脚本的提示对不对）。

## 和插件的关系

两条路可以同时存在，**不会双发**：

- 技能只调用 CLI，从不写 `settings.json`；
- hooks 只由 `../install.sh` 或 `../plugin/` 写；
- 用户装了技能又装了插件时，hooks 负责生命周期，技能的 `task` 负责终态和心情，
  应用侧本来就会对同一事件去重。

分发策略建议见 `PUBLISH-GUIDE.md` 第七节。
