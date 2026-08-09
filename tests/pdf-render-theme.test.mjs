import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getThemeRenderGeometry,
  toReverseByteOrderBitmapColor,
} from '../apps/pdf-render-theme.ts';

test('bitmap background colors swap red and blue without changing alpha or green', () => {
  assert.equal(toReverseByteOrderBitmapColor(0x7f123456), 0x7f563412);
  assert.equal(toReverseByteOrderBitmapColor(0xffffffff), 0xffffffff);
});

test('theme geometry maps full-page matrices for every PDF rotation', () => {
  const pageWidth = 100;
  const pageHeight = 200;

  assert.deepEqual(
    getThemeRenderGeometry(pageWidth, pageHeight, [2, 0, 0, 2, 0, 0]),
    { fullHeight: 400, fullWidth: 200, rotation: 0, startX: 0, startY: 0 },
  );
  assert.deepEqual(
    getThemeRenderGeometry(pageWidth, pageHeight, [0, 2, -2, 0, 400, 0]),
    { fullHeight: 200, fullWidth: 400, rotation: 1, startX: 0, startY: 0 },
  );
  assert.deepEqual(
    getThemeRenderGeometry(pageWidth, pageHeight, [-2, 0, 0, -2, 200, 400]),
    { fullHeight: 400, fullWidth: 200, rotation: 2, startX: 0, startY: 0 },
  );
  assert.deepEqual(
    getThemeRenderGeometry(pageWidth, pageHeight, [0, -2, 2, 0, 0, 200]),
    { fullHeight: 200, fullWidth: 400, rotation: 3, startX: 0, startY: 0 },
  );
});

test('theme geometry keeps the full-page origin when rendering a clipped tile', () => {
  assert.deepEqual(
    getThemeRenderGeometry(100, 200, [2, 0, 0, 2, -30, -50]),
    { fullHeight: 400, fullWidth: 200, rotation: 0, startX: -30, startY: -50 },
  );
  assert.deepEqual(
    getThemeRenderGeometry(100, 200, [0, 2, -2, 0, 300, -20]),
    { fullHeight: 200, fullWidth: 400, rotation: 1, startX: -100, startY: -20 },
  );
});
