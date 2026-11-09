import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from './pdf-editing-fixture.mjs';
const browser=await chromium.launch({channel:'chrome'});
try {
 const context=await browser.newContext();const a=await context.newPage(),b=await context.newPage();
 for (const page of [a,b]) {
  await page.goto(process.env.PDF_TEST_URL??'http://127.0.0.1:5187/');
  await page.locator('[aria-label="Choose or drop a PDF file"]').waitFor();
  await page.evaluate(async bytes=>{
   const {createSharedPdfEngine}=await import('/apps/engine/shared-document-client.ts');
   const runtime=createSharedPdfEngine();await runtime.client.ready;runtime.client.setIdentity('idle-audit');
   window.audit={...runtime,bytes};
   window.audit.doc=await runtime.engine.open({kind:'bytes',bytes:new Uint8Array(bytes),id:'audit'});
  },[...fixture()]);
 }
 const stats=page=>page.evaluate(()=>window.audit.client.getRuntimeDiagnostics());
 const before=await stats(a);assert.equal(before.documents,1);
 await a.evaluate(()=>window.audit.doc.close());
 await a.waitForTimeout(before.idleMs+300);
 assert.equal((await stats(b)).active,true,'other tab keeps the runtime alive');
 await b.evaluate(()=>window.audit.doc.close());
 // Reopen inside the grace period cancels teardown without a new generation.
 await a.evaluate(async()=>{window.audit.doc=await window.audit.engine.open({kind:'bytes',bytes:new Uint8Array(window.audit.bytes),id:'audit'});});
 assert.equal((await stats(a)).generation,before.generation);
 await a.evaluate(()=>window.audit.doc.close());
 await a.waitForTimeout(before.idleMs+300);
 assert.equal((await stats(a)).active,false,'last close destroys runtime even with connected tabs');
 await a.evaluate(async()=>{
  const x=window.audit;x.doc=await x.engine.open({kind:'bytes',bytes:new Uint8Array(x.bytes),id:'audit'});
  const page=(await x.doc.pages.list()).pages[0].ref;
  const pixels=await x.doc.page(page).render.raw({viewport:{kind:'width',width:320}});
  if(!pixels.data.byteLength)throw new Error('No pixels after runtime restart');
 });
 const reopened=await stats(a);assert.equal(reopened.generation,before.generation+1);assert.equal(reopened.documents,1);
 assert.equal(reopened.parsedPageBudgetBytes,64*1024*1024);assert.equal(reopened.decodedImageBudgetBytes,32*1024*1024);
 for(const page of [a,b])await page.evaluate(()=>window.audit.engine.destroy());
 console.log('PASS shared lifetime, grace-period reopen, idle destroy and fresh-runtime render.',reopened);
}finally{await browser.close();}
