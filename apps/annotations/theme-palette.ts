import type { ViewerTheme } from '../theme/theme';

// Slot order is permanent: saved colors retain their number across themes.
export const ANNOTATION_PALETTES: Record<ViewerTheme, readonly string[]> = {
  light: ['#315da8', '#4778bc', '#6293cc', '#3f737f', '#638894', '#747f91'],
  dark: ['#dedede', '#c7c7c7', '#b0b0b0', '#999999', '#828282', '#6b6b6b'],
  nord: ['#b7dce5', '#9bc9d6', '#80b5c6', '#a5bbd4', '#8da5c2', '#768da9'],
  gruvbox: ['#dfd6a0', '#c8c18a', '#b1ad76', '#d3bb8e', '#bda47b', '#a58d69'],
  solar: ['#406f66', '#54867b', '#6d9a8c', '#687f62', '#829372', '#969b83'],
  'catppuccin-latte': ['#7655a9', '#8a6ab8', '#9d80c7', '#6577a7', '#7a8bb6', '#919bc0'],
  'catppuccin-mocha': ['#d6b8ee', '#c3a3de', '#af8fca', '#b3bde4', '#9eacd4', '#899ac1'],
};

export function getAnnotationPaletteIndex(color: unknown): number | null {
  if (typeof color !== 'string') return null;
  const normalized = color.toLowerCase();
  for (const palette of Object.values(ANNOTATION_PALETTES)) {
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
