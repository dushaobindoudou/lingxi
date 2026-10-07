// integrations/shared/ holds the scripts that find, install and start the app. Every plugin is
// installed on its own - Claude Code and Codex copy the plugin directory into a cache, the npm
// package is published without the rest of the repository - so each carries its own copy, and
// drift is the failure mode: a fix to the installer that reaches one host and not the others.
// These tests hold every copy to its source, byte for byte.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(REPO, rel), 'utf8');

const COPIES = {
  'integrations/shared/lib.sh': [
    'integrations/hosts/claude/scripts/lib.sh',
    'integrations/hosts/codex/plugin/scripts/lib.sh',
    'integrations/hosts/workbuddy/plugin/scripts/lib.sh',
    'packages/mcp-server/scripts/lib.sh',
  ],
  'integrations/shared/install-app.sh': [
    'integrations/hosts/claude/scripts/install-app.sh',
    'integrations/hosts/codex/plugin/scripts/install-app.sh',
    'integrations/hosts/workbuddy/plugin/scripts/install-app.sh',
    'packages/mcp-server/scripts/install-app.sh',
  ],
  'integrations/shared/ensure-app.sh': [
    'integrations/hosts/codex/plugin/scripts/ensure-app.sh',
    'integrations/hosts/workbuddy/plugin/scripts/ensure-app.sh',
  ],
  'integrations/cli/lingxi': [
    'integrations/hosts/claude/scripts/lingxi-cli',
    'integrations/hosts/codex/plugin/scripts/lingxi-cli',
    'integrations/hosts/doubao/scripts/lingxi-cli',
    'packages/mcp-server/bin/lingxi',
  ],
  // The npm package is published without the repository: it must carry the licence it is under.
  'LICENSE.md': ['packages/mcp-server/LICENSE.md'],
  'integrations/skills/lingxi/SKILL.md': ['integrations/hosts/codex/plugin/skills/lingxi/SKILL.md'],
  'integrations/skills/lingxi-authoring/SKILL.md': ['integrations/hosts/codex/plugin/skills/lingxi-authoring/SKILL.md'],
  'integrations/hosts/codex/skills/lingxi-codex/SKILL.md': ['integrations/hosts/codex/plugin/skills/lingxi-codex/SKILL.md'],
};

test('every copy of a shared script is byte-identical to its source', () => {
  for (const [source, copies] of Object.entries(COPIES)) {
    for (const copy of copies) {
      assert.ok(existsSync(join(REPO, copy)), `${copy} is missing - run: cp ${source} ${copy}`);
      assert.equal(read(copy), read(source), `${copy} has drifted from ${source} - run: cp ${source} ${copy}`);
    }
  }
});

test('copies of executables stay executable', () => {
  for (const [source, copies] of Object.entries(COPIES)) {
    if (source.endsWith('.md') || source.endsWith('lib.sh')) continue;
    for (const copy of copies) {
      assert.ok(statSync(join(REPO, copy)).mode & 0o111, `${copy} is not executable - chmod +x ${copy}`);
    }
  }
});

test('the Codex plugin carries every module of the MCP server, unchanged', () => {
  const source = 'packages/mcp-server/src/';
  for (const file of readdirSync(join(REPO, source)).filter((f) => f.endsWith('.mjs'))) {
    assert.equal(read(`integrations/hosts/codex/plugin/mcp/${file}`), read(source + file),
      `run: cp packages/mcp-server/src/*.mjs integrations/hosts/codex/plugin/mcp/`);
  }
});

test('the installer every host shares takes its host from LINGXI_HOST, and locks machine-wide', () => {
  const lib = read('integrations/shared/lib.sh');
  assert.match(lib, /LX_HOST="\$\{LINGXI_HOST:-claude\}"/, 'Claude stays the default host');
  assert.match(lib, /LX_INSTALL_LOCK="\$\{LINGXI_INSTALL_LOCK:-\$HOME\/\.lingxi\/install\.lock\}"/,
    'one install at a time per machine, not per host');
  const installer = read('integrations/shared/install-app.sh');
  assert.match(installer, /LOCK="\$LX_INSTALL_LOCK"/);
  assert.match(installer, /"openManagement":"agent:%s"/, 'the app opens on the page of the host that installed it');
  assert.doesNotMatch(installer, /\/lingxi:setup/, 'no Claude-only command in a message every host prints');
});
