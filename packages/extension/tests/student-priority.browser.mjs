import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath, URL, URLSearchParams } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout, clearTimeout } from 'node:timers';
import process from 'node:process';
import console from 'node:console';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const pageUrl = 'https://lms.ynu.ac.jp/lms/homeHoml/doIndex;SID=synthetic-session';
const studentPath = '/lms/studentCourse;SID=synthetic-session';
const samples = new URL('../../../lms-definitions/coursepower/samples/', import.meta.url);
const sample = name => readFile(new URL(`${name}.html`, samples), 'utf8');
const home = await sample('home') + '<form id="homeHomlForm"><input name="nendo" value="2098"></form>';
const list = await sample('assignment-list') + '<form id="main_form"><input name="jyugyoHiddenId" value="synthetic"></form>';
const detail = await sample('assignment-detail-open');
const studentControls = `<main id="student-controls"><a id="student-link" href="${studentPath}">授業を開く</a>
  <button type="button" id="student-onclick" onclick="location.href='${studentPath}'">画面を移る</button>
  <button type="button" id="student-count" onclick="window.replayedCount=(window.replayedCount||0)+1">数える</button>
  <form id="student-form" action="${studentPath}" method="get"><input name="query" id="student-input" value="student-input">
    <button type="submit" name="pressed" value="original" id="student-submit">送信する</button></form></main>`;
