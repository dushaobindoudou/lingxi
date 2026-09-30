<!-- English translation of `docs/11-project-setup.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Project Setup and Current Delivery

> **Renamed on 2026-09-22**: the repository changed from `dsh-lingxi` to `lingxi` (GitHub keeps a redirect for the old address).
> Files under `docs/evidence/` are **deliberately left as they were** — they are a record of that day's state. Changing the old addresses inside them
> would make the record say something that did not happen. When you see a `dsh-lingxi` link, read it with that in mind.
> The app's bundle id has always been `com.dushaobin.lingxi-desktop`. **The rename does not affect it**,
> so the config directory, token, and user data do not need to be migrated.

Project name: Lingxi. Repository name: lingxi. Default branch: main. Private incubation. An open-source license has not been decided for the user.

## Local baseline

- Git, EditorConfig, newline and binary rules, and ignoring the local environment and caches.
- Node.js 22+, package-lock, and the base packages have no third-party runtime dependencies.
- `npm run validate` checks JSON, skin and personality configuration, and document links, and runs the contract tests.
- GitHub Actions runs validation and Python syntax compilation. It does not connect to a personal Blender/Agent.
- Dependabot maintains npm and Actions. CODEOWNERS, issue forms, a PR template, and contribution and security documents.
- Asset sources and generation prompts are recorded. Blender source files pack their images. Design-tool source and virtual environments are not committed.

## GitHub settings

The repository has been created and pushed: [dushaobindoudou/lingxi](https://github.com/dushaobindoudou/lingxi). [Remote settings evidence](../evidence/github-settings.json) records private, main, issues on, Wiki off, squash merge only, delete branch after merge, plus 3 milestones and 6 follow-up items. Dependency security alerts and automatic fixes are enabled. The first CI passed.

**Current limit: main-branch protection is not enabled.** GitHub returns HTTP 403: this account must upgrade to Pro, or the repository must be made public, before it can be enabled. It stays private and is not made public without being asked. The team process requires a PR and a green CI, but the server cannot enforce that yet. After an upgrade, "Validate must pass," "no force-push / delete," and a linear history can be enabled.

## User goals and the evidence boundary

| Goal | Output | Boundary that should not be confused |
| --- | --- | --- |
| A good name | The user has settled on Lingxi | No promise of exclusive trademark rights |
| Icon and design system | v2 icon, tokens, style rules, original identity reference | The first version was rejected; v2 can keep being tuned from feedback |
| A realistic 3D desktop plan | ADR 001 | The technical plan is written; runtime look and power have not been measured |
| Official Blender MCP and design | Official install, handshake, a reference working scene, three mesh versions and a fur study | Rendered offline; visual acceptance has not passed; no production rig or real-time verification |
| Multiple skins and personalities | Separate contracts, configuration, and tests | The planned skins do not yet have production meshes / textures |
| Agent extensibility | A unified event, an Observer interface, integration paths that have been checked | The future online-connection feature is not falsely marked as available |
| A standard GitHub project | Repository, CI, settings, templates, and project items | The remote evidence is what counts |
