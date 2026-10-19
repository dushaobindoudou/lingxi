import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import * as THREE from 'three';
import { stationaryJump, holdBellyPose } from '../src/realistic-play.ts';
import { readMotion } from './helpers/realistic-motion-asset.mjs';

const available=existsSync(new URL('../public/characters/lingxi-realistic/current/cat.glb',import.meta.url));

test('the shipped realistic jump leaves the floor and lands without baked horizontal travel', {skip:!available},()=>{
  const {root,nodes,clips}=readMotion(false,['Jump']);
  const bone=nodes.find(n=>n.name==='Root');
  for(const track of clips.Jump.clip.tracks) if(track.name===`${bone.uuid}.position`) track.name='Root.position';
  const jump=stationaryJump(clips.Jump.clip);
  const mixer=new THREE.AnimationMixer(root);
  const action=mixer.clipAction(jump);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
  mixer.setTime(0);const start=bone.position.clone();
  let maxY=start.y;
  for(let t=0;t<=jump.duration;t+=1/60){mixer.setTime(t);maxY=Math.max(maxY,bone.position.y);assert.ok(Math.abs(bone.position.z-start.z)<1e-5);}
  assert.ok(maxY>start.y+.2,'the real Jump must visibly lift, not just bend the legs');
  mixer.setTime(jump.duration);assert.ok(Math.abs(bone.position.y-start.y)<1e-5,'land at the launch height');
});

test('the shipped belly pose holds every animated transform while leaving the source asset unchanged', {skip:!available},()=>{
  const {clips}=readMotion(false,['BellyUp']);
  const source=clips.BellyUp.clip, before=source.tracks.map(t=>Array.from(t.values));
  const held=holdBellyPose(source);
  assert.ok(held.duration>8);
  for(let i=0;i<held.tracks.length;i++) {
    const track=held.tracks[i];
    const a=Array.from(track.InterpolantFactoryMethodLinear().evaluate(1.5));
    const b=Array.from(track.InterpolantFactoryMethodLinear().evaluate(6));
    assert.deepEqual(a,b,`pose drift in ${track.name}`);
    assert.deepEqual(Array.from(source.tracks[i].values),before[i]);
    assert.equal(track.times.at(-1),Math.fround(source.tracks[i].times.at(-1)+6));
  }
});
