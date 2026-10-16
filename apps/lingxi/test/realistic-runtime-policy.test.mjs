import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const policy = JSON.parse(read('../src-tauri/tauri.conf.json')).app.security;

test('the runtime audit page exercises the packaged CSP, including embedded glTF image fetches', () => {
  const meta = read('../app-runtime-audit.html').match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.equal(meta, policy.csp);
  for (const csp of [policy.csp, policy.devCsp]) {
    const connect = csp.split(';').find((directive) => directive.trim().startsWith('connect-src')).trim().split(/\s+/);
    // GLTFLoader uses ImageBitmapLoader.fetch(blobURL), even though the PNGs are inside the GLB.
    assert.ok(connect.includes('blob:'), 'embedded iris, nose and ear images must survive the production CSP');
  }
});
