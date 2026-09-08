import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ZoomDetents } from '../apps/renderer/zoom-detents.ts';

const nodes = [0.65, 0.85, 1, 1.5, 2];

test('zoom stays at normal speed until crossing a node, then holds until further travel', () => {
  for (const node of nodes) {
    for (const direction of [-1, 1]) {
      const start = node * Math.exp(-direction * 0.03);
      const zoom = new ZoomDetents(start);
      const approached = zoom.move(direction * 0.02, nodes);
      assert.ok(Math.abs(Math.log(approached / start) - direction * 0.02) < 1e-10);
      const snapped = zoom.move(direction * 0.09, nodes);
      assert.ok(Math.abs(snapped - node) < 1e-10);
      assert.ok(Math.abs(zoom.move(direction * 0.02, nodes) - node) < 1e-10);
      const escaped = zoom.move(direction * 0.07, nodes);
      assert.ok((escaped - node) * direction > 0);
      assert.ok((zoom.move(direction * 0.01, nodes) - escaped) * direction > 0);
    }
  }
});

test('held zoom can escape in the reverse direction', () => {
  const zoom = new ZoomDetents(1);
  assert.equal(zoom.move(0.02, nodes), 1);
  assert.ok(zoom.move(-0.1, nodes) < 1);
});

test('both directions stop at the nearest crossed node without slowing beforehand', () => {
  for (const node of nodes) {
    for (const direction of [-1, 1]) {
      const start = node * Math.exp(-direction * 0.12);
      const zoom = new ZoomDetents(start);
      assert.ok(Math.abs(zoom.move(direction * 0.13, [node]) - node) < 1e-10);
      assert.ok(Math.abs(zoom.move(direction * 0.02, [node]) - node) < 1e-10);
      assert.ok((zoom.move(direction * 0.08, [node]) - node) * direction > 0);
      const gentle = new ZoomDetents(start);
      const result = gentle.move(direction * 0.01, [node]);
      assert.ok(Math.abs(Math.log(result / start) - direction * 0.01) < 1e-10);
      assert.ok(Math.abs(result - node) > 0.01);
    }
  }
  const zoom = new ZoomDetents(1.2);
  assert.ok(Math.abs(zoom.move(-0.4, [1.1, 1.15]) - 1.15) < 1e-10);
});

test('a large coalesced delta stops at a node before subsequent input releases it', () => {
  const zoom = new ZoomDetents(0.9);
  assert.equal(zoom.move(0.4, [1]), 1);
  assert.equal(zoom.move(0.02, [1]), 1);
  assert.ok(zoom.move(0.1, [1]) > 1);
  assert.ok(Math.abs(zoom.move(10, []) - 60) < 1e-10);
  assert.ok(Math.abs(zoom.move(-20, []) - 0.2) < 1e-10);
});

test('a changed fit node releases stale holds', () => {
  const zoom = new ZoomDetents(0.85);
  zoom.move(0.01, nodes);
  assert.ok(zoom.move(0.01, [0.65, 0.9, 1, 1.5, 2]) > 0.85);
});

// Run the real frame adapter with a quantizing zoom plugin and no DOM. This
// covers preset feedback + unchanged frames, which pure detent tests miss.
const viewportSource = readFileSync(new URL('../apps/renderer/viewer-viewport-input.tsx', import.meta.url), 'utf8');
const flushSource = viewportSource.slice(
  viewportSource.indexOf('    const flushZoom ='),
  viewportSource.indexOf('    const scheduleZoom ='),
);
const makeFrames = new Function('ZoomDetents', 'getZoomNodes', `
  let current = 1;
  let lastAppliedZoom = 1;
  let detents = null;
  let pendingPinchDelta = null;
  let pendingZoomDelta = 0;
  let zoomFrame = 0;
  const zoomAnchor = { vx: 0, vy: 0 };
  const MIN_ZOOM_LEVEL = 0.2, MAX_ZOOM_LEVEL = 60;
  const WHEEL_ZOOM_SENSITIVITY = 0.002;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const zoomScope = {
    getState: () => ({ currentZoomLevel: current }),
    requestZoom: (value) => { current = Math.floor(value * 1000) / 1000; },
  };
  const viewportScope = { getMetrics: () => ({ scrollLeft: 0, scrollTop: 0 }) };
  const viewport = { scrollTo() {} };
  const scrollTo = () => {};
  const flushSync = (fn) => fn();
  ${flushSource}
  return {
    preset(value) { current = value; },
    frame(delta, wheel) {
      if (wheel) pendingZoomDelta = -delta / WHEEL_ZOOM_SENSITIVITY;
      else pendingPinchDelta = delta;
      flushZoom();
      return current;
    },
  };
`);

test('preset changes do not reset release pressure on unchanged pinch/wheel frames', () => {
  for (const preset of nodes) {
    for (const direction of [-1, 1]) {
      for (const wheel of [false, true]) {
        const frames = makeFrames(ZoomDetents, () => nodes);
        frames.preset(preset);
        assert.equal(frames.frame(direction * 0.005, wheel), preset);
        let result;
        for (let i = 0; i < 25; i++) result = frames.frame(direction * 0.005, wheel);
        assert.ok((result - preset) * direction > 0, `${preset}, direction ${direction}, wheel ${wheel}`);
      }
    }
  }
});

test('the frame adapter displays a crossed node for pinch and wheel before release', () => {
  for (const wheel of [false, true]) {
    const frames = makeFrames(ZoomDetents, () => [1]);
    frames.preset(0.9);
    assert.equal(frames.frame(0.4, wheel), 1);
    assert.equal(frames.frame(0.02, wheel), 1);
    assert.ok(frames.frame(0.1, wheel) > 1);
  }
});
