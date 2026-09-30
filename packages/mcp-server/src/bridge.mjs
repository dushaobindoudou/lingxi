// The one place that knows how to talk to a running 灵犀.
//
// Everything goes over the app's local HTTP bridge on 127.0.0.1 - the same surface the debug
// console uses. That choice is deliberate and worth stating: the MCP server does NOT embed,
// link, or spawn the app. It is a client. So it works with whatever version of 灵犀 happens to
// be running, it cannot crash it, and if the app is not running the agent gets a clear "the cat
// is not running" rather than a stack trace.
//
// It is still not an owner of the app, but it will now ASK the app to start (see ./launch.mjs)
// when the bridge is not answering, because "the cat is not running" is a true answer that the
// caller - a model - cannot act on.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureRunning, APP_NAME } from './launch.mjs';

export const DEFAULT_PORT = 47811;

export class BridgeError extends Error {}

/**
 * The bridge's shared secret, read from the file the app writes on first run.
 *
 * Loopback is a network boundary, not a trust boundary - every process running as this user can
 * reach 127.0.0.1, and the bridge can move the cat, read the owner notes and write to the config
 * directory. So the app mints a token and stores it with owner-only permissions, and clients
 * read it from there. Nothing has to be pasted, configured or kept in an environment variable
 * that ends up in a shell history.
 *
 * Cached after the first read but re-read on a 401, so restarting the app (which can mint a new
 * token) does not require restarting the MCP server.
 */
const TOKEN_PATH =
  process.env.LINGXI_TOKEN_FILE
  ?? join(homedir(), 'Library', 'Application Support', 'com.dushaobin.lingxi-desktop', 'bridge-token');

let cachedToken = null;

