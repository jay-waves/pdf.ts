import assert from 'node:assert/strict';
import test from 'node:test';
import { viewerActivity } from '../apps/viewer/viewer-activity.ts';

test('viewer activity emits a structured session event stream', () => {
  const events = [];
  const unsubscribe = viewerActivity.onEvent((event) => events.push(event));
  const session = viewerActivity.begin('Mouse', ['Viewport', 'Pan']);
  session.update(['Viewport', 'Pan', 'Inertia']);
  session.end();
  unsubscribe();

  assert.deepEqual(events.map(({ id: _id, ...event }) => event), [
    { phase: 'start', source: 'Mouse', path: ['Viewport', 'Pan'], audience: 'all' },
    { phase: 'update', source: 'Mouse', path: ['Viewport', 'Pan', 'Inertia'], audience: 'all' },
    { phase: 'end', source: 'Mouse', path: ['Viewport', 'Pan', 'Inertia'], audience: 'all' },
  ]);
});
