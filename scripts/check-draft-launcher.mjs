import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {chromium} from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import {localEngine} from '@embedpdf/engine';
const base=process.env.PDF_TEST_URL;const path=process.env.PDF_TEST_FILE;
if(!base||!path)throw Error('Run through TestDraftBrowser with PDF_TS_BROWSER_TEST=1.');
const original=await readFile(path);
const browser=await chromium.launch({channel:'chrome'});
const context=await browser.newContext({viewport:{width:1280,height:900}});
const errors=[];context.on('page',p=>{p.on('pageerror',e=>errors.push(e.message));if(process.env.DEBUG_PDF)p.on('console',m=>console.log(m.type(),m.text()));});
async function open(){const page=await context.newPage();page.setDefaultTimeout(15000);await page.goto(`${base}/?launcherDocument=draft-browser`);await page.waitForFunction(()=>[...document.querySelectorAll('.pdf-native-render-layer img')].some(i=>i.complete&&i.naturalWidth));await page.getByRole('button',{name:'Pin toolbar',exact:true}).click();return page;}
try{
 const a=await open();const b=await open();
 await a.bringToFront();await a.getByRole('button',{name:'Draw',exact:true}).click();await a.locator('[aria-label="Rectangle"]').click();
 const rect=await a.locator('.pdf-page-surface').first().boundingBox();await a.mouse.move(rect.x+110,rect.y+110);await a.mouse.down();await a.mouse.move(rect.x+220,rect.y+180,{steps:8});await a.mouse.up();await a.getByRole('button',{name:'Back',exact:true}).click();
 await a.locator('main[data-draft-status="saved"]').waitFor();await b.locator('main[data-draft-status="saved"]').waitFor();
 const draft=JSON.parse(await readFile(path+'.swp','utf8'));assert.equal(draft.format,'pdf.ts/swp');assert.equal(draft.bundle.items.length,1);
 assert.deepEqual(await readFile(path),original);
 await a.screenshot({path:'/tmp/pdf-ts-draft-status.png'});
 await a.close();await b.close();
 const reopened=await open();if(process.env.DEBUG_PDF)console.log('reopened',await reopened.locator('body').innerText(),errors);await reopened.locator('main[data-draft-status="saved"]').waitFor();assert.ok(await reopened.title().then(t=>t.startsWith('*')));
 await reopened.keyboard.press('Control+s');await reopened.waitForFunction(()=>!document.title.startsWith('*'));
 await assert.rejects(stat(path+'.swp'),{code:'ENOENT'});
 const output=await readFile(path);assert.notDeepEqual(output,original);
 const engine=localEngine({runtime:{prefer:'wasm'},defaultFallbackFonts:false});
 try{const doc=await engine.open({kind:'bytes',bytes:new Uint8Array(output)});const all=(await doc.annotations.list()).annotations;assert.equal(all.filter(a=>a.subtype==='square').length,1);}finally{await engine.destroy();}
 assert.deepEqual(errors,[]);
 console.log('PASS actual Go .pdf.swp auto-save, shared UI status, close/reopen recovery, Ctrl+S merge, draft cleanup, and PDFium verification');
}finally{await browser.close();}
