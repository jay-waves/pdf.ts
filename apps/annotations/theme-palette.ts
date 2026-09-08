import type { ViewerTheme } from '../theme/theme';

// Preset numbers map across themes; slot 03 holds each theme’s default color.
export const ANNOTATION_PALETTES: Record<ViewerTheme, readonly string[]> = {
  // Bright cyan, yellow, and green pairs; slot 03 is the Light default.
  light: ['#7dd3fc', '#a5e3fa', '#ffe066', '#ffec99', '#a8df78', '#c2eba0'],
  dark: ['#f5df87', '#e8ce70', '#f0f0f0', '#d8d8d8', '#a9dce7', '#8dc8d6'],
  nord: ['#f2dc9b', '#e8ca7e', '#bce9f2', '#9dd8e5', '#c6dca9', '#afd08e'],
  gruvbox: ['#d3e58c', '#bdd66b', '#f5df8c', '#ebcc66', '#ffbb91', '#f4a574'],
  solar: ['#f5df85', '#edcf66', '#9fb5a9', '#8fa89a', '#f3b5a0', '#eaa18b'],
  'catppuccin-latte': ['#f4dc8c', '#eacb6b', '#d7b5f5', '#c69aeb', '#a6dbe9', '#89ccdf'],
  'catppuccin-mocha': ['#f9e2af', '#eed18e', '#e4c5fa', '#d3acee', '#a6e9d7', '#87d8c4'],
};

const LEGACY_ANNOTATION_PALETTES: readonly (readonly string[])[] = [
  ['#f5df85', '#edcf66', '#b9cbc3', '#a4bbb2', '#f3b5a0', '#eaa18b'],
  ['#f5df85', '#edcf66', '#a8ded0', '#8dcebc', '#f3b5a0', '#eaa18b'],
  ['#315da8', '#4778bc', '#6293cc', '#3f737f', '#638894', '#747f91'],
  ['#fff2a8', '#ffe88a', '#ffdf70', '#f5e6b3', '#ecd99b', '#dfca83'],
  ['#ff9eae', '#ffb7c5'],
  ['#dedede', '#c7c7c7', '#b0b0b0', '#999999', '#828282', '#6b6b6b'],
  ['#b7dce5', '#9bc9d6', '#80b5c6', '#a5bbd4', '#8da5c2', '#768da9'],
  ['#dfd6a0', '#c8c18a', '#b1ad76', '#d3bb8e', '#bda47b', '#a58d69'],
  ['#406f66', '#54867b', '#6d9a8c', '#687f62', '#829372', '#969b83'],
  ['#7655a9', '#8a6ab8', '#9d80c7', '#6577a7', '#7a8bb6', '#919bc0'],
  ['#d6b8ee', '#c3a3de', '#af8fca', '#b3bde4', '#9eacd4', '#899ac1'],
];

export function getDefaultAnnotationColor(theme: ViewerTheme) {
  return ANNOTATION_PALETTES[theme][2];
}

export function getAnnotationPaletteIndex(color: unknown): number | null {
  if (typeof color !== 'string') return null;
  const normalized = color.toLowerCase();
  for (const palette of [...Object.values(ANNOTATION_PALETTES), ...LEGACY_ANNOTATION_PALETTES]) {
    const index = palette.indexOf(normalized);
    if (index !== -1) return index;
  }
  // Previous default/AUTO colors become slot 01.
  return normalized === '#e44234' || normalized === '#ffcd45' ? 0 : null;
}

export function getThemeAnnotationColor(color: unknown, theme: ViewerTheme) {
  const index = getAnnotationPaletteIndex(color);
  return index === null ? null : ANNOTATION_PALETTES[theme][index];
}

/** A display-only copy; never pass this object to annotation update commands. */
export function getAnnotationDisplayColors<T extends object>(annotation: T, theme: ViewerTheme): T {
  let result = annotation;
  for (const field of ['strokeColor', 'color', 'fontColor', 'backgroundColor'] as const) {
    const value = (annotation as Record<string, unknown>)[field];
    const color = getThemeAnnotationColor(value, theme);
    if (color && color !== value) {
      if (result === annotation) result = { ...annotation };
      (result as Record<string, unknown>)[field] = color;
    }
  }
  return result;
}
