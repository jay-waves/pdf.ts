import assert from 'node:assert/strict';
import test from 'node:test';
import { annotationKey, localEngine } from '@embedpdf/engine';
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

test('v3 layer restores original annotation edits, deletion, replies, stamp appearance, and form values', async t => {
  const engine = engineFor(t);
  const base = fixture({ notes: true });
  const original = Buffer.from(base);
  const { doc, page } = await openFixture(engine);
  const { annotations } = await page.annotations.list();
  const note = annotations.find(a => a.contents === 'original note');
  await page.annotations.update(note.ref, { contents: 'changed original' });
  await page.annotations.delete(annotations.find(a => a.contents === 'delete this note').ref);
  await page.annotations.create({
    subtype: 'text', rect: note.rect, contents: 'reply retained', reply: { to: note.ref },
  });
  // A PDF appearance avoids an image encoder dependency and checks binary resources.
  await page.annotations.create({
    subtype: 'stamp', box: { x: 200, y: 200, width: 100, height: 100 }, name: 'layer stamp',
  }, { resources: { appearance: fixture({ content: '1 0 0 rg 0 0 100 100 re f\n' }) } });
  const { fields } = await doc.forms.list();
  await doc.forms.setValue(fields[0].ref, { value: 'draft field value' });
  const layer = await doc.downloadLayer();
  assert.ok(layer.byteLength > 0);
  assert.ok(layer.byteLength < 100_000, 'small edits should not turn into a full-document backup');
  assert.deepEqual(base, original, 'draft export must not mutate the original input');
  await doc.close();

  const restored = await engine.open({
    kind: 'layerBytes', baseBytes: base, layer: { kind: 'artifact', bytes: layer },
  });
  const all = (await restored.annotations.list()).annotations;
  const restoredNote = all.find(a => a.contents === 'changed original');
  assert.ok(restoredNote);
  assert.ok(!all.some(a => a.contents === 'delete this note'));
  const reply = all.find(a => a.contents === 'reply retained');
  assert.equal(annotationKey(reply.reply.to), annotationKey(restoredNote.ref));
  const stamp = all.find(a => a.subtype === 'stamp');
  const appearance = await restored.page(stamp.page).annotations.downloadResource(stamp.ref, 'appearance');
  assert.ok(appearance.byteLength > 0);
  assert.equal((await restored.forms.list()).fields[0].value, 'draft field value');

  const output = await restored.download({ mode: 'rewrite' });
  const merged = await engine.open({ kind: 'bytes', bytes: output });
  assert.equal((await merged.annotations.list()).annotations.length, all.length);
  assert.equal((await merged.forms.list()).fields[0].value, 'draft field value');
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
