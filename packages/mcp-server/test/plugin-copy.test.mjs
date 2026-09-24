// The Claude Code plugin ships its own copy of this server (integrations/hosts/claude/mcp/), so
// the plugin directory can be installed from anywhere without the rest of the repository.
//
// That copy was index.mjs ALONE - the one file whose imports are three other files. Every
// session with the plugin enabled spawned `node mcp/index.mjs`, which died on its first line with
// ERR_MODULE_NOT_FOUND, and the plugin's MCP half - and with it the start-the-cat check - had
// never run once. So: every module here must be in the copy, byte for byte, and the copy must
// actually answer a handshake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('../src/', import.meta.url));
const PLUGIN = fileURLToPath(new URL('../../../integrations/hosts/claude/mcp/', import.meta.url));
const SYNC = 'cp packages/mcp-server/src/*.mjs integrations/hosts/claude/mcp/';

test('the plugin carries every module of the server, unchanged', () => {
  for (const file of readdirSync(SOURCE).filter((f) => f.endsWith('.mjs'))) {
    assert.ok(existsSync(PLUGIN + file), `the plugin is missing ${file} - run: ${SYNC}`);
    assert.equal(
      readFileSync(PLUGIN + file, 'utf8'),
      readFileSync(SOURCE + file, 'utf8'),
      `the plugin's ${file} has drifted from packages/mcp-server - run: ${SYNC}`,
    );
  }
});

test('the plugin copy starts and answers a handshake', () => {
  const frames = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  ].map((frame) => JSON.stringify(frame)).join('\n');
  const run = spawnSync(process.execPath, [`${PLUGIN}index.mjs`], {
    input: `${frames}\n`,
    encoding: 'utf8',
    timeout: 5000,
    // Never the real app: a test process must not open a window on the machine running it.
    env: { ...process.env, LINGXI_AUTOSTART: '0' },
  });
  assert.doesNotMatch(run.stderr, /ERR_MODULE_NOT_FOUND/, run.stderr);
  const replies = run.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(replies.find((r) => r.id === 1)?.result?.serverInfo?.name, 'lingxi');
  assert.ok(replies.find((r) => r.id === 2)?.result?.tools?.length >= 13, 'tools/list should list the tools');
});
