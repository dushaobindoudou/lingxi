# 灵犀宿主通知检查 · 2026-10-09

范围：本仓库全部六个宿主，检查安装产物、事件解析、回复来源、等待用户与共存去重。
修复集中在宿主适配和脚本，无需重编译桌面应用。

| 宿主 | 复现的问题 | 修复 |
|---|---|---|
| WorkBuddy | 安装为 Claude 解析；Stop 无直接回复时静默；缺字段等待事件缺少可靠兜底 | 独立 workbuddy 分支；按原生 transcript 取最终 `output_text`；缺失时发结束提示；安装补事件参数与 StopFailure |
| WorkBuddy | 插件和 settings 同时安装会重复投递 | 插件按具体事件检测新 settings 命令并让位，不让旧 Claude 配置关闭新兜底 |
| Cursor | 只装 stop，拿不到回复；开始/结束文档与行为不一致 | 安装 `afterAgentResponse` 并使用其 `text`；正常 stop 让位，避免覆盖末尾问题形成的 needs_input；旧配置兼容 |
| Cursor / Codex | Dock 的有限 PATH 找不到 Node，脚本静默不投递 | 运行时查找 `LINGXI_NODE`、PATH、Homebrew、nvm 等；Codex 旧 fanout 重装可升级并保留原通知程序 |
| Codex | notify 只报结束，插件却连 UserPromptSubmit 也跳过；合法 JSON 空格使回复字段重命名失效 | 保留 running hook；回复字段重命名接受空格 |
| Claude | settings 只装 Stop 时，插件连没有对应配置的权限/开始事件也跳过 | 用系统 plutil 按具体事件检查是否已有投递命令；检查失败时由插件投递 |
| Codex | notify 文件名包含 lingxi 即被视为已经通知猫，误抑制 Stop | 仅识别已知 emit / loopback 命令，fanout 检查实际脚本标记 |
| 豆包 | 回合监听遇到缺失 trajectory 回复时只有静默 completed | 发「这一轮结束了」，summary 明确标出无可用回复文本；保留模型报告去重 |
| 通用适配器 / 豆包 | 长回复只留开头，会丢失末尾等待用户的问题 | 4000 字符预算内保留开头结论和结尾 |
| DSH | 任务工具主路径未发现同类字段丢失 | 维持模型主动报告；本插件没有宿主回合 hook，不能保证模型未报告时也出声 |

回复正文始终只放在 display-only `result`，不放入 hook 的持久 summary。开始事件不转发 prompt。
「这一轮结束了」只说明回合结束，具体任务是否成功仍由模型稳定 taskId 的终态报告决定。

## 回归验证

先运行并观察新增测试失败，再修改实现。覆盖真实 emit 子进程与 HTTP 边界、宿主 shell 包装器、
安装/重复安装/卸载重装、部分安装、有限 PATH、原生 transcript、权限缺字段和长回复。

```sh
npm run check
node --experimental-strip-types --test --test-concurrency=1 packages/*/test/*.test.mjs apps/lingxi/test/*.test.mjs integrations/test/*.test.mjs
```

采用串行运行，避免全并行负载撞到 hook 与启动测试的固定时间预算；保留生产脚本的原有超时。
最终结果：**238 项通过、0 失败、0 跳过**；`npm run check` 与 `git diff --check` 均通过。
具体输出见本次验证日志 `/tmp/lingxi-final-tests.log`。

## 本机安装与实际桥接

- 已重跑 WorkBuddy、Cursor、Codex 安装器；变更前另存 `*.bak-lingxi-hook-fix-*` 快照。
- Codex 原 notify 包装器经前后比较保持一致，升级的是已有 fanout；没有取消原通知链。
- 豆包无进行中回合时重启已安装的 LaunchAgent，加载新监听代码。
- 执行本机 WorkBuddy settings 生成的命令：running、needs_approval、空文本 Stop、原生回复 Stop 均被实际应用记录；task-events.log 的反应为 `spoke`，包含 `say` 且无 rejected。
- 执行本机 Cursor hooks 生成的命令：回复末尾问题变 needs_input；之后 completed stop 不增加事件、不覆盖等待；新回复能正常 completed 并产生 `say`。
- 上述是安装命令到实际应用的冒烟，不等于宿主 UI 自动触发验收。尝试读取 WorkBuddy 窗口时，电脑控制的 Accessibility / Screen Recording 权限仍 pending，未完成普通任务/真实弹窗的 UI 自动测试。
- Cursor 当前公开事件没有通用权限弹窗通知；执行前 hook 不能证明弹窗出现，不把所有工具调用伪装成 needs_approval。需模型主动报告此类等待。
- 豆包日志监听属于未公开的宿主内部格式；宿主升级不再写相同行时，适配器无法自行补出事件。

## 契约来源

- [CodeBuddy 官方 Hook 输入](https://www.codebuddy.cn/docs/cli/hooks)：Stop 示例没有 last_assistant_message，提供 transcript_path 等公共字段；WorkBuddy 原生记录另以本机 5.7.7 文件结构核对。
- [Cursor 官方 Hooks](https://cursor.com/docs/hooks)：afterAgentResponse.text 与 stop.status 是不同事件的字段。
- [Claude 官方 Hooks](https://code.claude.com/docs/en/hooks)：Stop 提供 last_assistant_message，权限与 Notification 单独映射。
- Codex 的 notify 与原生插件格式沿用仓库既有实现和测试；DSH 为仓库中的任务工具实现。
