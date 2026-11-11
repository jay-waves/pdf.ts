import assert from 'node:assert/strict';
import { withViewer, dropPdf } from '../support/browser-viewer.mjs';
import { fixture } from '../support/pdf-editing-fixture.mjs';

await withViewer(async (page, errors) => {
  await dropPdf(page, fixture({ secondPage: true }), 'scroll.pdf');
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
}, { hasTouch: true });
