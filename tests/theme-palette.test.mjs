import assert from 'node:assert/strict';
import test from 'node:test';
import { ANNOTATION_PALETTES, getAnnotationPaletteIndex, getDefaultAnnotationColor, getThemeAnnotationColor } from '../apps/annotations/theme-palette.ts';

test('theme defaults share slot 03 so switching themes retains the representative color', () => {
  for (const theme of Object.keys(ANNOTATION_PALETTES)) {
    assert.equal(getAnnotationPaletteIndex(getDefaultAnnotationColor(theme)), 2);
  }
  assert.equal(getDefaultAnnotationColor('light'), '#ffe066');
  assert.equal(getThemeAnnotationColor(getDefaultAnnotationColor('light'), 'dark'), '#f0f0f0');
  assert.equal(getThemeAnnotationColor(getDefaultAnnotationColor('light'), 'nord'), '#bce9f2');
});

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

test('previous Light blue presets retain their slots in the yellow palette', () => {
  const previous = ['#315da8', '#4778bc', '#6293cc', '#3f737f', '#638894', '#747f91'];
  previous.forEach((color, index) => {
    assert.equal(getAnnotationPaletteIndex(color), index);
    assert.equal(getThemeAnnotationColor(color, 'light'), ANNOTATION_PALETTES.light[index]);
  });
});

test('previous theme presets retain their slots in every brighter palette', () => {
  const previous = [
    ['#dedede', '#c7c7c7', '#b0b0b0', '#999999', '#828282', '#6b6b6b'],
    ['#b7dce5', '#9bc9d6', '#80b5c6', '#a5bbd4', '#8da5c2', '#768da9'],
    ['#dfd6a0', '#c8c18a', '#b1ad76', '#d3bb8e', '#bda47b', '#a58d69'],
    ['#406f66', '#54867b', '#6d9a8c', '#687f62', '#829372', '#969b83'],
    ['#7655a9', '#8a6ab8', '#9d80c7', '#6577a7', '#7a8bb6', '#919bc0'],
    ['#d6b8ee', '#c3a3de', '#af8fca', '#b3bde4', '#9eacd4', '#899ac1'],
  ];
  for (const palette of previous) {
    palette.forEach((color, index) => {
      for (const theme of Object.keys(ANNOTATION_PALETTES)) {
        assert.equal(getThemeAnnotationColor(color, theme), ANNOTATION_PALETTES[theme][index]);
      }
    });
  }
});
