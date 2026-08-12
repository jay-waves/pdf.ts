import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PdfiumFontFallbackManager,
  classifyPdfFontFamily,
} from '../apps/fonts/font-fallback-manager.ts';
import { PDFIUM_FONT_FALLBACK } from '../apps/fonts/catalog.ts';
import { FontCharset } from '@embedpdf/models';

test('font family classification understands subset, localized, and pitch names', () => {
  const aliases = { simsun: 'serif', 宋体: 'serif', arial: 'sans' };
  assert.equal(classifyPdfFontFamily('ABCDEF+SimSun', 0, aliases), 'serif');
  assert.equal(classifyPdfFontFamily('宋体', 0, aliases), 'serif');
  assert.equal(classifyPdfFontFamily('Unknown', 1, aliases), 'monospace');
  assert.equal(classifyPdfFontFamily('Unknown', 0x10, aliases), 'serif');
  assert.equal(classifyPdfFontFamily('Unknown', 0, aliases), 'sans');
});

test('simplified Chinese serif uses one static Regular face', () => {
  const serif = PDFIUM_FONT_FALLBACK.families[FontCharset.GB2312].serif;
  assert.equal(typeof serif, 'string');
  assert.match(serif, /NotoSerifSC-Regular\.otf$/);
  assert.doesNotMatch(serif, /Bold/i);
});

test('project font manager owns the PDFium callbacks and preserves cache state', () => {
  const callbacks = new Map();
  const values = new Map();
  const heap = new Uint8Array(1024);
  let nextCallback = 1;
  let systemFontInfo = 0;
  const module = {
    pdfium: {
      HEAPU8: heap,
      wasmExports: { malloc: () => 100, free: () => undefined },
      addFunction(callback) {
        const pointer = nextCallback++;
        callbacks.set(pointer, callback);
        return pointer;
      },
      removeFunction(pointer) {
        callbacks.delete(pointer);
      },
      setValue(pointer, value) {
        values.set(pointer, value);
      },
      UTF8ToString: () => 'ABCDEF+SimSun',
    },
    FPDF_SetSystemFontInfo(pointer) {
      systemFontInfo = pointer;
    },
  };

  const previousXhr = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = class {
    status = 200;
    response = new Uint8Array([1, 2, 3, 4]).buffer;
    open() {}
    send() {}
  };

  try {
    const manager = new PdfiumFontFallbackManager({
      fonts: { 134: 'https://fonts.invalid/NotoSansHans.otf' },
      faceFamilies: { simsun: 'serif' },
    });
    manager.initialize(module);
    assert.equal(systemFontInfo, 100);

    const mapFont = callbacks.get(values.get(112));
    const getFontData = callbacks.get(values.get(120));
    const firstHandle = mapFont(0, 400, 0, 134, 0, 1, 0);
    assert.equal(getFontData(0, firstHandle, 0, 0, 0), 4);
    assert.equal(getFontData(0, firstHandle, 0, 200, 4), 4);
    assert.deepEqual([...heap.slice(200, 204)], [1, 2, 3, 4]);
    assert.equal(manager.getDiagnostics()[0].status, 'loaded');

    mapFont(0, 400, 0, 134, 0, 1, 0);
    assert.equal(manager.getDiagnostics()[0].status, 'cached');

    manager.disable();
    assert.equal(systemFontInfo, 0);

    globalThis.XMLHttpRequest = class {
      status = 503;
      response = null;
      open() {}
      send() {}
    };
    const failingManager = new PdfiumFontFallbackManager({
      fonts: { 134: 'https://fonts.invalid/unavailable.otf' },
    });
    failingManager.initialize(module);
    const failingMapFont = callbacks.get(values.get(112));
    const failingGetFontData = callbacks.get(values.get(120));
    const failingHandle = failingMapFont(0, 400, 0, 134, 0, 1, 0);
    assert.equal(failingGetFontData(0, failingHandle, 0, 0, 0), 0);
    assert.equal(failingManager.getDiagnostics()[0].status, 'failed');
    assert.equal(failingManager.getDiagnostics()[0].httpStatus, 503);
    failingManager.disable();
  } finally {
    globalThis.XMLHttpRequest = previousXhr;
  }
});
