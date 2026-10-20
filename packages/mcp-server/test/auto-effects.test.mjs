import test from 'node:test';
import assert from 'node:assert/strict';
import { tools } from '../src/tools.mjs';
import { bridge } from '../src/bridge.mjs';

const perform=tools.find(tool=>tool.name==='lingxi_perform');

async function fixture(policy, run) {
  const original={capabilities:bridge.capabilities,control:bridge.control};
  const posted=[];
  bridge.capabilities=async()=>policy===undefined?{}:{autoEffects:policy};
  bridge.control=async body=>{posted.push(body);return{applied:[`perform=${body.perform}`]};};
  try {await run(posted);}finally{Object.assign(bridge,original);}
}

test('automatic MCP effects skip disabled, cooling-down and older apps without posting a control',async()=>{
  for(const policy of [undefined,{enabled:false},{enabled:true,remainingCooldownMs:1000}]) {
    await fixture(policy,async posted=>{
      const result=await perform.run({id:'zoomies'});
      assert.equal(result.data.skipped,true);assert.deepEqual(posted,[]);
    });
  }
});

test('automatic MCP effects identify themselves and use a priority that will not wait behind work',async()=>{
  await fixture({enabled:true,remainingCooldownMs:0},async posted=>{
    await perform.run({id:'zoomies'});
    assert.deepEqual(posted,[{perform:'zoomies',performAutomatic:true,priority:'flavour'}]);
  });
});

test('explicit manual playback works with the setting off and with older apps',async()=>{
  await fixture({enabled:false},async posted=>{
    await perform.run({id:'kiss-rush',automatic:false});
    assert.deepEqual(posted,[{perform:'kiss-rush',performAutomatic:false,priority:'report'}]);
  });
  await fixture(undefined,async posted=>{
    await perform.run({id:'kiss-rush',automatic:false});
    assert.deepEqual(posted,[{perform:'kiss-rush',priority:'report'}]);
  });
});

test('a backend refusal is surfaced instead of being reported as a performed surprise',async()=>{
  await fixture({enabled:true,remainingCooldownMs:0},async()=>{
    bridge.control=async()=>{throw new Error('automatic effects are disabled by the user');};
    await assert.rejects(perform.run({id:'zoomies'}),/disabled by the user/);
  });
});
