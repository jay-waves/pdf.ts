import assert from 'node:assert/strict';
import test from 'node:test';
import { DocumentSaveCoordinator } from '../apps/engine/persistence/document-save.ts';
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
