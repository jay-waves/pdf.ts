import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === '../shared/utils' ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/viewer/viewer-input.ts')) {
      return { format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8')), shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
const { installStageNavigationInput } = await import('../apps/viewer/viewer-input.ts');
hooks.deregister();

test('hjkl follows directional navigation and respects keyboard guards', (t) => {
  const listeners = new Map();
  class Element {
    constructor(interactive = false) { this.interactive = interactive; }
    closest(selector) { return selector.startsWith('input') ? this.interactive : true; }
  }
  let dialog = false;
  for (const [name, value] of Object.entries({
    Element,
    document: { querySelector: () => dialog, body: {}, documentElement: {} },
    window: { addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: (name) => listeners.delete(name) },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  let mode = 'reading';
  const commands = [];
  const scrolls = [];
  const cleanup = installStageNavigationInput({
    getSnapshot: () => ({ mode }), scrollVertically: (delta) => scrolls.push(delta),
  }, (command) => commands.push(command));
  const press = (key, extra = {}) => {
    const event = { key, target: new Element(), preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra };
    listeners.get('keydown')(event);
    return event;
  };
  for (const key of ['h', 'j', 'k', 'l']) assert.equal(press(key).prevented, true);
  assert.deepEqual(commands.map((command) => command.delta), [-1, 1]);
  assert.deepEqual(scrolls, [40, -40]);
  mode = 'presentation';
  for (const key of ['h', 'j', 'k', 'l']) press(key);
  assert.deepEqual(commands.slice(2).map((command) => command.delta), [-1, 1, -1, 1]);
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { target: new Element(true) }]) {
    assert.equal(press('j', extra).prevented, undefined);
  }
  dialog = true;
  assert.equal(press('l').prevented, undefined);
  assert.equal(commands.length, 6);
  cleanup();
  assert.equal(listeners.size, 0);
});
