import assert from 'node:assert/strict';
import test from 'node:test';
import { localEngine } from '@embedpdf/engine';
const { buildDraft, captureBaseline, restoreDraft, encodeDraft, decodeDraft } = await import('../apps/renderer/document-draft.ts');
import { fixture } from '../scripts/pdf-editing-fixture.mjs';
async function setup(t) {
  const engine = localEngine({ runtime: { prefer: 'wasm' }, defaultFallbackFonts: false });
  t.after(() => engine.destroy());
  const bytes = fixture({ notes: true });
  const doc = await engine.open({ kind: 'bytes', bytes });
  return { engine, doc, bytes, baseline: await captureBaseline(doc) };
}

test('draft records net changes and deletion, preserving replies and binary appearance after reopen', async t => {
  const { engine, doc, bytes, baseline } = await setup(t);
  const [note, removed] = baseline.annotations;
  await doc.page(note.page).annotations.update(note.ref, { contents: 'changed original' });
  await doc.page(removed.page).annotations.delete(removed.ref);
  await doc.page(note.page).annotations.create({ subtype: 'text', rect: note.rect, contents: 'reply', reply: { to: note.ref } });
  await doc.page(note.page).annotations.create({ subtype: 'stamp', box: { x: 200, y: 200, width: 50, height: 50 } }, {
    resources: { appearance: fixture({ content: '1 0 0 rg 0 0 100 100 re f\n' }) },
  });
  await doc.forms.setValue(baseline.fields[0].ref, { value: 'new value' });
  const draft = await buildDraft(doc, 'hash', 4, baseline);
  assert.equal(draft.removed.length, 1);
  assert.equal(draft.removed[0].index, 1);
  assert.deepEqual(draft.formValues, { SharedName: { value: 'new value' } });
  assert.deepEqual(decodeDraft(encodeDraft(draft)), draft);
  const reopened = await engine.open({ kind: 'bytes', bytes: bytes.slice() });
  await restoreDraft(reopened, decodeDraft(encodeDraft(draft)), await captureBaseline(reopened));
  const all = (await reopened.annotations.list()).annotations;
  assert.equal(all.filter(a => a.contents === 'changed original').length, 1);
  assert.equal(all.filter(a => a.contents === 'reply').length, 1);
  assert.ok(!all.some(a => a.contents === 'delete this note'));
  const stamp = all.find(a => a.subtype === 'stamp');
  assert.ok((await reopened.page(stamp.page).annotations.downloadResource(stamp.ref, 'appearance')).byteLength > 0);
  assert.equal((await reopened.forms.list()).fields[0].value, 'new value');
});

test('a rebased draft after rewrite restores only edits made during the merge', async t => {
  const { engine, doc, baseline } = await setup(t);
  const note = baseline.annotations[0];
  await doc.page(note.page).annotations.update(note.ref, { contents: 'saved checkpoint' });
  const merged = await doc.download({ mode: 'rewrite' });
  const checkpoint = await captureBaseline(doc);
  await doc.page(note.page).annotations.update(note.ref, { contents: 'concurrent edit' });
  const draft = await buildDraft(doc, 'merged-hash', 2, checkpoint);
  const reopened = await engine.open({ kind: 'bytes', bytes: merged });
  await restoreDraft(reopened, draft, await captureBaseline(reopened));
  const all = (await reopened.annotations.list()).annotations;
  assert.equal(all.length, 2);
  assert.equal(all.filter(a => a.contents === 'concurrent edit').length, 1);
  assert.ok(all.some(a => a.contents === 'delete this note'));
});

test('unchanged documents produce no annotation bundle or form writes', async t => {
  const { doc, baseline } = await setup(t);
  const draft = await buildDraft(doc, 'hash', 0, baseline);
  assert.equal(draft.bundle, null);
  assert.deepEqual(draft.removed, []);
  assert.deepEqual(draft.formValues, {});
});

test('foreign swap formats and prototype-bearing JSON are rejected', () => {
  assert.throws(() => decodeDraft('VIM swap contents'));
  assert.throws(() => decodeDraft('{"format":"pdf.ts/swp","version":9}'));
  assert.throws(() => decodeDraft('{"__proto__":{"polluted":true}}'));
  assert.throws(() => decodeDraft(JSON.stringify({ format: 'pdf.ts/swp', version: 1, baseVersion: 'old', revision: 1, targets: [], removed: [], upsert: [], formValues: {} })), /not a supported/);
});


test('draft preserves checkbox and multi-select values through native form value shapes', async t => {
  const { engine, doc } = await setup(t);
  const page = (await doc.pages.list()).pages[0].ref;
  await doc.forms.create({ kind: 'checkbox', name: 'Agree', widgets: [{ page, box: { x: 30, y: 40, width: 20, height: 20 } }] });
  await doc.forms.create({ kind: 'listbox', name: 'Choices', multiSelect: true, options: ['A', 'B', 'C'].map(value => ({ value, label: value })), widgets: [{ page, box: { x: 80, y: 40, width: 100, height: 60 } }] });
  const base = await doc.download({ mode: 'rewrite' });
  const editing = await engine.open({ kind: 'bytes', bytes: base.slice() });
  const baseline = await captureBaseline(editing);
  await editing.forms.setValue(baseline.fields.find(f => f.name === 'Agree').ref, { checked: true });
  await editing.forms.setValue(baseline.fields.find(f => f.name === 'Choices').ref, { selectedValues: ['A', 'C'] });
  const draft = await buildDraft(editing, 'base', 2, baseline);
  assert.deepEqual(draft.formValues.Agree, { checked: true });
  assert.deepEqual(draft.formValues.Choices, { selectedValues: ['A', 'C'] });
  const reopened = await engine.open({ kind: 'bytes', bytes: base });
  await restoreDraft(reopened, decodeDraft(encodeDraft(draft)), await captureBaseline(reopened));
  const fields = (await reopened.forms.list()).fields;
  assert.equal(fields.find(f => f.name === 'Agree').checked, true);
  assert.deepEqual(fields.find(f => f.name === 'Choices').selectedValues, ['A', 'C']);
});
