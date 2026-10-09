import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AGENT_HOSTS, resolveAgentHost } from '../src/ui/agent-hosts.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));

test('every shipped host has an Agent integration panel and a valid navigation target', () => {
  const shipped = readdirSync(`${root}/integrations/hosts`).filter((id) =>
    existsSync(`${root}/integrations/hosts/${id}/README.md`),
  ).sort();
  const html = readFileSync(`${root}/apps/lingxi/management.html`, 'utf8');
  const panels = [...html.matchAll(/data-agent-panel="([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(AGENT_HOSTS.map((host) => host.id).sort(), shipped);
  assert.deepEqual(panels, shipped, 'adding an adapter must also make it discoverable in the app');
  for (const id of shipped) assert.equal(resolveAgentHost(id), id);
});

test('registered host aliases navigate to the same panel as canonical ids', () => {
  for (const [identity, expected] of [
    ['CodeBuddy', 'workbuddy'], ['WorkBuddy', 'workbuddy'], ['豆包', 'doubao'],
    ['Doubao', 'doubao'], ['Cursor', 'cursor'], ['claude-code', 'claude'],
    ['DeepSeek Harness', 'dsh'], ['Codex', 'codex'],
  ]) assert.equal(resolveAgentHost(identity), expected);
  assert.equal(resolveAgentHost('my-ci-runner'), undefined);
});

test('the native supported-host preference accepts every advertised adapter', () => {
  const source = readFileSync(`${root}/apps/lingxi/src-tauri/src/lib.rs`, 'utf8');
  const native = [...source.match(/const KNOWN_AGENTS:.*?= \[([^\]]+)\]/s)[1].matchAll(/"([^"]+)"/g)]
    .map((match) => match[1]).filter((id) => id !== 'none').sort();
  assert.deepEqual(native, AGENT_HOSTS.map((host) => host.id).sort());
});
