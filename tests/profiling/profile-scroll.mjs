// Local Vite/Chrome CPU sampling and lightweight call counters; never a test gate.
// PDF_PROFILE_FILE selects a real PDF; otherwise use the deterministic many-page fixture.
// PDF_BENCH_OUTPUT is an output directory for JSON and DevTools .cpuprofile files.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '/home/jay-waves/.local/lib/node_modules/playwright/index.mjs';
import { dropPdf } from '../support/browser-viewer.mjs';
import { scrollingFixture } from '../support/scrolling-fixture.mjs';

const output = process.env.PDF_BENCH_OUTPUT ?? '/tmp/pdf-scroll-profile';
const base = process.env.PDF_TEST_URL ?? 'http://127.0.0.1:5173';
const pageCount = Number(process.env.PDF_PROFILE_PAGES ?? 300);
const bytes = process.env.PDF_PROFILE_FILE ? await readFile(process.env.PDF_PROFILE_FILE) : scrollingFixture({ pageCount, pathCount: 300 });
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const rows = [], instrumented = new Set();

// Shared workers need a browser-target CDP session (Playwright's page session only sees the renderer).
async function workerSession(browser) {
  const root = await browser.newBrowserCDPSession();
  const { targetInfos } = await root.send('Target.getTargets');
  const target = targetInfos.find(t => t.type === 'shared_worker' && t.url.includes('pdfium-worker'));
  if (!target) throw Error('Shared PDF worker target not found');
  const { sessionId } = await root.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  let sequence = 0;
  const pending = new Map();
  root.on('Target.receivedMessageFromTarget', event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message), held = pending.get(message.id);
    if (!held) return;
    pending.delete(message.id);
    if (message.error) held.reject(Error(message.error.message)); else held.resolve(message.result);
  });
  return { send(method, params = {}) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      root.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) })
        .catch(error => { pending.delete(id); reject(error); });
    });
  }, close: () => root.detach() };
}

