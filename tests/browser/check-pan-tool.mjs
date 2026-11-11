import assert from 'node:assert/strict';
import { withViewer, dropPdf } from '../support/browser-viewer.mjs';
import { fixture } from '../support/pdf-editing-fixture.mjs';

await withViewer(async (page, errors) => {
  await dropPdf(page, fixture({ secondPage: true }), 'pan.pdf');
  const paper = page.locator('[data-pdf-page-index="0"]').first();
  await paper.waitFor();
  await page.mouse.move(640, 25);
  await page.getByRole('button', { name: 'Pin toolbar', exact: true }).click();
  const pan = page.getByRole('button', { name: 'Pan', exact: true });
  async function drag(button = 'left') {
    const before = await paper.boundingBox();
    const x = before.x + before.width / 2;
    await page.mouse.move(x, 550);
    await page.mouse.down({ button });
    await page.mouse.move(x, 430, { steps: 12 });
    const after = await paper.boundingBox();
    await page.mouse.up({ button });
    return before.y - after.y;
  }
  assert.ok(await drag('middle') > 80, 'Middle button must pan without enabling the Pan tool');
  assert.equal(await pan.getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('.viewer').getAttribute('data-pdf-middle-panning'), null);
  assert.ok(Math.abs(await drag()) < 2, 'Releasing middle button must restore ordinary left-button input');
  await pan.click();
  assert.equal(await pan.getAttribute('aria-pressed'), 'true');
  assert.ok(await drag() > 80, 'Pan must move the page with the left mouse button');
  await pan.click();
  assert.equal(await pan.getAttribute('aria-pressed'), 'false');
  assert.ok(Math.abs(await drag()) < 2, 'Disabling Pan must stop left-button panning on the page');
  await pan.click();
  assert.ok(await drag() > 80, 'Pan must work again after toggling');
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  assert.equal(await page.locator('.viewer').evaluate(el => el.classList.contains('is-pan-mode')), false);
  assert.ok(Math.abs(await drag()) < 2, 'Clearing the tool must reset panning and its UI state');
  const selectArea = async () => {
    await page.getByRole('button', { name: 'Zoom presets', exact: true }).click();
    await page.getByText('Fit area', { exact: true }).click();
  };
  await selectArea();
  await page.getByRole('region', { name: 'Reading area', exact: true }).waitFor();
  await selectArea();
  await page.getByRole('region', { name: 'Reading area', exact: true }).waitFor({ state: 'hidden' });
  await selectArea();
  await page.getByRole('region', { name: 'Reading area', exact: true }).waitFor();
  await pan.click();
  await page.getByRole('region', { name: 'Reading area', exact: true }).waitFor({ state: 'hidden' });
  assert.equal(await pan.getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Presentation mode', exact: true }).click();
  await page.locator('section[data-viewer-presentation]').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('section[data-viewer-presentation]').waitFor({ state: 'hidden' });
  await page.mouse.move(640, 25);
  assert.equal(await pan.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(errors, []);
  console.log('PASS pan toggling, page-tool reset, reading-area toggle, and presentation reset');
});
