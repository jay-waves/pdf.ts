import { FontCharset } from '@embedpdf/models';
import type {
  PdfFontEntry,
  PdfFontFallbackConfig,
  PdfFontFamily,
} from './types';

const EMBEDPDF_FONT_CDN = 'https://cdn.jsdelivr.net/npm';
const FONT_VERSION = '1.0.0';
const NOTO_CJK_CDN = 'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@Serif2.003';
const fontUrl = (pack: string, file: string) =>
  `${EMBEDPDF_FONT_CDN}/@embedpdf/fonts-${pack}@${FONT_VERSION}/fonts/${file}`;

const LATIN = fontUrl('latin', 'NotoSans-Regular.ttf');
const SIMPLIFIED_CHINESE = fontUrl('sc', 'NotoSansHans-Regular.otf');
const SIMPLIFIED_CHINESE_SERIF =
  `${NOTO_CJK_CDN}/Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf`;
const TRADITIONAL_CHINESE = fontUrl('tc', 'NotoSansHant-Regular.otf');
const JAPANESE = fontUrl('jp', 'NotoSansJP-Regular.otf');
const KOREAN = fontUrl('kr', 'NotoSansKR-Regular.otf');
const ARABIC = fontUrl('arabic', 'NotoNaskhArabic-Regular.ttf');
const HEBREW = fontUrl('hebrew', 'NotoSansHebrew-Regular.ttf');

const sansEntry = (url: string): Partial<Record<PdfFontFamily, PdfFontEntry>> => ({ sans: url });

export const PDF_SYSTEM_FACE_FAMILIES: Record<string, PdfFontFamily> = {
  arial: 'sans', helvetica: 'sans', calibri: 'sans', aptos: 'sans', verdana: 'sans',
  tahoma: 'sans', segoeui: 'sans', simhei: 'sans', microsoftyahei: 'sans',
  dengxian: 'sans', notosans: 'sans', sourcehansans: 'sans', meiryo: 'sans',
  yugothic: 'sans', malgungothic: 'sans',
  黑体: 'sans', 微软雅黑: 'sans', 等线: 'sans', 思源黑体: 'sans',
  times: 'serif', timesnewroman: 'serif', georgia: 'serif', cambria: 'serif',
  constantia: 'serif', garamond: 'serif', baskerville: 'serif', palatino: 'serif',
  bookantiqua: 'serif', simsun: 'serif', nsimsun: 'serif', songti: 'serif',
  stsong: 'serif', fangsong: 'serif', stfangsong: 'serif', pmingliu: 'serif',
  mingliu: 'serif', msmincho: 'serif', yumincho: 'serif', batang: 'serif',
  notoserif: 'serif', sourcehanserif: 'serif',
  宋体: 'serif', 新宋体: 'serif', 仿宋: 'serif', 明体: 'serif', 思源宋体: 'serif',
  courier: 'monospace', couriernew: 'monospace', consolas: 'monospace',
  menlo: 'monospace', monaco: 'monospace', liberationmono: 'monospace',
  kaiti: 'script', stkaiti: 'script', kai: 'script',
  楷体: 'script', 华文楷体: 'script',
};

export const PDFIUM_FONT_FALLBACK: PdfFontFallbackConfig = {
  fonts: {
    [FontCharset.ANSI]: LATIN,
    [FontCharset.DEFAULT]: LATIN,
    [FontCharset.SHIFTJIS]: JAPANESE,
    [FontCharset.HANGEUL]: KOREAN,
    [FontCharset.GB2312]: SIMPLIFIED_CHINESE,
    [FontCharset.CHINESEBIG5]: TRADITIONAL_CHINESE,
    [FontCharset.CYRILLIC]: LATIN,
    [FontCharset.GREEK]: LATIN,
    [FontCharset.VIETNAMESE]: LATIN,
    [FontCharset.EASTERNEUROPEAN]: LATIN,
    [FontCharset.ARABIC]: ARABIC,
    [FontCharset.HEBREW]: HEBREW,
  },
  defaultFont: LATIN,
  families: {
    [FontCharset.ANSI]: sansEntry(LATIN),
    [FontCharset.DEFAULT]: sansEntry(LATIN),
    [FontCharset.SHIFTJIS]: sansEntry(JAPANESE),
    [FontCharset.HANGEUL]: sansEntry(KOREAN),
    [FontCharset.GB2312]: {
      sans: SIMPLIFIED_CHINESE,
      // PDFium synthesizes bold/italic when a PDF asks for a variant that is
      // not present; keeping one static Regular face avoids a second download.
      serif: SIMPLIFIED_CHINESE_SERIF,
    },
    [FontCharset.CHINESEBIG5]: sansEntry(TRADITIONAL_CHINESE),
    [FontCharset.CYRILLIC]: sansEntry(LATIN),
    [FontCharset.GREEK]: sansEntry(LATIN),
    [FontCharset.VIETNAMESE]: sansEntry(LATIN),
    [FontCharset.EASTERNEUROPEAN]: sansEntry(LATIN),
    [FontCharset.ARABIC]: sansEntry(ARABIC),
    [FontCharset.HEBREW]: sansEntry(HEBREW),
  },
  faceFamilies: PDF_SYSTEM_FACE_FAMILIES,
};

export const PDFIUM_FONT_FALLBACK_INFO = {
  family: 'Noto regional fallbacks',
  coverage: 'On demand, by PDF charset and requested face family',
  source: `EmbedPDF font packages ${FONT_VERSION} and Noto CJK Serif 2.003 on jsDelivr`,
  cache: 'Versioned CDN URLs use the browser HTTP cache (immutable for one year)',
} as const;

const CHARSET_NAMES = new Map<number, string>([
  [FontCharset.ANSI, 'ANSI'], [FontCharset.DEFAULT, 'Default'],
  [FontCharset.SYMBOL, 'Symbol'], [FontCharset.SHIFTJIS, 'Japanese'],
  [FontCharset.HANGEUL, 'Korean'], [FontCharset.GB2312, 'Simplified Chinese'],
  [FontCharset.CHINESEBIG5, 'Traditional Chinese'], [FontCharset.GREEK, 'Greek'],
  [FontCharset.VIETNAMESE, 'Vietnamese'], [FontCharset.HEBREW, 'Hebrew'],
  [FontCharset.ARABIC, 'Arabic'], [FontCharset.CYRILLIC, 'Cyrillic'],
  [FontCharset.THAI, 'Thai'], [FontCharset.EASTERNEUROPEAN, 'Eastern European'],
]);

export function describeFontCharset(charset: number) {
  return CHARSET_NAMES.get(charset) ?? `Charset ${charset}`;
}

export function describeFallbackFont(url: string) {
  const file = decodeURIComponent(url.split('/').pop() ?? url);
  return file.replace(/\.(?:otf|ttf|woff2?)$/i, '').replaceAll('-', ' ');
}
