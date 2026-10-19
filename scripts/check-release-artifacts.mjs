#!/usr/bin/env node
// Check the actual distributable, rather than inferring its contents from build configuration.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, 'apps/lingxi/dist');
assert.ok(existsSync(dist), 'Build the app frontend before checking release artifacts');
const html = readdirSync(dist).filter(file => file.endsWith('.html')).sort();
assert.deepEqual(html, ['index.html', 'management.html'], 'Only product windows belong in the release');
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
for (const path of walk(dist)) {
  assert.doesNotMatch(path, /(?:probe|harness|debug|demo|model-audit)|\.(?:glb|blend|map)$/i,
    `Development material leaked into release: ${path}`);
}
for (const page of html) {
  for (const [, reference] of readFileSync(join(dist, page), 'utf8').matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (/^(?:https?:|data:)/.test(reference)) continue;
    assert.ok(existsSync(join(dist, reference.replace(/^\//, ''))), `${page}: missing asset ${reference}`);
  }
}
console.log('Frontend release: only product pages, all assets resolve, no debug/model payload');

const staging = mkdtempSync(join(tmpdir(), 'lingxi-release-check-'));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', timeout: 20_000, ...options });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${command}: ${result.stderr}`);
  return result.stdout;
}
try {
  const [packed] = JSON.parse(run('npm', ['pack', './packages/mcp-server', '--ignore-scripts', '--json', '--pack-destination', staging]));
  for (const file of packed.files) {
    assert.match(file.path, /^(?:src\/|scripts\/|bin\/|README\.md$|LICENSE\.md$|package\.json$)/,
      `Unexpected file in npm tarball: ${file.path}`);
  }
  run('tar', ['-xzf', join(staging, packed.filename), '-C', staging]);
  const packageDir = join(staging, 'package');
  const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
  for (const bin of Object.values(pkg.bin)) assert.ok(statSync(join(packageDir, bin)).mode & 0o111, `${bin} is not executable`);
  assert.equal(readFileSync(join(packageDir, 'LICENSE.md'), 'utf8'), readFileSync(join(root, 'LICENSE.md'), 'utf8'));
  const frames = run(process.execPath, [join(packageDir, 'src/index.mjs')], {
    cwd: staging,
    env: { ...process.env, LINGXI_AUTOSTART: '0', LINGXI_AUTOINSTALL: '0' },
    input: [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'release-check', version: '1' } } },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ].map(frame => JSON.stringify(frame)).join('\n') + '\n',
  }).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(frames.find(frame => frame.id === 1)?.result?.serverInfo?.version, pkg.version);
  const tools = frames.find(frame => frame.id === 2)?.result?.tools;
  assert.ok(tools?.length > 0, 'Packed MCP server did not return its tool catalogue');
  assert.equal(new Set(tools.map(tool => tool.name)).size, tools.length);
  for (const tool of tools) assert.equal(tool.inputSchema.type, 'object', `${tool.name}: missing schema`);
  console.log(`npm ${pkg.name}@${pkg.version}: ${packed.entryCount} files, executable clients, handshake and ${tools.length} tools verified from extracted tarball`);
  for (const folder of ['integrations/hosts/claude', 'integrations/hosts/codex/plugin', 'integrations/hosts/workbuddy/plugin']) {
    assert.equal(readFileSync(join(root, folder, 'LICENSE.md'), 'utf8'), readFileSync(join(root, 'LICENSE.md'), 'utf8'));
  }
  console.log('Standalone plugin licenses: OK');
} finally {
  rmSync(staging, { recursive: true, force: true });
}
