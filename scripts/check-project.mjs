import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { validateSkin, validatePersonality } from '../packages/contracts/src/index.mjs';
const root=process.cwd();
async function files(dir) {
 const out=[];
 for(const e of await readdir(dir,{withFileTypes:true})) {
  if(['.git','node_modules','.local','build','dist'].includes(e.name)) continue;
  const p=resolve(dir,e.name); out.push(...(e.isDirectory()?await files(p):[p]));
 }
 return out;
}
for(const p of await files(root)) {
 if(p.endsWith('.json')) {const v=JSON.parse(await readFile(p,'utf8')); if(p.includes('/presets/skins/'))validateSkin(v); if(p.includes('/presets/personalities/'))validatePersonality(v);}
 if(p.endsWith('.md')) for(const m of (await readFile(p,'utf8')).matchAll(/\]\(([^)]+)\)/g)) {
  const link=m[1]; if(/^[a-z]+:|^#/.test(link))continue;
  await stat(resolve(dirname(p),decodeURIComponent(link.split('#')[0])));
 }
}
console.log('JSON, preset contracts and local Markdown links: OK');
