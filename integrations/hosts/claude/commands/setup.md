---
description: 安装、打开并接入灵犀桌面猫（没装就装，装了就复用；加 update 升级应用）
argument-hint: "[update]"
allowed-tools: Bash(lingxi-claude:*), Bash(lingxi:*)
---

Run this and wait for it to finish (a first install downloads about 16 MB):

```bash
lingxi-claude setup $ARGUMENTS
```

Then tell the user, in their language and in a few short lines:

- whether 灵犀 is installed and running, and which version;
- that their existing settings, memories and reminders were kept (quote the data directory
  once), if the output says data already exists;
- anything marked ✗ or !, each with the one thing to do about it.

Do not paste the whole output. If it failed because the release could not be downloaded, say the
repository may be private and suggest `gh auth login`, or downloading the .dmg from the Releases
page and running the `--from` command the output shows.
