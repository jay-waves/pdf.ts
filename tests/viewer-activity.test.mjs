import assert from 'node:assert/strict';
import test from 'node:test';
import { viewerActivity } from '../apps/viewer-activity.ts';

test('viewer activity exposes structured current and last activity', () => {
  assert.deepEqual(viewerActivity.getSnapshot(), {
    source: null,
    path: [],
    active: false,
  });

  const session = viewerActivity.begin('Mouse', ['Viewport', 'Pan']);
  assert.deepEqual(viewerActivity.getSnapshot(), {
    source: 'Mouse',
    path: ['Viewport', 'Pan'],
    active: true,
  });

  session.update(['Viewport', 'Pan', 'Inertia']);
  assert.deepEqual(viewerActivity.getSnapshot(), {
    source: 'Mouse',
    path: ['Viewport', 'Pan', 'Inertia'],
    active: true,
  });

  session.end();
  assert.deepEqual(viewerActivity.getSnapshot(), {
    source: 'Mouse',
    path: ['Viewport', 'Pan', 'Inertia'],
    active: false,
  });
});
