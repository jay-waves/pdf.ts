import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from './pdf-editing-fixture.mjs';
const base = process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173';
const original=fixture({notes:true}); let pdf=original;
const browser=await chromium.launch({channel:'chrome'});
const context=await browser.newContext();
const errors=[];
context.on('page',page=>{
 page.on('pageerror',e=>errors.push(e.message));
 if(process.env.DEBUG_PDF)page.on('console',m=>console.log(m.type(),m.text()));
});
await context.route('**/draft-fixture.pdf',route=>route.fulfill({contentType:'application/pdf',body:pdf}));
await context.route('**/draft-test',route=>route.fulfill({contentType:'text/html',body:'Draft test'}));
const page=await context.newPage();page.setDefaultTimeout(15000);
async function open(){
 await page.evaluate(async()=>{ const {open}=await import('/scripts/shared-document-harness.ts'); window.session=await open('draft-fixture', '/draft-fixture.pdf'); });
}
async function saved(){await page.waitForFunction(()=>{const s=session.client.getSnapshot('test');return s.draftStatus==='saved'&&s.draftRevision===s.revision;});}
async function close(){await page.evaluate(()=>session.engine.destroy().toPromise());}
async function edits(){return page.evaluate(()=>Object.values(session.annotations.getState().byUid).filter(x=>x.commitState!=='deleted').map(x=>({id:x.object.id,type:x.object.type,contents:x.object.contents})));}
async function drafts(){return page.evaluate(async()=>{const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('pdf-ts-drafts');const files=[];for await(const [name,handle]of dir.entries())files.push({name,text:await(await handle.getFile()).text()});return files;});}
try {
 await page.goto(`${base}/draft-test`);await open();
 await page.evaluate(async()=>{
  const notes=Object.values(session.annotations.getState().byUid).map(x=>x.object).filter(x=>x.type===1);
  session.annotations.updateAnnotation(0,notes.find(x=>x.contents==='original note').id,{contents:'changed original'});
  session.annotations.deleteAnnotation(0,notes.find(x=>x.contents==='delete this note').id);
  session.annotations.createAnnotation(0,{id:'new-shape',type:5,pageIndex:0,rect:{origin:{x:20,y:30},size:{width:40,height:50}},color:'#ff0000',strokeWidth:2,opacity:1,flags:[]});
  await session.client.flush();
  await session.form.setFormValues({SharedName:'draft field value'}).toPromise();
  const canvas=new OffscreenCanvas(16,16);const ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,16,16);
  const data=await(await canvas.convertToBlob({type:'image/png'})).arrayBuffer();
  session.annotations.createAnnotation(0,{id:'draft-stamp',type:13,pageIndex:0,rect:{origin:{x:200,y:200},size:{width:32,height:32}},flags:[]},{data,mimeType:'image/png'});
  await session.client.flush();
 });
 await saved();
 const stored=await drafts();assert.equal(stored.length,1);assert.ok(stored[0].name.endsWith('.swp'));
 assert.ok(stored[0].text.includes('changed original'));assert.ok(stored[0].text.length<20000);assert.deepEqual(pdf,original);
 console.log('PASS auto-save writes .swp, leaves PDF untouched');
 await close();await open();
 const restored=await edits();
 assert.ok(restored.some(x=>x.contents==='changed original'));assert.ok(!restored.some(x=>x.contents==='delete this note'));
 assert.equal(restored.filter(x=>x.id==='new-shape').length,1);
 assert.equal(restored.filter(x=>x.id==='draft-stamp').length,1);
 const appearanceBytes=await page.evaluate(async()=>{const items=await session.annotations.exportAnnotations().toPromise();return items.find(x=>x.annotation.id==='draft-stamp').ctx.data.byteLength;});
 assert.ok(appearanceBytes>0,'stamp appearance survived .swp recovery');
 assert.equal(await page.evaluate(()=>session.form.getFormValues().SharedName),'draft field value');
 console.log('PASS restored create/update/delete and form values, including original annotations without IDs');
 // Begin manual merge, then edit while the complete PDF write awaits acknowledgement.
 await page.evaluate(()=>{window.pendingMerge=session.client.save('test',{save:async()=>false,writeShared:plan=>new Promise(resolve=>{window.plan=plan;window.ack=()=>resolve({status:'saved',version:plan.outputVersion});})});});
 await page.waitForFunction(()=>typeof ack==='function');
 pdf=Buffer.from(await page.evaluate(()=>Array.from(new Uint8Array(plan.data))));
 await page.evaluate(async()=>{
  session.annotations.updateAnnotation(0,'new-shape',{contents:'edited during merge'});await session.client.flush();ack();await pendingMerge;
 });
 await saved();
 const postMerge=JSON.parse((await drafts())[0].text);
 assert.equal(postMerge.upsert.length,1);assert.equal(postMerge.upsert[0].item.annotation.contents,'edited during merge');
 await close();await open();
 assert.equal((await edits()).filter(x=>x.id==='new-shape').length,1);
 assert.ok((await edits()).some(x=>x.contents==='edited during merge'));
 console.log('PASS merge rebases .swp and preserves concurrent edits without duplicates');
 // Final merge with no concurrent edits clears the draft.
 const final=await page.evaluate(async()=>{
  let data;await session.client.save('test',{save:async()=>false,writeShared:async plan=>{data=Array.from(new Uint8Array(plan.data));return {status:'saved',version:plan.outputVersion};}});return data;
 });pdf=Buffer.from(final);assert.equal((await drafts()).length,0);
 await close();await open();assert.equal((await edits()).filter(x=>x.id==='new-shape').length,1);
 console.log('PASS manual merge clears only acknowledged draft and saved PDF reopens');
 // A different PDF must not receive an old draft.
 await page.evaluate(async()=>{session.annotations.updateAnnotation(0,'new-shape',{contents:'conflicting draft'});await session.client.flush();});await saved();await close();
 pdf=original;await open();
 assert.equal(await page.evaluate(()=>session.client.getSnapshot('test').draftStatus),'conflict');
 assert.ok(!(await edits()).some(x=>x.contents==='conflicting draft'));
 assert.ok((await drafts())[0].text.includes('conflicting draft'));
 await page.evaluate(()=>session.client.request('test','sharedDiscardDraft'));
 assert.equal((await drafts()).length,0);
 console.log('PASS external PDF conflict preserves draft and requires explicit discard');
 // Simulate the PDF reaching disk but its acknowledgement being lost.
 await page.evaluate(async()=>{session.annotations.createAnnotation(0,{id:'crash-shape',type:5,pageIndex:0,rect:{origin:{x:20,y:30},size:{width:40,height:50}},color:'#ff0000',strokeWidth:2,opacity:1,flags:[]});await session.client.flush();});
 await saved();
 const interrupted=await page.evaluate(async()=>{
  let bytes;try{await session.client.save('test',{save:async()=>false,writeShared:async plan=>{bytes=Array.from(new Uint8Array(plan.data));throw new Error('lost acknowledgement');}});}catch{}return bytes;
 });
 pdf=Buffer.from(interrupted);assert.ok(JSON.parse((await drafts())[0].text).mergeOutputVersion);
 await close();await open();
 assert.equal((await edits()).filter(x=>x.id==='crash-shape').length,1);
 assert.equal((await drafts()).length,0);
 console.log('PASS interrupted merge recognizes saved output without replaying edits');
 // A write acknowledgement cannot hide a newer unsupported edit.
 const status = await page.evaluate(async () => {
  const { DraftSession } = await import('/apps/renderer/draft-session.ts');
  const { buildDraft, draftBaseline } = await import('/apps/renderer/document-draft.ts');
  let revision = 1, release, started;
  const writing = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const controller = new DraftSession({lane:{tail:Promise.resolve()}, revision:()=>revision,
   savedRevision:()=>0, capture:async()=>buildDraft('base',1,draftBaseline([],{}),[],{}), notify(){}, settled(){} });
  await controller.initialize(Promise.resolve({read:async()=>({text:null,version:'missing'}),
   write:async()=>{started();await gate;return 'written';},remove:async()=>{}}),'base');
  const pending = controller.persist(); await writing;
  revision++; controller.unavailable('Metadata requires Save to PDF.');
  release(); await pending; return controller.state;
 });
 assert.equal(status.draftStatus,'unavailable');assert.equal(status.draftRevision,1);
 console.log('PASS late draft acknowledgement preserves unsupported-edit warning');
 assert.deepEqual(errors,[]);
}finally{await browser.close();}
