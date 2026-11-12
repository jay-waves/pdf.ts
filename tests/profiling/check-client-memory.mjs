// Targeted real-SharedWorker ownership/GC audit; run against Vite dev.
import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from '../support/pdf-editing-fixture.mjs';
const browser=await chromium.launch({channel:'chrome'});
try {
 const page=await browser.newPage(); await page.goto(process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173');
 const cdp=await page.context().newCDPSession(page);
 await page.evaluate(async source=>{
  const {createSharedPdfEngine}=await import('/apps/engine/shared-document-client.ts');
  const {engine,client}=createSharedPdfEngine(); await client.ready;
  const bytes=new Uint8Array(source);
  window.audit={engine,client,weak:new WeakRef(bytes.buffer)};
  window.audit.doc=await engine.open({kind:'bytes',bytes,id:'audit'});
  window.audit.notTransferred=bytes.byteLength>0;
 },[...fixture({content:'%'+ 'x'.repeat(1024*1024)+'\n'})]);
 await cdp.send('HeapProfiler.collectGarbage');
 const open=await page.evaluate(()=>({originalBufferStillAlive:!!window.audit.weak.deref(),notTransferred:window.audit.notTransferred,
  documents:window.audit.client.documents.size,securityEntries:window.audit.client.securities.size,scopeEntries:window.audit.client.scopes.size}));
 console.log('OPEN',open);
 assert.equal(open.originalBufferStillAlive,false,'document proxy must not retain the borrowed source buffer');
 assert.equal(open.notTransferred,true,'opening must not detach caller-owned bytes');
 await page.evaluate(async()=>{await window.audit.doc.close();window.audit.doc=null;});
 await cdp.send('HeapProfiler.collectGarbage');
 const close=await page.evaluate(()=>({originalBufferStillAlive:!!window.audit.weak.deref(),documents:window.audit.client.documents.size,
  aliases:window.audit.client.aliases.size,snapshots:window.audit.client.snapshots.size,securityEntries:window.audit.client.securities.size,scopeEntries:window.audit.client.scopes.size}));
 console.log('CLOSE',close);
 assert.equal(close.documents,0);assert.equal(close.aliases,0);assert.equal(close.snapshots,0);assert.equal(close.securityEntries,0);assert.equal(close.scopeEntries,0);
 await page.evaluate(()=>window.audit.engine.destroy());
} finally {await browser.close();}
