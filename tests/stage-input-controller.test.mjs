import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const sourceImports = new Set(['./zoom-detents', './viewport-geometry']);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(sourceImports.has(specifier) ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/renderer/viewport-geometry.ts') ||
      url.endsWith('/renderer/stage-input-controller.ts')
      || url.endsWith('/renderer/zoom-detents.ts')
    ) {
      return {
        format: 'module',
        source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }),
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});
const { mergePendingZoom, installStageWheelZoom } = await import('../apps/renderer/stage-input-controller.ts');
hooks.deregister();

test('wheel and pinch deltas share one pending zoom accumulator', () => {
  let pending = mergePendingZoom(null, 0.12, { vx: 10, vy: 20 });
  pending = mergePendingZoom(pending, -0.04, { vx: 30, vy: 40 });
  assert.ok(Math.abs(pending.delta - 0.08) < Number.EPSILON);
  assert.deepEqual(pending.anchor, { vx: 30, vy: 40 });
});


function setup(t) {
  const frames = new Map(); let nextFrame = 0;
  const window = new EventTarget();
  const restore = [];
  for (const [name, value] of Object.entries({ window,
    requestAnimationFrame: callback => { frames.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restore.push(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  const viewport = { clientWidth: 800, clientHeight: 600, clientLeft: 0, clientTop: 0,
    getBoundingClientRect: () => ({ left: 10, top: 20 }) };
  let level = 1;
  const applied = [];
  const native = { getZoomLevel: () => level, stopMotion() {}, zoomTo(value, options) { level = value; applied.push({ value, options }); } };
  const dispose = installStageWheelZoom(viewport, native, { getFitScales: () => ({ page: .8, width: 1.5 }) });
  t.after(() => { dispose(); restore.forEach(fn => fn()); });
  const wheel = (fields = {}, inside = true) => {
    const event = new Event('wheel', { cancelable: true });
    Object.assign(event, { ctrlKey: true, metaKey: false, deltaY: -50, deltaMode: 0, clientX: 210, clientY: 120, ...fields });
    event.composedPath = () => inside ? [viewport] : [];
    window.dispatchEvent(event); return event;
  };
  const frame = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); };
  return { wheel, frame, applied, frames, dispose };
}

test('zoom wheels coalesce into one native focal zoom and block duplicate browser/SDK zoom', t => {
  const { wheel, frame, applied, frames } = setup(t);
  assert.equal(wheel().defaultPrevented, true);
  wheel({ clientX: 310, clientY: 220 });
  assert.equal(frames.size, 1);
  frame();
  assert.equal(applied.length, 1);
  assert.ok(Math.abs(applied[0].value - Math.exp(.2)) < 1e-9);
  assert.deepEqual(applied[0].options.around, { x: 300, y: 200 });
});

test('ordinary scroll and zoom outside the viewport remain native; teardown drops pending zoom', t => {
  const { wheel, frame, applied, frames, dispose } = setup(t);
  assert.equal(wheel({ ctrlKey: false }).defaultPrevented, false);
  assert.equal(wheel({}, false).defaultPrevented, false);
  assert.equal(frames.size, 0);
  wheel(); dispose(); frame();
  assert.deepEqual(applied, []);
  assert.equal(wheel().defaultPrevented, false);
});
