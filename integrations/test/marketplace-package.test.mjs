// The skill-market package (integrations/hosts/workbuddy/marketplace/) is not a copy of the host
// plugin: it ships to people who never ran install.sh, so it must not assume hooks, an MCP trust
// gate, or a host layer exists. These tests keep it self-contained and keep the platform's
// packaging rules (frontmatter fields, two-level depth, scripts/ entry point) from drifting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const PKG = 'integrations/hosts/workbuddy/marketplace/lingxi-desktop-cat';
const SKILL = `${PKG}/SKILL.md`;
const read = (rel) => readFileSync(join(REPO, rel), 'utf8');

const frontmatter = (text) => text.split('---')[1] ?? '';

test('SKILL.md carries every frontmatter field the platform requires', () => {
  const head = frontmatter(read(SKILL));
  for (const key of ['description', 'description_zh', 'description_en', 'version', 'author']) {
    assert.match(head, new RegExp(`^${key}:`, 'm'), `missing required frontmatter field: ${key}`);
  }
  const name = head.match(/^name:\s*(\S+)$/m)?.[1];
  assert.equal(name, 'lingxi-desktop-cat');
  assert.match(name, /^[a-z0-9-]+$/, 'name must be lowercase letters, digits and hyphens');
});

test('the package stays inside two directory levels', () => {
  const walk = (dir, rel = '') => {
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      const relPath = rel ? `${rel}/${entry}` : entry;
      if (statSync(abs).isDirectory()) {
        walk(abs, relPath);
      } else {
        const depth = relPath.split('/').length;
        assert.ok(depth <= 2, `${relPath} is ${depth} levels deep; the platform allows two`);
      }
    }
  };
  walk(join(REPO, PKG));
});

test('every @reference points at a file that ships in the package', () => {
  const body = read(SKILL);
  const refs = [...body.matchAll(/@(references\/[\w.-]+\.md)/g)].map((m) => m[1]);
  assert.ok(refs.length > 0, 'expected the skill to point at reference files');
  for (const ref of refs) {
    assert.ok(existsSync(join(REPO, PKG, ref)), `${ref} is referenced but not in the package`);
  }
});

test('the skill never assumes the plugin install ran', () => {
  const body = read(SKILL);
  // These only hold for people who ran install.sh or installed the marketplace plugin.
  // install.sh is now mentioned only as an optional upgrade path, so it is not a forbidden word.
  // The rest are plugin-only concepts a market install never provides.
  for (const forbidden of ['宿主层', 'lingxi-workbuddy', 'mcp.json', '信任闸门', '额度守卫']) {
    assert.ok(!body.includes(forbidden), `skill assumes "${forbidden}", which a market install does not provide`);
  }
});

test('every CLI call goes through the wrapper, never a bare lingxi', () => {
  const body = read(SKILL) + read(`${PKG}/references/cli-reference.md`);
  const subs = 'up|health|doctor|state|status|capabilities|integration|task|say|express|do|perform|toy|look|remember|recall|remind|reminders|assets|reload|agents|register|update';
  const bare = new RegExp(`(^|[^\\w/.-])lingxi (${subs})\\b`, 'gm');
  const hits = [...body.matchAll(bare)].map((m) => m[0].trim());
  assert.deepEqual(hits, [], `bare lingxi calls found (use scripts/lingxi.sh): ${hits.join(', ')}`);
});

test('the wrapper exists, is executable, and parses as bash', () => {
  const script = `${PKG}/scripts/lingxi.sh`;
  const abs = join(REPO, script);
  assert.ok(existsSync(abs), `${script} is missing`);
  assert.ok(statSync(abs).mode & 0o111, `${script} must be executable`);
  const parsed = spawnSync('bash', ['-n', abs], { encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
});

test('the skill states the macOS limit and does not install or download anything', () => {
  const body = read(SKILL);
  assert.match(body, /macOS/, 'the skill must say it only works on macOS');
  assert.match(body, /不要替用户下载/);
  // `update` replaces the app from GitHub Releases - never something the model should trigger.
  assert.ok(!/scripts\/lingxi\.sh update/.test(body), 'the skill must not call update');
});

test('the checker only observes: it never installs, downloads, starts, or writes config', () => {
  const script = read(`${PKG}/scripts/check.sh`);
  const forbidden = [
    ['hdiutil', 'mounting a dmg is an install step'],
    ['cp -R', 'copying an app is an install step'],
    ['cp -r', 'copying an app is an install step'],
    ['ditto', 'copying an app is an install step'],
    ['curl -O', 'downloading is an install step'],
    ['curl -L', 'downloading is an install step'],
    ['open -g', 'checking must not start the app'],
    ['mcp.json', 'checking must not write host config'],
    ['agent-permissions.json', 'permissions can only be granted by a human'],
  ];
  for (const [needle, why] of forbidden) {
    assert.ok(!script.includes(needle), `check.sh contains "${needle}": ${why}`);
  }
  // It may READ settings.json to see whether hooks are installed, but never write it.
  for (const write of ['sed -i', 'tee ', '> "$WB/settings.json"', '>> "$WB/settings.json"']) {
    assert.ok(!script.includes(write), `check.sh must not modify host config (found "${write}")`);
  }
  for (const result of ['app-missing', 'app-not-started', 'unsupported-os', 'ready']) {
    assert.ok(script.includes(result), `check.sh should be able to report ${result}`);
  }
});

test('the skill points first-time users at the checker, not at the app-side doctor', () => {
  const body = read(SKILL);
  assert.match(body, /bash scripts\/check\.sh/);
  assert.ok(!/scripts\/lingxi\.sh doctor/.test(body), 'check.sh must be the first step; doctor needs the CLI');
  assert.match(body, /不要替用户下载/);
});

test('the checker detects hooks but never installs or edits them', () => {
  const script = read(`${PKG}/scripts/check.sh`);
  assert.match(script, /lingxi-emit/, 'both install routes should be recognised by their emit script');
  assert.match(script, /会话 hooks 已安装/);
  assert.match(script, /可选增强/, 'missing hooks is an upgrade, not a fault');
});

test('the skill limits the hooks nudge to once and forbids writing host config', () => {
  const body = read(SKILL);
  assert.match(body, /整场对话最多一次/);
  assert.match(body, /不要\*\*去写 `~\/\.workbuddy\/settings\.json`/);
});

test('the publish guide keeps the two steps people forget', () => {
  const guide = read('integrations/hosts/workbuddy/marketplace/PUBLISH-GUIDE.md');
  assert.match(guide, /审核通过 ≠ 上架/);
  assert.match(guide, /开发者信息/);
});
