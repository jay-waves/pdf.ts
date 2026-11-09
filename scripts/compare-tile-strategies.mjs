// Deterministic scheduler benchmark: real render plugin, synthetic RGBA producer.
// Measures requests/pixels/retained buffers, not PDFium CPU or browser GPU memory.
// Each demand fully settles before the next; this does not model cancellation under load.
// Example: TILE_CACHE_MIB=48 TILE_STRATEGY=sqrt2 node scripts/compare-tile-strategies.mjs
import { createTestContext, manualClock } from '@embedpdf/core/testing';
import { AbortablePromise } from '@embedpdf/engine-core/runtime';
import { toPageRef } from '@embedpdf/core';
import { renderPlugin } from '@embedpdf/plugin-render';
import { PDF_TILE_SCALES } from '../apps/renderer/tile-levels.ts';

const cacheMiB = Number(process.env.TILE_CACHE_MIB ?? 32);
const ladders = [
  ['exact', 'exact'],
  ['quarter-octave', Array.from({ length: 33 }, (_, i) => 2 ** ((i - 4) / 4))],
  ['sqrt2', PDF_TILE_SCALES],
  ['double', Array.from({ length: 9 }, (_, i) => 2 ** (i - 1))],
];
const sweep = Array.from({ length: 41 }, (_, i) => 1.5 * 2 ** (i / 20));
const scenarios = {
  sweep: [...sweep, ...sweep.slice().reverse()],
  smallZoom: Array.from({ length: 60 }, (_, i) => 2.1 + 0.12 * Math.sin(i / 5)),
  boundary: Array.from({ length: 60 }, (_, i) => i % 2 ? 1.99 : 2.01),
  stops: [1.5, 2, 2.5, 3, 4, 3, 2.5, 2, 1.5],
};
async function run(quantize, scales, screenWidth, screenHeight) {
  const clock = manualClock();
  let requests = 0, pixels = 0, activePeak = 0;
  const definition = renderPlugin({ fullPage: { maxWidth: 640 }, tiles: {
    size: 768, quantize, settleMs: 0, bleedPx: 2,
    prefetch: { margin: 0, velocityBias: false },
  } }, { rawPixels: true, cacheBytes: cacheMiB * 1024 * 1024, maxInFlight: 2, demandWindowMs: 60 });
  const raw = options => AbortablePromise.run(async () => {
    const rect = options.target.rect, scale = options.viewport.scale;
    const width = Math.ceil(rect.width * scale), height = Math.ceil(rect.height * scale);
    requests++; pixels += width * height;
    return { width, height, stride: width * 4, data: new ArrayBuffer(width * height * 4) };
  });
  const doc = { with() { return this; }, page: () => ({ render: { raw } }) };
  const page = toPageRef(3);
  const ctx = createTestContext({ id: 'render', doc, pages: [{ ref: page }], state: definition.state(), settings: definition.settings, clock: clock.clock });
  const api = ctx.connect(definition.create(ctx)), view = api.createViewDemand('benchmark');
  let outbound = 0;
  for (let step = 0; step < scales.length; step++) {
    const scale = scales[step];
    const width = Math.min(612, screenWidth / scale), height = Math.min(792, screenHeight / scale);
    view.setDemand(page, { desiredDeviceWidth: 612 * scale,
      visibleRect: { x: (612 - width) / 2, y: (792 - height) / 2, width, height } });
    clock.advance(60);
    for (let i = 0; i < 160; i++) { await Promise.resolve(); clock.frame(); }
    const paint = view.getPlan(page).paint;
    activePeak = Math.max(activePeak, paint.reduce((sum, tile) => sum + tile.handle.data.byteLength, 0));
    paint.forEach(tile => view.markPainted(page, tile.key));
    for (let i = 0; i < 20; i++) { await Promise.resolve(); clock.frame(); }
    if (step === Math.floor(scales.length / 2) - 1) outbound = requests;
  }
  view.destroy(); await ctx.destroy();
  return { requests, megapixels: +(pixels / 1e6).toFixed(1), sampledActivePeakMiB: +(activePeak / 1048576).toFixed(1), secondHalfRequests: requests - outbound };
}
const rows = [];
for (const [viewport, w, h] of [['1200x900', 1200, 900], ['2100x1575', 2100, 1575]]) {
  for (const [scenario, scales] of Object.entries(scenarios)) {
    for (const [strategy, quantize] of ladders) {
      if (process.env.TILE_STRATEGY && process.env.TILE_STRATEGY !== strategy) continue;
      rows.push({ cacheMiB, viewport, scenario, strategy, ...await run(quantize, scales, w, h) });
    }
  }
}
console.table(rows);
