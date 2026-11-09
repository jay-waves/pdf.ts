import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForDocumentPaint } from '../apps/viewer/document-paint.ts';

function setup(t, picture) {
  const frames = new Map(); let sequence = 0;
  for (const [name, value] of Object.entries({ requestAnimationFrame: fn => { frames.set(++sequence, fn); return sequence; }, cancelAnimationFrame: id => frames.delete(id) })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete globalThis[name]; });
  }
  const bounds = { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 };
  const page = { getBoundingClientRect: () => bounds, querySelector: () => picture.canvas };
  const layer = { dataset: { pdfDocumentLayer: 'doc' }, querySelector: () => null, querySelectorAll: () => [page] };
  const root = { getBoundingClientRect: () => bounds, querySelectorAll: () => [layer] };
  return { root, frames, frame() { const callbacks = [...frames.values()]; frames.clear(); for (const fn of callbacks) fn(); } };
}
test('document replacement waits for painted canvas on two frames', async t => {
  const picture = {};
  const f = setup(t, picture);
  const controller = new AbortController();
  t.after(() => controller.abort());
  let resolved = false;
  const pending = waitForDocumentPaint(f.root, 'doc', controller.signal).then(() => { resolved = true; });
  f.frame(); await Promise.resolve(); assert.equal(resolved, false);
  picture.canvas = { width: 100, height: 100 };
  f.frame(); await Promise.resolve(); assert.equal(resolved, false);
  f.frame(); await pending;
  assert.equal(resolved, true); assert.equal(f.frames.size, 0);
});
test('cancelled document replacement stops waiting for a canvas', async t => {
  const f = setup(t, {});
  const controller = new AbortController();
  const pending = waitForDocumentPaint(f.root, 'doc', controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(f.frames.size, 0);
});
