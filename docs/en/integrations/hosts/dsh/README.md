<!-- English translation of `integrations/hosts/dsh/README.md`. If this file and the Chinese source diverge, the Chinese source wins. -->

# lingxi-dsh — Lingxi's dedicated DSH (DeepSeek Harness) plugin

DSH has no out-of-process plugin mechanism — host capabilities are registered as a **dynamic Cordis plugin**. This directory holds the plugin source
(`lingxi-dsh-plugin.js`, that is, the `code.host` function body of `cordis_define`). Register it as 5
model Tools, and from then on the model in a DSH session can drive the cat on the desk by calling them by name.

## Capabilities

| Tool | Role | Endpoint it uses |
|---|---|---|
| `lingxi_task` | Report task flow + **mood** (state/kind/mood/summary/progress) | `POST /task-event` |
| `lingxi_say` | Make the cat say one sentence | `POST /control {say}` |
| `lingxi_react` | Directly play an expression / action | `POST /control` |
| `lingxi_state` | Read the cat's state and the full expression / action library | `GET /perception` |
| `lingxi_remember` | Durably remember one fact about the user | `POST /memory` |

`summary` on `lingxi_task` is required: at the start, report the current goal with `running`; at the end, report the result with
`completed` / `failed` / `cancelled`, and write the specific task in `summary`. The completion bubble shows
this summary together with the DSH identity. The current DSH integration provides these behavior rules directly through the tool description. Only if the DSH
host loads a separate agent skill does installing the skill as well improve how accurately it triggers.

## Stable event contract

Every real task reports at least a start and a terminal state, and every event keeps the same `taskId`. The plugin fixes `provider` and
`agent` as `dsh`, so the bubble signature and the task's owner on the main window stably display as DSH. Do not invent a new agent id
for each tool call. `taskId`, `state`, and `summary` are all required:

```json
{"state":"running","taskId":"fix-login-2026-09-23","kind":"build","summary":"Fix the login flow and run the related tests"}
{"state":"completed","taskId":"fix-login-2026-09-23","kind":"build","summary":"Fixed the login flow; all 18 related tests passed"}
```

- `completed` means only that the user's goal has succeeded. An intermediate model reply, the end of a tool call, or the plugin having just loaded cannot be reported as task completion.
- `failed` means it did not succeed, and the summary names what failed. A user cancellation uses `cancelled`.
- `needs_input` / `needs_approval` are used only when the user really must answer / approve before work can continue. `blocked` means temporarily stuck, but the user does not need to step in.
- `summary` is a result the user can read. Do not write "done," "all set," or only the state name. It is used for the completion bubble and the recent tasks on the main window. The tray only shows how many tasks need attention. It does not expose task content.
- A long task may report progress with the same `taskId`. Do not open a new task for each progress point. The cat suppresses repeated progress reactions, but the main window still shows the latest state.
- Pass `mood` only when there is a real basis for the judgment. It affects how Lingxi responds. It does not change the task state.

When the plugin activates it only registers the DSH identity. It does not manufacture a fake "bridge ready" task that stays `running` forever. So the home page showing "registered · no tasks yet" is normal. A task state appears only after `lingxi_task` is actually called.

The identity is fixed as `dsh`. At startup it `POST /agents` to register the badge (`DS`, DeepSeek blue) — idempotent.

## Design constraints (all taught by the sandbox)

- The dynamic-plugin sandbox forbids Node globals: HTTP cannot use `fetch` (`WebFetchRequest` is GET-only), so it goes through
  curl on the `shell` service — the exact same token `-K` path as the CLI/hooks, and the token does not enter argv;
- `shell` is an optional lookup with `ctx.get('shell')` (the sandbox façade allows it; only the `ctx.shell` property access requires
  an `inject` declaration), and falls back to `bash`;
- Every Tool registration hangs on the disposer of `ctx.effect`, so stop/update/undefine are all reversible;
- If the bridge is not up, a tool call reports the error honestly ("bridge unreachable - is the cat running?") and does not pretend to succeed.

## Loading (have the agent run this inside a DSH session)

1. `cordis_define`: `code.host` = the contents of this file (the leading and trailing comments may be removed; pasting the whole block is enough);
2. `cordis_run`: activate the returned packageId (a Host-only package; no browser approval needed);
3. From the next step on, the five `lingxi_*` tools can be called by the model.

If DSH manages dynamic plugins with a profile/preset, put `cordis_define` and `cordis_run` into that preset,
so a new session does not have to paste them by hand every time. The plugin lifecycle is still managed by the host. After the source is updated it has to be redefined and activated. Tools in an old session
do not hot-update on their own.

## Acceptance

```bash
lingxi agents   # dsh / the DS badge appears, confirming identity registration
# In a DSH session, call lingxi_state → it returns perception JSON, confirming the bridge is reachable
# After reporting one running and the matching completed, lingxi events should show two dsh events with the same taskId
```

Common checks: if the `lingxi_*` tools are missing, confirm the Cordis package has been `cordis_run`. If a tool reports bridge unreachable,
confirm the Lingxi desktop app is running and the shell service is available. If the identity appears but the home page has no task, that is the normal empty state before
`lingxi_task` has been called. If there is a task but no identity badge, confirm `lingxi_register` / the plugin's
`POST /agents` uses the stable id `dsh`, and that `lingxi_task` is sent from that agent.

## Lifecycle

A dynamic plugin is session-scoped: it disappears when the process restarts. Load it again with the two steps above (the source is in this directory and can be pasted at any time).
To keep it across sessions, make it one line of a Cordis composition in an agent preset — that is a different path. See the
`editing-cordis-compositions` skill.
