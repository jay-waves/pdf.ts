import assert from 'node:assert/strict';
import test from 'node:test';
import { clientPointToViewport } from '../apps/renderer/viewport-geometry.ts';

test('client anchors exclude borders and clamp to the inner viewport', () => {
  const element = {
    getBoundingClientRect: () => ({ left: 100, top: 200 }),
    clientLeft: 3, clientTop: 5, clientWidth: 800, clientHeight: 600,
  };
  assert.deepEqual(clientPointToViewport(element, 123, 235), { vx: 20, vy: 30 });
  assert.deepEqual(clientPointToViewport(element, 0, 0), { vx: 0, vy: 0 });
  assert.deepEqual(clientPointToViewport(element, 2000, 2000), { vx: 800, vy: 600 });
});
