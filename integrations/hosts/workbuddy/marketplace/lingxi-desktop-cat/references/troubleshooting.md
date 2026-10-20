# 排障：猫没反应的时候

按可能性从高到低查。每一步都先拿事实，再下结论。

## 一、先跑体检，不要猜

```bash
bash scripts/check.sh
```

它只读：不下载、不安装、不启动、不写文件。最后一行 `RESULT:` 是结论。

| RESULT | 真实原因 | 怎么办 |
|---|---|---|
| `ready` | 环境完整，桥接在跑 | 直接调用命令 |
| `app-not-running` | 应用装着，当前没开 | 调一次 `scripts/lingxi.sh`，它会拉起 |
| `app-missing` | 没有安装 | 给用户下载页与安装步骤，等他自己装 |
| `app-not-started` | 装了但从没启动过，CLI 还没生成 | 让用户打开一次，或调 `scripts/lingxi.sh` |
| `token-missing` | 桥接 token 没生成 | 同上一行 |
| `unsupported-os` | 不是 macOS | 直接说明不支持 |

`scripts/lingxi.sh` 返回 127 时，把它的输出原样读一遍——脚本已经把「不是 macOS / 没装 /
装了没启动」分开写清了，照着它最后三行做即可。

**不要**替用户下载 dmg、挂载、或复制 `.app`。安装是用户的选择动作，你只负责把话说准确。

## 二、命令能跑，但猫毫无反应

```bash
bash scripts/lingxi.sh doctor
bash scripts/lingxi.sh state
bash scripts/lingxi.sh agents
```

- `doctor` 会逐项说哪一项没过，按它说的做。
- `state` 里 `expression` / `intent` 变了但屏幕没变：先看 `visible`（`lingxi status`）——
  用户可能把猫隐藏了。隐藏是用户的选择，不要改回来。
- `agents` 里没有 `workbuddy`：说明署名还没注册。**不要跑 `register`**（会覆盖用户的配置），
  让用户在灵犀主界面「Agent 接入」里补一次。

### 猫有反应，但只在你叫它的时候

这是**少了 hooks**，不是技能故障。每轮开始/结束本来可以由宿主自己触发，没装 hooks 时就只能
靠模型主动上报——你不报，它就不动。

```bash
bash scripts/check.sh   # 看有没有「会话 hooks 已安装」
```

- 没有：告诉用户这是可选增强。想升级就给一条路——在 WorkBuddy 里
  `/plugin marketplace add dushaobindoudou/lingxi` + `/plugin install lingxi@lingxi`，
  或按仓库 README 跑一次 `install.sh`。
- **不要自己往 `~/.workbuddy/settings.json` 里写 hook**，那是宿主配置。
- 显示已安装但没触发：确认 WorkBuddy 版本 ≥ 5.6（hooks 从这版开始），然后新开一轮会话再试。

## 三、返回 `stage busy`

**丢掉，不要重试。** 舞台被另一个会话或玩具占着，等它空出来时你那句话已经是历史了。
这也意味着同一时刻只有一个 Agent 能说话，这是设计，不是故障。

## 四、动作被拒 / 提示需要 trusted

`skin`、`camera`、`scale`、`visible`、备忘录、提醒这类能力需要用户授权。被拒绝就是答案：

- 换条路走，不要重试同一条。
- **不要写 `~/.lingxi/agent-permissions.json`**——那是 Agent 给自己发权限，设计上禁止；
  而且那份文件只在启动时载入，手改要重启应用才生效。正路只有让用户在
  「主界面 → Agent 接入 → 权限」里给。

## 五、动作看起来"没播"

动作有延迟是正常的：猫在走路时，动作会推迟到它停下才播。单次采样看到的 `action`
可能是**上一个**自主动作。隔几秒再 `state` 一次，不要据此判定失败然后重发。

## 六、报错说 state / expression 不存在

- `task` 的 `state` / `kind` / `mood` 是固定枚举，拼错会明确报错（这是好事）。
- 动作、表情、特效的 id 来自**用户可编辑的 JSON**，不同机器不一样。
  调用前先 `bash scripts/lingxi.sh capabilities`，用返回列表里的 id，不要硬编码。
- 用户改过资源后可能需要 `bash scripts/lingxi.sh reload`，再看 `assets` 的 `lastErrors`。

## 七、用户说"关掉它"

`LINGXI_AUTOSTART=0` 或用户直接在应用里退出，都是明确意愿。照实说明，不要绕过去，
也不要反复尝试启动。这个技能里没有任何一步需要强行拉起应用。

## 八、不要做的四件事

1. 不要 `lingxi update` —— 升级由用户决定。
2. 不要改 `skin` / `camera` / `scale` / `visible` —— 那是用户偏好。
3. 不要为了"修好"去改任何配置文件或权限文件。
4. 不要把一次失败说成成功。拿不到证据就说拿不到。
