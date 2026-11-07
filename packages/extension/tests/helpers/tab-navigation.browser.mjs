import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { randomUUID } from 'node:crypto';
import { setTimeout, clearTimeout } from 'node:timers';
import { URL, URLSearchParams } from 'node:url';
import console from 'node:console';

// An actual MV3 worker inspects tabs; the product worker/content bundles use
// synthetic transport and accounts. No tabs permission: match the LMS host grant.
export async function testTabNavigation({ chromium, content, worker, home, list, detail, pageUrl }) {
  const directory = await mkdtemp(join(tmpdir(), 'kadai-tab-navigation-'));
  let context;
  const results = [];
  try {
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ manifest_version: 3,
      name: 'Synthetic tab-state inspection', version: '1.0',
      host_permissions: ['https://lms.ynu.ac.jp/*'], background: { service_worker: 'inspect.js' } }));
    await writeFile(join(directory, 'inspect.js'), 'globalThis.ready = true;');
    // Playwright's documented Chromium channel supports extensions in headless mode.
    context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`] });
    const inspector = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const inspect = id => inspector.evaluate(id => globalThis.chrome.tabs.get(id), id);
    for (const scenario of ['slow-first', 'slow-yielded', 'slow-external', 'cancelled-reload', 'cancelled-pending', 'download']) {
      const page = await context.newPage();
      const state = scenario === 'slow-yielded' ? { ynuFetchStatus: 'yielded', ynuFetchCompletedAt: Date.now() } : {};
      const replies = [], reads = [];
      let listener, pendingRoute, claims = 0;
      const destination = scenario === 'slow-external' ? 'https://outside.example.test/student' : 'https://lms.ynu.ac.jp/lms/studentCourse';
      try {
        await context.route('**/*', async route => {
          const url = route.request().url();
          assert.ok(url.startsWith('https://lms.ynu.ac.jp/') || url === destination, 'only synthetic LMS/navigation transport is allowed');
          if (url.endsWith('/download')) return route.fulfill({ contentType: 'application/octet-stream',
            headers: { 'Content-Disposition': 'attachment; filename="synthetic.txt"' }, body: 'synthetic download' });
          if (url === destination) { pendingRoute = route; return; }
          return route.fulfill({ contentType: 'text/html; charset=utf-8', body: home });
        });
        const chrome = { runtime: { id: 'synthetic-extension', onMessage: { addListener: fn => { listener = fn; } } }, action: {},
          storage: { session: { get: async () => globalThis.structuredClone(state), set: async values => Object.assign(state, globalThis.structuredClone(values)) } },
          tabs: { query: args => inspector.evaluate(args => globalThis.chrome.tabs.query(args), args), get: inspect,
            sendMessage: async (_id, message) => {
              if (message.type === 'ynu-collection-claim') claims++;
              return page.evaluate(message => new Promise(resolve => globalThis.contentListener(message,
                { id: 'synthetic-extension' }, resolve)), message);
            } } };
        runInContext(worker, createContext({ chrome, URL, URLSearchParams, AbortSignal: globalThis.AbortSignal,
          AbortController: globalThis.AbortController, crypto: { randomUUID }, clearTimeout,
          setTimeout: (fn, ms) => { if (ms === 250) { globalThis.queueMicrotask(fn); return 0; } return setTimeout(fn, ms); },
          fetch: async (url, init) => {
            if (url.startsWith('https://lms.ynu.ac.jp/')) {
              reads.push(new URL(url).pathname.replace(/;[^/]*/g, ''));
              return { ok: true, status: 200, url, text: async () => url.includes('linkKyozaiTitle') ? detail : url.includes('linkKougi') ? list : home };
            }
            assert.equal(url, 'https://api.example.test/api/v1/observations');
            assert.equal(init.method, 'POST');
            return { ok: true, json: async () => ({ status: 'applied', changed: false, changeCount: 0 }) };
          } }));
        let tabId;
        const sendToWorker = message => new Promise(resolve => listener(message,
          { id: 'synthetic-extension', frameId: 0, url: page.url(), tab: { id: tabId }, documentId: 'synthetic-document' }, resolve));
        await page.exposeFunction('sendToWorker', async message => {
          const reply = await sendToWorker(message);
          if (message.type === 'ynu-session-found') replies.push(reply);
          return reply;
        });
        await page.addInitScript(() => {
          globalThis.departures = 0;
          globalThis.addEventListener('beforeunload', () => { globalThis.departures++; });
          globalThis.chrome = { runtime: { id: 'synthetic-extension',
            onMessage: { addListener: fn => { globalThis.contentListener = fn; } }, sendMessage: message => globalThis.sendToWorker(message) } };
        });
        await page.clock.install({ time: new Date('2098-11-07T00:00:00Z') });
        await page.clock.pauseAt(new Date('2098-11-07T00:00:01Z'));
        await page.goto(pageUrl);
        [tabId] = await inspector.evaluate(async () => (await globalThis.chrome.tabs.query({ url: 'https://lms.ynu.ac.jp/*' })).map(tab => tab.id));
        await page.addScriptTag({ content });
        await page.keyboard.press('Shift');
        const navigate = () => page.evaluate(url => { globalThis.location.href = url; }, destination);
        if (scenario === 'cancelled-reload') {
          await page.evaluate(() => globalThis.addEventListener('beforeunload', event => { event.preventDefault(); event.returnValue = ''; }));
          const dialog = page.waitForEvent('dialog');
          const reload = page.evaluate(() => { globalThis.location.reload(); });
          await (await dialog).dismiss(); await reload;
        } else if (scenario === 'download') {
          const download = page.waitForEvent('download');
          await page.evaluate(() => { globalThis.location.href = '/download'; });
          await (await download).delete();
        } else {
          await navigate();
          await eventually(() => Boolean(pendingRoute));
          const during = await inspect(tabId);
          assert.equal(during.status, 'loading');
          if (scenario !== 'slow-external') assert.equal(during.pendingUrl, destination);
          if (scenario === 'cancelled-pending') {
            const cdp = await context.newCDPSession(page);
            await cdp.send('Page.stopLoading'); await cdp.detach();
          }
        }
        if (scenario.startsWith('slow-')) {
          const started = Date.now();
          const snapshots = [];
          for (const elapsed of [17_000, 32_000]) {
            await new Promise(resolve => setTimeout(resolve, Math.max(0, elapsed - (Date.now() - started))));
            assert.equal(reads.length, 0, 'no home GET while a real navigation is waiting');
            // Chromium can suspend old-document evaluation while waiting for a
            // response. Deliver the late request at the worker's message boundary.
            const pendingReply = sendToWorker({ type: 'ynu-session-found', sid: 'synthetic-session' }).catch(() => ({ code: 'unavailable' }));
            await new Promise(resolve => setTimeout(resolve, 50));
            assert.equal(claims, 0, 'do not claim the old home while navigating');
            const reply = await pendingReply;
            assert.equal(reply.code, 'not-idle', `${scenario} after ${elapsed}ms`);
            const tab = await inspect(tabId);
            assert.equal(tab.status, 'loading');
            snapshots.push(`${elapsed / 1000}s: loading, pendingUrl=${tab.pendingUrl ? 'present' : 'absent'}`);
            assert.equal(reads.length, 0, 'no home GET while a real navigation is waiting');
            assert.equal(claims, 0, 'do not claim the old home while navigating');
          }
          const navigation = page.waitForURL(destination);
          await pendingRoute.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>学生の移動先</h1>' }); pendingRoute = undefined;
          await navigation; await page.getByRole('heading', { name: '学生の移動先' }).waitFor();
          results.push(`${scenario}: ${snapshots.join('; ')}, no claim/read: PASS`);
        } else {
          let after;
          await eventually(async () => { after = await inspect(tabId); return after.status === 'complete' && !after.pendingUrl; });
          assert.equal(page.url(), pageUrl);
          const departures = await page.evaluate(() => globalThis.departures);
          assert.ok(departures > 0, 'use an actual beforeunload, not a dispatched event');
          await page.clock.runFor(17_000);
          await eventually(() => replies.some(reply => reply.ok));
          assert.ok(claims > 0); assert.ok(reads.length > 0);
          results.push(`${scenario}: complete, pendingUrl absent, beforeunload=${departures}, collection resumed: PASS`);
        }
        console.log(results.at(-1));
      } finally {
        if (pendingRoute) await pendingRoute.abort().catch(() => {});
        await page.close({ runBeforeUnload: false });
        await context.unrouteAll({ behavior: 'ignoreErrors' });
      }
    }
    return results;
  } finally {
    await context?.close();
    await rm(directory, { recursive: true, force: true });
  }
}

async function eventually(predicate) {
  const deadline = Date.now() + 20_000;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, 'tab navigation condition timed out');
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
