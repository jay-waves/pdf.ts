interface PdfRenderThemeBase {
  /** Opaque colors in the conventional 0xAARRGGBB representation. */
  background: number;
}

export interface PdfBackgroundRenderTheme extends PdfRenderThemeBase {
  mode: 'background';
}

export interface PdfForcedColorRenderTheme extends PdfRenderThemeBase {
  mode: 'forced-colors';
  pathFill: number;
  pathStroke: number;
  textFill: number;
  textStroke: number;
}

export type PdfRenderTheme = PdfBackgroundRenderTheme | PdfForcedColorRenderTheme;

/**
 * FPDFBitmap_FillRect writes in the bitmap's native byte order even though
 * EmbedPDF asks page rendering for RGBA via FPDF_REVERSE_BYTE_ORDER. Background
 * fills therefore need red and blue exchanged; FPDF_COLORSCHEME values do not.
 */
export function toReverseByteOrderBitmapColor(argb: number) {
  const alpha = argb & 0xff000000;
  const red = (argb >>> 16) & 0xff;
  const green = (argb >>> 8) & 0xff;
  const blue = argb & 0xff;
  return (alpha | (blue << 16) | (green << 8) | red) >>> 0;
}
