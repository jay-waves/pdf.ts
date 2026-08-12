import type { WrappedPdfiumModule } from '@embedpdf/pdfium';
import type {
  PdfFontDiagnostic,
  PdfFontEntry,
  PdfFontFallbackConfig,
  PdfFontFamily,
  PdfFontLoadStatus,
  PdfFontVariant,
} from './types';

const SYSFONTINFO_SIZE = 36;
const OFFSET_VERSION = 0;
const OFFSET_RELEASE = 4;
const OFFSET_ENUMFONTS = 8;
const OFFSET_MAPFONT = 12;
const OFFSET_GETFONT = 16;
const OFFSET_GETFONTDATA = 20;
const OFFSET_GETFACENAME = 24;
const OFFSET_GETFONTCHARSET = 28;
const OFFSET_DELETEFONT = 32;
const MAX_DIAGNOSTICS = 100;

type FontHandle = {
  id: number;
  charset: number;
  url: string;
  data?: Uint8Array | null;
};

type FontMatch = {
  url: string;
  family: PdfFontFamily;
  matchedWeight: number;
  matchedItalic: boolean;
};

type PdfiumHeap = WrappedPdfiumModule['pdfium'] & { HEAPU8: Uint8Array };
type FontLog = (message: string, detail?: string, level?: 'info' | 'warn' | 'error') => void;

