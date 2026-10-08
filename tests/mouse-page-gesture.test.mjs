import assert from 'node:assert/strict';
import test from 'node:test';
import { installMousePageGesture } from '../apps/viewer/mouse-page-gesture.ts';

function setup(t) {
  const listeners = new Map();
  const navigations = [];
  const menus = [];
  let allowed = true;
  class Element {
    isConnected = true;
    dispatchEvent(event) {
      emit('contextmenu', event);
      if (!event.defaultPrevented) menus.push(event);
      return !event.defaultPrevented;
    }
  }
  class MouseEvent {
    constructor(type, init) { Object.assign(this, init); this.type = type; }
    preventDefault() { this.defaultPrevented = true; }
    stopImmediatePropagation() { this.stopped = true; }
  }
  const target = new Element();
  function emit(type, event = {}) {
    event.target ??= target;
    listeners.get(type)?.(event);
    return event;
  }
  const previousGlobals = new Map();
  for (const [name, value] of Object.entries({
    Element, MouseEvent,
    window: {
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: (name) => listeners.delete(name),
    },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    previousGlobals.set(name, previous);
    Object.defineProperty(globalThis, name, { configurable: true, value });
  }
  const gesture = installMousePageGesture(() => allowed, (delta) => navigations.push(delta));
  t.after(() => {
    gesture.dispose();
    for (const [name, previous] of previousGlobals) {
      if (previous) Object.defineProperty(globalThis, name, previous);
      else delete globalThis[name];
    }
  });
  const pointer = (type, extra = {}) => emit(type, {
    pointerId: 1, pointerType: 'mouse', button: 2, buttons: 2,
    clientX: 200, clientY: 200,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    ...extra,
  });
  const menu = () => emit('contextmenu', new MouseEvent('contextmenu', {
    button: 2, clientX: 200, clientY: 200,
  }));
  return { gesture, pointer, menu, emit, target, navigations, menus, listeners, setAllowed: (value) => { allowed = value; } };
}

test('right drags navigate once on release in either direction and suppress the following menu', (t) => {
  const { pointer, menu, navigations } = setup(t);
  pointer('pointerdown');
  pointer('pointermove', { clientX: 130 });
  pointer('pointermove', { clientX: 100 });
  assert.deepEqual(navigations, []);
  pointer('pointerup', { clientX: 100, buttons: 0 });
  pointer('pointerup', { clientX: 100, buttons: 0 });
  assert.deepEqual(navigations, [1]);
  assert.equal(menu().defaultPrevented, true);

  pointer('pointerdown');
  pointer('pointerup', { clientX: 280, buttons: 0 });
  assert.deepEqual(navigations, [1, -1]);
});

test('short right clicks keep release-time menus and replay press-time menus', (t) => {
  const { pointer, menu, navigations, menus } = setup(t);
  pointer('pointerdown');
  pointer('pointerup', { clientX: 202, buttons: 0 });
  assert.equal(menu().defaultPrevented, undefined);

  pointer('pointerdown');
  assert.equal(menu().defaultPrevented, true);
  assert.equal(menus.length, 0);
  pointer('pointerup', { buttons: 0 });
  assert.equal(menus.length, 1);
  assert.equal(menus[0].clientX, 200);
  assert.equal(menu().defaultPrevented, true);
  assert.deepEqual(navigations, []);
});

test('early menus are discarded for gestures, vertical drags and subthreshold drags', (t) => {
  const { pointer, menu, navigations, menus } = setup(t);
  for (const position of [{ clientX: 100 }, { clientY: 100 }, { clientX: 180 }, { clientX: 100, clientY: 100 }]) {
    pointer('pointerdown');
    menu();
    pointer('pointerup', { ...position, buttons: 0 });
  }
  assert.deepEqual(navigations, [1]);
  assert.deepEqual(menus, []);
});

test('blur, pointer cancellation, Escape cancellation and extra buttons abort page gestures', (t) => {
  const { gesture, pointer, emit, navigations, menus, menu } = setup(t);
  for (const abort of [
    () => emit('blur'),
    () => pointer('pointercancel'),
    () => gesture.cancel(),
    () => pointer('pointerdown', { button: 0, buttons: 3 }),
    () => pointer('pointermove', { buttons: 0 }),
  ]) {
    pointer('pointerdown');
    menu();
    pointer('pointermove', { clientX: 100 });
    abort();
    pointer('pointerup', { clientX: 100, buttons: 0 });
  }
  assert.deepEqual(navigations, []);
  assert.deepEqual(menus, []);
});

test('other buttons, touch, modifiers and blocked targets keep their existing behavior', (t) => {
  const { pointer, navigations, menu, setAllowed } = setup(t);
  for (const extra of [
    { button: 0, buttons: 1 }, { button: 1, buttons: 4 }, { buttons: 3 },
    { pointerType: 'touch' }, { shiftKey: true }, { ctrlKey: true },
    { altKey: true }, { metaKey: true }, { defaultPrevented: true },
  ]) {
    assert.equal(pointer('pointerdown', extra).stopped, undefined);
    pointer('pointerup', { clientX: 100, buttons: 0 });
  }
  setAllowed(false);
  pointer('pointerdown');
  pointer('pointerup', { clientX: 100, buttons: 0 });
  assert.equal(menu().defaultPrevented, undefined);
  setAllowed(true);
  pointer('pointerdown');
  setAllowed(false); // A dialog opens during the drag.
  pointer('pointerup', { clientX: 100, buttons: 0 });
  assert.deepEqual(navigations, []);
});

test('unrelated pointers do not finish the gesture and disposal removes all listeners', (t) => {
  const { pointer, gesture, navigations, listeners } = setup(t);
  pointer('pointerdown');
  pointer('pointerup', { pointerId: 2, clientX: 100, buttons: 0 });
  assert.deepEqual(navigations, []);
  pointer('pointerup', { clientX: 100, buttons: 0 });
  assert.deepEqual(navigations, [1]);
  gesture.dispose();
  assert.equal(listeners.size, 0);
});