function readToken({ refresh = false } = {}) {
  if (cachedToken && !refresh) return cachedToken;
  if (process.env.LINGXI_TOKEN) {
    cachedToken = process.env.LINGXI_TOKEN.trim();
    return cachedToken;
  }
  try {
    cachedToken = readFileSync(TOKEN_PATH, 'utf8').trim();
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

function baseUrl() {
  const port = Number(process.env.LINGXI_PORT ?? DEFAULT_PORT);
  return `http://127.0.0.1:${port}`;
}

/**
 * Who this server speaks for.
 *
 * The bridge is deliberately agent-agnostic: a reaction is attributed to whoever names itself on
 * the call, and the app's own integration contract asks every caller to "send `agent` on every
 * /control call". That makes naming yourself the caller's job - which meant that until this
 * existed, every reaction from this server was filed under `anonymous` with a neutral badge,
 * indistinguishable from every other agent sharing the cat.
 *
 * So the identity is configuration rather than something each tool call has to remember. The
 * variable names match the `lingxi` CLI exactly, so the script path and the MCP path attribute
 * identically and a machine driving both does not end up looking like two different agents.
 *
 * ## Why the environment is not the only place this can live
 *
 * An `env` block in a host's MCP config is the obvious way to set this, and for most hosts it is
 * fine. But some hosts gate third-party MCP servers behind an approval that is keyed by a hash of
 * the server's own config - WorkBuddy hashes `command|sorted(args)|sorted(env KEY NAMES)` and
 * stores the result in `~/.workbuddy/mcp-approvals.json`. Adding or renaming a single `env` key
 * therefore produces a new hash, the old approval stops matching, the host refuses to launch the
 * server, and every tool it offered vanishes until the user re-trusts it by hand.
 *
 * That failure is invisible from inside this file: the host never spawns the process, so nothing
 * here - no log line, no thrown error - ever runs. The symptom is "the cat stopped reacting",
 * which reads as a pet problem rather than a config-hash problem.
 *
 * So identity is ALSO readable from a machine-level file, and the file is the recommended place
 * to put it:
 *
 *   ~/.lingxi/agent.json    { "id": "workbuddy", "name": "WorkBuddy",
 *                             "badge": "🐧", "color": "#0AC89F" }
 *
 * With the identity living there, a host config needs nothing but `command` and `args` - and
 * those never change, so its approval hash stays valid forever. Set it once, and no host has to
 * carry an `env` block at all.
 *
 * Precedence is environment first, then the file, so a single host can still override the
 * machine default for one invocation without touching shared state.
 */
const AGENT_FILE = join(homedir(), '.lingxi', 'agent.json');

/** Best-effort read: a missing or malformed file just means "no file identity", never a crash.
 *  An MCP server that refuses to start because of a typo in an identity file would take the
 *  whole integration down over cosmetics. */
function readAgentFile() {
  try {
    const parsed = JSON.parse(readFileSync(AGENT_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function pick(envValue, fileValue) {
  if (typeof envValue === 'string' && envValue.trim()) return envValue.trim();
  if (typeof fileValue === 'string' && fileValue.trim()) return fileValue.trim();
  return '';
}

const fileAgent = readAgentFile();

const AGENT_ID = pick(process.env.LINGXI_AGENT, fileAgent.id);

// The file's look belongs to the file's id. A host that names itself in the environment
// (LINGXI_AGENT=claude-code) while the machine file says "workbuddy" used to register as
// claude-code WITH WorkBuddy's name and penguin logo - the cat spoke for Claude under the wrong
// face. Only a file describing this same identity may dress it.
const fileLook = !fileAgent.id || fileAgent.id === AGENT_ID ? fileAgent : {};

const AGENT_PROFILE = {
  name: pick(process.env.LINGXI_AGENT_NAME, fileLook.name) || undefined,
  badge: pick(process.env.LINGXI_AGENT_BADGE, fileLook.badge) || undefined,
  color: pick(process.env.LINGXI_AGENT_COLOR, fileLook.color) || undefined,
  logo: pick(process.env.LINGXI_AGENT_LOGO, fileLook.logo) || undefined,
};

/// Only these fields take over the cat's performance, and only these contend for the stage - the
/// same set the app uses. Registering is only worth a round trip when the call will actually be
/// attributed to something the user can see.
const STAGE_FIELDS = ['expression', 'action', 'say', 'perform', 'toy'];

let identityWarning = null;

/** Fold the configured identity into a request body. An explicit `agent` on the call still wins,
 *  so a caller that wants to speak as someone else can. */
function stamp(body) {
  if (!AGENT_ID || body.agent) return body;
  return { ...body, agent: AGENT_ID };
}

/**
 * Make sure the id we are about to speak as actually exists in the app's registry.
 *
 * Deliberately called on every stage-claiming call rather than memoised for the process. The
 * registry is pure in-memory and is lost when the app restarts, while the bridge token is
 * persisted and reused - so a restart leaves no signal that would let a cached "already
 * registered" flag notice it had gone stale. `POST /agents` is idempotent and keeps the existing
 * entry's claim count, so re-sending it costs one loopback round trip and no state.
 *
 * Failure is never fatal: the call still goes out and the app attributes it to the id anyway,
 * just with the fallback two-letter badge. That degradation is recorded and surfaced on the tool
 * result instead of being swallowed - an unattributed reaction the model believes was attributed
 * is the failure mode worth avoiding here.
 */
async function ensureRegistered() {
  if (!AGENT_ID) return;
  try {
    await call('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: AGENT_ID, ...AGENT_PROFILE }),
    });
    identityWarning = null;
  } catch (error) {
    identityWarning =
      `not registered as "${AGENT_ID}": ${error?.message ?? error} - reactions will show as ` +
      'anonymous until this is fixed';
  }
}

/**
 * Is the bridge answering? Unauthenticated on purpose: /health is the one endpoint that does not
 * need a token, so this stays true even before the token file exists.
 */
async function bridgeIsUp() {
  try {
    const response = await fetch(`${baseUrl()}/health`, { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}

// One start attempt per process, shared by every concurrent call. Without this, a burst of tool
// calls against a closed app would each spawn `open` and each wait out the boot timeout.
let startAttempt = null;
/** Set once the app was started by us, so the first successful result can mention it. */
let startedByUs = false;

/**
 * The session-start check: make sure the app is up as soon as a host connects, instead of on the
 * first tool call that happens to fail.
 *
 * A host launches this server when a session BEGINS, so this is the one moment every MCP host -
 * Codex, WorkBuddy, the Claude Code plugin, anything else - shares. Waiting for the first failed
 * call meant the cat stayed closed for a whole session in which the model never thought to use
 * it, and then the first call it did make paid the boot time. Not awaited by the caller: the
 * handshake must not wait on a GUI app, and a tool call that arrives mid-boot joins this same
 * attempt through `startAttempt` rather than starting a second one. Honours LINGXI_AUTOSTART=0.
 */
export function warmUp() {
  startAttempt ??= ensureRunning(bridgeIsUp);
  return startAttempt.then((result) => {
    if (result.ok && result.started) startedByUs = true;
    // Only a start we actually made spends this process's one attempt. Finding the app already
    // up spent nothing - if it is quit later in the session, the next call should still be able
    // to bring it back. A failure is released too, so a real call retries and reports why.
    if (!result.started) startAttempt = null;
    return result;
  });
}

export function autoStartNotice() {
  if (!startedByUs) return null;
  startedByUs = false; // said once, not on every call afterwards
  return `${APP_NAME} was not running, so I started it.`;
}

async function call(path, init, { retriedAuth = false, retriedStart = false } = {}) {
  let response;
  const token = readToken({ refresh: retriedAuth || retriedStart });
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // Who is calling, on EVERY request. /control and /task-event read the `agent` field out
        // of the body, but /memory and /reminders are checked before their body is available to
        // the permission layer, so those two read this header. Sending it everywhere means the
        // two paths can never disagree about who we are.
        ...(AGENT_ID ? { 'X-Lingxi-Agent': AGENT_ID } : {}),
      },
      // Short: every one of these is a local round trip, and an agent waiting on a desktop pet
      // is a bad trade. If the app is not there, fail fast and say so.
      signal: AbortSignal.timeout(2500),
    });
  } catch (cause) {
    // Not reachable. Before reporting that, try the one thing that would fix it - but only
    // once per process, and never from a retry of a call that already went through this.
    if (!retriedStart) {
      startAttempt ??= ensureRunning(bridgeIsUp);
      const { ok, started, reason } = await startAttempt;
      if (ok) {
        if (started) startedByUs = true;
        // Run the original call against the app that is now up. A fresh start mints a fresh
        // token, so this attempt re-reads the file; `retriedStart` is what stops it recursing.
        return call(path, init, { retriedStart: true });
      }
      startAttempt = null; // a failure is worth retrying on the next call; a success is not
      throw new BridgeError(reason, { cause });
    }
    throw new BridgeError(
      `灵犀 is not reachable on ${baseUrl()}. Start the app (it listens only on localhost), ` +
        `or set LINGXI_PORT if you changed the port.`,
      { cause },
    );
  }
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  // A restarted app can have minted a new token. Re-read the file once before giving up, so a
  // long-lived MCP server survives an app restart without being restarted itself.
  if (response.status === 401 && !retriedAuth) {
    return call(path, init, { retriedAuth: true, retriedStart });
  }
  if (response.status === 401) {
    throw new BridgeError(
      `灵犀 rejected the request: no valid token. The app writes one to ${TOKEN_PATH} on first `
        + `run - check it exists and is readable by this account, or set LINGXI_TOKEN.`,
    );
  }
  if (!response.ok) {
    // The bridge speaks a structured rejection - `rejected` is a list of human-readable
    // reasons, one per field. Dumping the raw JSON at the model instead of using it was the
    // cause of the two-styles-of-error problem: tools carefully wrote
    // `throw new Error(result.rejected.join('; '))`, but this line threw FIRST, every time, so
    // those branches were unreachable and their wording never once reached a model.
    const reasons = Array.isArray(body?.rejected) ? body.rejected.filter((r) => typeof r === 'string') : [];
    if (reasons.length) {
      // A request can be partly applied - `{skin, camera}` with only the camera wrong leaves the
      // skin changed. Saying so matters: a model told only "camera: unknown preset" will retry
      // the whole call and set the skin twice, or report to the user that nothing happened.
      const applied = Array.isArray(body?.applied) ? body.applied.filter((a) => typeof a === 'string') : [];
      const suffix = applied.length ? ` (but these DID apply: ${applied.join(', ')} - do not resend them)` : '';
      throw new BridgeError(`${reasons.join('; ')}${suffix}`);
    }
    throw new BridgeError(`${path} returned ${response.status}: ${text.slice(0, 300)}`);
  }
  return body;
}

export const bridge = {
  capabilities: () => call('/capabilities'),
  status: () => call('/status'),
  perception: () => call('/perception'),
  memory: () => call('/memory'),
  reminders: () => call('/reminders'),

  reloadAssets: () =>
    call('/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reloadAssets: true }),
    }),

  assets: () => call('/assets/status'),
  integration: () => call('/integration'),

  register: (identity) =>
    call('/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(identity),
    }),

  taskEvent: async (event) => {
    const body = stamp(event);
    // A task event always produces a reaction, so attribution is always worth the round trip.
    await ensureRegistered();
    return call('/task-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  events: () => call('/debug/events'),

  control: async (command) => {
    const body = stamp(command);
    if (STAGE_FIELDS.some((field) => body[field] !== undefined)) {
      await ensureRegistered();
    }
    return call('/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  /** The configured identity, for tools that want to say who they speak for. */
  agentId: () => AGENT_ID || null,
  /** Why attribution may be degraded, or null. Read after a call, surfaced on the result. */
  identityWarning: () => identityWarning,

  // Both stamped like every other write. They were the two calls that built their body by hand
  // and so travelled with no identity at all - which, once persistent writes needed a tier,
  // meant every one of them was filed under `anonymous` and refused.
  remember: async (text, kind) => {
    await ensureRegistered();
    return call('/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stamp({ text, kind })),
    });
  },

  remind: async (text, when) => {
    await ensureRegistered();
    return call('/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stamp({ text, ...when })),
    });
  },
};
