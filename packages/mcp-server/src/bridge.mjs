// The one place that knows how to talk to a running 灵犀.
//
// Everything goes over the app's local HTTP bridge on 127.0.0.1 - the same surface the debug
// console uses. That choice is deliberate and worth stating: the MCP server does NOT embed,
// link, or spawn the app. It is a client. So it works with whatever version of 灵犀 happens to
// be running, it cannot crash it, and if the app is not running the agent gets a clear "the cat
// is not running" rather than a stack trace.

export const DEFAULT_PORT = 47811;

export class BridgeError extends Error {}

function baseUrl() {
  const port = Number(process.env.LINGXI_PORT ?? DEFAULT_PORT);
  return `http://127.0.0.1:${port}`;
}

async function call(path, init) {
  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
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
  if (!response.ok) {
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

  control: (command) =>
    call('/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    }),

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
