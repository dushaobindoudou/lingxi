import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { validateSkin, validatePersonality } from '../packages/contracts/src/index.mjs';
const root=process.cwd();
async function files(dir) {
 const out=[];
 for(const e of await readdir(dir,{withFileTypes:true})) {
  // Build output and vendored code are not ours to validate, and `target/` in particular
  // holds tens of thousands of JSON files that would make this take minutes.
  if(['.git','node_modules','.local','build','dist','target','.venv','__pycache__'].includes(e.name)) continue;
  const p=resolve(dir,e.name); out.push(...(e.isDirectory()?await files(p):[p]));
 }
 return out;
}
for(const p of await files(root)) {
 // tsconfig files are JSONC by convention (TypeScript itself allows comments in them), so
 // they are deliberately not held to strict JSON.
 if(p.endsWith('.json') && !/tsconfig[^/]*\.json$/.test(p)) {
  let v;
  try { v=JSON.parse(await readFile(p,'utf8')); }
  // Without the path, a parse failure here is a line number in a file you cannot identify.
  catch(error) { throw new Error(`${p}: ${error.message}`); }
  if(p.includes('/presets/skins/'))validateSkin(v);
  if(p.includes('/presets/personalities/'))validatePersonality(v);
 }
 if(p.endsWith('.md')) for(const m of (await readFile(p,'utf8')).matchAll(/\]\(([^)]+)\)/g)) {
  const link=m[1]; if(/^[a-z]+:|^#|^<|\$\{/.test(link))continue;
  try { await stat(resolve(dirname(p),decodeURIComponent(link.split('#')[0]))); }
  catch { throw new Error(`${p}: broken local link -> ${link}`); }
 }
}
console.log('JSON, preset contracts and local Markdown links: OK');
