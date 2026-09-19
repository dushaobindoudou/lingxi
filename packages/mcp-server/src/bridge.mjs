// The one place that knows how to talk to a running 灵犀.
//
// Everything goes over the app's local HTTP bridge on 127.0.0.1 - the same surface the debug
// console uses. That choice is deliberate and worth stating: the MCP server does NOT embed,
// link, or spawn the app. It is a client. So it works with whatever version of 灵犀 happens to
// be running, it cannot crash it, and if the app is not running the agent gets a clear "the cat
// is not running" rather than a stack trace.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
 */
const AGENT_ID = (process.env.LINGXI_AGENT ?? '').trim();

const AGENT_PROFILE = {
  name: (process.env.LINGXI_AGENT_NAME ?? '').trim() || undefined,
  badge: (process.env.LINGXI_AGENT_BADGE ?? '').trim() || undefined,
  color: (process.env.LINGXI_AGENT_COLOR ?? '').trim() || undefined,
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

async function call(path, init, { retriedAuth = false } = {}) {
  let response;
  const token = readToken({ refresh: retriedAuth });
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      // Short: every one of these is a local round trip, and an agent waiting on a desktop pet
      // is a bad trade. If the app is not there, fail fast and say so.
      signal: AbortSignal.timeout(2500),
    });
  } catch (cause) {
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
    return call(path, init, { retriedAuth: true });
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

  remember: (text, kind) =>
    call('/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, kind }),
    }),

  remind: (text, when) =>
    call('/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...when }),
    }),
};
