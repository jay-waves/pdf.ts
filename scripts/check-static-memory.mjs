// Read-only diagnostics of the pinned EmbedPDF runtime. No viewer configuration changes.
// Run with: node --expose-gc scripts/check-static-memory.mjs
import assert from 'node:assert/strict';
import { createPdfRuntime } from '@embedpdf/engine-runtime';
import { WorkerHost } from '@embedpdf/engine-services';
import { LocalEngine } from '@embedpdf/engine';
import { fixture } from './pdf-editing-fixture.mjs';
const runtime = await createPdfRuntime({ prefer: 'wasm' });
const listeners = new Set();
const host = new WorkerHost(runtime, pack => { for (const listener of listeners) listener(pack.payload); });
const engine = LocalEngine.fromTransport({ transport: {
  send: pack => host.receive(pack.payload),
  onMessage: listener => { listeners.add(listener); return () => listeners.delete(listener); },
  terminate: () => runtime.destroy(),
} });
// These diagnostic fields are private SDK implementation details, pinned to 3.0.0.
// Read scalar counts only; do not retain sessions or pixel buffers.
const samples=[];
async function sample(stage) {
  await new Promise(r => setTimeout(r, 0)); global.gc?.();
  const memory=process.memoryUsage();
  const row={stage, documents:host.sessions.size, parsedPages:host.residency.size, parsedBytes:host.residency.bytes,
    decodedImageBytes:runtime.fn.EPDF_GetDecodedImageBytes(), parsedBudget:host.residency.policy.budgetBytes,
    decodedBudget:host.decodedImages.budgetBytes, nodeArrayBuffers:memory.arrayBuffers, nodeExternal:memory.external, nodeHeap:memory.heapUsed};
  samples.push(row); console.log(JSON.stringify(row)); return row;
}
try {
 await sample('runtime-ready');
 for(let cycle=0;cycle<3;cycle++) {
  let bytes=fixture({content:'%'+'x'.repeat(8*1024*1024)+'\n0 0 50 50 re f\n'});
  const doc=await engine.open({kind:'bytes',bytes,id:`memory-audit-${cycle}`}); bytes=null;
  await sample(`open-${cycle}`);
  const page=(await doc.pages.list()).pages[0].ref;
  await doc.page(page).render.raw({viewport:{kind:'width',width:640}});
  await sample(`render-${cycle}`);
  await doc.close();
  const closed=await sample(`close-${cycle}`);
  assert.equal(closed.documents,0);assert.equal(closed.parsedPages,0);assert.equal(closed.parsedBytes,0);
 }
} finally {await engine.destroy();}
console.log('PASS: all native document sessions and parsed pages released after each close. Node figures are not browser RSS.');
