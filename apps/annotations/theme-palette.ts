import type { ViewerTheme } from '../theme/theme';

// Preset numbers map across themes; slot 03 holds each theme’s default color.
export const ANNOTATION_PALETTES: Record<ViewerTheme, readonly string[]> = {
  // Bright cyan, yellow, and green pairs; slot 03 is the Light default.
  light: ['#7dd3fc', '#a5e3fa', '#ffe066', '#ffec99', '#a8df78', '#c2eba0'],
  dark: ['#f5df87', '#e8ce70', '#f0f0f0', '#d8d8d8', '#a9dce7', '#8dc8d6'],
  nord: ['#f2dc9b', '#e8ca7e', '#bce9f2', '#9dd8e5', '#c6dca9', '#afd08e'],
  gruvbox: ['#d3e58c', '#bdd66b', '#f5df8c', '#ebcc66', '#ffbb91', '#f4a574'],
  solar: ['#f5df85', '#edcf66', '#9fb5a9', '#8fa89a', '#f3b5a0', '#eaa18b'],
};

export function getDefaultAnnotationColor(theme: ViewerTheme) {
  return ANNOTATION_PALETTES[theme][2];
}

export function getAnnotationPaletteIndex(color: unknown): number | null {
  if (typeof color !== 'string') return null;
  const normalized = color.toLowerCase();
  for (const palette of Object.values(ANNOTATION_PALETTES)) {
    const index = palette.indexOf(normalized);
    if (index !== -1) return index;
  }
  return null;
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
