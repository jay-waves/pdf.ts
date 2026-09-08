import assert from 'node:assert/strict';
import test from 'node:test';
import { ZoomDetents } from '../apps/renderer/zoom-detents.ts';

test('fast input holds for 220ms without accumulating a release jump', () => {
  for (const direction of [-1, 1]) {
    const zoom = new ZoomDetents(0.85 * Math.exp(-direction * 0.1));
    const move = (delta, time) => zoom.move(direction * delta, [0.85], time);
    assert.ok(Math.abs(move(0.4, 0) - 0.85) < 1e-10);
    for (let time = 8; time < 220; time += 8) {
      assert.ok(Math.abs(move(0.5, time) - 0.85) < 1e-10);
    }
    assert.ok(Math.abs(move(0, 220) - 0.85) < 1e-10);
    const escaped = move(0.005, 220);
    assert.ok((escaped - 0.85) * direction > 0);
    assert.ok(Math.abs(Math.log(escaped / 0.85)) < 0.02);
  }
});

test('changing fit geometry clears even an unexpired hold', () => {
  const zoom = new ZoomDetents(0.8);
  zoom.move(0.1, [0.85], 0);
  assert.ok(zoom.move(0.01, [0.95], 10) > 0.85);
});

test('large deltas stop at the nearest fit node in either direction', () => {
  const levels = [0.65, 0.85];
  const zoomIn = new ZoomDetents(0.5);
  const zoomOut = new ZoomDetents(1);
  assert.ok(Math.abs(zoomIn.move(1, levels, 0) - 0.65) < 1e-10);
  assert.ok(Math.abs(zoomOut.move(-1, levels, 0) - 0.85) < 1e-10);
});

test('a held node allows reversing direction after the pause', () => {
  const zoom = new ZoomDetents(0.8);
  zoom.move(0.1, [0.85], 0);
  assert.ok(zoom.move(-0.1, [0.85], 220) < 0.85);
});

test('a new gesture can leave an exact fit scale immediately', () => {
  for (const direction of [-1, 1]) {
    const zoom = new ZoomDetents(0.85);
    assert.ok((zoom.move(direction * 0.005, [0.65, 0.85], 0) - 0.85) * direction > 0);
  }
});
