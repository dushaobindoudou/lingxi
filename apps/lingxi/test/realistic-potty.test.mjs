import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { digHead, digPaw, POTTY_DIG, POTTY_SQUAT, smooth01 } from '../src/realistic-potty.ts';
import { placePaw } from '../src/realistic-locomotion.ts';

test('squat lift leaves room below the rump while its spread keeps the rear paws planted', () => {
  // From the shipped Sit frame: pelvis 0.156 m, rear paw 0.062 m, front paw 0.064 m.
  assert.ok(POTTY_SQUAT.rumpLift > 0.05);
  assert.ok(0.156 + POTTY_SQUAT.rumpLift - 0.062 > 0.15);
  assert.ok(POTTY_SQUAT.hindSpread > 0 && POTTY_SQUAT.hindSpread < 0.03);
  assert.equal(smooth01(0), 0);
  assert.equal(smooth01(1), 1);
});

test('four alternating scratches lift, reach, scrape at floor height, and recover', () => {
  for (let stroke = 0; stroke < POTTY_DIG.strokes; stroke++) {
    const start = POTTY_DIG.leadIn + stroke * POTTY_DIG.strokeSeconds;
    const active = stroke % 2 === 0 ? 'L' : 'R';
    const resting = active === 'L' ? 'R' : 'L';
    const lift = digPaw(start + POTTY_DIG.strokeSeconds * 0.27, active);
    const scrape = digPaw(start + POTTY_DIG.strokeSeconds * 0.75, active);
    assert.ok(lift.y > 0.04 && lift.z > 0.05, `stroke ${stroke} reaches forward`);
    assert.ok(scrape.y >= 0 && scrape.y < 0.001 && scrape.z < -0.04, `stroke ${stroke} scrapes backward on the floor`);
    assert.deepEqual(digPaw(start + POTTY_DIG.strokeSeconds * 0.27, resting), { y: 0, z: 0 });
  }
  for (const side of ['L', 'R']) assert.deepEqual(digPaw(POTTY_DIG.sniffAt, side), { y: 0, z: 0 });
});

test('head looks down for scratching then dips for one final sniff', () => {
  assert.deepEqual(digHead(0), { neck: 0, head: 0 });
  const digging = digHead(0.8), sniff = digHead(3.4), end = digHead(3.95);
  assert.ok(digging.neck > 0.17 && digging.head > 0.15);
  assert.ok(sniff.neck > digging.neck && sniff.head > digging.head);
  assert.ok(end.neck < sniff.neck && end.head < sniff.head);
});

test('the shipped Sit skeleton can lift its rump with planted hind paws and stationary forequarters', async () => {
  const cat = readFileSync(new URL('../public/characters/lingxi-realistic/current/cat.glb', import.meta.url));
  const jsonLength = cat.readUInt32LE(12);
  const json = JSON.parse(cat.subarray(20, 20 + jsonLength));
  delete json.images; delete json.textures; delete json.materials;
  json.meshes.forEach(mesh => mesh.primitives.forEach(primitive => { delete primitive.material; }));
  const text = Buffer.from(JSON.stringify(json));
  const padded = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)]);
  const glb = Buffer.alloc(20 + padded.length + cat.length - 20 - jsonLength);
  glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(glb, 20); cat.subarray(20 + jsonLength).copy(glb, 20 + padded.length);
  const asset = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  const model = asset.scene, mixer = new THREE.AnimationMixer(model);
  const sit = asset.animations.find(clip => clip.name === 'Sit');
  mixer.clipAction(sit).play(); mixer.setTime(sit.duration * 0.5);
  model.updateWorldMatrix(true, true);
  const pelvis = model.getObjectByName('Pelvis'), chest = model.getObjectByName('Chest');
  const chestPoint = chest.getWorldPosition(new THREE.Vector3());
  const paws = ['L', 'R'].map(side => {
    const upper = model.getObjectByName(`RearUpper${side}`);
    const lower = model.getObjectByName(`RearLower${side}`);
    const paw = model.getObjectByName(`RearPaw${side}`);
    return { upper, lower, paw, target: paw.getWorldPosition(new THREE.Vector3()) };
  });
  pelvis.position.y += POTTY_SQUAT.rumpLift;
  pelvis.position.z += POTTY_SQUAT.rumpForward;
  pelvis.updateWorldMatrix(false, true);
  chest.position.copy(chest.parent.worldToLocal(chestPoint.clone()));
  chest.updateWorldMatrix(false, true);
  paws.forEach(({ upper, lower, paw, target }, i) => {
    target.x += (i ? 1 : -1) * POTTY_SQUAT.hindSpread;
    placePaw(upper, lower, paw, target);
    assert.ok(paw.getWorldPosition(new THREE.Vector3()).distanceTo(target) < 1e-4, `rear paw ${i} stays at floor height`);
    assert.ok(target.y > 0.05 && target.y < 0.07);
  });
  assert.ok(chest.getWorldPosition(new THREE.Vector3()).distanceTo(chestPoint) < 1e-6);
  const clearance = pelvis.getWorldPosition(new THREE.Vector3()).y - paws[0].target.y;
  assert.ok(clearance > 0.15, `rump to paw clearance ${clearance}`);
});
