import assert from 'node:assert/strict';
import test from 'node:test';
import { installPagePrefetch } from '../apps/renderer/page-prefetch.ts';

function setup(t) {
  const previousDocument = globalThis.document;
  const document = Object.assign(new EventTarget(), { hidden: false });
  globalThis.document = document;
  const cameraListeners = new Set(), updates = new Set(), motionListeners = new Set(), idle = new Set(), frames = new Set();
  const subscribe = listeners => callback => { listeners.add(callback); return () => listeners.delete(callback); };
  const pages = Array.from({ length: 5 }, (_, pageIndex) => ({ pageIndex, ref: { objectNumber: pageIndex + 1 }, visibleRect: { width: 100, height: 100 }, transform: { renderScale: 2 } }));
  let index = 0, camera = { x: 0, y: 0, zoom: 1 }, ready = true, pending = false, epoch = 0, destroyed = 0;
  const calls = [];
  const stage = {
    getLensId: () => 'stage', getCamera: () => camera, getCurrentPageIndex: () => index,
    getSettings: () => ({ layout: 'vertical', direction: 'ltr' }), isMoving: () => false,
    listVisiblePages: () => [pages[index]], getPageCount: () => pages.length, getPageBox: i => { const page = pages[typeof i === 'number' ? i : i.objectNumber - 1]; return { ...page, visibleRect: { width: page.pageIndex === index ? 100 : 0, height: 100 } }; },
    isPageVisible: page => page.objectNumber === index + 1,
    onCameraChanged: subscribe(cameraListeners), onMotionEnded: subscribe(motionListeners),
  };
  const render = {
    createViewDemand: () => ({ isPending: () => pending, destroy: () => destroyed++ }),
    getPictureState: () => ({ status: ready ? 'ready' : 'loading' }),
    getSourceKey: page => `${page.objectNumber}:${epoch}`,
    renderSource: (page, options) => new Promise(resolve => calls.push({ page, options, resolve })),
  };
  const stop = installPagePrefetch(stage, render, subscribe(updates), callback => { idle.add(callback); return () => idle.delete(callback); },
    callback => { frames.add(callback); return () => frames.delete(callback); });
  t.after(() => { stop(); globalThis.document = previousDocument; });
  const notify = () => { for (const fn of [...updates]) fn(); };
  const frame = () => { for (const fn of [...frames]) { frames.delete(fn); fn(); } };
  const update = () => { notify(); frame(); };
  return { calls, document, stop, notify, frame,
    idle: () => { for (const fn of [...idle]) { idle.delete(fn); fn(); } },
    move: (next, loading = false) => { ready = !loading; index = next; camera = { ...camera, y: next * 800 }; for (const fn of cameraListeners) fn(); },
    ready: value => { ready = value; update(); }, pending: value => { pending = value; update(); },
    invalidate: () => { epoch++; update(); }, update,
    counts: () => ({ frames: frames.size, idle: idle.size, subscriptions: updates.size + cameraListeners.size + motionListeners.size, destroyed }),
  };
}

test('one directional neighbour, ordinary base layers, and no repeated requests while settled', async t => {
  const f = setup(t);
  assert.equal(f.calls.length, 0);
  f.idle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].page.objectNumber, 2);
  assert.equal(f.calls[0].options.scale, 2);
  assert.equal(f.calls[0].options.includeAnnotations, false);
  assert.equal(f.calls[0].options.includeFormFields, false);
  assert.equal(f.calls[0].options.view, 'stage');
  f.calls[0].resolve(); await new Promise(setImmediate);
  f.update(); f.idle(); assert.equal(f.calls.length, 1);
  f.move(3); f.idle(); assert.equal(f.calls.at(-1).page.objectNumber, 5);
  f.move(2); assert.equal(f.calls.at(-1).options.signal.aborted, true);
  f.idle(); assert.equal(f.calls.at(-1).page.objectNumber, 2, 'reverse scroll prefetches the preceding page');
  f.move(0); f.idle(); assert.equal(f.calls.length, 3, 'no page before the start');
  f.move(4); f.idle(); assert.equal(f.calls.length, 3, 'no page after the end');
});

test('foreground work wins before and after idle dispatch; hidden tabs and teardown abort speculation', t => {
  const f = setup(t);
  f.ready(false); f.idle(); assert.equal(f.calls.length, 0);
  f.pending(true); f.ready(true); f.idle(); assert.equal(f.calls.length, 0);
  f.pending(false); f.idle(); assert.equal(f.calls.length, 1);
  f.pending(true); assert.equal(f.calls[0].options.signal.aborted, true);
  f.pending(false); f.idle(); assert.equal(f.calls.length, 2);
  f.document.hidden = true; f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.calls[1].options.signal.aborted, true);
  f.document.hidden = false; f.document.dispatchEvent(new Event('visibilitychange'));
  f.stop(); f.idle(); assert.equal(f.calls.length, 2);
  assert.equal(f.counts().subscriptions, 0);
});

test('source invalidation replaces an old prefetch; late completion cannot clear its replacement', async t => {
  const f = setup(t); f.idle(); f.invalidate(); f.idle();
  assert.equal(f.calls[0].options.signal.aborted, true);
  assert.equal(f.calls.length, 2);
  f.calls[0].resolve(); await new Promise(setImmediate);
  f.pending(true);
  assert.equal(f.calls[1].options.signal.aborted, true);
});


test('a prefetched page becoming visible keeps its in-flight base for the foreground consumer', t => {
  const f = setup(t); f.idle();
  f.move(1, true); f.idle();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].options.signal.aborted, false, 'do not restart a matching visible base');
  f.pending(true);
  assert.equal(f.calls[0].options.signal.aborted, false);
  f.move(3, true);
  assert.equal(f.calls[0].options.signal.aborted, true, 'a later jump makes that base obsolete');
});


test('notification bursts schedule one check and teardown cancels it', t => {
  const f = setup(t);
  for (let i = 0; i < 100; i++) f.notify();
  assert.equal(f.counts().frames, 1);
  f.frame(); f.idle();
  assert.equal(f.calls.length, 1);
  f.pending(true);
  assert.equal(f.calls[0].options.signal.aborted, true, 'active speculation cancels synchronously');
  f.notify();
  assert.equal(f.counts().frames, 1);
  f.stop();
  assert.equal(f.counts().frames, 0);
});
