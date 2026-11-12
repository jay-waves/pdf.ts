import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import { localEngine } from '@embedpdf/engine';
import { fixture } from './support/pdf-editing-fixture.mjs';

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('/draft-storage') || specifier === './draft-storage') return { url: 'test:host-storage', shortCircuit: true };
    return nextResolve(specifier.startsWith('.') && context.parentURL?.includes('/apps/') && !specifier.endsWith('.ts') ? `${specifier}.ts` : specifier, context);
  },
  load(url, context, nextLoad) {
    if (url === 'test:host-storage') return { format: 'module', shortCircuit: true, source: `
      export class DraftConflict extends Error {}
      export async function openDraftStorage() { return { read: async () => ({ text: null, version: 'missing' }) }; }
    ` };
    if (url.includes('/apps/') && url.endsWith('.ts')) return { format: 'module', shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8'), { mode: 'transform' }) };
    return nextLoad(url, context);
  },
});
const { SharedDocumentHost } = await import('../apps/engine/shared-document-host.ts');
hooks.deregister();

test('opening and display reads defer the draft baseline, but the first edit preserves original annotations', async t => {
  const engine = localEngine({ runtime: { prefer: 'wasm' }, defaultFallbackFonts: false });
  t.after(() => engine.destroy());
  const originalOpen = engine.open.bind(engine);
  let scans = 0;
  t.mock.method(engine, 'open', async (...args) => {
    const doc = await originalOpen(...args);
    const list = doc.annotations.list.bind(doc.annotations);
    t.mock.method(doc.annotations, 'list', (...args) => { scans++; return list(...args); });
    return doc;
  });
  const host = new SharedDocumentHost(engine, { run: fn => fn(), notify() {}, event() {}, protect: bytes => bytes });
  const doc = await host.open('lazy-baseline', { kind: 'bytes', bytes: fixture({ notes: true }) });
  assert.equal(scans, 0, 'opening must not enumerate annotations');
  for (const [service, method] of [['pages', 'list'], ['render', 'getPolicy'], ['annotations', 'list'], ['forms', 'list'], ['actions', 'get'], ['annotations', 'renderAppearances']]) {
    await host.prepareCall(doc.id, { type: 'call', path: [service], method });
  }
  assert.equal(scans, 0, 'display calls must not trigger the baseline');
  const note = (await doc.annotations.list()).annotations.find(a => a.contents === 'original note');
  const before = scans;
  await host.prepareCall(doc.id, { type: 'call', path: [{ page: note.page }, 'annotations'], method: 'update' });
  assert.equal(scans, before + 1);
  await doc.page(note.page).annotations.update(note.ref, { contents: 'changed original' });
  const draft = await host.capture(doc.id);
  assert.ok(draft.bundle.items.some(item => item.data.contents === 'changed original'));
  const after = scans;
  await host.prepareCall(doc.id, { type: 'call', path: [], method: 'futureOperation' });
  assert.equal(scans, after, 'later calls reuse the original baseline');
  // The browser integration covers storage and reopen; stop its pending timer here.
  host.setProtection(doc.id, null);
});
