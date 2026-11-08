import assert from 'node:assert/strict';
import test from 'node:test';
import { localEngine } from '@embedpdf/engine';
import { encodeEngineResult, decodeEngineResult } from '../apps/engine/engine-wire.ts';
import { fixture } from '../scripts/pdf-editing-fixture.mjs';
const roundTrip = value => decodeEngineResult(structuredClone(encodeEngineResult(value)));
async function setup(t) {
  const engine = localEngine({ runtime: { prefer: 'wasm' }, defaultFallbackFonts: false });
  t.after(() => engine.destroy());
  const doc = await engine.open({ kind: 'bytes', bytes: fixture({ content: 'BT /Helv 20 Tf 60 700 Td (Select this text) Tj ET\n' }) });
  return doc.page((await doc.pages.list()).pages[0].ref);
}
test('worker text layout retains hit-testing, word selection and highlight geometry', async t => {
  const page = await setup(t); const layout = await page.text.layout(); const remote = roundTrip(layout);
  assert.equal(remote.charCount, layout.charCount);
  const quad = layout.charQuad(0);
  const point = { x: (quad.upperLeft.x + quad.lowerRight.x) / 2, y: (quad.upperLeft.y + quad.lowerRight.y) / 2 };
  assert.equal(remote.charAt(point), 0);
  assert.deepEqual(remote.wordAt(point), layout.wordAt(point));
  assert.deepEqual(remote.lineAt(point), layout.lineAt(point));
  assert.deepEqual(remote.segments(remote.wordAt(point)), layout.segments(layout.wordAt(point)));
});
test('worker image and raster results preserve pixels, object URLs and coordinate transforms', async t => {
  const page = await setup(t);
  const image = await page.render.image({ viewport: { kind: 'width', width: 306 }, format: 'png', rotation: 90 });
  const remote = roundTrip(image);
  assert.deepEqual(new Uint8Array(await (await remote.blob()).arrayBuffer()), new Uint8Array(await (await image.blob()).arrayBuffer()));
  const url = await remote.objectUrl(); assert.match(url.url, /^blob:/); url.revoke();
  for (const value of [{ x: 60, y: 92 }, { x: 40, y: 70, width: 90, height: 20 }]) {
    assert.deepEqual(remote.transform.pageToPixels(value), image.transform.pageToPixels(value));
    assert.deepEqual(remote.transform.pixelsToPage(value), image.transform.pixelsToPage(value));
  }
  const raster = await page.render.raw({ viewport: { kind: 'width', width: 100 } });
  const round = roundTrip(raster); assert.deepEqual(round.data, raster.data);
  assert.deepEqual(round.transform.pageToPixels({ x: 60, y: 92 }), raster.transform.pageToPixels({ x: 60, y: 92 }));
});
