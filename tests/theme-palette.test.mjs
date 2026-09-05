import assert from 'node:assert/strict';
import test from 'node:test';
import { ANNOTATION_PALETTES, getAnnotationPaletteIndex, getThemeAnnotationColor } from '../apps/annotations/theme-palette.ts';

test('saved preset colors retain their number through every theme and back', () => {
  for (const [sourceTheme, palette] of Object.entries(ANNOTATION_PALETTES)) {
    assert.equal(palette.length, 6);
    for (const [index, color] of palette.entries()) {
      for (const targetTheme of Object.keys(ANNOTATION_PALETTES)) {
        const mapped = getThemeAnnotationColor(color.toUpperCase(), targetTheme);
        assert.equal(getAnnotationPaletteIndex(mapped), index);
        assert.equal(getThemeAnnotationColor(mapped, sourceTheme), color);
      }
    }
  }
});

test('legacy default colors become preset 01 while imported custom colors remain untouched', () => {
  for (const theme of Object.keys(ANNOTATION_PALETTES)) {
    assert.equal(getThemeAnnotationColor('#e44234', theme), ANNOTATION_PALETTES[theme][0]);
    assert.equal(getThemeAnnotationColor('#ffcd45', theme), ANNOTATION_PALETTES[theme][0]);
    for (const color of ['transparent', '#123456', '#ffffff', '#000000', undefined]) {
      assert.equal(getThemeAnnotationColor(color, theme), null);
    }
  }
});
