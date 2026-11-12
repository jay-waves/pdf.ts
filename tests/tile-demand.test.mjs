import assert from 'node:assert/strict';
import test from 'node:test';
import { tileDemandSubmitter } from '../apps/renderer/tile-demand.ts';

test('equivalent demands skip commits, but geometry, velocity, layers and resume submit', () => {
  const calls = [], page = { objectNumber: 3 };
  const submit = tileDemandSubmitter({
    setPaused: (ref, paused) => calls.push(['pause', ref, paused]),
    setDemand: (ref, demand, layers) => calls.push(['demand', ref, demand, layers]),
  }, page);
  const demand = { desiredDeviceWidth: 1000, visibleRect: { x: 0, y: 0, width: 500, height: 500 } };
  submit(demand, true, false);
  submit(structuredClone(demand), true, false);
  assert.equal(calls.length, 2);
  const moved = { ...demand, visibleRect: { ...demand.visibleRect, y: 100 } };
  submit(moved, true, false);
  const fast = { ...moved, velocity: { dx: 0, dy: 10 } };
  submit(fast, true, false);
  submit(fast, false, false);
  submit(fast, false, true);
  submit(fast, false, true);
  submit(fast, false, false);
  submit(fast, false, false);
  assert.equal(calls.length, 12);
  assert.deepEqual(calls.at(-2), ['pause', page, false]);
  assert.deepEqual(calls.at(-1)[3], {});
});
