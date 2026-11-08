import assert from 'node:assert/strict';
import test from 'node:test';
import { localEngine } from '@embedpdf/engine';
import { fixture } from '../scripts/pdf-editing-fixture.mjs';

test('native v3 cancellation does not block the next full-page render', async t => {
  const engine = localEngine({ runtime: { prefer: 'wasm' }, defaultFallbackFonts: false });
  t.after(() => engine.destroy());
  const doc = await engine.open({ kind: 'bytes', bytes: fixture({ content: '1 0 0 rg 0 0 100 100 re f\n' }) });
  const ref = (await doc.pages.list()).pages[0].ref;
  const obsolete = doc.page(ref).render.raw({ viewport: { kind: 'width', width: 2000 } });
  const rejected = assert.rejects(obsolete);
  obsolete.abort();
  await rejected;
  const current = await doc.page(ref).render.raw({ viewport: { kind: 'width', width: 612 } });
  assert.equal(current.width, 612);
  assert.equal(current.height, 792);
  assert.equal(current.data.byteLength, 612 * 792 * 4);
});