function summarize(profile) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parent = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const self = new Map(), inclusive = new Map();
  const key = node => `${node.callFrame.functionName || '(anonymous)'} @ ${node.callFrame.url}:${node.callFrame.lineNumber + 1}`;
  let busy = 0;
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    let id = profile.samples[i];
    const ms = profile.timeDeltas[i] / 1000, node = nodes.get(id);
    if (node.callFrame.functionName !== '(idle)') busy += ms;
    const name = key(node); self.set(name, (self.get(name) ?? 0) + ms);
    const seen = new Set();
    while (id !== undefined) {
      const name = key(nodes.get(id));
      if (!seen.has(name)) { inclusive.set(name, (inclusive.get(name) ?? 0) + ms); seen.add(name); }
      id = parent.get(id);
    }
  }
  const top = values => [...values].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, ms]) => ({ name, ms: +ms.toFixed(2) }));
  return { sampledBusyMs: +busy.toFixed(2), topSelf: top(self), topInclusive: top(inclusive),
    coordination: [...inclusive].filter(([name]) => /page-prefetch|buildScene|layoutFor|withTransform|setDemand|CanvasTiles|energy-motion/.test(name))
      .map(([name, ms]) => ({ name, ms: +ms.toFixed(2) })) };
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('pdf-viewer-energy-saving-v1', 'off');
    window.scrollProfile = { counts: {}, demands: new Map(), frames: [], longTasks: [], rpc: {} };
    window.countProfile = name => { const c = window.scrollProfile.counts; c[name] = (c[name] ?? 0) + 1; };
    let last;
    const frame = now => { if (last !== undefined) window.scrollProfile.frames.push(now - last); last = now; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    new PerformanceObserver(list => { window.scrollProfile.longTasks.push(...list.getEntries().map(e => e.duration)); }).observe({ type: 'longtask', buffered: false });
    const post = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function (message, ...args) {
      if (message?.type === 'call' || message?.type === 'abort') {
        const key = message.type === 'abort' ? 'abort' : `${message.path.filter(p => typeof p === 'string').join('.')}.${message.method}`;
        const rpc = window.scrollProfile.rpc; rpc[key] = (rpc[key] ?? 0) + 1;
      }
      return post.call(this, message, ...args);
    };
  });
  await page.route(/\/(apps\/renderer\/page-prefetch\.ts|node_modules\/\.vite\/deps\/@embedpdf_plugin-(stage|render)\.js)(\?|$)/, async route => {
    const response = await route.fetch();
    let body = await response.text();
    const inject = (pattern, name, extra = '') => {
      if (!pattern.test(body)) throw Error(`Diagnostic injection no longer matches: ${name}`);
      body = body.replace(pattern, match => `${match} globalThis.countProfile('${name}'); ${extra}`);
      instrumented.add(name);
    };
    if (route.request().url().includes('page-prefetch.ts')) {
      inject(/const candidate = \(\) => \{/, 'prefetch.candidate');
      inject(/const update = \(\) => \{/, 'prefetch.update');
    } else if (route.request().url().includes('plugin-stage')) {
      inject(/const buildScene = \(\) => \{/, 'scene.lookup');
      inject(/const layoutFor = \(groups\) => \{/, 'scene.rebuild');
      inject(/const withTransform = \(box\) => \{/, 'scene.transform');
    } else {
      inject(/plan\(view, pageObjectNumber, demand, layers\) \{/, 'tiles.plan');
      inject(/setDemand: \(page, demand, options\) => \{/, 'tiles.setDemand', `const diagnosticKey = viewId + ':' + page.objectNumber; const diagnosticValue = JSON.stringify([demand, options]); const demands = globalThis.scrollProfile.demands; if (demands.get(diagnosticKey) === diagnosticValue) globalThis.countProfile('tiles.sameDemand'); demands.set(diagnosticKey, diagnosticValue);`);
    }
    await route.fulfill({ response, body });
  });
  await page.goto(base);
  await page.getByRole('button', { name: 'Choose or drop a PDF file' }).waitFor();
  await dropPdf(page, bytes, 'profile.pdf');
  const settle = async () => {
    await page.waitForFunction(() => {
      const pages = [...document.querySelectorAll('.pdf-page')];
      return pages.length && pages.every(p => p.querySelector('canvas[data-plane=base][data-painted=true]')) &&
        [...document.querySelectorAll('[data-canvas-tiles]')].every(p => p.dataset.fetching === '0' && p.dataset.paused === 'false');
    });
    await page.waitForTimeout(300);
  };
  await settle();
  const main = await page.context().newCDPSession(page), worker = await workerSession(browser);
  await main.send('Performance.enable');
  for (const session of [main, worker]) { await session.send('Profiler.enable'); await session.send('Profiler.setSamplingInterval', { interval: 1000 }); }
  const metrics = async () => Object.fromEntries((await main.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  async function sample(name, action) {
    await settle();
    await page.evaluate(() => { const p = window.scrollProfile; p.counts = {}; p.frames = []; p.longTasks = []; p.rpc = {}; p.demands.clear(); });
    const before = await metrics();
    await Promise.all([main.send('Profiler.start'), worker.send('Profiler.start')]);
    const start = Date.now();
    await action(); await settle();
    const wallMs = Date.now() - start;
    const [mainResult, workerResult] = await Promise.all([main.send('Profiler.stop'), worker.send('Profiler.stop')]);
    const after = await metrics();
    const observed = await page.evaluate(() => {
      const { counts, frames, longTasks, rpc } = window.scrollProfile;
      const sorted = [...frames].sort((a, b) => a - b);
      return { counts, rpc, frames: { count: frames.length, p95Ms: sorted[Math.floor(sorted.length * .95)], over32ms: frames.filter(n => n > 32).length }, longTasks };
    });
    const metricDelta = Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'].map(key => [key, after[key] - before[key]]));
    const row = { name, wallMs, ...observed, metricDelta, main: summarize(mainResult.profile), worker: summarize(workerResult.profile) };
    rows.push(row);
    await Promise.all([writeFile(join(output, `${name}-main.cpuprofile`), JSON.stringify(mainResult.profile)), writeFile(join(output, `${name}-worker.cpuprofile`), JSON.stringify(workerResult.profile))]);
    console.log(JSON.stringify({ name, wallMs, counts: row.counts, frames: row.frames, metrics: metricDelta, mainBusyMs: row.main.sampledBusyMs, workerBusyMs: row.worker.sampledBusyMs }));
  }
  await page.mouse.move(640, 25);
  await page.getByRole('button', { name: 'Pin toolbar', exact: true }).click();
  await page.getByRole('button', { name: 'Page', exact: true }).click();
  const zoom = page.getByRole('textbox', { name: 'Zoom percentage', exact: true });
  await zoom.fill('400%'); await zoom.press('Enter');
  await sample('same-page-scroll', async () => {
    await page.mouse.move(700, 450);
    for (let i = 0; i < 24; i++) await page.mouse.wheel(0, 30);
  });
  await zoom.fill('100%'); await zoom.press('Enter');
  const drag = async fraction => {
    const bar = await page.locator('.pdf-scrollbar-y').boundingBox(), thumb = await page.locator('.pdf-scrollbar-y .pdf-scroll-thumb').boundingBox();
    await page.mouse.move(thumb.x + thumb.width / 2, thumb.y + thumb.height / 2); await page.mouse.down();
    await page.mouse.move(thumb.x + thumb.width / 2, bar.y + bar.height * fraction, { steps: 60 }); await page.mouse.up();
  };
  await sample('scrollbar-forward', () => drag(.85));
  await sample('scrollbar-return', () => drag(.15));
  await sample('zoom', async () => { for (const value of ['110%', '125%', '140%', '160%', '180%', '200%']) { await zoom.fill(value); await zoom.press('Enter'); } });
  await worker.close();
  if (errors.length) throw Error(errors.join('\n'));
  const report = { chrome: browser.version(), source: process.env.PDF_PROFILE_FILE ?? `synthetic:${pageCount} pages, 300 paths/page`, instrumented: [...instrumented],
    limitations: 'Vite development build, instrumented call counters and 1ms V8 sampling. Not GPU time or process RSS. Inclusive samples overlap. Synthetic vector PDF is not representative of every PDF.', rows };
  await writeFile(join(output, 'summary.json'), JSON.stringify(report, null, 2));
  console.log(`Saved ${output}/summary.json and DevTools CPU profiles.`);
} finally { await browser.close(); }
