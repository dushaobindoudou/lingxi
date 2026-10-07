# 更新日志

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。版本号遵循语义化版本。

这个文件从立起来的这一天开始记。更早的变化在 git 历史里，不在这里补写。

## [Unreleased]

### 新增

- **任何一条接入都会自己把应用装上。** 发现 Mac 上没有灵犀时，从 GitHub Releases 下载最新版，校验
  SHA256、bundle id、代码签名后装进「应用程序」并打开；装了就复用，数据跨重装保留。覆盖：Claude Code /
  Codex / WorkBuddy 插件的会话开始、MCP server 被宿主连上时、`lingxi up`、各宿主 `install.sh` 的第 0 步。
  `LINGXI_AUTOINSTALL=0` 关闭。共用的脚本在 `integrations/shared/`（每个插件带逐字副本，测试守着）。
- **Codex 原生插件**（`integrations/hosts/codex/plugin/`）：`codex plugin marketplace add dushaobindoudou/lingxi`
  后 `codex plugin add lingxi@lingxi`。hooks 报会话开始、提交消息、等授权、回合结束，署名 codex；带 skill 两层
  和 MCP。仓库根新增 `.agents/plugins/marketplace.json`——没有它，Codex 会把 Claude 插件装给 Codex 用户。
- **npm 包 `lingxi-mcp`**：`npx -y lingxi-mcp` 即可给任何 MCP 宿主接上灵犀，不需要克隆仓库；附带 `lingxi` 命令行。
- WorkBuddy 插件新增 SessionStart：会话开始时自动安装 / 打开灵犀。
- `lingxi update`：任何宿主都能把已装的应用升级到最新 release（同一个安装器的 `--update`，数据保留）。

### 修复

- 两个宿主同时开第一个会话会各下载一次、互相替换同一个应用：安装锁改为全机唯一（`~/.lingxi/install.lock`）。
- 安装器在"找不到已装应用"时（Spotlight 还在建索引、路径被覆盖）会下载并覆盖目标位置已有的灵犀：
  现在只有 `--update` 会替换已装的应用。
- `lingxi up` 和 MCP server 在应用没装时只会说"去自己编译"：现在给出下载地址，或直接安装。

## [0.3.0] - 2026-09-30

### 新增

- 猫会对 agent 活动醒来：每条任务事件（含被吞掉的进度）都会打开生命引擎的"家中活动"窗口
  （`activityPulse`，90 秒滚动窗口，逐事件顺延）。窗口开着时睡着的猫立刻醒来、醒着的猫不再躺下；
  停止汇报后窗口自行过期，困意照常积累，猫才重新入睡——睡觉只出现在没有活动的时候。
  因活动醒来的猫按 `curiosity` 个性概率起身短途踱步（默认 50%，好奇的猫更爱去看一眼）。
  窗口状态经 `GET /perception` 的 `agentBusy` 暴露。docs/19 中英同步。
- 需要你处理的事当场通知：Claude Code 弹出授权、选择题（AskUserQuestion）、计划审批时立刻提醒，
  并说清要批什么（「想跑：清理构建目录」「想改 lib.rs」「用哪个方案？」）；回复以问句结尾时按
  "等你回答"提醒，不再当成"做完了"。同一件事 10 分钟内不重复叫。新接入 `PermissionRequest`、
  `TaskCompleted`、`SessionEnd` 三个 hook；已经一键接入的机器在新版首次启动时自动补上一次（有备份，
  之后删掉的不会再加回来）。
- 一轮结束时猫说这一轮的结论（取回复第一句），不再是「本轮回复结束」。回复内容只在本机用来生成这句话，
  不写盘、不进事件日志、不发给通知 webhook。
- 菜单栏图标旁显示待处理数（等你授权/回答/出错）；猫被隐藏时，这些和到期提醒改发系统通知。
- 主界面首页「提醒与日程」：列出所有提醒，可取消，也可以直接添加（支持每天重复）。
- `lingxi remind 09:30 "…" --every 1440` 支持时间点；`lingxi reminders` 列出提醒；MCP `lingxi_remind`
  支持 `mood` 和 `repeatEveryMinutes`。
- 事件日志：`logs/task-events.log` 记录每个事件的字段结构和猫的反应（只记长度，不记正文）。

- 托盘菜单重新整理：「打开主界面」放到最上面；新增「玩具」子菜单（毛线球 / 逗猫棒 / 激光笔 / 收起）
  和「特效」子菜单（愤怒抓屏 / 飞奔亲亲 / 半夜暴走）；「有 N 个任务需要留意」可点击，直接打开主界面。
- 各宿主的 skill 改为按宿主分层：claude / codex / cursor / doubao / workbuddy 各有一层
  `lingxi-<host>/`（宿主专属的用法说明），共享内核仍在 `integrations/skills/lingxi/`，安装脚本
  会两层一起装。WorkBuddy 新增配额护栏（读它本地的会话用量，上下文快满时猫先提醒）；豆包新增
  `lingxi-doubao-watch` 观察器（豆包没有 hook，读它自己的日志补上任务开始/结束）。
- Codex 的接入对齐 Claude 的会话语义：每个会话一行、会话名取工作目录，回复以问句结尾按
  "等你回答"提醒；一键接入时顺带把 skill 装进 `~/.codex/skills`（已有内容不会覆盖）。
- WorkBuddy 的标识从占位圆形重画成真实的猫脸矢量；`integrations/hosts/PLUGIN-STANDARD.md`
  落成文，新宿主照着接。

### 修复
- 托盘打开主界面有时要点两次：新建的窗口没有被提到前面，落在当前应用后面。macOS 14 起激活是协作式的，
  现在用 `orderFrontRegardless` 直接把窗口提到最前。
- 主界面左侧菜单只剩图标、没有文字（挂图标时把按钮文字整个替换掉了）。
- 同一个 agent 在气泡和主界面里的图标不一致：两边改用同一条规则（已知工具用内置图标，其它用它登记的
  logo，都没有才用字母徽章）；权限表、调用日志、提醒来源不再显示原始 id。
- 主界面清理：去掉面向开发者的说明（取值白名单、`packages/mcp-server`、"后续工作"等）和未实现的
  「LLM 增强」占位；玩具/特效卡片铺满整行并标出当前玩具；「说出来」没写内容时不可点、说完有反馈；
  「隐藏」改为「隐藏猫咪 / 显示猫咪」。

- Claude Code 的事件以会话 UUID 当身份：气泡上是灰色两字母方块、没有图标，主界面对不上 Claude。
  现在身份固定为 `claude`，会话名取 Claude Code 自己的标题（`/rename` 优先），每个会话一行。
- 气泡署名不会过期：任何 agent 说过一次话后，之后所有气泡（包括提醒、摸猫时的台词）都带着它的署名。
- 登录成功等不需要处理的通知被当成"在等你"。
- 提醒在人不在电脑前时说完即作废；现在等人回来再说。
- 每天重复的提醒会漂移到应用下次启动的时间；现在按原定时刻走，错过的直接跳过。
