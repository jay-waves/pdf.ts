import assert from 'node:assert/strict';
import test from 'node:test';
import { markedTextRanges } from '../apps/annotations/markup-text.ts';

const layout = {
  charCount: 10,
  charQuad(index) {
    return { upperLeft: { x: index * 10, y: 0 }, upperRight: { x: index * 10 + 8, y: 0 },
      lowerLeft: { x: index * 10, y: 10 }, lowerRight: { x: index * 10 + 8, y: 10 } };
  },
};
test('disjoint and overlapping markup boxes produce exact, non-duplicated character ranges', () => {
  assert.deepEqual(markedTextRanges(layout, [
    { x: 0, y: 0, width: 18, height: 10 },
    { x: 10, y: 0, width: 8, height: 10 },
    { x: 80, y: 0, width: 18, height: 10 },
  ]), [{ start: 0, count: 2 }, { start: 8, count: 2 }]);
  assert.deepEqual(markedTextRanges(layout, [{ x: 0, y: 20, width: 100, height: 10 }]), []);
});
