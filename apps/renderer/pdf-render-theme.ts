interface PdfRenderThemeBase {
  /** Opaque colors in the conventional 0xAARRGGBB representation. */
  background: number;
}

interface PdfBackgroundRenderTheme extends PdfRenderThemeBase {
  mode: 'background';
}

interface PdfForcedColorRenderTheme extends PdfRenderThemeBase {
  mode: 'forced-colors';
  pathFill: number;
  pathStroke: number;
  textFill: number;
  textStroke: number;
}

export type PdfRenderTheme = PdfBackgroundRenderTheme | PdfForcedColorRenderTheme;

export function getThemeRenderGeometry(
  pageWidth: number,
  pageHeight: number,
  matrix: ArrayLike<number>,
) {
  const a = matrix[0];
  const b = matrix[1];
  const c = matrix[2];
  const d = matrix[3];
  const e = matrix[4];
  const f = matrix[5];
  let rotation = 0;
  let scaleX = Math.abs(a);
  let scaleY = Math.abs(d);
  if (Math.abs(b) > Math.abs(a)) {
    rotation = b > 0 ? 1 : 3;
    scaleX = Math.abs(c);
    scaleY = Math.abs(b);
  } else if (a < 0) {
    rotation = 2;
  }

  const fullWidth = Math.max(1, Math.round((rotation & 1 ? pageHeight : pageWidth) * scaleX));
  const fullHeight = Math.max(1, Math.round((rotation & 1 ? pageWidth : pageHeight) * scaleY));
  let startX = Math.round(e);
  let startY = Math.round(f);
  if (rotation === 1 || rotation === 2) startX -= fullWidth;
  if (rotation === 2 || rotation === 3) startY -= fullHeight;
  return { fullHeight, fullWidth, rotation, startX, startY };
}

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
