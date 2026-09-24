import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateSkin, validatePersonality } from '../packages/contracts/src/index.mjs';
import { currentVersion } from './version.mjs';
const root=process.cwd();
// --tracked: only what git tracks. scripts/release.sh uses it - a release is built from a commit,
// and someone's half-written untracked file elsewhere in the tree is not part of it. (Untracked
// files that WOULD reach the app are caught by release.sh's own dirty check.)
const tracked=process.argv.includes('--tracked')
 ? new Set(spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).stdout.split('\0').filter(Boolean).map((f)=>resolve(root,f)))
 : null;
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

/**
 * Which of these paths git is deliberately not tracking.
 *
 * The heavy modelling material - .blend files, render sheets, evaluation frames - is excluded by
 * .gitignore on purpose (see the comment above those rules: keeping it out is what makes this
 * repo clonable). The docs that describe that material still link to it, because on the machine
 * that produced it the files really are at those paths.
 *
 * So a link pointing into an ignored path is not a broken link, it is a link to working material
 * that lives alongside the checkout rather than inside it. Failing on those meant `npm run check`
 * - and therefore `npm run validate` - could never pass on a fresh clone, which is exactly the
 * machine most likely to be running it for the first time.
 *
 * One batched `git check-ignore` rather than one per path: it is a process spawn, and there are
 * enough links here for that to matter. No git (tarball, no binary) means we cannot tell
 * intentional from broken, and reporting a false failure is worse than reporting none - so an
 * unavailable git yields an empty set and those links are simply not flagged.
 */
function ignoredPaths(paths) {
 if(!paths.length) return new Set();
 const r=spawnSync('git',['check-ignore','--stdin'],{cwd:root,input:paths.join('\n'),encoding:'utf8'});
 // 0 = some matched, 1 = none matched; anything else (128: not a repo, or git missing) is
 // "cannot tell", never a reason to fail the check.
 if(r.error||(r.status!==0&&r.status!==1)) return new Set();
 return new Set(r.stdout.split('\n').filter(Boolean));
}

// Every problem, not just the first. A check that throws on the thing it happens to reach first
// turns "fix the project" into a serial guessing game: fix, rerun, discover the next one.
const problems=[];
const missing=[];
for(const p of (await files(root)).filter((f)=>!tracked||tracked.has(f))) {
 // tsconfig files are JSONC by convention (TypeScript itself allows comments in them), so
 // they are deliberately not held to strict JSON.
 if(p.endsWith('.json') && !/tsconfig[^/]*\.json$/.test(p)) {
  let v;
  try { v=JSON.parse(await readFile(p,'utf8')); }
  // Without the path, a parse failure here is a line number in a file you cannot identify.
  catch(error) { problems.push(`${relative(root,p)}: ${error.message}`); continue; }
  try {
   if(p.includes('/presets/skins/'))validateSkin(v);
   if(p.includes('/presets/personalities/'))validatePersonality(v);
  } catch(error) { problems.push(`${relative(root,p)}: ${error.message}`); }
 }
 if(p.endsWith('.md')) for(const m of (await readFile(p,'utf8')).matchAll(/\]\(([^)]+)\)/g)) {
  const link=m[1]; if(/^[a-z]+:|^#|^<|\$\{/.test(link))continue;
  const target=resolve(dirname(p),decodeURIComponent(link.split('#')[0]));
  try { await stat(target); }
  catch { missing.push({ doc:relative(root,p), link, rel:relative(root,target) }); }
 }
}

// One version, everywhere: a release tag, the bundle's "About" and the crate must not disagree.
try { currentVersion(); } catch(error) { problems.push(`${error.message}\n  fix: node scripts/version.mjs <version>`); }

const ignored=ignoredPaths(missing.map((m)=>m.rel));
const excused=missing.filter((m)=>ignored.has(m.rel));
for(const m of missing.filter((x)=>!ignored.has(x.rel))) problems.push(`${m.doc}: broken local link -> ${m.link}`);

if(problems.length) {
 for(const p of problems) console.error(`  ${p}`);
 throw new Error(`${problems.length} problem(s) - see above`);
}
// Say so rather than passing silently: "OK" on a machine where a documented asset is absent
// should not look identical to "OK" on the machine that has it.
if(excused.length) console.log(`${excused.length} link(s) point at git-ignored working material (not in this checkout) - see .gitignore`);
console.log(`JSON, preset contracts, local Markdown links and version ${currentVersion()}: OK`);
