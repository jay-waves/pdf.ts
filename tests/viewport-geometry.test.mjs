import assert from 'node:assert/strict';
import test from 'node:test';
import { transformPosition } from '@embedpdf/models';
import {
  clientPointToViewport, measureViewport, pagePointFromOffset,
  viewportInterval, projectRect, revealDelta, scrollAxes, fitScales,
} from '../apps/renderer/viewport-geometry.ts';

test('client anchors exclude borders and clamp to the inner viewport', () => {
  const element = {
    getBoundingClientRect: () => ({ left: 100, top: 200 }),
    clientLeft: 3, clientTop: 5, clientWidth: 800, clientHeight: 600,
  };
  assert.deepEqual(clientPointToViewport(element, 123, 235), { vx: 20, vy: 30 });
  assert.deepEqual(clientPointToViewport(element, 0, 0), { vx: 0, vy: 0 });
  assert.deepEqual(clientPointToViewport(element, 2000, 2000), { vx: 800, vy: 600 });
});

test('viewport measurement reads each field once and derives relative position from that snapshot', () => {
  const values = {
    offsetWidth: 806, offsetHeight: 610, clientWidth: 800, clientHeight: 600,
    scrollLeft: 40, scrollTop: 100, scrollWidth: 1000, scrollHeight: 1000,
    clientLeft: 3, clientTop: 5,
  };
  const reads = {};
  const element = new Proxy(values, { get(target, key) { reads[key] = (reads[key] ?? 0) + 1; return target[key]; } });
  const metrics = measureViewport(element);
  assert.deepEqual(metrics.relativePosition, { x: 0.2, y: 0.25 });
  assert.ok(Object.values(reads).every((count) => count === 1));
  values.scrollWidth = 800;
  values.scrollHeight = 600;
  assert.deepEqual(measureViewport(element).relativePosition, { x: 0, y: 0 });
});

test('page coordinate transforms invert every rotation at fractional and enlarged scales', () => {
  const size = { width: 612, height: 792 };
  for (const rotation of [0, 1, 2, 3]) {
    for (const scale of [0.5, 1, 2.5]) {
      for (const point of [{ x: 0, y: 0 }, { x: 127, y: 241 }, { x: -20, y: 850 }]) {
        const offset = transformPosition(size, point, rotation, scale);
        assert.deepEqual(pagePointFromOffset(offset, size, rotation, scale), point);
      }
    }
  }
});

test('horizontal and vertical reveal share identical interval rules', () => {
  for (const axis of Object.values(scrollAxes)) {
    const view = viewportInterval({ scrollLeft: 100, scrollTop: 100, clientWidth: 600, clientHeight: 600 }, axis);
    const interval = (start, size) => projectRect({ origin: { x: start, y: start }, size: { width: size, height: size } }, axis);
    assert.equal(revealDelta(interval(200, 20), view), 0);
    assert.equal(revealDelta(interval(90, 20), view), -70);
    assert.equal(revealDelta(interval(680, 20), view), 60);
    const tiny = viewportInterval({ scrollLeft: 0, scrollTop: 0, clientWidth: 10, clientHeight: 10 }, axis,
      { top: 20, bottom: 20, left: 20, right: 20 });
    assert.ok(tiny.visibleEnd >= tiny.visibleStart);
    assert.ok(tiny.landing >= 0 && tiny.landing <= 10);
  }
});

test('fit scales share double-page gaps, mixed page dimensions and zero-size handling', () => {
  const spreads = [
    [{ rotatedSize: { width: 300, height: 700 } }, { rotatedSize: { width: 400, height: 500 } }],
    [{ rotatedSize: { width: 600, height: 800 } }],
  ];
  assert.deepEqual(fitScales(spreads, { clientWidth: 740, clientHeight: 820 }, 10, 20), { width: 1, height: 1, page: 1 });
  assert.deepEqual(fitScales([], { clientWidth: 740, clientHeight: 820 }, 10, 20), { width: 0, height: 0, page: 0 });
  assert.deepEqual(fitScales(spreads, { clientWidth: 10, clientHeight: 10 }, 10, 20), { width: 0, height: 0, page: 0 });
});
