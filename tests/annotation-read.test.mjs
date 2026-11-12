import assert from 'node:assert/strict';
import test from 'node:test';
import { localEngine } from '@embedpdf/engine';
import { readAnnotationBatches } from '../apps/engine/annotation-read.ts';
import { scrollingFixture } from './support/scrolling-fixture.mjs';
import { documentReadPriority } from '../apps/engine/render-task-queue.ts';

async function collect(iterator) {
  let step, yields = 0;
  do { step = await iterator.next(); if (!step.done) yields++; } while (!step.done);
  return { value: step.value, yields };
}

test('batched native annotation reads match full and filtered snapshots including ordering and empty pages', async t => {
  const engine = localEngine({ runtime: { prefer: 'wasm' }, defaultFallbackFonts: false });
  t.after(() => engine.destroy());
  const doc = await engine.open({ kind: 'bytes', bytes: scrollingFixture({ pageCount: 35, pathCount: 1 }) });
  const pages = (await doc.pages.list()).pages.map(page => page.ref);
  for (const index of [0, 15, 16, 32, 34]) {
    await doc.page(pages[index]).annotations.create({ subtype: 'text', rect: { x: 40, y: 40, width: 20, height: 20 }, contents: `note ${index}` });
  }
  for (const options of [undefined, { pages: [...pages].reverse() }, { pages: pages.slice(0, 2) }, { pages: [] }]) {
    const expected = await doc.annotations.list(options);
    const actual = await collect(readAnnotationBatches(doc, options, operation => Promise.resolve(operation())));
    assert.deepEqual(actual.value, expected);
    assert.equal(actual.yields > 0, (options?.pages ?? pages).length > 16);
  }
});

test('only explicit document reads may pass a bulk snapshot; unknown paths remain write barriers', () => {
  const request = (service, method) => ({ type: 'call', path: [service], method });
  assert.equal(documentReadPriority(request('annotations', 'list')), -10);
  assert.ok(documentReadPriority(request('actions', 'get')) > 0);
  for (const [service, method] of [['forms', 'setValue'], ['pages', 'delete'], ['annotations', 'import'], ['actions', 'unknown']]) {
    assert.equal(documentReadPriority(request(service, method)), undefined);
  }
  assert.equal(documentReadPriority({ ...request('annotations', 'list'), path: ['unknown', 'annotations'] }), undefined);
  assert.equal(documentReadPriority({ ...request('annotations', 'list'), type: 'save' }), undefined);
});
