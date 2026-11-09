import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { fixture } from './pdf-editing-fixture.mjs';

const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173');
  const dataTransfer = await page.evaluateHandle(bytes => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'scroll.pdf', { type: 'application/pdf' }));
    return transfer;
  }, [...fixture({ secondPage: true })]);
  await page.locator('[aria-label="Choose or drop a PDF file"]').dispatchEvent('drop', { dataTransfer });
  await page.waitForFunction(() => [...document.querySelectorAll('.pdf-native-render-layer img, .pdf-native-render-layer canvas[data-plane=base]')].some(image => (image.tagName === 'CANVAS' ? image.dataset.painted === 'true' : image.complete && image.naturalWidth)));
  const toolbar=page.locator('[data-toolbar-level]');
  await page.waitForFunction(()=>!document.querySelector('[data-toolbar-level]').hasAttribute('data-visible'));
  const rect=await page.locator('.viewer').boundingBox();
  await page.touchscreen.tap(rect.x+rect.width/2,rect.y+300);
  await page.waitForFunction(()=>document.querySelector('[data-toolbar-level]').dataset.visible==='true');
  await page.touchscreen.tap(rect.x+rect.width/2,rect.y+300);
  await page.waitForFunction(()=>!document.querySelector('[data-toolbar-level]').hasAttribute('data-visible'));
  await page.touchscreen.tap(rect.x+rect.width/2,rect.y+300);
  await page.waitForFunction(()=>document.querySelector('[data-toolbar-level]').dataset.visible==='true');
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:rect.x+rect.width/2,y:rect.y+400}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:rect.x+rect.width/2,y:rect.y+330}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>!document.querySelector('[data-toolbar-level]').hasAttribute('data-visible'));
  assert.deepEqual(errors,[]);
  console.log('PASS touch tap toggles controls and drag hides controls');
} finally {await browser.close();}
