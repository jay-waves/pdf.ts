import assert from 'node:assert/strict';
import test from 'node:test';
import { ZoomDetents } from '../apps/renderer/zoom-detents.ts';

const nodes = [0.65, 0.85, 1, 1.5, 2];

test('approach slows down, snaps exactly, and requires further travel to escape', () => {
  for (const node of nodes) {
    for (const direction of [-1, 1]) {
      const start = node * Math.exp(-direction * 0.03);
      const zoom = new ZoomDetents(start);
      const approached = zoom.move(direction * 0.02, nodes);
      assert.ok(Math.abs(Math.log(approached / start)) < 0.02);
      const snapped = zoom.move(direction * 0.025, nodes);
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

test('large wheel deltas traverse nodes and respect zoom limits', () => {
  const zoom = new ZoomDetents(0.9);
  assert.ok(zoom.move(0.4, [1]) > 1.1);
  assert.ok(Math.abs(zoom.move(10, nodes) - 60) < 1e-10);
  assert.ok(Math.abs(zoom.move(-20, nodes) - 0.2) < 1e-10);
});

test('a changed fit node releases stale holds', () => {
  const zoom = new ZoomDetents(0.85);
  zoom.move(0.01, nodes);
  assert.ok(zoom.move(0.01, [0.65, 0.9, 1, 1.5, 2]) > 0.85);
});
