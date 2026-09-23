#!/usr/bin/env node
// 灵犀 MCP server - stdio transport, no dependencies.
//
// Hand-rolled rather than built on the MCP SDK on purpose: this package exists so that anyone
// with Node can point any MCP-speaking agent at their desktop cat, and a zero-dependency single
// file is the lowest-friction way to make that true. The protocol surface needed here is small
// and stable (initialize / tools/list / tools/call over JSON-RPC 2.0 framed by newlines), so the
// cost of owning it is a page of code, and the benefit is `node src/index.mjs` working forever
// with no install step and nothing to audit.
import { createInterface } from 'node:readline';
import { toolsByName, tools } from './tools.mjs';
import { BridgeError } from './bridge.mjs';

const PROTOCOL_VERSION = '2024-11-05';

function send(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`);
}

// Frame CONSTRUCTORS, not writers: handle() stays pure so a batch can collect its replies
// and emit them as one array, and nothing writes twice.
function reply(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function replyError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

async function handle(request) {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'lingxi', version: '0.1.0' },
        instructions:
          'Drives the 灵犀 desktop cat. Call lingxi_capabilities first - the action and ' +
          'expression libraries are user-editable, so ids vary between installs. Prefer small, ' +
          'infrequent reactions (an expression, a short line) over full-screen performances; ' +
          'the cat shares a screen with someone who is working.',
      });

    case 'notifications/initialized':
      return; // no response expected

    // The spec (both the 2024-11-05 version declared above and its successors) requires ping
    // to be answered with an empty result. Hosts that probe liveness this way treated the
    // -32601 this used to return as "server is unhealthy".
    case 'ping':
      return reply(id, {});

    case 'tools/list':
      return reply(id, {
        tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });

    case 'tools/call': {
      const tool = toolsByName.get(params?.name);
      if (!tool) return replyError(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        const result = await tool.run(params.arguments ?? {});
        return reply(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
      } catch (error) {
        // Reported as a tool-level failure rather than a protocol error: "the cat is not
        // running" is a normal thing for the model to encounter and reason about, not a bug in
        // the transport.
        const message = error instanceof BridgeError ? error.message : `${error?.message ?? error}`;
        return reply(id, { content: [{ type: 'text', text: message }], isError: true });
      }
    }

    default:
      // A notification (no id) gets no reply frame - answering one used to emit an object
      // whose `id` member vanished in serialisation, which is not a legal JSON-RPC frame.
      if (id === undefined) return undefined;
      return replyError(id, -32601, `Unsupported method: ${method}`);
  }
}

const lines = createInterface({ input: process.stdin });

// A host that stops reading (or half-closes the pipe) must not take the server down with a
// stack trace: transport teardown is normal lifecycle, not a server bug. Exit quietly so a
// supervisor that restarts on nonzero exit does not churn.
process.stdout.on('error', (error) => {
  if (error && error.code === 'EPIPE') process.exit(0);
});

// No legitimate frame in this protocol is megabytes. A host that sends one is broken in a way
// that should surface as an error reply, not as this process growing without bound.
const MAX_FRAME_CHARS = 4 * 1024 * 1024;

/** Validate one decoded frame and dispatch it. Resolves to the reply frame (or undefined for
 *  notifications), so batch arrays can reuse the exact same path. */
function dispatch(request) {
  // `null` parses as JSON but is not a request object. It used to be destructured at the top
  // of handle(), throw inside the catch (which read `.id` off it a second time), and take the
  // whole server down as an unhandled rejection - one malformed line killed all thirteen
  // tools for the life of the host session.
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    return replyError(null, -32600, 'Invalid request: expected a JSON-RPC 2.0 object');
  }
  // A frame with neither method nor id is a response to a request we never made, or an empty
  // notification. Either way there is nothing to answer.
  if (typeof request.method !== 'string') {
    return request.id === undefined
      ? undefined
      : replyError(request.id, -32600, 'Invalid request: missing method');
  }
  return Promise.resolve(handle(request)).catch((error) => {
    if (request.id !== undefined) return replyError(request.id, -32603, `${error?.message ?? error}`);
    return undefined;
  });
}

lines.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  if (trimmed.length > MAX_FRAME_CHARS) {
    send(replyError(null, -32600, `request frame exceeds ${MAX_FRAME_CHARS} bytes`));
    return;
  }
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    send(replyError(null, -32700, 'Parse error'));
    return;
  }
  // Batches (allowed by the 2024-11-05 spec this server declares) run the same dispatch per
  // element; the defined replies go back as one bare array, per the spec.
  if (Array.isArray(request)) {
    Promise.all(request.map((entry) => Promise.resolve(dispatch(entry)).catch(() => undefined)))
      .then((replies) => {
        const defined = replies.filter((entry) => entry !== undefined);
        // An all-notification batch gets no reply at all - not an empty array.
        if (defined.length > 0) process.stdout.write(`${JSON.stringify(defined)}\n`);
      })
      .catch(() => {});
    return;
  }
  Promise.resolve(dispatch(request))
    .then((frame) => {
      if (frame !== undefined) send(frame);
    })
    .catch(() => {});
});
