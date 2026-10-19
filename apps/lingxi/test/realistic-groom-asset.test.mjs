import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { coatLength, createGroom } from '../src/realistic-groom.ts';

const directory = new URL('../public/characters/lingxi-realistic/current/', import.meta.url);
test('original groom is paired with this model and follows its animated skeleton without losing curvature',
  { skip: !existsSync(new URL('groom.json', directory)) }, async () => {
    const cat = readFileSync(new URL('cat.glb', directory));
    const spec = JSON.parse(readFileSync(new URL('groom.json', directory)));
    const raw = readFileSync(new URL('groom.bin', directory));
    assert.equal(spec.modelSha256, createHash('sha256').update(cat).digest('hex'), 'groom belongs to a different cat');
    assert.equal(raw.byteLength, spec.bytes);
    const bytes = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    // Parse the production geometry and animation in Node; strip only image materials,
    // which require a browser image decoder and do not affect skeleton deformation.
    async function parseGeometry(cat) {
    const oldJsonLength = cat.readUInt32LE(12);
    const json = JSON.parse(cat.subarray(20, 20 + oldJsonLength));
    delete json.images; delete json.textures; delete json.materials;
    json.meshes.forEach(m => m.primitives.forEach(p => { delete p.material; }));
    const text = Buffer.from(JSON.stringify(json));
    const padding = (4 - text.length % 4) % 4;
    const j = Buffer.concat([text, Buffer.alloc(padding, 32)]);
    const binary = cat.subarray(20 + oldJsonLength);
    const glb = Buffer.alloc(20 + j.length + binary.length);
    glb.write('glTF'); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
    glb.writeUInt32LE(j.length, 12); glb.writeUInt32LE(0x4e4f534a, 16);
    j.copy(glb, 20); binary.copy(glb, 20 + j.length);
    return new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
    }
    const model = await parseGeometry(cat);
    const patch = await parseGeometry(readFileSync(new URL('lids.glb', directory)));
    patch.scene.traverse(o => {
      if (!o.isMesh) return;
      let target;
      model.scene.traverse(n => { if (n.isMesh && (n.userData.name ?? n.name) === (o.userData.name ?? o.name)) target = n; });
      if (target) {
        target.geometry = o.geometry; target.morphTargetDictionary = { ...o.morphTargetDictionary };
        target.morphTargetInfluences = (o.morphTargetInfluences ?? []).slice();
      }
    });
    const base = model.scene.getObjectByName('LX_Body');
    const groom = createGroom({ spec, bytes }, base);
    groom.meshes.forEach(m => base.parent.add(m));
    assert.equal(groom.meshes.reduce((sum, m) => sum + m.geometry.getAttribute('position').count / 12, 0), spec.strands);
    const mixer = new THREE.AnimationMixer(model.scene);
    const walk = model.animations.find(a => a.name === 'Walk');
    mixer.clipAction(walk).play();
    for (const t of [0, .25, .75, 1.25]) {
      mixer.setTime(t);
      for (const m of groom.meshes) { if (m.morphTargetInfluences) m.morphTargetInfluences.fill(t / 2); }
      model.scene.updateMatrixWorld(true); base.skeleton.update();
      for (const mesh of groom.meshes) {
        const part = spec.parts.find(p => p.name === mesh.name);
        const positions = new Float32Array(bytes, part.positions.offset, part.positions.count);
        const joints = new Uint16Array(bytes, part.joints.offset, part.joints.count);
        const weights = new Float32Array(bytes, part.weights.offset, part.weights.count);
        for (const strand of [0, Math.floor(part.strands / 2), part.strands - 1]) {
          for (const point of [0, 2, 5]) {
            const index = strand * 6 + point;
            // the coat drawn a little shorter than groomed: each point drawn in toward its root
            const root = new THREE.Vector3().fromArray(positions, strand * 18);
            const rest = new THREE.Vector3().fromArray(positions, index * 3).sub(root).multiplyScalar(coatLength(part.name)).add(root);
            if (part.morphTarget) {
              for (const [key, mi] of Object.entries(mesh.morphTargetDictionary)) {
                const block = part.morphs[key];
                if (block) rest.addScaledVector(new THREE.Vector3().fromArray(new Float32Array(bytes, block.offset, block.count), strand * 3), mesh.morphTargetInfluences[mi]);
              }
            }
            rest.applyMatrix4(base.bindMatrix);
            const expected = new THREE.Vector3();
            for (let w = 0; w < 4; w++) {
              const offset = (part.skinPerPoint ? index : strand) * 4 + w;
              const ji = joints[offset];
              const bone = base.skeleton.bones.findIndex(b => (b.userData.name ?? b.name) === spec.jointNames[ji]);
              const transform = new THREE.Matrix4().multiplyMatrices(base.skeleton.bones[bone].matrixWorld, base.skeleton.boneInverses[bone]);
              expected.addScaledVector(rest.clone().applyMatrix4(transform), weights[offset]);
            }
            expected.applyMatrix4(base.bindMatrixInverse);
            // strands are drawn in a shuffled order (setDensity draws a leading run of them)
            const slot = mesh.userData.groomOrder.indexOf(strand);
            const actual = mesh.getVertexPosition((slot * 6 + point) * 2, new THREE.Vector3());
            assert.ok(actual.distanceTo(expected) < 1e-6, `${mesh.name}, strand ${strand}, point ${point}, t ${t}`);
          }
          const a = new THREE.Vector3().fromArray(positions, strand * 18);
          const b = new THREE.Vector3().fromArray(positions, strand * 18 + 15);
          assert.ok(a.distanceTo(b) < .3, `${mesh.name}: invalid strand length`);
        }
      }
    }
    // a small cat draws an even share of every part, each strand as opaque as the ones it stands for
    groom.setDensity(0.3);
    for (const mesh of groom.meshes) {
      const strands = mesh.userData.groomStrands;
      // (the lids' coat is drawn whole at any size - thinned, their undercoat's rows showed as rings round a closed eye)
      const share = /_LX_Lid/.test(mesh.name) ? 1 : 0.3;
      assert.equal(mesh.geometry.drawRange.count, Math.max(1, Math.round(strands * share)) * 30, mesh.name);
      assert.equal(new Set(mesh.userData.groomOrder).size, strands, `${mesh.name}: the shuffle must keep every strand`);
    }
    assert.equal(groom.density, 0.3);
    for (const mesh of groom.meshes) mesh.geometry.dispose();
    groom.material.dispose();
  });
