import assert from 'node:assert/strict';
import test from 'node:test';
import { localEngine, PortableImageEncoder } from '@embedpdf/engine';
import { encodeEngineResult, decodeEngineResult, ownEngineResponseBuffer, engineResultTransfers } from '../apps/engine/engine-wire.ts';
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


test('owned encoded images transfer once while SDK and caller buffers remain usable', async () => {
  const pixels = new Uint8Array([255, 0, 0, 255]);
  const image = await new PortableImageEncoder().encode({ width: 1, height: 1, stride: 4, data: pixels.buffer }, { format: 'bmp' }, new AbortController().signal);
  const expected = image.source.bytes.slice();
  ownEngineResponseBuffer(image.source.bytes.buffer);
  const wire = encodeEngineResult({ image, alias: image.source.bytes, unowned: pixels });
  const transfer = engineResultTransfers(wire);
  assert.equal(transfer.length, 1);
  const remote = decodeEngineResult(structuredClone(wire, { transfer }));
  assert.equal(image.source.bytes.byteLength, 0);
  assert.equal(pixels.byteLength, 4);
  assert.deepEqual(new Uint8Array(await (await remote.image.blob()).arrayBuffer()), expected);
  assert.equal(remote.alias.buffer, remote.image.source.bytes.buffer);
  const url = await remote.image.objectUrl();
  try { assert.deepEqual(new Uint8Array(await (await fetch(url.url)).arrayBuffer()), expected); }
  finally { url.revoke(); }
});

test('image Blob contains only the byte view, without prefix or suffix bytes', async () => {
  const bytes = new Uint8Array([99, 1, 2, 3, 88]);
  const image = roundTrip({ width: 1, height: 1, mimeType: 'image/bmp', source: { kind: 'bytes', bytes: bytes.subarray(1, 4) } });
  assert.deepEqual(new Uint8Array(await (await image.blob()).arrayBuffer()), new Uint8Array([1, 2, 3]));
});

// These assertions guard allocation/ownership contracts, not GC timing or RSS.
test('wire adapters preserve binary object identity and view boundaries', () => {
  const buffer = new ArrayBuffer(32);
  const view = new Uint8Array(buffer, 7, 9);
  const dataView = new DataView(buffer, 3, 4);
  const blob = new Blob(['unchanged']);
  const value = { nested: [{ buffer, view, dataView, blob }] };
  for (const adapt of [encodeEngineResult, decodeEngineResult]) {
    const actual = adapt(value).nested[0];
    assert.equal(actual.buffer, buffer, 'adapter must not copy ArrayBuffer');
    assert.equal(actual.view, view, 'adapter must not copy or widen typed views');
    assert.equal(actual.dataView, dataView);
    assert.equal(actual.blob, blob);
  }
});

test('transfer collection is deduplicated, cycle-safe and scoped to the current response', () => {
  const owned = new ArrayBuffer(16);
  const otherResponse = new ArrayBuffer(8);
  const callerOwned = new ArrayBuffer(4);
  ownEngineResponseBuffer(owned);
  ownEngineResponseBuffer(otherResponse);
  const response = { direct: owned, nested: [new Uint8Array(owned, 4, 8), new DataView(owned)], callerOwned };
  response.self = response;
  assert.deepEqual(engineResultTransfers(response), [owned]);
  assert.deepEqual(engineResultTransfers({ callerOwned }), []);
  assert.deepEqual(engineResultTransfers(null), []);
  const remote = structuredClone(response, { transfer: engineResultTransfers(response) });
  assert.equal(owned.detached, true);
  assert.equal(otherResponse.detached, false, 'unrelated responses must remain usable');
  assert.equal(callerOwned.detached, false);
  assert.equal(remote.nested[0].buffer, remote.direct);
  assert.equal(remote.nested[0].byteOffset, 4);
  assert.equal(remote.nested[0].byteLength, 8);
});

test('image Blob receives the original byte view, without an intermediate copy', async t => {
  const NativeBlob = globalThis.Blob;
  const partsSeen = [];
  t.mock.method(globalThis, 'Blob', class extends NativeBlob {
    constructor(parts, options) { super(parts, options); partsSeen.push(parts); }
  });
  const bytes = new Uint8Array([99, 1, 2, 3, 88]).subarray(1, 4);
  const image = decodeEngineResult({ width: 1, height: 1, mimeType: 'image/bmp', source: { kind: 'bytes', bytes } });
  const blob = await image.blob();
  assert.equal(partsSeen.length, 1);
  assert.equal(partsSeen[0].length, 1);
  assert.equal(partsSeen[0][0], bytes, 'slice(), copying constructors and widened buffers violate the contract');
  bytes.fill(0);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), new Uint8Array([1, 2, 3]), 'Blob must retain its immutable snapshot');
});