function normalizeFaceName(value: string) {
  return value
    .replace(/^[A-Z]{6}\+/, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

export function classifyPdfFontFamily(
  face: string,
  pitchFamily: number,
  aliases: Record<string, PdfFontFamily>,
): PdfFontFamily {
  const normalizedFace = normalizeFaceName(face);
  const matches = Object.entries(aliases)
    .map(([alias, family]) => [normalizeFaceName(alias), family] as const)
    .filter(([alias]) => alias)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [alias, family] of matches) {
    if (normalizedFace.includes(alias)) return family;
  }
  if ((pitchFamily & 1) !== 0) return 'monospace';
  const familyClass = (pitchFamily >> 4) & 15;
  if (familyClass === 1) return 'serif';
  if (familyClass === 4) return 'script';
  return 'sans';
}

/**
 * Project-owned FPDF_SYSFONTINFO implementation.
 *
 * This follows PDFium's wasm32 callback ABI and intentionally performs font
 * loading inside a dedicated worker: GetFontData is synchronous by contract.
 */
export class PdfiumFontFallbackManager {
  private readonly config: PdfFontFallbackConfig;
  private readonly log: FontLog;
  private readonly handles = new Map<number, FontHandle>();
  private readonly fontCache = new Map<string, Uint8Array>();
  private diagnostics: PdfFontDiagnostic[] = [];
  private module: WrappedPdfiumModule | null = null;
  private nextHandleId = 1;
  private structPtr = 0;
  private callbackPtrs: number[] = [];
  private reportedLogs = new Set<string>();
  private enabled = false;

  constructor(config: PdfFontFallbackConfig, log: FontLog = () => undefined) {
    this.config = config;
    this.log = log;
  }

  initialize(module: WrappedPdfiumModule) {
    if (this.enabled) return;
    this.module = module;
    const pdfium = module.pdfium;
    this.structPtr = pdfium.wasmExports.malloc(SYSFONTINFO_SIZE);
    if (!this.structPtr) throw new Error('Could not allocate FPDF_SYSFONTINFO.');

    try {
      for (let offset = 0; offset < SYSFONTINFO_SIZE; offset++) {
        pdfium.setValue(this.structPtr + offset, 0, 'i8');
      }
      const release = pdfium.addFunction(() => undefined, 'vi');
      const enumFonts = pdfium.addFunction(() => undefined, 'vii');
      const mapFont = pdfium.addFunction(
        (
          _self: number,
          weight: number,
          italic: number,
          charset: number,
          pitchFamily: number,
          facePtr: number,
          exactPtr: number,
        ) => {
          const face = facePtr ? pdfium.UTF8ToString(facePtr) : '';
          if (exactPtr) pdfium.setValue(exactPtr, 0, 'i32');
          return this.mapFont(weight, italic !== 0, charset, pitchFamily, face);
        },
        'iiiiiiii',
      );
      const getFont = pdfium.addFunction((_self: number, facePtr: number) => {
        const face = facePtr ? pdfium.UTF8ToString(facePtr) : '';
        return this.mapFont(400, false, 0, 0, face);
      }, 'iii');
      const getFontData = pdfium.addFunction(
        (_self: number, fontHandle: number, table: number, buffer: number, size: number) =>
          this.getFontData(fontHandle, table, buffer, size),
        'iiiiii',
      );
      const getFaceName = pdfium.addFunction(() => 0, 'iiiii');
      const getFontCharset = pdfium.addFunction((_self: number, fontHandle: number) =>
        this.handles.get(fontHandle)?.charset ?? 0, 'iii');
      const deleteFont = pdfium.addFunction((_self: number, fontHandle: number) => {
        this.handles.delete(fontHandle);
      }, 'vii');
      this.callbackPtrs = [
        release,
        enumFonts,
        mapFont,
        getFont,
        getFontData,
        getFaceName,
        getFontCharset,
        deleteFont,
      ];

      pdfium.setValue(this.structPtr + OFFSET_VERSION, 1, 'i32');
      pdfium.setValue(this.structPtr + OFFSET_RELEASE, release, 'i32');
      pdfium.setValue(this.structPtr + OFFSET_ENUMFONTS, enumFonts, 'i32');
      pdfium.setValue(this.structPtr + OFFSET_MAPFONT, mapFont, 'i32');
      pdfium.setValue(this.structPtr + OFFSET_GETFONT, getFont, 'i32');
      pdfium.setValue(this.structPtr + OFFSET_GETFONTDATA, getFontData, 'i32');
      pdfium.setValue(this.structPtr + OFFSET_GETFACENAME, getFaceName, 'i32');
      pdfium.setValue(this.structPtr + OFFSET_GETFONTCHARSET, getFontCharset, 'i32');
      pdfium.setValue(this.structPtr + OFFSET_DELETEFONT, deleteFont, 'i32');
      module.FPDF_SetSystemFontInfo(this.structPtr);
      this.enabled = true;
    } catch (error) {
      this.releaseResources();
      throw error;
    }
  }

  disable() {
    if (!this.module) return;
    if (this.enabled) this.module.FPDF_SetSystemFontInfo(0);
    this.enabled = false;
    this.releaseResources();
    this.handles.clear();
    this.fontCache.clear();
  }

  resetDiagnostics() {
    this.diagnostics = [];
    this.reportedLogs.clear();
  }

  getDiagnostics() {
    return this.diagnostics.map((diagnostic) => ({ ...diagnostic }));
  }

  private releaseResources() {
    const module = this.module;
    if (!module) return;
    for (const pointer of this.callbackPtrs) {
      if (!pointer) continue;
      try {
        module.pdfium.removeFunction(pointer);
      } catch {
        // PDFium may already have released the wasm table during teardown.
      }
    }
    this.callbackPtrs = [];
    if (this.structPtr) module.pdfium.wasmExports.free(this.structPtr);
    this.structPtr = 0;
    this.module = null;
  }

  private mapFont(
    weight: number,
    italic: boolean,
    charset: number,
    pitchFamily: number,
    face: string,
  ) {
    const family = classifyPdfFontFamily(face, pitchFamily, this.config.faceFamilies ?? {});
    const match = this.findBestFontMatch(charset, weight, italic, family);
    if (!match) return 0;

    const handle: FontHandle = {
      id: this.nextHandleId++,
      charset,
      url: match.url,
    };
    this.handles.set(handle.id, handle);
    this.logOnce(
      `mapped\0${match.url}`,
      'Font fallback mapped',
      `${this.fontName(match.url)} · ${match.family} · requested by ${face || '(unspecified)'}`,
    );
    this.upsertDiagnostic({
      face: face || '(unspecified)',
      charset,
      family,
      selectedFamily: match.family,
      weight,
      italic,
      pitchFamily,
      url: match.url,
      status: this.fontCache.has(match.url) ? 'cached' : 'mapped',
    });
    return handle.id;
  }

  private getFontData(fontHandle: number, table: number, bufferPtr: number, bufferSize: number) {
    const handle = this.handles.get(fontHandle);
    if (!handle) return 0;

    if (handle.data === undefined) {
      const cached = this.fontCache.get(handle.url);
      if (cached) {
        handle.data = cached;
        this.logOnce(
          `cached\0${handle.url}`,
          'Fallback font ready',
          `${this.fontName(handle.url)} · HTTP cache · ${this.formatBytes(cached.byteLength)}`,
        );
        this.updateUrlStatus(handle.url, 'cached', { bytes: cached.byteLength });
      } else {
        handle.data = this.fetchFontSync(handle.url);
      }
    }
    if (!handle.data) return 0;
    if (table !== 0) return 0;
    if (!bufferPtr || bufferSize < handle.data.byteLength) return handle.data.byteLength;

    const heap = this.module?.pdfium as PdfiumHeap | undefined;
    if (!heap) return 0;
    heap.HEAPU8.set(handle.data, bufferPtr);
    return handle.data.byteLength;
  }

  private fetchFontSync(url: string) {
    this.logOnce(`loading\0${url}`, 'Loading fallback font', this.fontName(url));
    this.updateUrlStatus(url, 'loading');
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.responseType = 'arraybuffer';
      xhr.send();
      if (xhr.status !== 200 || !(xhr.response instanceof ArrayBuffer)) {
        this.log('Fallback font failed', `${this.fontName(url)} · HTTP ${xhr.status}`, 'error');
        this.updateUrlStatus(url, 'failed', {
          httpStatus: xhr.status,
          error: `HTTP ${xhr.status}`,
        });
        return null;
      }
      const data = new Uint8Array(xhr.response);
      this.fontCache.set(url, data);
      this.logOnce(
        `loaded\0${url}`,
        'Fallback font ready',
        `${this.fontName(url)} · ${this.formatBytes(data.byteLength)} · HTTP ${xhr.status}`,
      );
      this.updateUrlStatus(url, 'loaded', {
        bytes: data.byteLength,
        httpStatus: xhr.status,
        error: undefined,
      });
      return data;
    } catch (error) {
      this.log(
        'Fallback font failed',
        `${this.fontName(url)} · ${error instanceof Error ? error.message : String(error)}`,
        'error',
      );
      this.updateUrlStatus(url, 'failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private findBestFontMatch(
    charset: number,
    requestedWeight: number,
    requestedItalic: boolean,
    family: PdfFontFamily,
  ): FontMatch | null {
    const familyEntry = this.config.families?.[charset]?.[family];
    const entry = familyEntry ?? this.config.fonts[charset] ?? this.config.defaultFont;
    if (!entry) return null;
    const variants = this.normalizeVariants(entry);
    if (!variants.length) return null;
    const best = this.selectBestVariant(variants, requestedWeight, requestedItalic);
    let url = best.url;
    if (
      this.config.baseUrl
      && !url.startsWith('http://')
      && !url.startsWith('https://')
      && !url.startsWith('/')
    ) {
      url = `${this.config.baseUrl.replace(/\/$/, '')}/${url}`;
    }
    return {
      url,
      family: familyEntry ? family : 'sans',
      matchedWeight: best.weight ?? 400,
      matchedItalic: best.italic ?? false,
    };
  }

  private normalizeVariants(entry: PdfFontEntry): PdfFontVariant[] {
    if (typeof entry === 'string') return [{ url: entry, weight: 400, italic: false }];
    const variants = Array.isArray(entry) ? entry : [entry];
    return variants.map((variant) => ({
      url: variant.url,
      weight: variant.weight ?? 400,
      italic: variant.italic ?? false,
    }));
  }

  private selectBestVariant(
    variants: PdfFontVariant[],
    requestedWeight: number,
    requestedItalic: boolean,
  ) {
    const italicMatches = variants.filter((variant) =>
      (variant.italic ?? false) === requestedItalic);
    const candidates = italicMatches.length ? italicMatches : variants;
    let best = candidates[0];
    for (const candidate of candidates.slice(1)) {
      const candidateWeight = candidate.weight ?? 400;
      const bestWeight = best.weight ?? 400;
      const candidateDistance = Math.abs(candidateWeight - requestedWeight);
      const bestDistance = Math.abs(bestWeight - requestedWeight);
      if (
        candidateDistance < bestDistance
        || (candidateDistance === bestDistance
          && (requestedWeight >= 500 ? candidateWeight > bestWeight : candidateWeight < bestWeight))
      ) {
        best = candidate;
      }
    }
    return best;
  }

  private diagnosticKey(diagnostic: PdfFontDiagnostic) {
    return [
      diagnostic.face,
      diagnostic.charset,
      diagnostic.family,
      diagnostic.url,
    ].join('\0');
  }

  private upsertDiagnostic(diagnostic: PdfFontDiagnostic) {
    const key = this.diagnosticKey(diagnostic);
    const index = this.diagnostics.findIndex((item) => this.diagnosticKey(item) === key);
    if (index >= 0) this.diagnostics[index] = diagnostic;
    else this.diagnostics = [...this.diagnostics.slice(-(MAX_DIAGNOSTICS - 1)), diagnostic];
  }

  private updateUrlStatus(
    url: string,
    status: PdfFontLoadStatus,
    details: Partial<Pick<PdfFontDiagnostic, 'bytes' | 'httpStatus' | 'error'>> = {},
  ) {
    this.diagnostics = this.diagnostics.map((diagnostic) =>
      diagnostic.url === url ? { ...diagnostic, ...details, status } : diagnostic);
  }

  private logOnce(key: string, message: string, detail?: string) {
    if (this.reportedLogs.has(key)) return;
    this.reportedLogs.add(key);
    this.log(message, detail);
  }

  private fontName(url: string) {
    return decodeURIComponent(url.split('/').pop() ?? url)
      .replace(/\.(?:otf|ttf|woff2?)$/i, '')
      .replaceAll('-', ' ');
  }

  private formatBytes(bytes: number) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
}
