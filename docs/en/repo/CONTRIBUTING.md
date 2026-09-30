<!-- English translation of `CONTRIBUTING.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Contributing

Read the architecture and the boundaries in the [README](../../../README.en.md) before changing code. Change behavior, rendering, and the desktop shell separately. Task state is read-only. Do not auto-approve or execute commands.

## Environment

Node.js 22+ and Rust are required (`rustup`; the version is pinned by `rust-toolchain.toml`). Blender work needs 5.1+. The version checked so far is 5.2.1.

```sh
npm ci --ignore-scripts
cd apps/lingxi && npm ci --ignore-scripts

npm run validate          # repo root: convention checks + unit tests
cd apps/lingxi && npx tsc --noEmit
cd apps/lingxi/src-tauri && cargo test
```

`npm run tauri dev` inside `apps/lingxi` starts the desktop app. Before changing animation, read the healthy values at the top of `probe-gait.html`.

## Branches and commits

Branch from `main`: `feat/…`, `fix/…`, `docs/…`. Commit subjects use a `feat:`, `fix:`, `docs:`, or `chore:` prefix and say why.

Merge into `main` through a pull request. CI must pass. Do not start a local Blender MCP server in public CI, and do not read personal Agent sessions there.

## What a pull request should say

- Which experience changed, and what it was before and after
- The checks that were actually run. Visual changes attach a small desktop-size preview. 3D changes name the Blender or runtime version
- What is still unverified, plus compatibility and performance impact

When a decision changes, update the docs in the same change. Preview images and real 3D renders must stay distinguishable. Do not describe a blockout or a generated reference as having reached the final level of realism.

## Do not commit

Caches, secrets, the bridge token, user memories, or personal sessions. Plan Git LFS or a GitHub Release for large production assets before they enter formal production. Do not drop them straight into git.

Record the source and version of new assets. Treat external models, textures, and scripts as untrusted input. An ordinary skin pack must not run arbitrary Python or JavaScript.

Community behavior is in [CODE_OF_CONDUCT.md](../../../CODE_OF_CONDUCT.md). Vulnerabilities go to [SECURITY.md](../../../SECURITY.md). Do not open a public issue for those.
