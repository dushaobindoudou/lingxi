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

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
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
      return replyError(id, -32601, `Unsupported method: ${method}`);
  }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request;
  try {
    request = JSON.parse(trimmed);
  } catch {
    return replyError(null, -32700, 'Parse error');
  }
  // Notifications have no id and get no reply; anything else is answered, including failures.
  Promise.resolve(handle(request)).catch((error) => {
    if (request.id !== undefined) replyError(request.id, -32603, `${error?.message ?? error}`);
  });
});
