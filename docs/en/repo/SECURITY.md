<!-- English translation of `SECURITY.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Security and privacy

## Reporting a vulnerability

Use the repository [Security Advisories](https://github.com/dushaobindoudou/lingxi/security/advisories/new) private report, or contact the maintainer `@dushaobindoudou` directly.

Do not attach credentials, the bridge token, private sessions, or the contents of memory files to a public issue, pull request, or discussion. A version, a platform, and the smallest steps that reproduce it are enough.

We will confirm receipt, and publish details only after the fix is in the release notes.

## Support

| Version | Status |
| --- | --- |
| The current desktop app on `main` | Reports accepted |
| Older untagged builds | Not maintained separately |

The app supports macOS only. The bridge listens on `127.0.0.1` only. Loopback is not a trust boundary: any local process can connect, so every route except `GET /health` requires a token. The token file should be mode `0600`.

## Product boundaries

The observation layer receives only the task metadata it needs. It has no interface to approve, execute, or cancel a task. MCP is not packaged into the end-user app. Blender Lab MCP can execute Blender Python. It is configured for local loopback and a manual start. Stop it from the Blender extension panel when a design session ends.

External models, materials, textures, and scripts are treated as untrusted input. An ordinary skin pack does not run arbitrary Python or JavaScript. Dependabot updates dependencies and GitHub Actions on a schedule. CI permissions default to read-only.
