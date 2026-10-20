import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

test('the real CLI obeys opt-in and cooldown, and labels explicit manual requests',async()=>{
  let policy, posted=[];
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.url==='/capabilities')return res.end(JSON.stringify(policy===undefined?{}:{autoEffects:policy}));
    if(req.url==='/control') {
      let raw='';for await(const chunk of req)raw+=chunk;
      posted.push(JSON.parse(raw));
    }
    res.end('{"ok":true,"applied":["perform"]}');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const env={...process.env,LINGXI_PORT:String(server.address().port),LINGXI_TOKEN:'test-only-token',
    LINGXI_AGENT:'codex',LINGXI_AUTOSTART:'0',LINGXI_PRIORITY:''};
  const run=(...args)=>promisify(execFile)('bash',[fileURLToPath(new URL('../cli/lingxi',import.meta.url)),'perform','zoomies',...args],{env,timeout:15000});
  try {
    for(const disabled of [undefined,{enabled:false},{enabled:true,remainingCooldownMs:1000}]) {
      policy=disabled;await run();assert.deepEqual(posted,[]);
    }
    policy={enabled:true,remainingCooldownMs:0};await run();
    assert.deepEqual(posted.pop(),{perform:'zoomies',performAutomatic:true,priority:'flavour',agent:'codex'});
    policy={enabled:false};await run('--manual');
    assert.deepEqual(posted.pop(),{perform:'zoomies',performAutomatic:false,priority:'report',agent:'codex'});
    policy=undefined;await run('--manual');
    assert.deepEqual(posted.pop(),{perform:'zoomies',priority:'report',agent:'codex'});
    await assert.rejects(run('--not-a-mode'));
  } finally {await new Promise(resolve=>server.close(resolve));}
});
