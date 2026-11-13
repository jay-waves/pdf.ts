import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionWorkingSets } from '../apps/engine/session-working-sets.ts';
import { RenderTaskQueue } from '../apps/engine/render-task-queue.ts';

const pages = number => [{ page: { objectNumber: number }, role: 'visible', pixels: 800_000 }];

test('hidden views withdraw native hints and restore only the latest live views', () => {
  const published = [];
  const sets = new SessionWorkingSets((...hint) => published.push(hint));
  sets.set('pdf', 'main', pages(1));
  sets.set('pdf', 'preview', pages(2));
  sets.setVisible(false);
  assert.equal(sets.get('pdf'), undefined);
  assert.deepEqual(published.slice(-2), [['pdf', 'main', []], ['pdf', 'preview', []]]);
  sets.set('pdf', 'main', pages(3));
  sets.set('pdf', 'preview', []);
  sets.set('closed', 'main', pages(4));
  sets.delete('closed');
  const count = published.length;
  sets.setVisible(false);
  assert.equal(published.length, count, 'unchanged visibility does not republish');
  sets.setVisible(true);
  assert.deepEqual(published.slice(count), [['pdf', 'main', pages(3)]]);
  assert.deepEqual(sets.get('pdf').get('main'), pages(3));
  assert.equal(sets.get('closed'), undefined);
  sets.delete('pdf');
  assert.deepEqual(published.at(-1), ['pdf', 'main', []]);
  sets.setVisible(false);
  sets.setVisible(true);
  assert.equal(sets.get('pdf'), undefined);
});

test('one hidden session cannot withdraw another session showing the same document', () => {
  const native = new Map();
  const session = key => new SessionWorkingSets((doc, view, hints) => {
    const id = `${doc}:${key}:${view}`;
    if (hints.length) native.set(id, hints); else native.delete(id);
  });
  const a = session('a'), b = session('b');
  a.set('pdf', 'main', pages(1));
  b.set('pdf', 'main', pages(1));
  a.setVisible(false);
  assert.deepEqual([...native.keys()], ['pdf:b:main']);
  a.delete('pdf');
  a.setVisible(true);
  assert.deepEqual([...native.keys()], ['pdf:b:main']);
});

test('visibility reorders already queued reads without losing promises or crossing edits', async () => {
  const turns = [];
  const queue = new RenderTaskQueue(next => turns.push(next));
  const a = new SessionWorkingSets(() => {}), b = new SessionWorkingSets(() => {});
  const order = [];
  const hidden = queue.enqueue(async () => order.push('hidden metadata'), { priority: () => a.priority(200) });
  const visible = queue.enqueue(async () => order.push('visible pixels'), { priority: () => b.priority(130) });
  const edit = queue.enqueue(async () => order.push('edit'));
  const later = queue.enqueue(async () => order.push('later pixels'), { priority: () => b.priority(130) });
  a.setVisible(false);
  while (turns.length) {
    turns.shift()();
    await new Promise(resolve => setImmediate(resolve));
  }
  await Promise.all([hidden, visible, edit, later]);
  assert.deepEqual(order, ['visible pixels', 'hidden metadata', 'edit', 'later pixels']);
  a.setVisible(true);
  assert.equal(a.priority(200), 200);
});
