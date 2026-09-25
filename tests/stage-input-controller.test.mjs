import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { registerHooks, stripTypeScriptTypes } from 'node:module';

const sourceImports = new Set(['./zoom-detents', '../viewer/viewer-activity']);
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(sourceImports.has(specifier) ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, nextLoad) {
    if (
      url.endsWith('/renderer/stage-input-controller.ts')
      || url.endsWith('/renderer/zoom-detents.ts')
      || url.endsWith('/viewer/viewer-activity.ts')
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
const { mergePendingZoom, reducePointerGesture } = await import('../apps/renderer/stage-input-controller.ts');
hooks.deregister();

test('wheel and pinch deltas share one pending zoom accumulator', () => {
  let pending = mergePendingZoom(null, 0.12, { vx: 10, vy: 20 });
  pending = mergePendingZoom(pending, -0.04, { vx: 30, vy: 40 });
  assert.ok(Math.abs(pending.delta - 0.08) < Number.EPSILON);
  assert.deepEqual(pending.anchor, { vx: 30, vy: 40 });
});

const touch = {
  pointerId: 7,
  pointerX: 10,
  pointerY: 20,
  target: {},
  timer: 12,
  interactionPaused: true,
  scrollLeft: 30,
  scrollTop: 40,
  cancel() {},
};

test('touch gesture has one explicit pending, pan, and idle path', () => {
  let state = reducePointerGesture({ type: 'idle' }, { type: 'begin-touch', gesture: touch });
  assert.equal(state.type, 'touch-pending');

  state = reducePointerGesture(state, { type: 'touch-pan' });
  assert.equal(state.type, 'touch-pan');
  assert.equal(state.pointerId, 7);
  assert.equal(state.scrollTop, 40);

  state = reducePointerGesture(state, { type: 'end' });
  assert.deepEqual(state, { type: 'idle' });
});

test('long press can only claim a pending touch', () => {
  const pending = reducePointerGesture(
    { type: 'idle' },
    { type: 'begin-touch', gesture: touch },
  );
  const selection = reducePointerGesture(pending, { type: 'touch-selection' });
  assert.equal(selection.type, 'touch-selection');
  assert.strictEqual(
    reducePointerGesture(selection, { type: 'touch-pan' }),
    selection,
  );
});

test('pinch takes over any pointer gesture and tracks its latest scale', () => {
  const pending = reducePointerGesture(
    { type: 'idle' },
    { type: 'begin-touch', gesture: touch },
  );
  let state = reducePointerGesture(pending, { type: 'begin-pinch' });
  assert.deepEqual(state, { type: 'pinch', lastScale: 1 });

  state = reducePointerGesture(state, { type: 'set-pinch-scale', scale: 1.4 });
  assert.deepEqual(state, { type: 'pinch', lastScale: 1.4 });
});

test('mouse drag threshold changes only a mouse pan', () => {
  let state = reducePointerGesture({ type: 'idle' }, {
    type: 'begin-mouse',
    gesture: { scrollLeft: 5, scrollTop: 9, dragging: false, cancel() {} },
  });
  assert.equal(state.type, 'mouse-pan');
  assert.equal(state.dragging, false);

  state = reducePointerGesture(state, { type: 'set-mouse-dragging' });
  assert.equal(state.type, 'mouse-pan');
  assert.equal(state.dragging, true);

  const unchanged = reducePointerGesture({ type: 'idle' }, { type: 'set-mouse-dragging' });
  assert.deepEqual(unchanged, { type: 'idle' });
});

test('a second pointer gesture cannot silently replace an active drag', () => {
  const pending = reducePointerGesture(
    { type: 'idle' },
    { type: 'begin-touch', gesture: touch },
  );
  const attemptedMouse = reducePointerGesture(pending, {
    type: 'begin-mouse',
    gesture: { scrollLeft: 0, scrollTop: 0, dragging: false, cancel() {} },
  });
  assert.strictEqual(attemptedMouse, pending);
});
