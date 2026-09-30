#!/bin/bash
# open-in-doubao.sh — 一键唤起豆包客户端，并把「灵犀接入向导」粘进新工作任务的输入框。
#
# 为什么是这个形态：豆包桌面端（com.bot.pc.doubao）没有注册任何 URL scheme
# （Info.plist 的 CFBundleURLTypes 为空），所以 doubao:// 带参数的唤起链接不存在。
# 这里用 macOS 原生能力：唤起应用 → ⌘N 新建工作任务（豆包 2.30.4 快捷键，旧版是 ⌘J）
# → 粘贴向导文本，用户按回车后，豆包工作任务里的 agent 就会按向导自行完成官方接入。
#
# 用法：
#   bash integrations/hosts/doubao/onboarding/open-in-doubao.sh
#   DOUBAO_BOOT_PROMPT="自定义提示词" bash .../open-in-doubao.sh   # 覆盖默认向导
#
# 依赖与权限：
#   - 首次运行需在「系统设置 → 隐私与安全性 → 辅助功能」给终端/运行器授权，
#     AppleScript System Events 的按键注入依赖它。
#   - 只粘贴、不自动发送：你检查无误后按回车，避免误发。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
DOC="${REPO_ROOT}/integrations/hosts/doubao/DOUBAO-CUSTOM-PLUGIN.md"
INSTALL="${REPO_ROOT}/integrations/hosts/doubao/install.sh"
MCP="${REPO_ROOT}/packages/mcp-server/src/index.mjs"

if [ "${DOUBAO_BOOT_PROMPT:-}" != "" ]; then
  PROMPT="${DOUBAO_BOOT_PROMPT}"
else
  PROMPT="请帮我完成灵犀桌宠的豆包官方接入（灵犀是我自研的 macOS 桌宠，仓库在 ${REPO_ROOT}）。
请按以下步骤执行，并在最后逐项汇报结果与遇到的问题：
1. 先完整阅读 ${DOC}（豆包官方机制核查 + 注册参数 + 发布分析）；
2. 运行 ${INSTALL}（幂等，可重复执行；会装好 lingxi 包装器与技能软链）；
3. 进入豆包「插件·技能·伙伴 → 管理 → 连接器」，确认「个人」分类下有 lingxi（灵犀）；
   若没有，用「+ 添加 → 新建自定义连接器」注册：服务器名称 lingxi（灵犀）、
   传输类型 STDIO、命令 node、参数 ${MCP}、环境变量留空；
4. 进入「技能」管理，确认「个人」分类下有 Lingxi 与 Lingxi Authoring；
5. 运行 lingxi state 确认桌宠在跑、lingxi agents 确认豆包身份已注册；
6. 用「新工作任务」@lingxi 调用一次 lingxi_state 做端到端验证（注意：MCP 访问日志在
   ~/Library/Logs/lingxi-mcp-access.log，若 tools/call 没到日志说明是豆包运行时侧问题，如实报告）。
完成后汇报每步结果。"
fi

echo "▶ 唤起豆包客户端（运行期间请勿操作豆包窗口 ~5 秒）…"
open -b com.bot.pc.doubao
sleep 1

printf '%s' "${PROMPT}" | pbcopy

osascript <<'APPLESCRIPT'
tell application id "com.bot.pc.doubao" to activate
delay 1.5
tell application "System Events"
	keystroke "n" using {command down}
	delay 3
	keystroke "a" using command down
	delay 0.4
	keystroke "v" using command down
	delay 0.8
end tell
APPLESCRIPT

echo "✔ 已在新工作任务输入框粘贴接入向导（只粘贴，未发送）。"
echo "  请检查输入框内容后按回车发送；豆包里的 agent 会自行完成接入。"
echo "  若输入框为空：若刚才豆包正在生成回复（按键被吞），等它空闲后重新运行一次即可（脚本幂等）；"
echo "  或到「系统设置 → 隐私与安全性 → 辅助功能」为本终端授权后重试。"
