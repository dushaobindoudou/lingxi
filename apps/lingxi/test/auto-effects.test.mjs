import test from 'node:test';
import assert from 'node:assert/strict';
import { createPerformanceGate } from '../src/fx/performance-gate.ts';

function fixture() {
  const calls=[];
  const player={active:null, play(id){if(id==='missing')return false;this.active=id;calls.push(id);return true;},stop(){this.active=null;calls.push('stop');}};
  return {player,calls,gate:createPerformanceGate(player,()=>calls.push('start'))};
}

test('automatic surprises require opt-in, including legacy events without an origin marker',()=>{
  const {gate,calls}=fixture();
  assert.equal(gate.play('kiss-rush'),false);assert.deepEqual(calls,[]);
  gate.setEnabled(true);
  assert.equal(gate.play('kiss-rush'),true);assert.deepEqual(calls,['kiss-rush','start']);
});

test('turning the setting off interrupts only an automatic performance',()=>{
  const {gate,player,calls}=fixture();gate.setEnabled(true);gate.play('zoomies');
  gate.setEnabled(false);assert.equal(player.active,null);assert.equal(calls.at(-1),'stop');
  gate.play('kiss-rush',false);gate.setEnabled(false);
  assert.equal(player.active,'kiss-rush');
  assert.equal(gate.play('zoomies',true),false);
});

test('a rejected unknown clip never takes over the user interaction',()=>{
  const {gate,calls}=fixture();gate.setEnabled(true);
  assert.equal(gate.play('missing',true),false);assert.deepEqual(calls,[]);
});

test('an automatic surprise yields to petting or toys while an explicit manual request can play',()=>{
  const calls=[];
  const player={active:null,play(id){this.active=id;calls.push(id);return true;},stop(){}};
  const gate=createPerformanceGate(player,()=>{},()=>false);gate.setEnabled(true);
  assert.equal(gate.play('zoomies',true),false);assert.deepEqual(calls,[]);
  assert.equal(gate.play('kiss-rush',false),true);
});
