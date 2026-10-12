// Dev-only evidence capture. Run with the apps/lingxi Vite server on port 1420.
import {createRequire} from 'node:module';
import {homedir} from 'node:os';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
let playwrightModule=process.env.PLAYWRIGHT_MODULE;
if(!playwrightModule){
  try{playwrightModule=require.resolve('playwright');}
  catch{playwrightModule=resolve(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');}
}
if(!existsSync(playwrightModule))throw new Error('Set PLAYWRIGHT_MODULE to your installed playwright module file.');
const {chromium}=await import(pathToFileURL(playwrightModule).href);
const chrome=process.env.CHROME_BIN??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser=await chromium.launch({headless:true,...(existsSync(chrome)?{executablePath:chrome}:{})});
try{
  const page=await browser.newPage({viewport:{width:1500,height:1820},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.goto((process.env.AUDIT_URL??'http://127.0.0.1:1420')+'/model-audit.html');
  await page.waitForFunction(()=>window.modelAudit);
  await page.evaluate(()=>document.fonts.ready);
  if(errors.length)throw new Error(errors.join('\n'));
  const out=resolve(process.env.AUDIT_OUT??'docs/evidence/model-audit-2026-10-10');mkdirSync(out,{recursive:true});
  await page.screenshot({path:resolve(out,'comparison.png'),fullPage:true});
  for(const id of ['loaf','candidate','side-nap','paw-detail','paw-bottom','mouth-open','mouth-side'])await page.locator(`[data-id="${id}"]`).screenshot({path:resolve(out,id+'.png')});
  const result=await page.evaluate(()=>window.modelAudit);
  writeFileSync(resolve(out,'measurements.json'),JSON.stringify(result,null,2)+'\n');
  const sample=id=>result.measurements.find(row=>row.id===id).parts;
  const stand=sample('stand'),loaf=sample('loaf');
  // These are explicitly proposed acceptance bounds, not universal anatomical constants.
  const checks=[
    ['standing: all four sole gaps <= 0.15 voxel',Math.max(...['pawFL','pawFR','pawBL','pawBR'].map(id=>stand[id].minY))<=.15],
    ['loaf: chest underside <= 1.0 voxel',loaf.spine1.minY<=1],
    ['sleep: no return to standing after entering sleep',result.sleepSamples.filter(row=>row.time>=2).every(row=>row.loaf>=.95)],
  ];
  for(const [name,ok]of checks)console.log(`${ok?'PASS':'FAIL'} ${name}`);
  console.log(`Evidence saved: ${out}`);
  if(!checks.every(([,ok])=>ok))process.exitCode=2; // Expected red on the audited model.
}finally{await browser.close();}
