import assert from 'node:assert/strict';
import test from 'node:test';
import { localEngine } from '@embedpdf/engine';
import { fixture } from '../scripts/pdf-editing-fixture.mjs';

// Exercise the shipped WASM runtime, the same implementation used by the viewer.
// No v2 adapter, mocked executor, timing delay, or network font fetch is involved.
function engineFor(t) {
  const engine = localEngine({ runtime: { prefer: 'wasm' }, defaultFallbackFonts: false });
  t.after(() => engine.destroy());
  return engine;
}

async function openFixture(engine) {
  const doc = await engine.open({ kind: 'bytes', bytes: fixture({ notes: true }) });
  const { pages } = await doc.pages.list();
  return { doc, page: doc.page(pages[0].ref), pageRef: pages[0].ref };
}

test('v3 applies one annotation/form action atomically and undoes/redoes it without a timing barrier', async t => {
  const engine = engineFor(t);
  const { doc, page, pageRef } = await openFixture(engine);
  const { fields } = await doc.forms.list();
  const change = await doc.apply({
    ops: [
      { type: 'annotations.create', page: pageRef, data: {
        subtype: 'square', box: { x: 20, y: 30, width: 40, height: 50 }, contents: 'one action',
      } },
      { type: 'forms.setValue', field: fields[0].ref, value: { value: 'edited' } },
    ],
  });
  assert.equal(change.meta.undoable, true);
  assert.ok((await page.annotations.list()).annotations.some(a => a.contents === 'one action'));
  assert.equal((await doc.forms.get(fields[0].ref)).value, 'edited');

  const undo = await doc.apply({ undoOf: change.meta.opId });
  assert.ok(!(await page.annotations.list()).annotations.some(a => a.contents === 'one action'));
  assert.equal((await doc.forms.get(fields[0].ref)).value, 'initial');
  await doc.apply({ undoOf: undo.meta.opId });
  assert.equal((await page.annotations.list()).annotations.filter(a => a.contents === 'one action').length, 1);
  assert.equal((await doc.forms.get(fields[0].ref)).value, 'edited');

  const before = await page.annotations.list();
  await assert.rejects(doc.apply({ ops: [
    { type: 'annotations.create', page: pageRef, data: {
      subtype: 'square', box: { x: 10, y: 20, width: 30, height: 40 }, contents: 'must roll back',
    } },
    { type: 'forms.setValue', field: { kind: 'objectNumber', objectNumber: 999999 }, value: { value: 'invalid' } },
  ] }));
  assert.deepEqual(await page.annotations.list(), before);
  assert.equal((await doc.forms.get(fields[0].ref)).value, 'edited');
});

test('v3 explicit rewrite preserves final metadata without accumulating PDF revisions', async t => {
  const engine = engineFor(t);
  const { doc } = await openFixture(engine);
  await doc.metadata.update({ title: 'first', author: 'retained author' });
  const first = await doc.download({ mode: 'rewrite' });
  await doc.metadata.update({ title: 'second' });
  const second = await doc.download({ mode: 'rewrite' });
  assert.ok(second.byteLength < first.byteLength + 100);
  assert.equal(new TextDecoder().decode(second).match(/%%EOF/g).length, 1);
  const reopened = await engine.open({ kind: 'bytes', bytes: second });
  const metadata = await reopened.metadata.get();
  assert.equal(metadata.title, 'second');
  assert.equal(metadata.author, 'retained author');
});
