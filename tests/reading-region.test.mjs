import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReadingRegion, readingRegionRect, isReadingRegion } from '../apps/shared/reading-region.ts';

const region = { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 };

test('reading areas map proportionally to every page and clamp to page boundaries', () => {
  const rect = { x: 60, y: 160, width: 480, height: 480 };
  assert.deepEqual(normalizeReadingRegion(rect, { width: 600, height: 800 }), region);
  const mapped = readingRegionRect(region, { width: 300, height: 400 });
  assert.equal(mapped.x, 30);
  assert.equal(mapped.y, 80);
  assert.equal(mapped.width, 240);
  assert.ok(Math.abs(mapped.height - 240) < 1e-9);
  assert.deepEqual(normalizeReadingRegion({ x: -10, y: -20, width: 900, height: 1000 }, { width: 600, height: 800 }),
    { left: 0, top: 0, right: 1, bottom: 1 });
  for (const invalid of [null, {}, { ...region, left: NaN }, { ...region, right: 2 }, { ...region, top: 1 }, { ...region, bottom: Infinity }]) {
    assert.equal(isReadingRegion(invalid), false);
  }
  assert.equal(normalizeReadingRegion({ ...rect, width: 0, height: 100 }, { width: 600, height: 800 }), null);
});
