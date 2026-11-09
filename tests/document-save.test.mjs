import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentSaveCoordinator, ownedPdfBuffer } from '../apps/engine/persistence/document-save.ts';
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const coordinator = new DocumentSaveCoordinator('base');
  let revision = 1;
  const plans = [];
  const prepared = [];
  const options = {
    revision: () => revision,
    prepare: async () => { prepared.push(revision); return { data: new ArrayBuffer(8), hash: `r${revision}`, revision }; },
    write: async plan => { plans.push(plan); return { status: 'saved', version: plan.outputVersion }; },
    committed() {}, changed: async () => {}, assertConnected() {},
  };
  return { coordinator, options, plans, prepared, edit: () => ++revision };
}
test('worker serializes disk writes without blocking edits', async () => {
  const f = fixture(); const writing = deferred(); const ack = deferred();
  const first = f.coordinator.save({ ...f.options, write: async plan => { f.plans.push(plan); writing.resolve(); await ack.promise; return { status: 'saved', version: plan.outputVersion }; } });
  await writing.promise;
  f.edit();
  assert.equal(f.coordinator.savedRevision, 0);
  const second = f.coordinator.save(f.options);
  assert.equal(f.plans.length, 1);
  ack.resolve(); await first; await second;
  assert.deepEqual(f.plans.map(p => p.expectedVersion), [
    'base', 'r1',
  ]);
  assert.equal(f.coordinator.savedRevision, 2);
  assert.equal(f.coordinator.diskVersion, 'r2');
  assert.equal(f.coordinator.saving, false);
  await f.coordinator.save(f.options);
  assert.equal(f.plans.length, 2, 'redundant save is coalesced');
});
test('edits made during disk IO remain dirty after that revision is acknowledged', async () => {
  const f = fixture();
  await f.coordinator.save({ ...f.options, write: async plan => { f.edit(); return { status: 'saved', version: plan.outputVersion }; } });
  assert.equal(f.coordinator.savedRevision, 1);
  assert.equal(f.options.revision(), 2);
});
test('every edited revision is serialized as a complete PDF', async () => {
  const f = fixture();
  await f.coordinator.save(f.options);
  f.edit(); await f.coordinator.save(f.options);
  assert.deepEqual(f.prepared, [1, 2]);
  assert.equal(f.plans[1].expectedVersion, 'r1');
});
test('failed/disconnected writers cannot advance disk state or wedge the next save', async () => {
  const f = fixture();
  await assert.rejects(f.coordinator.save({ ...f.options, write: async () => { throw Error('disconnected'); } }), /disconnected/);
  assert.equal(f.coordinator.diskVersion, 'base');
  assert.equal(f.coordinator.savedRevision, 0);
  assert.equal(f.coordinator.saving, false);
  await f.coordinator.save(f.options);
  assert.equal(f.coordinator.savedRevision, 1);
});
test('conflict copies and invalid acknowledgements never mark the original saved', async () => {
  const f = fixture(); const destinations = [];
  assert.equal(await f.coordinator.save({ ...f.options, write: async plan => {
    destinations.push(plan.destination);
    return { status: plan.destination === 'original' ? 'retry-copy' : 'copy' };
  } }), false);
  assert.deepEqual(destinations, ['original', 'copy']);
  assert.equal(f.coordinator.diskVersion, 'base');
  assert.equal(f.coordinator.savedRevision, 0);
  await assert.rejects(f.coordinator.save({ ...f.options, write: async () => ({ status: 'saved', version: 'wrong' }) }), /expected file version/);
});
test('different open revisions of the same file share the write lane', async () => {
  const a = fixture(); const b = new DocumentSaveCoordinator('new-base', a.coordinator.lane);
  const writing = deferred(); const ack = deferred(); let secondStarted = false;
  const first = a.coordinator.save({ ...a.options, write: async plan => { writing.resolve(); await ack.promise; return { status: 'saved', version: plan.outputVersion }; } });
  await writing.promise;
  const second = b.save({ ...a.options, write: async plan => { secondStarted = true; return { status: 'saved', version: plan.outputVersion }; } });
  await Promise.resolve(); assert.equal(secondStarted, false);
  ack.resolve(); await first; await second;
  assert.equal(secondStarted, true);
});


test('owned PDF output reuses full buffers and isolates partial/shared views', () => {
  const full = new Uint8Array([9, 1, 2, 8]);
  assert.equal(ownedPdfBuffer(full), full.buffer, 'normal save must not duplicate the PDF');
  for (const partial of [full.subarray(1, 3), full.subarray(0, 2)]) {
    const standalone = ownedPdfBuffer(partial);
    assert.notEqual(standalone, full.buffer);
    assert.deepEqual(new Uint8Array(standalone), partial);
    structuredClone(standalone, { transfer: [standalone] });
    assert.equal(full.buffer.detached, false);
  }
  const shared = new Uint8Array(new SharedArrayBuffer(4));
  shared.set([1, 2, 3, 4]);
  const standalone = ownedPdfBuffer(shared);
  assert.ok(standalone instanceof ArrayBuffer);
  assert.deepEqual(new Uint8Array(standalone), new Uint8Array([1, 2, 3, 4]));
});

test('save forwards the owned buffer and retry-copy prepares fresh bytes after transfer', async () => {
  const f = fixture();
  const outputs = [];
  const received = [];
  const result = await f.coordinator.save({ ...f.options,
    prepare: async () => {
      const bytes = new Uint8Array([outputs.length + 1, 2, 3]);
      const data = ownedPdfBuffer(bytes);
      outputs.push(data);
      return { data, hash: 'output', revision: 1 };
    },
    write: async plan => {
      assert.equal(plan.data, outputs.at(-1), 'coordinator must not clone the PDF');
      assert.equal(plan.data.detached, false);
      received.push(structuredClone(plan.data, { transfer: [plan.data] }));
      assert.equal(plan.data.detached, true);
      return { status: plan.destination === 'original' ? 'retry-copy' : 'copy' };
    },
  });
  assert.equal(result, false);
  assert.equal(outputs.length, 2);
  assert.notEqual(outputs[0], outputs[1]);
  assert.deepEqual(received.map(buffer => [...new Uint8Array(buffer)]), [[1, 2, 3], [2, 2, 3]]);
  assert.equal(f.coordinator.candidateVersion, undefined);
  assert.equal(f.coordinator.saving, false);
  assert.equal(await f.coordinator.lane.tail, false, 'settled lane returns only the save status, not PDF bytes');
});

test('failed save after transfer releases pending state and permits a fresh save', async () => {
  const f = fixture();
  await assert.rejects(f.coordinator.save({ ...f.options, write: async plan => {
    structuredClone(plan.data, { transfer: [plan.data] });
    throw new Error('disk failed after transfer');
  } }), /disk failed/);
  assert.equal(f.coordinator.candidateVersion, undefined);
  assert.equal(f.coordinator.saving, false);
  assert.equal(await f.coordinator.lane.tail, undefined);
  assert.equal(await f.coordinator.save(f.options), true);
});
