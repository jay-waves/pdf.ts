import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { createKernel } from '@embedpdf/core';
import { localEngine } from '@embedpdf/engine';
import { stagePlugin } from '@embedpdf/plugin-stage';
import { StageToken } from '@embedpdf/plugin-stage/contract/host';
import { interactionPlugin } from '@embedpdf/plugin-interaction';
import { InteractionToken } from '@embedpdf/plugin-interaction/contract/host';
import { fixture } from '../scripts/pdf-editing-fixture.mjs';
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(['../shared/reading-region', '../renderer/stage-scroll-adapter'].includes(specifier) ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('/stage-scroll-adapter.ts') || url.endsWith('/viewer-stage.ts')) return {
      format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true,
    };
    return nextLoad(url, context);
  },
});
const { StageScrollAdapter } = await import('../apps/renderer/stage-scroll-adapter.ts');
const { ViewerStage } = await import('../apps/viewer/viewer-stage.ts');
hooks.deregister();
async function setup(t) {
  const engine = localEngine({ runtime: { prefer: 'wasm' }, defaultFallbackFonts: false });
  const kernel = createKernel({ engine, plugins: [interactionPlugin(), stagePlugin({ viewUnitsPerPoint: 1, padding: 10, gap: { px: 10 }, zoom: { mode: 'fit-page' } })] });
  t.after(async () => { await kernel.destroy(); await engine.destroy(); });
  await kernel.start();
  await kernel.documents.open({ kind: 'bytes', bytes: fixture({ secondPage: true }), id: 'test' });
  const native = kernel.capability(StageToken, 'test');
  native.setViewportSize({ width: 800, height: 600 });
  const scroll = new StageScrollAdapter(kernel, 'test');
  return { kernel, native, scroll };
}
const near = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} vs ${expected}`);

test('navigation translates one-based pages and restores the native viewpoint after another page', async t => {
  const { native, scroll } = await setup(t);
  native.zoomTo(2);
  scroll.goToPage(2);
  native.scrollBy({ top: 100 });
  const before = scroll.getAnchor();
  scroll.goToPage(1);
  scroll.restoreAnchor(before);
  assert.equal(scroll.getCurrentPage(), 2);
  assert.equal(native.getViewpoint().anchor.pageIndex, before.viewpoint.anchor.pageIndex);
  near(native.getViewpoint().anchor.fractionY, before.viewpoint.anchor.fractionY);
});

test('reading area fits native page-space rectangles and remains centered after rotation', async t => {
  const { native, scroll } = await setup(t);
  for (const rotation of [0, 90, 180, 270]) {
    native.setViewRotation(rotation);
    const rect = { x: 120, y: 160, width: 240, height: 320 };
    const region = scroll.normalizeReadingRegion(0, rect);
    assert.ok(region);
    assert.equal(scroll.fitReadingRegion(region, 1), true);
    const box = native.pageRectToViewport(0, rect);
    assert.ok(box.width <= 781 && box.height <= 581);
    near(box.x + box.width / 2, 400, 1);
    near(box.y + box.height / 2, 300, 1);
  }
});

test('fit detents agree with native fit zoom and include spread page sizes and padding', async t => {
  const { native, scroll } = await setup(t);
  for (const spread of ['none', 'odd', 'even']) {
    native.updateSettings({ spread });
    native.fitPage();
    near(scroll.getFitScales().page, native.getZoomLevel(), .02);
    native.fitWidth();
    near(scroll.getFitScales().width, native.getZoomLevel(), .02);
  }
});

test('reading-area tool cancels without fitting or creating PDF edits and commits a completed drag', async t => {
  const { kernel, native } = await setup(t);
  const stage = new ViewerStage(kernel, 'test');
  t.after(stage.install());
  const interaction = kernel.capability(InteractionToken, 'test');
  const page = kernel.documents.listPages('test')[0].ref;
  const sample = (phase, x, y) => ({ phase, viewport: { x, y }, page: { ref: page, point: { x, y } }, modifiers: { ctrl: false, shift: false, alt: false, meta: false }, pointerType: 'mouse' });
  stage.beginRegionSelection();
  const zoom = native.getZoomLevel();
  interaction.dispatchPointer(sample('down', 100, 100));
  interaction.dispatchPointer(sample('move', 300, 400));
  assert.ok(stage.getSnapshot().regionPreview);
  interaction.dispatchPointer(sample('cancel', 300, 400));
  assert.equal(stage.getSnapshot().regionPreview, null);
  assert.equal(native.getZoomLevel(), zoom);
  interaction.dispatchPointer(sample('down', 100, 100));
  interaction.dispatchPointer(sample('move', 300, 400));
  interaction.dispatchPointer(sample('up', 300, 400));
  assert.equal(stage.getSnapshot().selectingRegion, false);
  assert.ok(native.getZoomLevel() > zoom);
  assert.equal(kernel.documents.get('test').hasUnsavedChanges, false);
});
