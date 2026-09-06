import assert from 'node:assert/strict';
import test from 'node:test';
import { PdfErrorCode, Task, TaskStage } from '@embedpdf/models';
import { renderImage } from '../apps/renderer/render-image.ts';

test('render URL is released once even when load and cleanup both release it', (t) => {
  const revoke = t.mock.method(URL, 'revokeObjectURL');
  const task = new Task();
  let image;
  const dispose = renderImage(() => task, (url, release) => { image = { url, release }; }, assert.fail);
  task.resolve(new Blob(['raster']));
  assert.ok(image.url.startsWith('blob:'));
  image.release();
  dispose();
  assert.equal(task.state.stage, TaskStage.Resolved);
  assert.equal(revoke.mock.callCount(), 1);
});

test('disposing an unfinished render cancels it without reporting an error', () => {
  const task = new Task();
  const errors = [];
  const dispose = renderImage(() => task, assert.fail, (error) => errors.push(error));
  dispose();
  assert.deepEqual(errors, []);
  assert.equal(task.state.stage, TaskStage.Aborted);
  assert.equal(task.state.reason.code, PdfErrorCode.Cancelled);
});

test('a late completion from a non-cancellable renderer cannot publish a URL', () => {
  let complete;
  const dispose = renderImage(() => ({
    wait(resolve) { complete = resolve; },
    abort() {},
  }), assert.fail, assert.fail);
  dispose();
  complete(new Blob(['stale']));
});

test('render failures are reported, including synchronous start failures', () => {
  const errors = [];
  const task = new Task();
  renderImage(() => task, assert.fail, (error) => errors.push(error));
  task.reject({ code: PdfErrorCode.Unknown, message: 'tile failed' });
  const synchronousError = new Error('renderer unavailable');
  renderImage(() => { throw synchronousError; }, assert.fail, (error) => errors.push(error));
  assert.equal(errors[0].message, 'tile failed');
  assert.equal(errors[1], synchronousError);
});

test('releasing an old image does not revoke the next render URL', async () => {
  const start = () => {
    const task = new Task();
    let image;
    const dispose = renderImage(() => task, (url, release) => { image = { url, release }; }, assert.fail);
    task.resolve(new Blob(['raster']));
    return { ...image, dispose };
  };
  const oldImage = start();
  oldImage.dispose();
  const nextImage = start();
  oldImage.release();
  try {
    assert.equal(await (await fetch(nextImage.url)).text(), 'raster');
  } finally {
    nextImage.dispose();
  }
});
