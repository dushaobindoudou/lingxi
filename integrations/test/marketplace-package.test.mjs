// The skill-market package (integrations/hosts/workbuddy/marketplace/) is not a copy of the host
// plugin: it ships to people who never ran install.sh, so it must not assume hooks, an MCP trust
// gate, or a host layer exists. Those same people will not go to GitHub for a dmg either, so when
// the app is missing the skill asks once and, on a yes, installs it with the shared installer. These tests keep it self-contained and keep the platform's
// packaging rules (frontmatter fields, two-level depth, scripts/ entry point) from drifting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { platform, tmpdir } from 'node:os';
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

test('the skill states the macOS limit and installs only through install.sh, after the user agrees', () => {
  const body = read(SKILL);
  assert.match(body, /macOS/, 'the skill must say it only works on macOS');
  assert.match(body, /bash scripts\/install\.sh/, 'a missing app is installed for the user, not left to them');
  assert.match(body, /同意/, 'installing touches the user\'s machine: ask first');
  assert.match(body, /用户拒绝或没回应 → 不装/);
  assert.match(body, /releases\/latest/, 'the download page stays as the fallback when install.sh fails');
  for (const diy of ['hdiutil attach', 'curl -fL', 'curl -L', 'ditto ']) {
    assert.ok(!body.includes(diy), `the model must not hand-roll an install ("${diy}")`);
  }
  // `update` replaces the app from GitHub Releases - never something the model should trigger.
  assert.ok(!/scripts\/lingxi\.sh update/.test(body), 'the skill must not call update');
  const head = frontmatter(body);
  assert.match(head, /^description:.*同意.*安装/m, 'the listing must disclose that the skill can install the app');
  assert.match(head, /^description_en:.*install/m);
});

test('install.sh installs as the workbuddy host and opens the app', () => {
  const script = read(`${PKG}/scripts/install.sh`);
  assert.equal(spawnSync('bash', ['-n', join(REPO, PKG, 'scripts/install.sh')]).status, 0);
  assert.match(script, /LINGXI_HOST="\$\{LINGXI_HOST:-workbuddy\}"/);
  assert.match(script, /exec bash "\$DIR\/install-app\.sh" --open/, 'call through bash: unzip may drop the exec bit');
});

test('install.sh downloads, verifies and installs a release end to end', { skip: platform() !== 'darwin' && 'macOS only' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'lingxi-market-'));
  const home = join(root, 'home');
  const bin = join(root, 'bin');
  const dest = join(root, 'Applications');
  const app = join(dest, '灵犀.app');
  for (const dir of [home, bin]) mkdirSync(dir, { recursive: true });
  const stub = (name, body) => { writeFileSync(join(bin, name), `#!/bin/bash\n${body}\n`); chmodSync(join(bin, name), 0o755); };
  stub('open', `printf '%s\\n' "$*" >> '${root}/opened'`);
  stub('curl', 'exit 7'); // the bridge never answers: install, open, then give up waiting quietly

  const stage = join(root, 'stage', '灵犀.app');
  mkdirSync(join(stage, 'Contents/MacOS'), { recursive: true });
  writeFileSync(join(stage, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.dushaobin.lingxi-desktop</string>
<key>CFBundleShortVersionString</key><string>9.8.0</string>
<key>CFBundleExecutable</key><string>lingxi</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>`);
  writeFileSync(join(stage, 'Contents/MacOS/lingxi'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(stage, 'Contents/MacOS/lingxi'), 0o755);
  assert.equal(spawnSync('codesign', ['--force', '--deep', '--sign', '-', stage]).status, 0, 'codesign failed');
  const release = join(root, 'release');
  mkdirSync(release);
  const dmg = join(release, 'Lingxi-9.8.0-universal.dmg');
  assert.equal(spawnSync('hdiutil', ['create', '-quiet', '-fs', 'HFS+', '-srcfolder', join(root, 'stage'), '-volname', 'Lingxi', dmg]).status, 0);
  const sum = spawnSync('shasum', ['-a', '256', dmg], { encoding: 'utf8' }).stdout.split(' ')[0];
  writeFileSync(join(release, 'SHA256SUMS.txt'), `${sum}  Lingxi-9.8.0-universal.dmg\n`);

  const r = spawnSync('bash', [join(REPO, PKG, 'scripts/install.sh'), '--from', release, '--dest', dest], {
    env: { PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8',
      LINGXI_APP_PATH: app, LINGXI_CONFIG_DIR: join(root, 'config'), LINGXI_NO_SPOTLIGHT: '1' },
    encoding: 'utf8', timeout: 120000,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ 灵犀 9\.8\.0 已安装/);
  assert.ok(existsSync(join(app, 'Contents/Info.plist')), 'the app landed in the destination');
  assert.ok(existsSync(join(home, '.lingxi/workbuddy/install.state')), 'progress is filed under the workbuddy host');
  assert.ok(existsSync(join(root, 'opened')), 'the app is opened once installed');
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
  assert.match(read(`${PKG}/scripts/check.sh`), /bash scripts\/install\.sh/, 'app-missing names the installer');
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
