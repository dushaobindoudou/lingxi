# 灵犀 · WorkBuddy 插件包

装上即得：桌宠对每轮对话的**确定性反应**（hooks）+ 模型可用的**任务与心情上报**（skill）。
本目录是 marketplace 安装的自包含副本——skills 与适配器从 `integrations/` 拷入，
**改了源头记得同步**（见文末）。

## 用户安装

```sh
# 1. 添加市场（= 本仓库的 GitHub 路径，仓库改名后同步更新这两条命令）
/plugin marketplace add <owner>/lingxi

# 2. 安装插件
/plugin install lingxi@lingxi

# 3. 验证
/reload-plugins
lingxi events | tail     # 结束一轮对话后应出现 workbuddy 署名的 running/completed
```

装完后：

- **hooks**：`UserPromptSubmit`→running、`Stop`→completed 自动生效，实时加载，无需重启会话
- **skill**：`lingxi`（任务上报与心情）与 `lingxi-authoring`（自定义动作/表情/皮肤）出现在可用 skill 列表
- **身份**：机器级 `~/.lingxi/agent.json`（id=workbuddy）——首次反应时若该文件不存在，
  会以 fallback 徽章出现；跑一次本仓库的 `integrations/hosts/workbuddy/install.sh`
  即可补齐署名、MCP 与真实图标 logo

## 设计边界

- 装四个事件：`UserPromptSubmit` / `Stop`（会话生命周期）+ `Notification` / `PermissionRequest`
  （agent 弹出权限提示或提问、在等用户）。**只装生命周期那两条时弹窗完全不会被覆盖**——
  这就是"WorkBuddy 弹了个东西，猫却没反应"的原因
- **不要加 `PreToolUse` / `PostToolUse`**：每次工具调用都触发，会把猫变成通知轰炸
- `SessionStart` 是有的（实测会触发），只是我们没装——它只能报 `queued`，价值不大
- hooks 报不出 `mood`（适配器故意不猜）；想让猫懂内容，靠 skill 里的 `lingxi task` 上报
- **MCP 不随插件分发**：用户级 `~/.workbuddy/mcp.json` 若已配过 lingxi，插件再带一份
  `.mcp.json` 会撞 server id；且 WorkBuddy 的信任按配置哈希记账，见上层 README 的
  「信任闸门」与「env 是毒药」两节。需要 MCP 时走 install.sh 或按 README 手动配置

## 维护者：同步源头

```sh
cd integrations/hosts/workbuddy/plugin
cp ../../../adapters/lingxi-emit.mjs          bin/lingxi-emit.mjs
cp ../../../skills/lingxi                     skills/   # 共享基础能力
cp ../../../skills/lingxi-authoring           skills/
cp ../bin/lingxi-quota-guard.mjs              bin/     # 额度守卫
cp ../skills/lingxi-workbuddy                 skills/   # 宿主定制层，源在 hosts/workbuddy/skills/
```

`lingxi-workbuddy` 的源**不在** `integrations/skills/`——它是这个宿主私有的，
所以路径是 `../skills/` 而不是 `../../../skills/`。漏同步它会让 marketplace 包里
缺掉信任闸门那几条规则，而那正是模型最容易踩的坑。

改了 `adapters/lingxi-emit.mjs` 或 `integrations/skills/` 之后跑一遍，再 bump
`plugin.json` 与 `marketplace.json` 的版本号。

## 许可

本插件随主仓库以 **PolyForm Noncommercial 1.0.0** 发布：非商业用途免费；
商业使用需另行授权，见仓库根 [LICENSE.md](../../../../LICENSE.md)。
（marketplace 安装后的副本不含此相对路径，请以安装页/仓库主页上的许可说明为准。）

**来源标注义务**：任何使用、修改、分发或基于本插件/本软件的衍生项目，必须在面向
最终用户可见的显著位置标注来源「灵犀 lingxi」并附仓库链接
<https://github.com/dushaobindoudou/lingxi>——详见仓库根 LICENSE.md 的
「来源标注（附加条件）」一节。
