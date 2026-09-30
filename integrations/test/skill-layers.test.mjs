// Every host plugin carries the cat's skill in two layers (integrations/hosts/PLUGIN-STANDARD.md, 六):
// the shared system layer `lingxi`, identical everywhere, and the host's own `lingxi-<host>`, which
// only says what holds on that host. These tests keep the two from bleeding into each other again -
// before this, three hosts carried forks of the shared skill that had drifted apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(REPO, rel), 'utf8');
const SYSTEM = 'integrations/skills/lingxi/SKILL.md';
const HOSTS = ['claude', 'codex', 'cursor', 'doubao', 'workbuddy'];

test('the system layer names no host: host facts belong in the host layer', () => {
  const system = read(SYSTEM);
  assert.match(system, /^---\nname: lingxi\n/);
  for (const host of ['Claude Code', 'Codex', 'Cursor', 'WorkBuddy', '豆包', 'DSH', 'CLAUDECODE', 'CODEX_']) {
    assert.ok(!system.includes(host), `system layer mentions ${host} - move that into lingxi-<host>`);
  }
});

test('every host has its own layer, named lingxi-<host>, that defers to the system layer', () => {
  for (const host of HOSTS) {
    const rel = `integrations/hosts/${host}/skills/lingxi-${host}/SKILL.md`;
    assert.ok(existsSync(join(REPO, rel)), `${rel} missing`);
    const text = read(rel);
    assert.match(text, new RegExp(`^---\\nname: lingxi-${host}\\n`), `${rel}: wrong name`);
    assert.match(text, /alongside the lingxi skill/, `${rel}: description must say to read it with lingxi`);
    assert.match(text, /`lingxi`/, `${rel}: body must point back at the system layer`);
    // A host layer that grows past this is re-telling the system layer.
    assert.ok(text.split('\n').length < 120, `${rel} is too long for a host layer`);
  }
});

test('plugins that ship a copy of the system layer ship it byte for byte, never a fork', () => {
  const system = read(SYSTEM);
  for (const copy of [
    'integrations/hosts/claude/skills/lingxi/SKILL.md',
    'integrations/hosts/doubao/skills/lingxi/SKILL.md',
    'integrations/hosts/workbuddy/plugin/skills/lingxi/SKILL.md',
  ]) {
    assert.equal(read(copy), system, `run: cp ${SYSTEM} ${copy}`);
  }
  assert.equal(read('integrations/hosts/workbuddy/plugin/skills/lingxi-workbuddy/SKILL.md'),
    read('integrations/hosts/workbuddy/skills/lingxi-workbuddy/SKILL.md'));
});

test('installers put both layers in place', () => {
  const codex = read('integrations/hosts/codex/install.sh');
  assert.match(codex, /link_skill lingxi "\$REPO\/integrations\/skills\/lingxi"/);
  assert.match(codex, /link_skill lingxi-codex "\$REPO\/integrations\/hosts\/codex\/skills\/lingxi-codex"/);
  assert.match(read('integrations/hosts/cursor/install.sh'), /SKILL_NAMES="lingxi lingxi-authoring lingxi-cursor"/);
  assert.match(read('integrations/hosts/doubao/install.sh'), /install_skill "lingxi-doubao"/);
  // The app's own one-click Codex install embeds the same two files.
  const app = read('apps/lingxi/src-tauri/src/lib.rs');
  assert.match(app, /integrations\/skills\/lingxi\/SKILL\.md/);
  assert.match(app, /integrations\/hosts\/codex\/skills\/lingxi-codex\/SKILL\.md/);
});
