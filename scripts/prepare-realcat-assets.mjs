#!/usr/bin/env node
// Production character assets are explicit, hashed inputs. Local look-dev files are never copied wholesale.
import { readFileSync, existsSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const realcatManifest = JSON.parse(readFileSync(join(root, 'apps/lingxi/src/data/realistic-assets.json'), 'utf8'));
export const realcatSource = join(root, 'apps/lingxi/public', realcatManifest.directory);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function verifyRealcatAssets(directory = realcatSource) {
  for (const [name, expected] of Object.entries(realcatManifest.files)) {
    const path = join(directory, name);
    if (!existsSync(path)) throw new Error(`Missing realistic cat asset ${path}; run node scripts/prepare-realcat-assets.mjs`);
    const bytes = readFileSync(path);
    if (bytes.byteLength !== expected.bytes || sha256(bytes) !== expected.sha256) throw new Error(`Realistic cat asset does not match the release manifest: ${path}`);
  }
  const groom = JSON.parse(readFileSync(join(directory, 'groom.json'), 'utf8'));
  if (groom.modelSha256 !== realcatManifest.files['cat.glb'].sha256 || groom.bytes !== realcatManifest.files['groom.bin'].bytes) {
    throw new Error('The realistic cat and its groom do not belong together');
  }
}

export function copyRealcatAssets(dist) {
  verifyRealcatAssets();
  const destination = join(dist, realcatManifest.directory);
  mkdirSync(destination, { recursive: true });
  for (const name of Object.keys(realcatManifest.files)) copyFileSync(join(realcatSource, name), join(destination, name));
}

export async function prepareRealcatAssets() {
  try { verifyRealcatAssets(); console.log('Realistic cat: all 6 production assets verified'); return; } catch { /* restore from pinned archive */ }
  const staging = mkdtempSync(join(tmpdir(), 'lingxi-realcat-'));
  try {
    console.log('Downloading the pinned realistic cat runtime assets…');
    const archive = join(staging, 'runtime.tar.gz');
    // curl respects the developer's proxy settings, unlike Node 22's built-in fetch.
    execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--retry', '2',
      '--connect-timeout', '15', '--max-time', '180', '--output', archive, realcatManifest.archive.url], { stdio: 'inherit' });
    if (sha256(readFileSync(archive)) !== realcatManifest.archive.sha256) throw new Error('Realistic cat archive checksum mismatch');
    const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n').sort();
    if (JSON.stringify(entries) !== JSON.stringify(Object.keys(realcatManifest.files).sort())) throw new Error('Unexpected paths in realistic cat archive');
    const extracted = join(staging, 'files');
    mkdirSync(extracted);
    execFileSync('tar', ['-xzf', archive, '-C', extracted]);
    verifyRealcatAssets(extracted);
    mkdirSync(realcatSource, { recursive: true });
    for (const name of Object.keys(realcatManifest.files)) copyFileSync(join(extracted, name), join(realcatSource, name));
    console.log('Realistic cat runtime installed and verified');
  } finally { rmSync(staging, { recursive: true, force: true }); }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await prepareRealcatAssets();
}
