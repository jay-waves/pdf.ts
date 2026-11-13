import assert from 'node:assert/strict';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { dropPdf } from '../support/browser-viewer.mjs';
import { scrollingFixture } from '../support/scrolling-fixture.mjs';

const base = process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome' });
const files = [50, 700, 2500].map(pathCount => scrollingFixture({ pageCount: 12, pathCount }));
try {
  for (const mode of ['off', 'on']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    try {
      const errors = [], pages = [], positions = new Map();
      // Headless Chrome exposes every tab as visible. Simulate the browser's
      // visibility events explicitly; scrolling, navigation and rendering are real.
      await context.addInitScript(mode => {
        localStorage.setItem('pdf-viewer-energy-saving-v1', mode);
        window.testVisible = false;
        Object.defineProperty(document, 'visibilityState', { get: () => window.testVisible ? 'visible' : 'hidden' });
        Object.defineProperty(document, 'hidden', { get: () => !window.testVisible });
      }, mode);
      const painted = page => page.waitForFunction(() => {
        const viewport = document.querySelector('.viewer')?.getBoundingClientRect();
        if (!viewport) return false;
        const shown = [...document.querySelectorAll('[data-pdf-page-index]')].filter(node => {
          const rect = node.getBoundingClientRect();
          return Math.min(rect.bottom, viewport.bottom) - Math.max(rect.top, viewport.top) > 30;
        });
        return shown.length > 0 && shown.every(node => node.querySelector('canvas[data-plane="base"][data-painted="true"]'));
      }, undefined, { timeout: 20_000 });
      const current = page => page.getByRole('textbox', { name: 'Current page', exact: true });
      const activate = async selected => {
        for (const page of pages) if (!page.isClosed()) await page.evaluate(visible => {
          window.testVisible = visible;
          document.dispatchEvent(new Event('visibilitychange'));
        }, page === selected);
        await selected.bringToFront();
        await painted(selected);
      };
      const open = async index => {
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        pages.push(page);
        await page.goto(base);
        await page.evaluate(() => { window.testVisible = true; document.dispatchEvent(new Event('visibilitychange')); });
        await dropPdf(page, files[index], `switch-${index}.pdf`);
        await painted(page);
        return page;
      };
      await open(0); await open(1);
      let switches = 0;
      for (const count of [2, 3]) {
        if (count === 3) await open(2);
        for (let round = 0; round < 4; round++) for (const page of pages) {
          await activate(page);
          await page.mouse.move(640, 875);
          if (positions.has(page)) assert.equal(await current(page).inputValue(), positions.get(page), 'switching must retain each document position');
          await current(page).fill(round % 2 ? '6' : '2');
          await current(page).press('Enter');
          await painted(page);
          await page.mouse.move(700, 450);
          await page.mouse.wheel(0, round % 2 ? -450 : 650);
          await page.waitForTimeout(300); // Let eased wheel movement and the motion gate settle.
          await painted(page);
          await page.mouse.move(640, 875);
          positions.set(page, await current(page).inputValue());
          switches++;
        }
      }
      // Leave work in flight: a tab switch must not strand cancelled tiles or
      // restore the previous session's viewport hints when the tab returns.
      for (let round = 0; round < 3; round++) for (const page of pages) {
        await activate(page);
        await page.mouse.move(700, 450);
        await page.mouse.wheel(0, round % 2 ? -900 : 900);
      }
      for (const page of pages) {
        await activate(page);
        await page.waitForFunction(() => {
          const tiles = [...document.querySelectorAll('[data-canvas-tiles]')];
          return tiles.length > 0 && tiles.every(node => node.dataset.fetching === '0');
        }, undefined, { timeout: 20_000 });
        await painted(page);
      }
      await pages[2].close();
      await activate(pages[0]);
      await open(2);
      await activate(pages.at(-1));
      assert.deepEqual(errors, []);
      console.log(`PASS energy=${mode}: ${switches} settled switches plus 9 switches during scrolling, backtracking, position retention and close/reopen.`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
