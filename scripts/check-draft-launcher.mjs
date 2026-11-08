import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {chromium} from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import {init} from '@embedpdf/pdfium';
import {PdfiumNative} from '@embedpdf/engines/pdfium';
const base=process.env.PDF_TEST_URL;const path=process.env.PDF_TEST_FILE;
if(!base||!path)throw Error('Run through TestDraftBrowser with PDF_TS_BROWSER_TEST=1.');
const original=await readFile(path);
const browser=await chromium.launch({channel:'chrome'});
const context=await browser.newContext({viewport:{width:1280,height:900}});
const errors=[];context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));
async function open(){const page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(`${base}/?launcherDocument=draft-browser`);await page.waitForFunction(()=>[...document.querySelectorAll('.pdf-page-render-image')].some(i=>i.complete&&i.naturalWidth));await page.getByRole('button',{name:'Pin toolbar',exact:true}).click();return page;}
try{
 const a=await open();const b=await open();
 await a.bringToFront();await a.getByRole('button',{name:'Draw',exact:true}).click();await a.locator('[aria-label="Rectangle"]').click();
 const rect=await a.locator('.pdf-page-surface').first().boundingBox();await a.mouse.move(rect.x+110,rect.y+110);await a.mouse.down();await a.mouse.move(rect.x+220,rect.y+180,{steps:8});await a.mouse.up();await a.getByRole('button',{name:'Back',exact:true}).click();
 await a.getByRole('status').filter({hasText:'Draft saved'}).waitFor();await b.getByRole('status').filter({hasText:'Draft saved'}).waitFor();
 const draft=JSON.parse(await readFile(path+'.swp','utf8'));assert.equal(draft.format,'pdf.ts/swp');assert.equal(draft.upsert.length,1);
 assert.deepEqual(await readFile(path),original);
 await a.screenshot({path:'/tmp/pdf-ts-draft-status.png'});
 await a.close();await b.close();
 const reopened=await open();await reopened.getByRole('status').filter({hasText:'Draft saved'}).waitFor();assert.ok(await reopened.title().then(t=>t.startsWith('*')));
 await reopened.keyboard.press('Control+s');await reopened.waitForFunction(()=>!document.title.startsWith('*'));
 await assert.rejects(stat(path+'.swp'),{code:'ENOENT'});
 const output=await readFile(path);assert.notDeepEqual(output,original);
 const native=new PdfiumNative(await init({wasmBinary:await readFile(new URL(import.meta.resolve('@embedpdf/pdfium/pdfium.wasm')))}));
 try{const doc=await native.openDocumentBuffer({id:'verify',content:output.buffer.slice(output.byteOffset,output.byteOffset+output.length)}).toPromise();const all=await native.getPageAnnotations(doc,doc.pages[0]).toPromise();assert.equal(all.filter(a=>a.type===5).length,1);}finally{await native.destroy().toPromise();}
 assert.deepEqual(errors,[]);
 console.log('PASS actual Go .pdf.swp auto-save, shared UI status, close/reopen recovery, Ctrl+S merge, draft cleanup, and PDFium verification');
}finally{await browser.close();}
