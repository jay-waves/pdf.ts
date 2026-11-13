import assert from 'node:assert/strict';
import test from 'node:test';
import { createPdfWorker } from '../apps/engine/pdf-worker-transport.ts';

for (const shared of [false, true]) test(`visibility follows ${shared ? 'shared and fallback' : 'dedicated'} transport lifecycle`, async t => {
  const originals = new Map(['window', 'document', 'Worker', 'SharedWorker', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const endpoints = [];
  class Endpoint extends EventTarget {
    messages = [];
    constructor() { super(); endpoints.push(this); }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated = true; }
  }
  class Shared extends EventTarget {
    port = new Endpoint();
    constructor() {
      super();
      this.port.start = () => {};
      this.port.close = () => { this.port.closed = true; };
    }
  }
  const window = new EventTarget(), document = new EventTarget();
  document.visibilityState = 'hidden';
  for (const [key, value] of Object.entries({ window, document, Worker: Endpoint, SharedWorker: shared ? Shared : undefined,
    navigator: { locks: { request: async (_name, _options, callback) => callback() } } })) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }
  const transport = createPdfWorker();
  t.after(() => transport.terminate());
  transport.postMessage({ type: 'init', options: {} });
  let endpoint = endpoints.at(-1);
  assert.deepEqual(endpoint.messages[0], { type: 'visibility', visible: false });
  assert.equal(endpoint.messages[1].type, 'init');
  if (shared) {
    endpoint.dispatchEvent(new MessageEvent('message', { data: { type: 'error', error: 'startup failed' } }));
    assert.equal(endpoint.closed, true);
    endpoint = endpoints.at(-1);
    assert.deepEqual(endpoint.messages[0], { type: 'visibility', visible: false });
    assert.equal(endpoint.messages[1].type, 'init');
  }
  document.visibilityState = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(endpoint.messages.at(-1), { type: 'visibility', visible: true });
  const hide = new Event('pagehide');
  Object.defineProperty(hide, 'persisted', { value: true });
  window.dispatchEvent(hide);
  assert.deepEqual(endpoint.messages.at(-1), { type: 'visibility', visible: false });
  assert.equal(endpoint.terminated, undefined);
  window.dispatchEvent(new Event('pageshow'));
  assert.deepEqual(endpoint.messages.at(-1), { type: 'visibility', visible: true });
  transport.terminate();
  const count = endpoint.messages.length;
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('pageshow'));
  assert.equal(endpoint.messages.length, count, 'no messages after termination');
  assert.equal(endpoint.terminated, true);
});
