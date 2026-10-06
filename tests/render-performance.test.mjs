import assert from 'node:assert/strict';
import test from 'node:test';
import { Task, TaskStage, PdfErrorCode } from '@embedpdf/models';
import { PdfEngine } from '@embedpdf/engines/pdfium';
import { getDisplayTiles } from '../apps/renderer/tile-rendering.ts';
import { renderImage } from '../apps/renderer/render-image.ts';

const doc = { id: 'test-document' };
const page = { index: 0 };
const rect = { origin: { x: 0, y: 0 }, size: { width: 100, height: 100 } };
const pixels = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture() {
  const calls = [];
  const run = (kind) => {
    const task = new Task();
    calls.push({ kind, task });
    return task;
  };
  const executor = {
    renderPageRect: () => run('tile'),
    renderPageRaw: () => run('base'),
  };
  const engine = new PdfEngine(executor, {
    imageConverter: () => Promise.resolve(new Blob()),
  });
  return { engine, calls };
}

test('queued cancellation prevents execution; dispatched cancellation finishes in worker', async () => {
  const { engine, calls } = fixture();
  const running = engine.renderPageRect(doc, page, rect, { scaleFactor: 1 });
  const queued = engine.renderPageRect(doc, page, rect, { scaleFactor: 2 });
  const reason = { code: PdfErrorCode.Cancelled, message: 'Superseded' };
  queued.abort(reason);
  running.abort(reason);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].task.state.stage, TaskStage.Pending);
  calls[0].task.resolve(pixels);
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(running.state.stage, TaskStage.Aborted);
  assert.equal(queued.state.stage, TaskStage.Aborted);
});

test('identical tile requests are not deduplicated by the engine', async () => {
  const { engine, calls } = fixture();
  const first = engine.renderPageRect(doc, page, rect, { scaleFactor: 1 });
  const second = engine.renderPageRect(doc, page, rect, { scaleFactor: 1 });
  calls[0].task.resolve(pixels);
  await tick();
  assert.equal(calls.length, 2);
  calls[1].task.resolve(pixels);
  await Promise.all([first.toPromise(), second.toPromise()]);
});

test('full-page renders take priority over queued tiles', async () => {
  const { engine, calls } = fixture();
  const first = engine.renderPageRect(doc, page, rect, { scaleFactor: 1 });
  const second = engine.renderPageRect(doc, page, rect, { scaleFactor: 2 });
  const base = engine.renderPage(doc, page, { scaleFactor: 0.5 });
  calls[0].task.resolve(pixels);
  await tick();
  assert.deepEqual(calls.map((call) => call.kind), ['tile', 'base']);
  calls[1].task.resolve(pixels);
  await tick();
  assert.deepEqual(calls.map((call) => call.kind), ['tile', 'base', 'tile']);
  calls[2].task.resolve(pixels);
  await Promise.all([first.toPromise(), second.toPromise(), base.toPromise()]);
});

test('zoom retains loaded detail while removing obsolete unfinished tiles', () => {
  const front = { id: 'front', srcScale: 1 };
  const sharp = { id: 'sharp', srcScale: 2 };
  const unfinished = { id: 'unfinished', srcScale: 2 };
  const current = { id: 'current', srcScale: 3 };
  const loaded = new Set(['front', 'sharp']);
  assert.deepEqual(
    getDisplayTiles([front], [sharp, unfinished, current], 3, loaded),
    [front, sharp, current],
  );
  // A shared fallback tile must stay mounted only once, with its latest metadata.
  const fallback = { ...front, isFallback: true };
  assert.deepEqual(getDisplayTiles([front], [fallback], 3, loaded), [fallback]);
  // Returning to an earlier scale permits an aborted tile to be requested again.
  assert.deepEqual(getDisplayTiles([], [unfinished], 2, loaded), [unfinished]);
});

test('unmounting an obsolete queued tile lets the current scale run next', async () => {
  const { engine, calls } = fixture();
  const running = engine.renderPageRect(doc, page, rect, { scaleFactor: 1 });
  const dispose = renderImage(
    () => engine.renderPageRect(doc, page, rect, { scaleFactor: 2 }),
    () => assert.fail('Obsolete tile must not reach the view'),
    assert.fail,
  );
  const current = engine.renderPageRect(doc, page, rect, { scaleFactor: 3 });
  dispose();
  calls[0].task.resolve(pixels);
  await tick();
  assert.equal(calls.length, 2);
  calls[1].task.resolve(pixels);
  await Promise.all([running.toPromise(), current.toPromise()]);
  await tick();
  assert.equal(calls.length, 2);
});
