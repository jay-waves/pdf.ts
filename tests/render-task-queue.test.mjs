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
