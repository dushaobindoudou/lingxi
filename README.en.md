[中文](README.md) · **English**

[![CI](https://github.com/dushaobindoudou/lingxi/actions/workflows/ci.yml/badge.svg)](https://github.com/dushaobindoudou/lingxi/actions/workflows/ci.yml)

# Lingxi 灵犀

> You do your work. I am here.

A quiet 3D cat for your macOS desktop. It walks, rests, stays away from your cursor and plays with yarn, a wand and a laser pointer.
Connect a coding agent and it reacts to completed tasks, failures and requests for your attention with expressions, actions and speech bubbles.

<img src="assets/brand/lingxi-icon-v3.png" width="200" alt="Lingxi, a grey-brown tabby kitten with white paws" />

Switch between block-style and realistic cats in the main window under Appearance → Style. The image above is the brand illustration.

**v1.0.0 is being prepared for release.** Supports **macOS 12+, Apple Silicon and Intel**.

## Download and install

1. Open [GitHub Releases](https://github.com/dushaobindoudou/lingxi/releases/latest) and download `Lingxi-<version>-universal.dmg`.
2. Open the image, drag Lingxi into Applications and launch it.
3. Use the menu bar cat → Open Lingxi to adjust size, personality, appearance, toys and agent connections.

The desktop app needs neither Node.js nor Rust. Until v1.0.0 ships, Latest points to the previous release; check its version.
See each release's notes for signing and first-launch instructions. Builds without Apple notarization require approval in System Settings → Privacy & Security.
Each app release includes `SHA256SUMS.txt`; use `shasum -a 256` to verify downloads.

## Everyday companion

- Walks, rests and sleeps along the screen edge; pauses when hidden, locked or asleep.
- Avoids focused input fields and the active editor line after Accessibility permission is enabled in Settings. Detects geometry only, without reading typed text.
- Responds to petting and double clicks, and plays with yarn, a wand or a laser pointer. Hold the wand handle to tease a jump. In Play → Petting, hold the left mouse button and gently stroke the head or body; offer a belly roll to rub the exposed belly.
- Optional automatic effects: enable them in Settings for occasional context-aware surprises, with a shared ten-minute cooldown. They default to off; manual performances remain in Play.
- Shows the agent's icon and session name on task notifications.
- Supports reminders, daily repeats and local memories. Reminders wait until you return to the computer.
- Five personality sliders affect behavior. Size, camera and theme changes apply immediately. JSON files customize actions, expressions and skins.

## Connect an agent

The app and integrations support macOS. Plugins and the MCP server can install a missing app from GitHub Releases and reuse an existing installation and data.
Automatic downloads require internet access; everyday cat behavior runs locally.
The DSH dynamic plugin uses its [host skill](integrations/hosts/dsh/skills/lingxi-dsh/SKILL.md) to guide installation and upgrades; it does not download a DMG automatically.

**Claude Code** (host CLI required; the MCP server needs Node.js 22+):

```sh
claude plugin marketplace add dushaobindoudou/lingxi
claude plugin install lingxi@lingxi
```

**Codex**:

```sh
codex plugin marketplace add dushaobindoudou/lingxi
codex plugin add lingxi@lingxi
```

**Other MCP clients** (Node.js 22+; replace `cursor` with the actual host identity):

```json
{
  "mcpServers": {
    "lingxi": {
      "command": "npx",
      "args": ["-y", "lingxi-mcp"],
      "env": { "LINGXI_AGENT": "cursor" }
    }
  }
}
```

[WorkBuddy / CodeBuddy](integrations/hosts/workbuddy/README.md), [Cursor](integrations/hosts/cursor/README.md),
[Doubao](integrations/hosts/doubao/README.md), [DeepSeek Harness](integrations/hosts/dsh/README.md), [integration guide](integrations/README.md).
These commands use this repository's marketplace. Official directory review and publication are separate processes.
Set `LINGXI_AUTOINSTALL=0` to disable automatic installation or `LINGXI_AUTOSTART=0` to disable automatic startup.

## Data and limitations

- The HTTP bridge listens on `127.0.0.1:47811` and requires a local token except for health checks. Observation interfaces do not approve or execute agent tasks.
- Replies may be used locally to generate bubbles, but are excluded from task event logs and notification webhooks. Memories, reminders and settings live in the local configuration directory.
- Interaction counts and time near the cat stay in memory and reset on restart. Cursor trajectories are not recorded. See [configuration storage](apps/lingxi/src-tauri/README-config.md).
- macOS only. Multi-monitor coordinates and some curled poses have [known limitations](docs/KNOWN_ISSUES.md).

## Customize and contribute

In Appearance, export the built-in resource templates, edit files under the configuration directory's `assets/`, then reload custom resources.
Invalid resources retain the built-in version and report an error. See [authoring instructions](integrations/skills/lingxi-authoring/SKILL.md).

Built with Tauri 2, Rust, TypeScript and Three.js. See [contributing](CONTRIBUTING.md) for development and tests,
[releasing](docs/RELEASING.md) for packaging, and the [documentation index](docs/README.md).

[Changelog](CHANGELOG.md) · [Issues](https://github.com/dushaobindoudou/lingxi/issues) · [Security](SECURITY.md) · [Code of conduct](CODE_OF_CONDUCT.md)

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md). Commercial use requires a separate license.
The license's additional attribution terms require visible credit to “灵犀 lingxi” and a repository link for use, modifications, distribution and derivative projects.
