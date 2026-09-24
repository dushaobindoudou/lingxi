---
description: 查看灵犀桌面猫的状态：安装、运行、版本更新、连接权限、数据目录、插件选项
allowed-tools: Bash(lingxi-claude:*), Bash(lingxi:*)
---

Run:

```bash
lingxi-claude status
```

Summarise it for the user in a few short lines, in their language: installed or not (and any
install in progress), running or not, whether an update is available, Claude's permission
tier, and where their data lives. Mention the plugin options only if one of them is off. Point
at `/lingxi:setup` (or `/lingxi:setup update`) when that is the fix.
