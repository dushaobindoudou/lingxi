import test from 'node:test';
import assert from 'node:assert/strict';
import { createStageFx } from '../src/fx/stage-fx.ts';

// Minimal DOM for the actual bubble renderer: retain children and image sources.
class Element {
  children = [];
  style = { setProperty() {} };
  classList = { add() {}, remove() {} };
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  querySelector() { return null; }
  addEventListener() {}
}
const codex = { name: 'Codex', badge: 'CX', markUrl: '/codex-mark.svg' };
const mark = container => container.children[0]?.children[0]?.children
  .find(node => node.className === 'lingxi-bubble-source')?.children
  .find(node => node.className === 'lingxi-bubble-mark')?.src;

for (const interruption of ['another bubble', 'another agent']) {
  test(`Codex speech keeps its icon after ${interruption} between stage and say`, () => {
    const previous = globalThis.document;
    globalThis.document = { getElementById: () => ({}), createElement: () => new Element() };
    const container = new Element();
    const fx = createStageFx();
    try {
      fx.mount(container);
      fx.setBubbleAttribution(codex);
      if (interruption === 'another bubble') fx.say('猫自己的话');
      else fx.setBubbleAttribution({ name: 'Claude', markUrl: '/claude.svg' });
      fx.say('Codex 完成了', 6000, codex);
      assert.equal(mark(container), codex.markUrl);
      fx.say('摸摸猫');
      assert.equal(mark(container), undefined, 'identity must not leak to later pet speech');
    } finally {
      fx.hush();
      globalThis.document = previous;
    }
  });
}

test('speech carries its icon even after pending attribution expires', t => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  const previous = globalThis.document;
  globalThis.document = { getElementById: () => ({}), createElement: () => new Element() };
  const container = new Element();
  const fx = createStageFx();
  try {
    fx.mount(container);
    fx.setBubbleAttribution(codex);
    now = 10_000;
    fx.say('Codex 完成了', 6000, codex);
    assert.equal(mark(container), codex.markUrl);
    fx.setBubbleAttribution(codex);
    fx.say('我们一起完成 10 件事啦', 4200, null);
    assert.equal(mark(container), undefined, 'unattributed events must not borrow the stage owner');
  } finally {
    fx.hush();
    globalThis.document = previous;
  }
});
