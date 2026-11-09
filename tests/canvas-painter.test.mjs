import assert from 'node:assert/strict';
import test from 'node:test';
import { paintRaster } from '../apps/renderer/canvas-painter.ts';

function surface(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'ImageData');
  Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class {
    constructor(data, width, height) { this.data = data; this.width = width; this.height = height; }
  } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'ImageData', previous); else delete globalThis.ImageData; });
  let image;
  const canvas = { dataset: {}, getContext: () => ({ putImageData(value, x, y) { assert.equal(x, 0); assert.equal(y, 0); image = value; } }) };
  return { canvas, image: () => image };
}
test('canvas submits tightly packed RGBA without a pixel copy or image encoding', t => {
  const view = surface(t);
  const data = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]).buffer;
  paintRaster(view.canvas, { width: 2, height: 1, stride: 8, data });
  assert.equal(view.image().data.buffer, data);
  assert.equal(view.image().data.byteLength, 8);
  assert.equal(data.detached, false);
  assert.equal(view.canvas.width, 2); assert.equal(view.canvas.height, 1);
  assert.equal(view.canvas.dataset.painted, 'true');
});
test('canvas removes row padding without corrupting the source or including padding bytes', t => {
  const view = surface(t);
  const pixels = new Uint8Array([1, 2, 3, 255, 99, 99, 99, 99, 4, 5, 6, 255, 88, 88, 88, 88]);
  const before = pixels.slice();
  paintRaster(view.canvas, { width: 1, height: 2, stride: 8, data: pixels.buffer });
  assert.notEqual(view.image().data.buffer, pixels.buffer);
  assert.deepEqual([...view.image().data], [1, 2, 3, 255, 4, 5, 6, 255]);
  assert.deepEqual(pixels, before);
});
