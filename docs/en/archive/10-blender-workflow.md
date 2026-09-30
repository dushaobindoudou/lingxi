<!-- English translation of `docs/archive/10-blender-workflow.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# Official Blender MCP and the character-design workflow

This follows the user-specified [official Blender Lab notes](https://www.blender.org/lab/mcp-server/). The source is [lab/blender_mcp](https://projects.blender.org/lab/blender_mcp). The official requirement is Blender 5.1+; this machine is currently 5.2.1 LTS.

## Installed and verified

The official server package is version 1.0.2, the extension is 1.0.0, and the source commit is recorded in [upstream-lock](../../../scripts/blender/upstream-lock.json). The standalone Python environment is at `.local/blender-mcp-venv` in the project, and the source is at `.local/blender-lab`. Neither is committed to Git. The global Codex `blender` entry has been changed to the official service.

The path is stdio → local TCP `127.0.0.1:9877` → Blender. The auto-start preference is false; this round explicitly opened a separate design session. The official MCP tools can execute Python and are not distributed with the Lingxi end-user application. The previously installed community edition has been disabled, and the listener it started this round has been stopped.

Auto-approval once rejected the auto-start setting. After switching to a manual start, installation succeeded, without bypassing that restriction.

The [handshake evidence](../../evidence/blender-mcp-handshake.json) confirms the tool list and the scene query. The server version returned by MCP initialization comes from the SDK (1.30.0) and must not be mistaken for the Blender Lab package version. The actual package version is the one in the lock record.

## Starting the design over

Run from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --online-mode assets/characters/lingxi/source/lingxi-reference-studio.blend --python scripts/blender/start_mcp.py
.local/blender-mcp-venv/bin/python scripts/blender/mcp_client.py
```

`--online-mode` is what the official bridge requires of this process. It does not change the global online preference. If 9877 is already taken by another design session, reuse that session or stop it manually first. Do not start multiple Blender processes contending for the same port.

The next time Codex establishes an MCP tool connection, it loads the new configuration. This conversation completed its calls through the standard Python MCP client. What was verified is not a plain socket probe.

The install script is [install_official_addon.py](../../../scripts/blender/install_official_addon.py). It depends on the already downloaded official extension zip. A new machine must install the standalone environment from the locked source and generate the zip. The exact install reproduction is in the script and upstream-lock. It does not depend on the community package of the same name on PyPI.

## Design results already created

- [Character working scene](../../../assets/characters/lingxi/source/lingxi-reference-studio.blend): three packed references, 4 cameras, 3 lights, baseline materials for coat / nose / iris / cornea, and layered collections.
- [Character turnaround candidate](../../../assets/characters/lingxi/reference/turnaround-v1.png): pose, proportion, and markings still need further alignment.
- [MCP scene-creation evidence](../../evidence/blender-design-scene.json), [scene verification](../../evidence/blender-verification.json), [background reopen check](../../evidence/blender-reopen-check.json), and the [working-scene screenshot](../../evidence/blender-studio.png). The reference images are packed, so the external-resource check has 0 items pending. Self-containment is verified together with the packed flag.

The working scene uses the original primary cat as the identity reference. The scene text explicitly says "no finished character mesh, hair, rig, or animation yet." The reference images are for design only. They are hidden at render time and must not be mistaken for the 3D cat.

Later, [three mesh-and-hair studies](12-character-study-review.md) were made in separate files, with official MCP calls and Cycles renders completed. The third version uses native curve hair divided into regions. The studies exposed problems in facial structure, hair flow, and markings. Visual acceptance has not passed. The original reference working scene is unchanged.

## Production order from here

Correct the turnaround → volume sculpt → quadruped topology → UV / marking masks → skeleton and base pose → eyes → region groom → runtime hair trial → breathing, blinking, gaze → desktop integration. Each step keeps an editable source file and a visual check. Final quality has to return to the user's original reference. A blockout is not a substitute.

## Evening update, 2026-09-13 (DSH session): the port truth, the community add-on, and script fixes

- **The community-edition add-on was not actually disabled.** `scripts/addons/blender_mcp.py` (module `blender_mcp`) was still enabled in the user preferences. Every launch automatically seized 9876, and the protocol is different (it waits for a newline rather than `\0`). This is the root of the official bridge's odd behavior: "connected successfully but never responds." `start_mcp.py` now disables the community edition first and saves preferences, so the official service has the port to itself.
- **The port convention is unified on 9876** (the official blmcp default). Both `start_mcp.py` and `mcp_client.py` now use the `BLENDER_MCP_PORT` environment variable, overridable, defaulting to 9876. The old hardcoded 9877 had drifted from the port that was actually listening, which is why the client previously reported "Cannot connect." On the DSh side, a user preset `lingxi` has been created (`~/.dsh/.agent-presets/lingxi/`). It bridges this service through dsh-mcp-client. In a new session the tool names are `mcp__blender__*`.
- **start_mcp.py now retries the port bind.** TIME_WAIT from a killed instance makes a bind without SO_REUSEADDR fail, which leaves the add-on in a "half-started" state (the port is listening but never answers).
- **Incident record:** around 22:08 on 2026-09-13, a DSH session cleaning up leftover socket connections accidentally killed the Blender that was running at the time (PID 85405, running since 09:40). Disk state is safe (`lingxi-v6.blend` was last saved at 18:17; there is also a `.blend1` from 18:02 and three version snapshots). Unsaved in-memory edits after 18:17 are lost; how many is unknown. The current instance was restarted by the DSH session with `--online-mode` and the v6 file. The official MCP has been tested and can query the scene and execute code.
