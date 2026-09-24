#!/usr/bin/env node
// The app's version lives in seven places, and a release is only coherent when they agree.
//
//   node scripts/version.mjs           print every one, exit 1 if they disagree
//   node scripts/version.mjs 0.2.0     set all of them
//
// Why all seven and not just tauri.conf.json: the bundle's CFBundleShortVersionString comes from
// tauri.conf.json, but the Rust crate, both npm packages and their lockfiles each carry their own
// copy. Bumping one leaves a build whose "About" says one thing and whose crate metadata, lockfile
// and release tag say another - and a lockfile whose root version disagrees with its
// package.json is the kind of noise that makes a later `npm ci` diff unreadable.
//
// packages/mcp-server is versioned on its own on purpose: it talks to whichever app is running,
// and its protocol does not change because the app did.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const json = (path) => ({
  path,
  read: () => JSON.parse(readFileSync(root + path, 'utf8')),
  write: (data) => writeFileSync(root + path, `${JSON.stringify(data, null, 2)}\n`),
});

/** Each place a version lives: how to read it and how to set it. */
const FIELDS = [
  { ...json('apps/lingxi/src-tauri/tauri.conf.json'), get: (d) => d.version, set: (d, v) => { d.version = v; } },
  { ...json('package.json'), get: (d) => d.version, set: (d, v) => { d.version = v; } },
  { ...json('package-lock.json'), get: (d) => d.version, set: (d, v) => { d.version = v; d.packages[''].version = v; } },
  { ...json('apps/lingxi/package.json'), get: (d) => d.version, set: (d, v) => { d.version = v; } },
  { ...json('apps/lingxi/package-lock.json'), get: (d) => d.version, set: (d, v) => { d.version = v; d.packages[''].version = v; } },
  {
    path: 'apps/lingxi/src-tauri/Cargo.toml',
    read: () => readFileSync(`${root}apps/lingxi/src-tauri/Cargo.toml`, 'utf8'),
    write: (text) => writeFileSync(`${root}apps/lingxi/src-tauri/Cargo.toml`, text),
    // The [package] table's version - the first `version =` line, before any dependency table.
    get: (text) => text.match(/^\[package\][^[]*?^version\s*=\s*"([^"]+)"/ms)?.[1],
    set: (text, v) => text.replace(/^(\[package\][^[]*?^version\s*=\s*")[^"]+(")/ms, `$1${v}$2`),
  },
  {
    path: 'apps/lingxi/src-tauri/Cargo.lock',
    read: () => readFileSync(`${root}apps/lingxi/src-tauri/Cargo.lock`, 'utf8'),
    write: (text) => writeFileSync(`${root}apps/lingxi/src-tauri/Cargo.lock`, text),
    get: (text) => text.match(/^name = "lingxi"\nversion = "([^"]+)"/m)?.[1],
    set: (text, v) => text.replace(/^(name = "lingxi"\nversion = ")[^"]+(")/m, `$1${v}$2`),
  },
];

export function readVersions() {
  return FIELDS.map((field) => ({ path: field.path, version: field.get(field.read()) ?? null }));
}

export function currentVersion() {
  const versions = readVersions();
  const distinct = [...new Set(versions.map((v) => v.version))];
  if (distinct.length !== 1 || !distinct[0]) {
    throw new Error(`versions disagree:\n${versions.map((v) => `  ${v.version}\t${v.path}`).join('\n')}`);
  }
  return distinct[0];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const wanted = process.argv[2];
  if (wanted) {
    const bare = wanted.replace(/^v/, '');
    if (!SEMVER.test(bare)) {
      console.error(`"${wanted}" is not a version like 0.2.0 or 0.2.0-beta.1`);
      process.exit(1);
    }
    for (const field of FIELDS) {
      const data = field.read();
      const next = field.set(data, bare) ?? data;
      if (field.get(next) !== bare) {
        console.error(`could not set the version in ${field.path} - its layout is not what this script expects`);
        process.exit(1);
      }
      field.write(next);
    }
  }
  const versions = readVersions();
  for (const { path, version } of versions) console.log(`${version ?? '(missing)'}\t${path}`);
  try {
    console.log(`\nversion ${currentVersion()}`);
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exit(1);
  }
}
