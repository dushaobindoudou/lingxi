// node --experimental-strip-types --test scripts/test-voxel-texture-import.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mappedUVs,parseTextureConfig,readPngSize} from '../apps/lingxi/src/style-lab/texture-import.ts';
const node={id:'head',box:{size:[8,4,2]},parent:null,pivot:[0,0,0],slot:'fur'};
const config={format:'lingxi-texture',schemaVersion:1,rigId:'test',textureSize:[256,128],mapping:{mode:'tile',tileSize:8},filter:'nearest',faces:{}};
test('arbitrary rectangular PNG supported; oversized dimensions rejected before decode',()=>{
 const bytes=fs.readFileSync(new URL('../assets/characters/lingxi/voxel-style-kit/import-examples/colour-check.png',import.meta.url));
 assert.deepEqual(readPngSize(bytes.subarray(0,24)),[256,128]);
 const huge=Buffer.from(bytes.subarray(0,24));huge.writeUInt32BE(65536,16);assert.throws(()=>readPngSize(huge),/4096/);
 assert.throws(()=>readPngSize(new Uint8Array(24)),/有效 PNG/);
});
test('tile preserves source aspect and consistent physical density across faces',()=>{
 const uv=mappedUVs(node,config); // +X is 2x4 units; +Z is 8x4 units.
 assert.equal(uv[2],.125);assert.equal(uv[5],.5);
 assert.equal(uv[34],.5);assert.equal(uv[37],.5);
});
test('cover crops centered without stretching a non-square source',()=>{
 const uv=mappedUVs(node,{...config,mapping:{mode:'cover',tileSize:8}});
 assert.equal(uv[0],.375);assert.equal(uv[2],.625); // narrow side crops source horizontally.
 assert.deepEqual(Array.from(uv.slice(32,40)),[0,1,1,1,0,0,1,0]); // front matches 2:1 source.
});
test('JSON per-face override follows top-left pixel origin while other faces tile',()=>{
 const c=parseTextureConfig({...config,faces:{head:{pz:[0,0,32,32]}}},[node],'test',256,128);
 const uv=mappedUVs(node,c);
 assert.equal(uv[32],.5/256);assert.equal(uv[33],1-.5/128);
 assert.equal(uv[34],31.5/256);assert.equal(uv[37],1-31.5/128);
 assert.equal(uv[2],.125);
});
test('reject incompatible or malformed JSON before touching the model',()=>{
 for(const bad of [
  {...config,rigId:'other'}, {...config,textureSize:[128,128]},
  {...config,faces:{missing:{pz:[0,0,1,1]}}}, {...config,faces:{head:{pz:[250,0,32,32]}}},
  {...config,faces:{head:{pz:[0,0,-1,1]}}}, {...config,faces:{head:{north:[0,0,1,1]}}},
  {...config,mapping:{mode:'tile',tileSize:0}}, {...config,mapping:{mode:'anything'}},
 ])assert.throws(()=>parseTextureConfig(bad,[node],'test',256,128));
});
test('atlas requires explicit layout; all six faces receive finite UVs',()=>{
 assert.throws(()=>mappedUVs(node,{...config,mapping:{mode:'atlas',tileSize:8}}),/缺少/);
 for(const mode of ['tile','cover']){const uv=mappedUVs(node,{...config,mapping:{mode,tileSize:8}});assert.equal(uv.length,48);assert.ok(Array.from(uv).every(Number.isFinite));}
});
test('previous exported skin manifests remain importable with explicit UV',()=>{
 const previous={format:'lingxi-skin',schemaVersion:1,rigId:'test',texture:{width:256,height:128,filter:'nearest'},uv:{head:{pz:[0,0,32,32]}}};
 const parsed=parseTextureConfig(previous,[node],'test',256,128);
 assert.deepEqual(parsed.faces.head.pz,[0,0,32,32]);assert.equal(parsed.mapping.mode,'cover');
});
