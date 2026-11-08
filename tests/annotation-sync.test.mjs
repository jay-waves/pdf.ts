import assert from 'node:assert/strict';
import test from 'node:test';
import { diffAnnotations, mergeAnnotationPayload, applyAnnotationPayload } from '../apps/renderer/annotation-sync.ts';
const tracked = (id, pageIndex = 0, contents = '') => ({ commitState: 'synced', object: { id, pageIndex, contents } });
function state(byUid) {
  const pages = {};
  for (const item of Object.values(byUid)) (pages[item.object.pageIndex] ??= []).push(item.object.id);
  return { byUid, pages, hasPendingChanges: false, selectedUid: 'b', selectedUids: ['b'], activeToolId: 'ink' };
}
test('one edit transmits only one annotation and preserves unrelated SDK references and selection', () => {
  const a = tracked('a'); const b = tracked('b', 1);
  const before = { a, b }; const after = { a: tracked('a', 0, 'edited'), b };
  const changes = diffAnnotations(before, after);
  assert.deepEqual(changes.upsert, [after.a]);
  assert.deepEqual(changes.removed, []); assert.deepEqual(changes.pageIndices, [0]);
  const local = state(before); const applied = applyAnnotationPayload(local, { changes });
  assert.equal(applied.state.byUid.b, b);
  assert.equal(applied.state.pages[1], local.pages[1]);
  assert.equal(applied.state.selectedUid, 'b'); assert.equal(applied.state.activeToolId, 'ink');
  assert.deepEqual(applied.pageIndices, [0]);
});
test('moves and deletes invalidate both old and new pages and remove stale selections', () => {
  const before = { a: tracked('a'), b: tracked('b', 1) };
  const after = { a: tracked('a', 2) };
  const applied = applyAnnotationPayload(state(before), { changes: diffAnnotations(before, after) });
  assert.deepEqual(new Set(applied.pageIndices), new Set([0, 1, 2]));
  assert.deepEqual(applied.state.pages, { 0: [], 1: [], 2: ['a'] });
  assert.equal(applied.state.selectedUid, null); assert.deepEqual(applied.state.selectedUids, []);
});
test('in-flight updates coalesce in order, retaining removals across metadata acknowledgements', () => {
  const a = tracked('a');
  let buffer = mergeAnnotationPayload({}, { annotations: { a } });
  buffer = mergeAnnotationPayload(buffer, { changes: { upsert: [tracked('a', 0, 'changed'), tracked('b', 1)], removed: [], pageIndices: [0, 1] } });
  buffer = mergeAnnotationPayload(buffer, { changes: { upsert: [], removed: ['a'], pageIndices: [0] } });
  buffer = mergeAnnotationPayload(buffer, {});
  const applied = applyAnnotationPayload(state({}), buffer);
  assert.deepEqual(Object.keys(applied.state.byUid), ['b']);
  const replacement = mergeAnnotationPayload(buffer, { annotations: { c: tracked('c') } });
  assert.deepEqual(Object.keys(applyAnnotationPayload(state({}), replacement).state.byUid), ['c']);
});
test('canonical acknowledgements clear optimistic rejected creates and restore SDK flags', () => {
  const local = state({ ghost: { ...tracked('ghost'), commitState: 'new' } });
  local.hasPendingChanges = true;
  const changes = diffAnnotations({}, {}, ['ghost']);
  const applied = applyAnnotationPayload(local, { changes });
  assert.deepEqual(applied.state.byUid, {}); assert.equal(applied.state.hasPendingChanges, false);
  assert.deepEqual(applied.pageIndices, [0]);
  const a = { ...tracked('stamp'), dictMode: true };
  assert.deepEqual(diffAnnotations({ stamp: a }, { stamp: { ...a, dictMode: false } }).upsert.map(a => a.dictMode), [false]);
});
test('save metadata requires no annotation replacement or page invalidation', () => {
  const local = state({ a: tracked('a') });
  const applied = applyAnnotationPayload(local, {});
  assert.equal(applied.state, local); assert.deepEqual(applied.pageIndices, []);
});
