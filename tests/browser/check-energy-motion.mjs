import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from '../support/pdf-editing-fixture.mjs';
const browser=await chromium.launch({channel:'chrome'});
try {
 for (const mode of ['on', 'off']) {
 const page=await browser.newPage({viewport:{width:1280,height:900}});
 const telemetry=[];page.on('request',r=>{if(r.url().includes('__memory_trace'))telemetry.push(r.url());});
 await page.addInitScript(mode=>localStorage.setItem('pdf-viewer-energy-saving-v1',mode),mode);
 await page.goto(process.env.PDF_TEST_URL??'http://127.0.0.1:5173');
 const drop=page.locator('[aria-label="Choose or drop a PDF file"]');await drop.waitFor();
 const dt=await page.evaluateHandle(bytes=>{const d=new DataTransfer();d.items.add(new File([new Uint8Array(bytes)],'motion.pdf',{type:'application/pdf'}));return d;},[...fixture({secondPage:true})]);
 await drop.dispatchEvent('drop',{dataTransfer:dt});await dt.dispose();
 await page.locator('canvas[data-plane="base"][data-painted="true"]').first().waitFor();
 await page.getByRole('button',{name:'Page',exact:true}).click({force:true});
 const zoom=page.getByRole('textbox',{name:'Zoom percentage',exact:true});await zoom.fill('400%');await zoom.press('Enter');
 await page.locator('canvas[data-plane="tile"][data-painted="true"]').first().waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('canvas[data-plane="tile"]')].some(c=>Number(c.dataset.tileScale)>=4));
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-canvas-tiles]')].every(e=>e.dataset.fetching==='0' && e.dataset.paused==='false'));
 const previous=await page.evaluateHandle(()=>[...document.querySelectorAll('canvas[data-plane="tile"]')]);
 await page.mouse.move(700,500);
 for(let i=0;i<4;i++) {
  await page.mouse.wheel(0,30);
  if (mode === 'on') await page.waitForFunction(()=>[...document.querySelectorAll('[data-canvas-tiles]')].some(e=>e.dataset.paused==='true'));
  else assert.ok(await page.locator('[data-canvas-tiles]').evaluateAll(nodes=>nodes.every(e=>e.dataset.paused==='false')), 'normal mode must not wait for motion to stop');
  assert.ok(await previous.evaluate(canvases=>canvases.some(c=>c.isConnected)), 'overlapping tiles stay mounted during motion');
  assert.ok(await previous.evaluate(canvases=>canvases.filter(c=>c.isConnected).every(c=>c.dataset.paintVersion==='1')), 'retained canvases must not repaint');
 }
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-canvas-tiles]')].every(e=>e.dataset.paused==='false' && e.dataset.fetching==='0'));
 await page.locator('canvas[data-plane="tile"][data-painted="true"]').first().waitFor();
 await previous.dispose();
 assert.deepEqual(telemetry,[]);
 console.log(`PASS ${mode === 'on' ? 'energy' : 'normal'} motion strategy keeps painted canvases and preserves its pause policy.`);
 await page.close();
 }
}finally{await browser.close();}
