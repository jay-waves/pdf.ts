import assert from 'node:assert/strict';
import test from 'node:test';
import { PdfWorkerDocuments } from '../apps/renderer/pdf-worker-session.ts';

function open(session, id) {
  const args = [{ id, content: new ArrayBuffer(8) }];
  const [file] = session.args('openDocumentBuffer', args);
  return session.result('openDocumentBuffer', args, { id: file.id, pages: [], pageCount: 0 });
}

test('identical public IDs keep independent documents and cannot borrow another session handle', () => {
  const a = new PdfWorkerDocuments('tab-a');
  const b = new PdfWorkerDocuments('tab-b');
  const docA = open(a, 'document');
  const docB = open(b, 'document');
  assert.equal(docA.id, docB.id);
  assert.notEqual(a.args('saveAsCopy', [docA])[0].id, b.args('saveAsCopy', [docB])[0].id);
  assert.throws(() => b.args('saveAsCopy', [{ id: 'tab-a:document' }]));
  assert.throws(() => open(a, 'document'));
  a.result('closeDocument', [docA], true);
  assert.throws(() => a.args('saveAsCopy', [docA]));
  assert.equal(b.args('saveAsCopy', [docB])[0].id, 'tab-b:document');
  assert.equal(open(a, 'document').id, 'document');
});

test('imports and merges resolve every live document through the caller session', () => {
  const a = new PdfWorkerDocuments('tab-a');
  const first = open(a, 'first');
  const second = open(a, 'second');
  assert.deepEqual(a.args('importPages', [first, second, [0], 1]).map(x => x?.id ?? x),
    ['tab-a:first', 'tab-a:second', [0], 1]);
  assert.deepEqual(a.args('mergePages', [[{ docId: 'first', pageIndices: [0] }]]),
    [[{ docId: 'tab-a:first', pageIndices: [0] }]]);
  assert.throws(() => a.args('mergePages', [[{ docId: 'other', pageIndices: [0] }]]));
  assert.throws(() => a.args('importPages', [first, { id: 'other' }, [0], 0]));
  a.clear();
  assert.equal(a.all().length, 0);
  assert.throws(() => a.args('saveAsCopy', [second]));
});