const errorHtml = '<html><body><h1>システムエラーが発生しました。</h1></body></html>';
const config = { apiOrigin: 'https://api.example.test', firebase: { projectId: 'synthetic-project' } };
async function bundle(name, plugins = []) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url))],
    bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome105', plugins,
    define: { __AUTH_PROBE_CONFIG__: JSON.stringify(config) } });
  return result.outputFiles[0].text;
}
const content = await bundle('content');
const worker = await bundle('service-worker', [{ name: 'no-external-accounts', setup(builder) {
  builder.onResolve({ filter: /auth-probe-browser\.js$/ }, () => ({ path: 'identity', namespace: 'fake' }));
  builder.onResolve({ filter: /calendar-browser\.js$/ }, () => ({ path: 'calendar', namespace: 'fake' }));
  builder.onResolve({ filter: /digest-browser\.js$/ }, () => ({ path: 'digest', namespace: 'fake' }));
  builder.onLoad({ filter: /.*/, namespace: 'fake' }, ({ path }) => ({ contents: path === 'identity'
    ? `export const observationIdentity = async () => ({ uid: 'synthetic-user', token: 'synthetic-token' });
       export const browserProbe = () => { throw new Error('interactive-auth-forbidden'); };`
    : path === 'calendar' ? `export const startCalendarSync = () => {}; export const handleCalendarMessage = () => undefined;
       export const syncCalendarInBackground = async () => {};`
      : `export const startDigest = () => {}; export const handleDigestMessage = () => undefined;` }));
} }]);

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const pageRoute of [false, true]) for (const scenario of ['complete', 'yield', 'state-error']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const state = {}, actions = [];
    let screen = 'home', release, held = false, listener, studentErrors = 0, uploads = 0;
    const lms = async (url, init = {}, student = false) => {
      const path = new URL(url).pathname.replace(/;[^/]*/g, '');
      const kind = path.includes('studentCourse') ? 'student' : path.includes('linkKyozaiTitle') ? 'detail'
        : path.includes('linkKougi') ? 'course' : path.includes('/error') ? 'error' : 'home';
      assert.equal(init.method, ['course', 'detail'].includes(kind) ? 'POST' : 'GET');
      actions.push(kind);
      let html;
      if (kind === 'student') {
        if (screen !== 'home') { studentErrors++; html = errorHtml; }
        else { screen = 'student'; html = '<h1>学生の授業</h1>'; }
      } else if (kind === 'error' || (scenario === 'state-error' && kind === 'course')
        || (kind === 'detail' && !['course', 'detail'].includes(screen))) {
        screen = 'error'; html = errorHtml;
      } else if (kind === 'home') { screen = 'home'; html = home + (student ? studentControls : ''); }
      else if (kind === 'course') { screen = 'course'; html = list; }
      else {
        screen = 'detail'; html = detail;
        if (scenario === 'yield' && !held) { held = true; await new Promise(resolve => { release = resolve; }); }
      }
      return { ok: true, status: 200, url: html === errorHtml ? 'https://lms.ynu.ac.jp/lms/error/' : url, text: async () => html };
    };
    await context.route('https://lms.ynu.ac.jp/**', async route => {
      const request = route.request();
      const reply = await lms(request.url(), { method: request.method(), body: request.postData() }, request.isNavigationRequest());
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: await reply.text() });
    });
    const chrome = { runtime: { id: 'synthetic-extension', onMessage: { addListener: fn => { listener = fn; } } }, action: {},
      storage: { session: { get: async () => globalThis.structuredClone(state), set: async values => Object.assign(state, globalThis.structuredClone(values)) } },
      tabs: { query: async () => [{ id: 7 }], sendMessage: async (_id, message) => page.evaluate(message =>
        new Promise(resolve => globalThis.contentListener(message, { id: 'synthetic-extension' }, resolve)), message) } };
    const fetcher = async (url, init) => {
      if (url.startsWith('https://lms.ynu.ac.jp/')) {
        if (pageRoute) throw new Error('background-blocked');
        return lms(url, init);
      }
      assert.equal(url, `${config.apiOrigin}/api/v1/observations`); uploads++;
      return { ok: true, json: async () => ({ status: 'applied', changed: false, changeCount: 0 }) };
    };
    runInContext(worker, createContext({ chrome, fetch: fetcher, URL, URLSearchParams,
      AbortSignal: globalThis.AbortSignal, AbortController: globalThis.AbortController, crypto: { randomUUID }, clearTimeout,
      setTimeout: (fn, ms) => { if (ms === 250) { globalThis.queueMicrotask(fn); return 0; } return setTimeout(fn, ms); } }));
    await page.exposeFunction('sendToWorker', message => new Promise(resolve => listener(message,
      { id: 'synthetic-extension', frameId: 0, url: page.url(), tab: { id: 7 }, documentId: 'synthetic-document' }, resolve)));
    await page.addInitScript(() => {
      const originalTimeout = globalThis.setTimeout;
      globalThis.setTimeout = (fn, ms, ...args) => {
        if (ms === 250) { globalThis.queueMicrotask(() => fn(...args)); return 0; }
        return originalTimeout(fn, ms, ...args);
      };
      globalThis.chrome = { runtime: { id: 'synthetic-extension',
        onMessage: { addListener: fn => { globalThis.contentListener = fn; } }, sendMessage: message => globalThis.sendToWorker(message) } };
    });
    await page.goto(pageUrl); await page.addScriptTag({ content });
    if (scenario === 'yield') {
      await assertEventually(() => held, () => ({ pageRoute, scenario, status: state.ynuFetchStatus, reads: actions.length }));
      const navigation = page.waitForURL('**/lms/studentCourse*');
      await page.locator('#student-link').click();
      assert.equal(screen, 'detail');
      release(); await navigation;
      await page.getByRole('heading', { name: '学生の授業' }).waitFor();
      await assertEventually(() => state.ynuFetchStatus === 'yielded');
      assert.equal(uploads, 0);
      assert.equal(actions.filter(kind => kind === 'detail').length, 1);
      assert.equal(state.ynuFetchStats.failed, 0);
    } else {
      await assertEventually(() => state.ynuFetchStatus === (scenario === 'complete' ? 'success' : 'lms-state'),
        () => ({ pageRoute, scenario, status: state.ynuFetchStatus, reads: actions.length, summary: state.ynuFetchSummary }));
      assert.equal(state.ynuFetchSummary.restoreSucceeded, 1);
      if (scenario === 'state-error') {
        assert.equal(actions.filter(kind => kind === 'course').length, 1);
        assert.equal(actions.filter(kind => kind === 'detail').length, 0);
        assert.equal(uploads, 0);
      } else assert.equal(uploads, 1);
      await page.locator('#student-link').click();
      await page.getByRole('heading', { name: '学生の授業' }).waitFor();
    }
    assert.equal(studentErrors, 0);
    results.push(`${scenario}, ${pageRoute ? 'page' : 'background'}: PASS`);
    console.log(results.at(-1));
    await context.close();
  }

  for (const action of ['link', 'onclick', 'submit', 'enter', 'two-clicks']) {
    const context = await browser.newContext();
    const page = await context.newPage();
    let studentRequests = 0;
    await context.route('https://lms.ynu.ac.jp/**', route => {
      const target = new URL(route.request().url());
      if (target.pathname.includes('studentCourse')) {
        studentRequests++;
        if (['submit', 'enter'].includes(action)) {
          assert.equal(target.searchParams.get('query'), 'student-input');
          assert.equal(target.searchParams.get('pressed'), 'original');
        }
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>学生の授業</h1>' });
      }
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: home + studentControls });
    });
    await page.addInitScript(() => {
      globalThis.chrome = { runtime: { id: 'synthetic-extension', onMessage: { addListener: fn => { globalThis.contentListener = fn; } },
        sendMessage: message => message.type === 'ynu-collection-yield' ? new Promise(() => {}) : Promise.resolve({ ok: true }) } };
    });
    await page.clock.install({ time: new Date('2098-11-07T00:00:00Z') });
    await page.clock.pauseAt(new Date('2098-11-07T00:00:01Z'));
    await page.goto(pageUrl); await page.addScriptTag({ content });
    await page.clock.runFor(2000);
    assert.equal(await page.evaluate(() => new Promise(resolve => globalThis.contentListener(
      { type: 'ynu-collection-claim', sid: 'synthetic-session' }, { id: 'synthetic-extension' }, resolve))).then(r => r.ok), true);
    if (action === 'link') await page.locator('#student-link').click();
    if (action === 'onclick') await page.locator('#student-onclick').click();
    if (action === 'submit') await page.evaluate(() => globalThis.document.querySelector('#student-form')
      .requestSubmit(globalThis.document.querySelector('#student-submit')));
    if (action === 'enter') {
      await page.locator('#student-input').evaluate(input => input.addEventListener('keydown', event => {
        globalThis.enterReplayCode = event.keyCode;
      }));
      await page.locator('#student-input').focus(); await page.keyboard.press('Enter');
    }
    if (action === 'two-clicks') { await page.locator('#student-count').click(); await page.locator('#student-count').click(); }
    await page.clock.runFor(14_999);
    assert.equal(studentRequests, 0);
    if (action === 'two-clicks') assert.equal(await page.evaluate(() => globalThis.replayedCount || 0), 0);
    await page.clock.runFor(1);
    if (action === 'enter') assert.equal(await page.evaluate(() => globalThis.enterReplayCode), 13);
    if (action === 'two-clicks') assert.equal(await page.evaluate(() => globalThis.replayedCount), 2);
    else { await page.getByRole('heading', { name: '学生の授業' }).waitFor(); assert.equal(studentRequests, 1); }
    results.push(`no reply, ${action}, local 15s deadline: PASS`);
    console.log(results.at(-1));
    await context.close();
  }
  console.log(`${results.length} browser scenarios passed`);
} finally { await browser.close(); }

async function assertEventually(predicate, diagnostic = () => ({})) {
  const deadline = Date.now() + 20_000;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail(`condition not reached: ${JSON.stringify(diagnostic())}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
