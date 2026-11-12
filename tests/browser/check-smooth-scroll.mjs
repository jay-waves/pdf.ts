import assert from 'node:assert/strict';
import { withViewer, dropPdf } from '../support/browser-viewer.mjs';
import { fixture } from '../support/pdf-editing-fixture.mjs';

await withViewer(async (page, errors) => {
  await dropPdf(page, fixture({ secondPage: true }), 'scroll.pdf');
  await page.waitForFunction(() => [...document.querySelectorAll('.pdf-render img, .pdf-render canvas[data-plane=base]')].some(image => (image.tagName === 'CANVAS' ? image.dataset.painted === 'true' : image.complete && image.naturalWidth)));
  assert.deepEqual(await page.locator('.viewer').evaluate(element => {
    const style = getComputedStyle(element);
    return [style.overflowX, style.overflowY, element.scrollTop, element.scrollLeft];
  }), ['hidden', 'hidden', 0, 0], 'Stage must not have a second browser scroll container');
  const sample = async (options = {}) => page.evaluate(async options => {
    const viewport = document.querySelector('.viewer');
    const surface = document.querySelector('.pdf-page');
    const start = surface.getBoundingClientRect().y;
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, ...options });
    viewport.dispatchEvent(event);
    const positions = [surface.getBoundingClientRect().y - start];
    for (let i = 0; i < 35; i++) {
      await new Promise(requestAnimationFrame);
      positions.push(surface.getBoundingClientRect().y - start);
    }
    return { prevented: event.defaultPrevented, positions };
  }, options);
  const smooth = await sample();
  assert.ok(smooth.prevented);
  assert.equal(smooth.positions[0], 0, 'wheel does not jump immediately');
  assert.ok(Math.abs(smooth.positions[1]) < 15, 'first frame accelerates gently instead of jumping');
  assert.ok(smooth.positions.filter(y => y < -1 && y > -119).length > 3, 'wheel moves over several frames');
  assert.ok(Math.abs(smooth.positions.at(-1) + 120) < 1, 'one notch preserves its distance');
  const otherNotch = await sample({ deltaY: 60 });
  assert.ok(otherNotch.positions.filter(y => y < -1 && y > -59).length > 3, 'non-100/120 wheel steps are eased too');
  assert.ok(Math.abs(otherNotch.positions.at(-1) + 60) < 1);
  const smallNotch = await sample({ deltaY: 12.5 });
  assert.ok(smallNotch.positions.filter(y => y < -1 && y > -11.5).length > 3, 'small fractional mouse deltas do not bypass smoothing');
  assert.ok(Math.abs(smallNotch.positions.at(-1) + 12.5) < 1);
  const reverse = await sample({ deltaY: -120 });
  assert.ok(Math.abs(reverse.positions.at(-1) - 120) < 1, 'reverse direction preserves distance');
  const interruption = await page.evaluate(async () => {
    const viewport = document.querySelector('.viewer');
    const surface = document.querySelector('.pdf-page');
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120 }));
    await new Promise(requestAnimationFrame);
    window.dispatchEvent(new Event('blur'));
    const before = surface.getBoundingClientRect().y;
    await new Promise(resolve => setTimeout(resolve, 300));
    return surface.getBoundingClientRect().y - before;
  });
  assert.equal(interruption, 0, 'losing focus cancels residual motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reduced = await sample();
  assert.ok(Math.abs(reduced.positions.at(-1) + 120) < 1);
  assert.ok(reduced.positions.filter(y => y < -1 && y > -119).length <= 1, 'reduced motion retains native scrolling without easing');
  assert.deepEqual(errors, []);
  console.log('PASS eased wheel distance, reverse direction, interruption and reduced motion');
});
