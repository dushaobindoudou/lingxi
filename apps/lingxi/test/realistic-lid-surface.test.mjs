import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rebuildLidMorphNormals, createLidFuzz } from '../src/realistic-lid-surface.ts';

test('a closing lid carries both its lighting normal and fur direction onto its sculpted surface', () => {
  for (const relative of [true, false]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0], 3));
    geometry.morphTargetsRelative = relative;
    geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(relative
      ? [0,0,0, -1,0,1, 0,0,0] : [0,0,0, 0,0,1, 0,1,0], 3)];
    const original = Array.from(geometry.morphAttributes.position[0].array);
    rebuildLidMorphNormals(geometry);
    for (let i = 0; i < 3; i++) {
      const open = new THREE.Vector3().fromBufferAttribute(geometry.getAttribute('normal'), i);
      const shut = new THREE.Vector3().fromBufferAttribute(geometry.morphAttributes.normal[0], i);
      if (relative) shut.add(open);
      assert.ok(open.distanceTo(new THREE.Vector3(0,0,1)) < 1e-6);
      assert.ok(shut.distanceTo(new THREE.Vector3(-1,0,0)) < 1e-6);
    }
    assert.deepEqual(Array.from(geometry.morphAttributes.position[0].array), original, 'normal repair must preserve the sculpted positions');
    geometry.dispose();
  }
});

test('scattered eyelid hairs follow a closing surface and stay outside its 0.8 mm undercoat', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, .1,0,0, 0,.1,0], 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(Array(3).fill([.5,.4,.3]).flat(), 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(12).fill(0), 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1,0,0,0, 1,0,0,0, 1,0,0,0], 4));
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute([0,0,0, -.1,0,.1, 0,0,0], 3)];
  rebuildLidMorphNormals(geometry);
  const lid = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
  lid.name = 'LX_LidUpperL';
  const bone = new THREE.Bone(); lid.add(bone); lid.bind(new THREE.Skeleton([bone]));
  lid.morphTargetDictionary = {Blink:0}; lid.morphTargetInfluences = [0];
  const fuzz = createLidFuzz(lid,64);
  assert.equal(fuzz.morphTargetInfluences,lid.morphTargetInfluences);
  assert.equal(fuzz.skeleton,lid.skeleton);
  assert.equal(fuzz.geometry.getAttribute('position').count,256);
  bone.updateMatrixWorld(true);lid.skeleton.update();
  for(const key of [0,1]){
    lid.morphTargetInfluences[0] = key;
    for(let h=0;h<64;h++){
      const root = fuzz.getVertexPosition(h*4,new THREE.Vector3());
      assert.ok(Number.isFinite(root.x+root.y+root.z));
      assert.ok(key ? root.x < -.001 : root.z > .001, 'the hair root must remain above the undercoat while blinking');
    }
  }
  const again = createLidFuzz(lid,64);
  assert.deepEqual(fuzz.geometry.getAttribute('position').array,again.geometry.getAttribute('position').array,'loading again must not reshuffle roots');
  fuzz.geometry.dispose();fuzz.material.dispose();again.geometry.dispose();again.material.dispose();geometry.dispose();lid.material.dispose();
});
