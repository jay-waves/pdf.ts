// Small, repeatable real-SharedWorker benchmark. Start Vite, then run this script.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from '../support/pdf-editing-fixture.mjs';
const url = process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173';
const bytes = fixture({ notes: true, content: '0.1 0.3 0.8 rg 30 40 230 200 re f\nBT /Helv 20 Tf 60 700 Td (Canvas vs BMP) Tj ET\n' });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(url);
  const result = await page.evaluate(async input => {
    const { createSharedPdfEngine } = await import('/apps/engine/shared-document-client.ts');
    const { paintRaster } = await import('/apps/renderer/canvas-painter.ts');
    const { engine, client } = createSharedPdfEngine();
    await client.ready;
    const doc = await engine.open({ kind: 'bytes', bytes: new Uint8Array(input) });
    const ref = (await doc.pages.list()).pages[0].ref;
    const render = doc.page(ref).render;
    const canvas = document.createElement('canvas'); document.body.append(canvas);
    const context = canvas.getContext('2d');
    const img = new Image(); document.body.append(img);
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const rows = [];
    async function sample(mode, options, verify) {
      const start = performance.now();
      const output = mode === 'canvas' ? await render.raw(options) : await render.image({ ...options, format: 'bmp' });
      const received = performance.now();
      if (mode === 'canvas') paintRaster(canvas, output);
      else {
        const object = await output.objectUrl();
        try {
          img.src = object.url; await img.decode();
        } finally { object.revoke(); }
      }
      const painted = performance.now();
      if (verify && mode === 'bmp') { canvas.width = output.width; canvas.height = output.height; context.drawImage(img, 0, 0); }
      return { workerAndRpcMs: received - start, presentationMs: painted - received, totalMs: painted - start,
        bytes: mode === 'canvas' ? output.data.byteLength : output.source.bytes.byteLength,
        pixels: verify ? context.getImageData(0, 0, canvas.width, canvas.height).data : null };
    }
    try {
      for (const width of [640, 1600, 2400]) {
        const options = { viewport: { kind: 'width', width } };
        const raw = await sample('canvas', options, true), bmp = await sample('bmp', options, true);
        let different = 0;
        for (let i = 0; i < raw.pixels.length; i++) if (raw.pixels[i] !== bmp.pixels[i]) different++;
        const samples = { canvas: [], bmp: [] };
        // Alternate order to reduce warm-cache/order bias; warmups are excluded.
        for (let i = 0; i < 10; i++) for (const mode of i % 2 ? ['bmp', 'canvas'] : ['canvas', 'bmp']) samples[mode].push(await sample(mode, options, false));
        for (const mode of ['canvas', 'bmp']) rows.push({ width, mode, differentPixelBytes: different, samples: 10,
          transferBytes: samples[mode][0].bytes,
          ...Object.fromEntries(['workerAndRpcMs', 'presentationMs', 'totalMs'].map(key => [key, +median(samples[mode].map(s => s[key])).toFixed(2)])) });
      }
      for (const options of [{ viewport: { kind: 'width', width: 500 }, rotation: 90 },
        { viewport: { kind: 'scale', scale: 3 }, target: { kind: 'rect', rect: { x: 20, y: 30, width: 200, height: 180 } } }]) {
        const raw = await sample('canvas', options, true), bmp = await sample('bmp', options, true);
        if (raw.pixels.length !== bmp.pixels.length || raw.pixels.some((v, i) => v !== bmp.pixels[i])) throw Error('rotated/cropped pixel mismatch');
      }
      return { userAgent: navigator.userAgent, rows, rotatedAndCroppedPixelsEqual: true };
    } finally { canvas.width = canvas.height = 0; canvas.remove(); img.remove(); await engine.destroy(); }
  }, [...bytes]);
  assert.ok(result.rows.every(row => row.differentPixelBytes === 0), 'canvas/BMP output pixels differ');
  console.table(result.rows);
  if (process.env.PDF_BENCH_OUTPUT) await writeFile(process.env.PDF_BENCH_OUTPUT, JSON.stringify(result, null, 2) + '\n');
  console.log('PASS: exact pixel equality including crop/rotation; timings exclude readback and include real SharedWorker RPC. GPU compositing/RSS are not measured.');
} finally { await browser.close(); }
