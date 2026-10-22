import * as THREE from 'three';
/** GLB lids carry position-only shape keys. Rebuild their normals after the closed dome is sculpted, once at load.
 * Keeping the open eye's normals made a shut lid look flat and sent its short fur in the open rim's direction. */
export function rebuildLidMorphNormals(geometry: THREE.BufferGeometry): void {
    const position = geometry.getAttribute('position');
    const keys = geometry.morphAttributes.position;
    if (!position || !keys?.length)
        return;
    const surface = new THREE.BufferGeometry();
    surface.setIndex(geometry.getIndex());
    const posed = new THREE.BufferAttribute(new Float32Array(position.count * 3), 3);
    surface.setAttribute('position', posed);
    const normalsAt = (key?: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
        for (let i = 0; i < position.count; i++)
            for (let c = 0; c < 3; c++) {
                posed.setComponent(i, c, key ? key.getComponent(i, c) + (geometry.morphTargetsRelative ? position.getComponent(i, c) : 0) : position.getComponent(i, c));
            }
        surface.computeVertexNormals();
        return surface.getAttribute('normal').clone() as THREE.BufferAttribute;
    };
    const basis = normalsAt();
    geometry.setAttribute('normal', basis);
    geometry.morphAttributes.normal = keys.map(key => {
        const normal = normalsAt(key);
        if (geometry.morphTargetsRelative)
            for (let i = 0; i < normal.count; i++)
                for (let c = 0; c < 3; c++) {
                    normal.setComponent(i, c, normal.getComponent(i, c) - basis.getComponent(i, c));
                }
        return normal;
    });
    surface.dispose();
}
/** Fine hairs with irregular triangle-sampled roots. Shares the lid's pose and shape-key weights. */
export function createLidFuzz(lid: THREE.SkinnedMesh, count = 1100, eyeCentre?: THREE.Vector3): THREE.SkinnedMesh {
    const g = lid.geometry, p = g.getAttribute('position'), col = g.getAttribute('color'), normals = g.getAttribute('normal');
    const joints = g.getAttribute('skinIndex'), weights = g.getAttribute('skinWeight'), ix = g.getIndex();
    const at = (i: number) => ix ? ix.getX(i) : i, areas: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let total = 0, seed = /Upper/.test(lid.userData.name ?? lid.name) ? 9173 : 2909;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
        a.fromBufferAttribute(p, at(i));
        b.fromBufferAttribute(p, at(i + 1));
        c.fromBufferAttribute(p, at(i + 2));
        total += b.sub(a).cross(c.sub(a)).length() * .5;
        areas.push(total);
    }
    const positions = new Float32Array(count * 12), colors = new Float32Array(count * 12);
    const ji = new Uint16Array(count * 16), sw = new Float32Array(count * 16), indices: number[] = [];
    const keys = g.morphAttributes.position ?? [], morphs = keys.map(() => new Float32Array(count * 12));
    const direction = /Upper/.test(lid.userData.name ?? lid.name) ? -1 : 1;
    const root = new THREE.Vector3(), normal = new THREE.Vector3(), tangent = new THREE.Vector3(), across = new THREE.Vector3(), point = new THREE.Vector3();
    for (let h = 0; h < count; h++) {
        const sample = random() * total;
        let lo = 0, hi = areas.length - 1;
        while (lo < hi) {
            const m = (lo + hi) >>> 1;
            if (areas[m] < sample)
                lo = m + 1;
            else
                hi = m;
        }
        const verts = [at(lo * 3), at(lo * 3 + 1), at(lo * 3 + 2)], u = Math.sqrt(random()), v = random(), bary = [1 - u, u * (1 - v), u * v];
        const blend = (attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, component: number) => verts.reduce((sum, vertex, k) => sum + bary[k] * attr.getComponent(vertex, component), 0);
        const coat = g.getAttribute('furScale');
        // The old .25-.85 ramp left most of a closed lid's dome with subpixel stubs. Only the thin free edge is bare;
        // the rest carries short, overlapping hairs in the same colour as the surrounding face.
        const coverage = coat ? THREE.MathUtils.smoothstep(blend(coat, 0), .03, .5) : 1;
        const length = (.0026 + random() * .0023) * coverage, width = (.0004 + random() * .0003) * coverage, lean = (random() - .5) * .8, tone = .55 + random() * 1.0;
        const influences = new Map<number, number>();
        verts.forEach((vertex, k) => { for (let j = 0; j < 4; j++) {
            const joint = joints.getComponent(vertex, j);
            influences.set(joint, (influences.get(joint) ?? 0) + bary[k] * weights.getComponent(vertex, j));
        } });
        const skin = [...influences].sort((a, b) => b[1] - a[1]).slice(0, 4), weightSum = skin.reduce((sum, pair) => sum + pair[1], 0) || 1;
        const hair = (key = -1) => {
            root.set(blend(p, 0), blend(p, 1), blend(p, 2));
            normal.set(blend(normals, 0), blend(normals, 1), blend(normals, 2));
            if (key >= 0) {
                const dp = keys[key], dn = g.morphAttributes.normal?.[key];
                a.set(blend(dp, 0), blend(dp, 1), blend(dp, 2));
                if (g.morphTargetsRelative)
                    root.add(a);
                else
                    root.copy(a);
                if (dn) {
                    a.set(blend(dn, 0), blend(dn, 1), blend(dn, 2));
                    if (g.morphTargetsRelative)
                        normal.add(a);
                    else
                        normal.copy(a);
                }
            }
            normal.normalize();
            if (eyeCentre && normal.dot(a.copy(root).sub(eyeCentre)) < 0)
                normal.negate();
            tangent.set(lean, direction, .15);
            tangent.addScaledVector(normal, -tangent.dot(normal)).normalize();
            across.crossVectors(tangent, normal).normalize();
            const out: number[] = [];
            for (let corner = 0; corner < 4; corner++) {
                const tip = corner >= 2, side = corner % 2 ? 1 : -1;
                point.copy(root).addScaledVector(normal, .00135 + (tip ? length * .4 : 0)).addScaledVector(tangent, tip ? length : 0).addScaledVector(across, side * width * (tip ? .035 : .5));
                out.push(point.x, point.y, point.z);
            }
            return out;
        };
        const basis = hair();
        positions.set(basis, h * 12);
        morphs.forEach((values, key) => values.set(hair(key).map((value, i) => value - basis[i]), h * 12));
        for (let corner = 0; corner < 4; corner++) {
            const vertex = h * 4 + corner;
            for (let component = 0; component < 3; component++)
                colors[vertex * 3 + component] = Math.min(1, blend(col, component) * 1.18 * tone * (corner >= 2 ? 1.12 : .9));
            skin.forEach(([joint, weight], j) => { ji[vertex * 4 + j] = joint; sw[vertex * 4 + j] = weight / weightSum; });
        }
        indices.push(h * 4, h * 4 + 1, h * 4 + 2, h * 4 + 2, h * 4 + 1, h * 4 + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('skinIndex', new THREE.BufferAttribute(ji, 4));
    geometry.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = morphs.map(values => new THREE.BufferAttribute(values, 3));
    rebuildLidMorphNormals(geometry);
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: .92, side: THREE.DoubleSide, alphaHash: true, opacity: .45,
    }));
    mesh.name = `${lid.name}_ShortFur`;
    mesh.bind(lid.skeleton, lid.bindMatrix);
    mesh.bindMode = lid.bindMode;
    mesh.position.copy(lid.position);
    mesh.quaternion.copy(lid.quaternion);
    mesh.scale.copy(lid.scale);
    mesh.morphTargetDictionary = lid.morphTargetDictionary;
    mesh.morphTargetInfluences = lid.morphTargetInfluences;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    return mesh;
}
