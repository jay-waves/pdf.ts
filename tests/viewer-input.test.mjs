import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(['../shared/utils', './mouse-page-gesture'].includes(specifier) ? `${specifier}.ts` : specifier, context);
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
  let selectingRegion = false;
  const commands = [];
  const scrolls = [];
  let cancellations = 0;
  const cleanup = installStageNavigationInput({
    cancelPendingNavigation: () => cancellations++,
    getSnapshot: () => ({ mode, selectingRegion }), scrollVertically: (delta) => scrolls.push(delta),
  }, (command) => commands.push(command));
  const press = (key, extra = {}) => {
    const event = { key, target: new Element(), preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra };
    listeners.get('keydown')(event);
    return event;
  };
  for (const key of ['h', 'j', 'k', 'l']) assert.equal(press(key).prevented, true);
  assert.deepEqual(commands.map((command) => command.delta), [-1, 1]);
  assert.deepEqual(scrolls, [40, -40]);
  for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']) {
    assert.equal(press(key).prevented, undefined);
  }
  assert.equal(cancellations, 7);
  mode = 'presentation';
  for (const key of ['h', 'j', 'k', 'l']) press(key);
  assert.deepEqual(commands.slice(2).map((command) => command.delta), [-1, 1, -1, 1]);
  for (const extra of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { isComposing: true }, { target: new Element(true) }]) {
    assert.equal(press('j', extra).prevented, undefined);
  }
  dialog = true;
  assert.equal(press('l').prevented, undefined);
  assert.equal(commands.length, 6);
  dialog = false;
  selectingRegion = true;
  assert.equal(press('Escape', { target: new Element(true) }).prevented, true);
  assert.deepEqual(commands.at(-1), { type: 'view/cancel-reading-region' });
  dialog = true;
  assert.equal(press('Escape').prevented, undefined);
  assert.equal(commands.length, 7);
  cleanup();
  assert.equal(listeners.size, 0);
});

test('right mouse gestures dispatch the same page command and Escape cancels them', (t) => {
  const listeners = new Map();
  class Element {
    closest(selector) { return selector.startsWith('input') ? null : this; }
  }
  const previousGlobals = new Map();
  for (const [name, value] of Object.entries({
    Element,
    document: { querySelector: () => null },
    window: {
      addEventListener(name, handler) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(handler);
      },
      removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
    },
  })) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const commands = [];
  let focus = 0;
  let selectingRegion = false;
  const cleanup = installStageNavigationInput({
    getSnapshot: () => ({ mode: 'reading', selectingRegion }),
    focusViewportAfterAction: () => focus++,
  }, (command) => commands.push(command));
  t.after(() => {
    cleanup();
    for (const [name, previous] of previousGlobals) {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    }
  });
  const emit = (type, extra = {}) => {
    const event = {
      target: new Element(), pointerType: 'mouse', pointerId: 1,
      button: 2, buttons: 2, clientX: 200, clientY: 200,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {}, stopImmediatePropagation() {}, ...extra,
    };
    for (const listener of listeners.get(type) ?? []) listener(event);
    return event;
  };
  emit('pointerdown');
  emit('pointermove', { clientX: 120 });
  assert.deepEqual(commands, []);
  emit('pointerup', { clientX: 120, buttons: 0 });
  assert.deepEqual(commands, [{ type: 'navigation/move-pages', delta: 1, source: 'Mouse' }]);
  assert.equal(focus, 1);
  emit('pointerdown');
  emit('pointermove', { clientX: 280 });
  assert.equal(emit('keydown', { key: 'Escape' }).defaultPrevented, true);
  emit('pointerup', { clientX: 280, buttons: 0 });
  assert.equal(commands.length, 1);
  selectingRegion = true;
  emit('pointerdown');
  emit('pointerup', { clientX: 120, buttons: 0 });
  assert.equal(commands.length, 1);
});
