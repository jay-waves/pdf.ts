import assert from 'node:assert/strict';
import test from 'node:test';
import { Task, PdfErrorCode } from '@embedpdf/models';
import { createPdfSearchStore } from '../apps/search/pdf-search.ts';

test('a new search replaces old page highlights during progress and after failure', (t) => {
  const tasks = [];
  const store = createPdfSearchStore();
  store.getState().attach({
    withDocument(_id, operation) {
      return operation({ searchAllPages() { const task = new Task(); tasks.push(task); return task; } }, {});
    },
  });
  store.getState().setDocument('doc');
  store.getState().run('first');
  tasks[0].resolve({ results: [{ pageIndex: 0, rects: [] }] });
  store.getState().run('second');
  assert.equal(store.getState().resultsByPage.size, 0);
  tasks[1].progress({ results: [{ pageIndex: 1, rects: [] }] });
  assert.equal(store.getState().resultsByPage.has(0), false);
  assert.equal(store.getState().resultsByPage.get(1)[0].resultIndex, 0);
  t.mock.method(console, 'error', () => {});
  tasks[1].reject({ code: PdfErrorCode.Unknown, message: 'Search failed' });
  assert.equal(store.getState().results.length, 0);
  assert.equal(store.getState().resultsByPage.size, 0);
  assert.equal(store.getState().loading, false);
});
