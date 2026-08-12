export type PdfFontFamily = 'sans' | 'serif' | 'monospace' | 'script';
export type PdfFontLoadStatus = 'mapped' | 'loading' | 'loaded' | 'cached' | 'failed';

export interface PdfFontVariant {
  url: string;
  weight?: number;
  italic?: boolean;
}

export type PdfFontEntry = string | PdfFontVariant | PdfFontVariant[];

export interface PdfFontFallbackConfig {
  fonts: Partial<Record<number, PdfFontEntry>>;
  defaultFont?: PdfFontEntry;
  baseUrl?: string;
  families?: Partial<Record<number, Partial<Record<PdfFontFamily, PdfFontEntry>>>>;
  faceFamilies?: Record<string, PdfFontFamily>;
}

export interface PdfFontDiagnostic {
  face: string;
  charset: number;
  family: PdfFontFamily;
  selectedFamily: PdfFontFamily;
  weight: number;
  italic: boolean;
  pitchFamily: number;
  url: string;
  status: PdfFontLoadStatus;
  bytes?: number;
  httpStatus?: number;
  error?: string;
}
