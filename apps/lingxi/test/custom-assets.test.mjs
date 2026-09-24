// parseSkins 的 proportions（体型参数）透传与校验 - 自定义皮肤要能改脚部尺寸（如大皮鞋）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSkins } from '../src/rig/custom-assets.ts';

const TEXTURES = {};
const RIG_ID = 'lingxi-cat-v1';

function baseSkin(overrides = {}) {
  return {
    id: 'test-skin',
    name: '测试皮肤',
    rigId: RIG_ID,
    materials: {
      fur: '#B88254', pattern: '#1E1610', cream: '#F5E9D2', iris: '#382618',
      pupil: '#241610', nose: '#8A5836', paw: '#F6F3EC', mouth: '#2C1B11',
      whisker: '#F5E9D2', tongue: '#E08A92',
    },
    ...overrides,
  };
}

test('合法 proportions 原样透传', () => {
  const skins = parseSkins([baseSkin({
    proportions: {
      footL: { size: [3.2, 3.0, 3.2] },
      upperFL: { size: [2.2, 2.6, 2.2], segmentLength: 2.6 },
    },
  })], TEXTURES, RIG_ID);
  assert.deepEqual(skins[0].proportions.footL.size, [3.2, 3.0, 3.2]);
  assert.equal(skins[0].proportions.upperFL.segmentLength, 2.6);
});

test('size 必须是三个有限数字', () => {
  assert.throws(
    () => parseSkins([baseSkin({ proportions: { footL: { size: [1, 2] } } })], TEXTURES, RIG_ID),
    /size/,
  );
  assert.throws(
    () => parseSkins([baseSkin({ proportions: { footL: { size: [1, 2, 'x'] } } })], TEXTURES, RIG_ID),
    /size/,
  );
  assert.throws(
    () => parseSkins([baseSkin({ proportions: { footL: { size: [1, 2, 99] } } })], TEXTURES, RIG_ID),
    /size/,
  );
});

test('segmentLength 越界与未知字段被拒绝', () => {
  assert.throws(
    () => parseSkins([baseSkin({ proportions: { footL: { segmentLength: 0.01 } } })], TEXTURES, RIG_ID),
    /segmentLength/,
  );
  assert.throws(
    () => parseSkins([baseSkin({ proportions: { footL: { pivot: [0, 0, 0] } } })], TEXTURES, RIG_ID),
    /不是可调项/,
  );
});

test('proportions 必须是对象且部位数有上限', () => {
  assert.throws(
    () => parseSkins([baseSkin({ proportions: [1, 2] })], TEXTURES, RIG_ID),
    /必须是对象/,
  );
  const many = Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`n${i}`, { size: [1, 1, 1] }]));
  assert.throws(
    () => parseSkins([baseSkin({ proportions: many })], TEXTURES, RIG_ID),
    /最多 60/,
  );
});
