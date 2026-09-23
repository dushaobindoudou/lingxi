// The guard that makes a second tool list safe to keep.
//
// The management window cannot import tools.mjs (it pulls in node:fs through bridge.mjs), so it
// renders catalogue.mjs instead. Two lists describing one surface is exactly the shape that
// rotted last time - the page shipped a table of six tools that were never implemented under a
// heading announcing no MCP server existed, while thirteen real ones were being served - so the
// lists are pinned to each other here rather than by anyone remembering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tools } from '../src/tools.mjs';
import { catalogue } from '../src/catalogue.mjs';

test('the page catalogue names exactly the tools the server serves, in order', () => {
  assert.deepEqual(
    catalogue.map((entry) => entry.name),
    tools.map((tool) => tool.name),
  );
});

test('every catalogue entry is renderable - a short purpose and a known risk level', () => {
  for (const entry of catalogue) {
    assert.ok(entry.purpose && entry.purpose.length <= 30, `${entry.name}: purpose too long for the table`);
    assert.ok(['低', '中', '高'].includes(entry.risk), `${entry.name}: unknown risk level ${entry.risk}`);
  }
});
