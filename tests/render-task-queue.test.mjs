import assert from 'node:assert/strict';
import test from 'node:test';
import { RenderTaskQueue, displayRead } from '../apps/engine/render-task-queue.ts';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('latest visible reads pass obsolete reads, but never an edit barrier; native work stays serial', async () => {
  const queue = new RenderTaskQueue();
  const started = deferred(), release = deferred();
  const order = [];
  const first = queue.enqueue(async () => { started.resolve(); await release.promise; order.push('active'); });
  await started.promise;
  let visible = 'old';
  const read = name => queue.enqueue(async () => { order.push(name); }, { priority: () => visible === name ? 100 : 0 });
  const old = read('old'), latest = read('latest');
  const edit = queue.enqueue(async () => { order.push('edit'); });
  const after = queue.enqueue(async () => { order.push('after'); }, { priority: () => 1000 });
  visible = 'latest';
  assert.deepEqual(order, []);
  release.resolve();
  await Promise.all([first, old, latest, edit, after]);
  assert.deepEqual(order, ['active', 'latest', 'old', 'edit', 'after']);
});

test('cancel removes pending work immediately; failures do not block subsequent tasks', async () => {
  const queue = new RenderTaskQueue(), release = deferred(), started = deferred();
  const active = queue.enqueue(async () => { started.resolve(); await release.promise; });
  await started.promise;
  let ran = false;
  const obsolete = queue.enqueue(async () => { ran = true; }, { key: 'obsolete', priority: () => 10 });
  const rejected = assert.rejects(obsolete, { code: 'Aborted' });
  assert.equal(queue.cancel('obsolete'), true);
  await rejected;
  assert.equal(queue.cancel('obsolete'), false);
  const failing = queue.enqueue(async () => { throw Error('native failure'); });
  const failure = assert.rejects(failing, /native failure/);
  const last = queue.enqueue(async () => 42);
  release.resolve();
  await active; await failure;
  assert.equal(await last, 42);
  assert.equal(ran, false);
});

test('allowlisted page reads alone can be reordered; exports, edits and unknown paths remain barriers', () => {
  const request = (service, method, args = [{}]) => ({ type: 'call', path: [{ with: { view: 'stage' } }, { page: { objectNumber: 7 } }, service], method, args });
  assert.deepEqual(displayRead(request('render', 'raw')), { page: 7, view: 'stage', detail: 3 });
  assert.equal(displayRead(request('render', 'raw', [{ target: { rect: {} } }])).detail, 2);
  for (const [service, method] of [['text', 'layout'], ['annotations', 'list'], ['forms', 'renderAppearances']]) assert.equal(displayRead(request(service, method)).detail, 1);
  for (const [service, method] of [['annotations', 'update'], ['forms', 'setValue'], ['render', 'unknown']]) assert.equal(displayRead(request(service, method)), null);
  assert.equal(displayRead({ type: 'save' }), null);
  assert.equal(displayRead({ type: 'call', method: 'download' }), null);
  assert.equal(displayRead({ type: 'call', method: 'list', path: ['annotations'] }), null);
});

test('a bulk snapshot yields to foreground reads but stays ahead of edits across every batch', async () => {
  const queue = new RenderTaskQueue();
  const first = deferred(), release = deferred();
  const order = [];
  async function* batches() {
    order.push('batch1'); first.resolve(); await release.promise; yield;
    order.push('batch2'); yield;
    order.push('batch3'); return 3;
  }
  const bulk = queue.enqueueSteps(batches(), { priority: () => -10 });
  await first.promise;
  const foreground = queue.enqueue(async () => { order.push('visible'); }, { priority: () => 100 });
  const edit = queue.enqueue(async () => { order.push('edit'); });
  const later = queue.enqueue(async () => { order.push('later'); }, { priority: () => 200 });
  release.resolve();
  assert.equal(await bulk, 3);
  await Promise.all([foreground, edit, later]);
  assert.deepEqual(order, ['batch1', 'visible', 'batch2', 'batch3', 'edit', 'later']);
});

test('cancelling a suspended bulk read releases its generator and the next write', async () => {
  const turns = [];
  const queue = new RenderTaskQueue(next => turns.push(next));
  let closed = false;
  const bulk = queue.enqueueSteps((async function* () {
    try { yield; assert.fail('cancelled batch must not execute'); }
    finally { closed = true; }
  })(), { key: 'bulk', priority: () => 0 });
  const rejection = assert.rejects(bulk, { code: 'Aborted' });
  turns.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queue.cancel('bulk'), true);
  await rejection;
  assert.equal(closed, true);
  const edit = queue.enqueue(async () => 7);
  turns.shift()();
  assert.equal(await edit, 7);
});

test('failed bulk reads reject without holding the write barrier', async () => {
  const queue = new RenderTaskQueue();
  const bulk = queue.enqueueSteps((async function* () { yield; throw Error('batch failed'); })(), { priority: () => 0 });
  const rejected = assert.rejects(bulk, /batch failed/);
  const edit = queue.enqueue(async () => 'edited');
  await rejected;
  assert.equal(await edit, 'edited');
});

test('cancelling an earlier queued read cannot move a suspended snapshot behind a write', async () => {
  const queue = new RenderTaskQueue();
  const occupied = deferred(), releaseLane = deferred(), entered = deferred(), releaseBatch = deferred();
  const blocker = queue.enqueue(async () => { occupied.resolve(); await releaseLane.promise; });
  await occupied.promise;
  const obsolete = queue.enqueue(async () => assert.fail('obsolete read ran'), { key: 'obsolete', priority: () => -100 });
  const rejected = assert.rejects(obsolete, { code: 'Aborted' });
  const order = [];
  const bulk = queue.enqueueSteps((async function* () {
    order.push('batch1'); entered.resolve(); await releaseBatch.promise; yield;
    order.push('batch2');
  })(), { priority: () => 0 });
  const edit = queue.enqueue(async () => { order.push('edit'); });
  releaseLane.resolve();
  await entered.promise;
  assert.equal(queue.cancel('obsolete'), true);
  await rejected;
  releaseBatch.resolve();
  await Promise.all([blocker, bulk, edit]);
  assert.deepEqual(order, ['batch1', 'batch2', 'edit']);
});
