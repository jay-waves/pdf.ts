import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState } from '@embedpdf/plugin-annotation';
import { normalizeReadingRegion, readingRegionRect, isReadingRegion } from '../apps/shared/reading-region.ts';
import { createReadingRegionHandlers } from '../apps/renderer/reading-region-input.ts';

const region = { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 };

test('reading areas map proportionally to every page and clamp to page boundaries', () => {
  const rect = { origin: { x: 60, y: 160 }, size: { width: 480, height: 480 } };
  assert.deepEqual(normalizeReadingRegion(rect, { width: 600, height: 800 }), region);
  const mapped = readingRegionRect(region, { width: 300, height: 400 });
  assert.deepEqual(mapped.origin, { x: 30, y: 80 });
  assert.equal(mapped.size.width, 240);
  assert.ok(Math.abs(mapped.size.height - 240) < 1e-9);
  assert.deepEqual(normalizeReadingRegion({ origin: { x: -10, y: -20 }, size: { width: 900, height: 1000 } }, { width: 600, height: 800 }),
    { left: 0, top: 0, right: 1, bottom: 1 });
  for (const invalid of [null, {}, { ...region, left: NaN }, { ...region, right: 2 }, { ...region, top: 1 }, { ...region, bottom: Infinity }]) {
    assert.equal(isReadingRegion(invalid), false);
  }
  assert.equal(normalizeReadingRegion({ ...rect, size: { width: 0, height: 100 } }, { width: 600, height: 800 }), null);
});

test('reading area reuses the real Rectangle handler without changing its defaults or creating annotations', () => {
  const tool = initialState({}).tools.find((tool) => tool.id === 'square');
  const originalDefaults = { ...tool.defaults };
  const previews = [];
  const commits = [];
  let captured = 0;
  const event = { setPointerCapture() { captured++; }, releasePointerCapture() { captured--; } };
  const handlers = createReadingRegionHandlers(tool, {
    pageIndex: 0, pageSize: { width: 600, height: 800 }, pageRotation: 0, scale: 1,
    onPreview: (rect) => previews.push(rect), onCommit: (rect) => commits.push(rect),
  });
  handlers.onPointerDown({ x: 540, y: 640 }, event, 'reading-region');
  handlers.onPointerMove({ x: 60, y: 160 }, event, 'reading-region');
  handlers.onPointerUp({ x: 60, y: 160 }, event, 'reading-region');
  assert.deepEqual(commits, [{ origin: { x: 60, y: 160 }, size: { width: 480, height: 480 } }]);
  assert.equal(previews.at(-1), null);
  assert.equal(captured, 0);
  assert.deepEqual(tool.defaults, originalDefaults);
  // A click, tiny strip or canceled drag must not replace the document region.
  handlers.onPointerDown({ x: 100, y: 100 }, event, 'reading-region');
  handlers.onPointerUp({ x: 100, y: 100 }, event, 'reading-region');
  handlers.onPointerDown({ x: 100, y: 100 }, event, 'reading-region');
  handlers.onPointerMove({ x: 200, y: 101 }, event, 'reading-region');
  handlers.onPointerUp({ x: 200, y: 101 }, event, 'reading-region');
  handlers.onPointerDown({ x: 100, y: 100 }, event, 'reading-region');
  handlers.onPointerMove({ x: 200, y: 200 }, event, 'reading-region');
  handlers.onPointerCancel({ x: 200, y: 200 }, event, 'reading-region');
  handlers.onPointerUp({ x: 200, y: 200 }, event, 'reading-region');
  assert.equal(commits.length, 1);
  assert.equal(captured, 0);
});
