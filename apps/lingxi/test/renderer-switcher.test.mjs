import test from 'node:test';
import assert from 'node:assert/strict';
import { createRendererSwitcher } from '../src/renderer-switcher.ts';

function fixture(ready) {
  const created = [];
  const factories = Object.fromEntries(['voxel', 'realistic'].map(style => [style, () => {
    const renderer = {
      style, ready: style === 'realistic' ? ready : undefined,
      disposed: false, calls: [], capabilities: { style },
      mount(...args) { this.calls.push(['mount', ...args]); },
      resize(...args) { this.calls.push(['resize', ...args]); },
      setScale(...args) { this.calls.push(['scale', ...args]); },
      render(...args) { this.calls.push(['render', ...args]); },
      dispose() { this.disposed = true; },
    };
    created.push(renderer);
    return renderer;
  }]));
  return { switcher: createRendererSwitcher(factories), created };
}

test('both cat forms can switch back and forth while retaining host state', async () => {
  const { switcher, created } = fixture();
  const container = {};
  switcher.mount(container);
  switcher.resize(800, 600);
  switcher.setScale(1.2);
  switcher.render({ position: { x: 20, y: 30 } }, 0.016, null);
  assert.deepEqual(await switcher.switchStyle('realistic'), { applied: true });
  assert.equal(switcher.activeStyle, 'realistic');
  assert.equal(created[0].disposed, true);
  assert.deepEqual(created[1].calls.slice(0, 3), [['mount', container], ['resize', 800, 600], ['scale', 1.2]]);
  assert.deepEqual(await switcher.switchStyle('voxel'), { applied: true });
  assert.equal(switcher.activeStyle, 'voxel');
  assert.equal(created[1].disposed, true);
  switcher.dispose();
});

test('a model load failure keeps the current cat available', async () => {
  const { switcher, created } = fixture(Promise.reject(new Error('missing model')));
  assert.deepEqual(await switcher.switchStyle('realistic'), { applied: false, error: 'missing model' });
  assert.equal(switcher.activeStyle, 'voxel');
  assert.equal(created[0].disposed, false);
  assert.equal(created[1].disposed, true);
  assert.deepEqual(await switcher.switchStyle('voxel'), { applied: true });
  switcher.dispose();
});

test('returning to the current form cancels an in-flight model switch', async () => {
  let finish;
  const { switcher, created } = fixture(new Promise(resolve => { finish = resolve; }));
  const pending = switcher.switchStyle('realistic');
  assert.equal(switcher.activeStyle, 'voxel');
  assert.equal(switcher.requestedStyle, 'realistic');
  assert.deepEqual(await switcher.switchStyle('voxel'), { applied: true });
  assert.equal(switcher.requestedStyle, 'voxel');
  finish();
  assert.deepEqual(await pending, { applied: false });
  assert.equal(created[1].disposed, true);
  assert.equal(created[0].disposed, false);
  switcher.dispose();
});
