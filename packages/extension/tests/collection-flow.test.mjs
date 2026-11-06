import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath, URL, URLSearchParams } from 'node:url';
import { expect, it, vi } from 'vitest';
import { parseObservation } from '../../server/src/observation-input.js';

const config = { apiOrigin: 'https://api.example.test', oauthClientId: '123-synthetic.apps.googleusercontent.com',
  firebase: { apiKey: 'synthetic-key', authDomain: 'synthetic.firebaseapp.com', projectId: 'synthetic', appId: 'synthetic-app' } };
const worker = await build({
  entryPoints: [fileURLToPath(new URL('../src/service-worker.ts', import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome105',
  define: { __AUTH_PROBE_CONFIG__: JSON.stringify(config) },
  plugins: [{ name: 'fake-identity', setup(builder) {
    builder.onResolve({ filter: /auth-probe-browser\.js$/ }, () => ({ path: 'identity', namespace: 'fake' }));
    builder.onLoad({ filter: /.*/, namespace: 'fake' }, () => ({ contents: `
      export const observationIdentity = async () => ({ uid: 'synthetic-user', token: 'synthetic-id-token' });
      export const firebaseAuth = () => ({ authStateReady: async () => {}, currentUser: null });
      export const readProbeState = async () => undefined;
      export const confirmGoogleIdentity = () => { throw new Error('interactive-auth-forbidden'); };
      export const browserProbe = () => { throw new Error('interactive-auth-forbidden'); };` }));
  } }],
});
const content = await build({ entryPoints: [fileURLToPath(new URL('../src/content.ts', import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome105' });
const samples = new URL('../../../lms-definitions/coursepower/samples/', import.meta.url);
const home = await readFile(new URL('home.html', samples), 'utf8');
const materials = await readFile(new URL('assignment-list.html', samples), 'utf8');
const detail = await readFile(new URL('assignment-detail-open.html', samples), 'utf8');
const pageUrl = 'https://lms.ynu.ac.jp/lms/homeHoml/doIndex;SID=synthetic-session';

for (const backgroundBlocked of [false, true]) it(`opening an LMS page reads all courses and sends one observation (background blocked: ${backgroundBlocked})`, async () => {
  const state = {};
  const apiBodies = [], backgroundCalls = [], pageCalls = [];
  let workerListener, contentListener, trigger;
  // Existing sample data stays untouched. The fake server adds synthetic forms and
  // accessible links for the three closed rows to exercise the complete-list path.
  const lmsFetch = (calls) => vi.fn(async (url, init) => {
    calls.push({ url, init });
    const fields = new URLSearchParams(String(init.body ?? ''));
    const list = materials.replace(/(<td class="kyozaititleCell" id="(REP\d+)">)([\s\S]*?)(<\/td>)/g,
      (whole, open, id, inner, close) => inner.includes('onclick=') ? whole
        : `${open}${inner}<a onclick="kyozaiTitleLink('${id}','02')"></a>${close}`);
    const html = url.includes('linkKougi') ? list + '<form name="corsCollActionForm"><input name="jyugyoHiddenId" value="synthetic-folder"></form>'
      : url.includes('linkKyozaiTitle') ? detail.replaceAll('架空課題04', `架空課題${fields.get('kyozaiId')}`)
        : home + '<form name="homeHomlActionForm"><input name="kougiId"><input name="nendo" value="2098"></form>';
    return { ok: true, status: 200, url, text: async () => html };
  });
  const backgroundFetch = lmsFetch(backgroundCalls), pageFetch = lmsFetch(pageCalls);
  const fetcher = vi.fn(async (url, init) => {
    if (url.startsWith('https://lms.ynu.ac.jp/')) {
      if (backgroundBlocked) throw new Error('synthetic-background-block');
      return backgroundFetch(url, init);
    }
    expect(url).toBe('https://api.example.test/api/v1/observations');
    expect(init.headers.Authorization).toBe('Bearer synthetic-id-token');
    expect(init.credentials).toBe('omit');
    apiBodies.push(parseObservation(JSON.parse(init.body)));
    return { ok: true, json: async () => ({ status: 'applied', changed: true, changeCount: 198 }) };
  });
  const common = { URL, URLSearchParams, AbortSignal: globalThis.AbortSignal, crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000001' },
    setTimeout: (fn) => { globalThis.queueMicrotask(fn); return 0; }, console: { warn: vi.fn() } };
  const call = (listener, message, sender) => new Promise(resolve => listener(message, sender, resolve));
  const workerContext = createContext({ ...common, fetch: fetcher, chrome: {
    runtime: { id: 'synthetic-extension', onStartup: { addListener: vi.fn() }, onMessage: { addListener: fn => { workerListener = fn; } } },
    storage: { session: { set: async values => Object.assign(state, globalThis.structuredClone(values)), get: async () => globalThis.structuredClone(state) } },
    tabs: { sendMessage: async (tabId, message, target) => {
      expect(tabId).toBe(7); expect(target).toEqual({ frameId: 0, documentId: 'synthetic-document' });
      return call(contentListener, message, { id: 'synthetic-extension' });
    } },
  } }, { codeGeneration: { strings: false, wasm: false } });
  const contentContext = createContext({ ...common, fetch: pageFetch, window: { location: { href: pageUrl } }, chrome: {
    runtime: { id: 'synthetic-extension', onMessage: { addListener: fn => { contentListener = fn; } },
      sendMessage: message => {
        trigger = call(workerListener, message, { id: 'synthetic-extension', frameId: 0, url: pageUrl, tab: { id: 7 }, documentId: 'synthetic-document' });
        return trigger;
      } },
  } }, { codeGeneration: { strings: false, wasm: false } });
  runInContext(worker.outputFiles[0].text, workerContext);
  runInContext(content.outputFiles[0].text, contentContext);
  expect(await trigger).toEqual({ ok: true });
  expect(apiBodies).toHaveLength(1);
  const observation = apiBodies[0];
  expect(observation.catalogCourses).toHaveLength(22);
  expect(observation.courseResults).toHaveLength(22);
  expect(observation.assignments).toHaveLength(198);
  expect(observation.courseResults.every(c => c.listComplete && c.seenSourceIds.length === 9)).toBe(true);
  expect(observation.failures).toEqual([]);
  const calls = backgroundBlocked ? pageCalls : backgroundCalls;
  expect(calls.filter(c => c.url.includes('linkKougi'))).toHaveLength(22);
  expect(calls.filter(c => c.url.includes('linkKyozaiTitle'))).toHaveLength(198);
  expect(backgroundBlocked ? backgroundCalls : pageCalls).toEqual([]);
  expect(JSON.stringify([observation, state.ynuFetchStats, state.ynuFetchStatus])).not.toMatch(/synthetic-session|synthetic-id-token|SID=|Cookie/i);
  expect(state.ynuFetchStats).toEqual({ attempted: 1, backgroundSucceeded: backgroundBlocked ? 0 : 1, pageSucceeded: backgroundBlocked ? 1 : 0, failed: 0 });
  const count = pageCalls.length;
  expect(await call(contentListener, { type: 'ynu-read-page', operation: { kind: 'home' }, sid: 'synthetic-session' }, { id: 'other-extension' })).toEqual({ ok: false });
  expect(await call(contentListener, { type: 'ynu-read-page', operation: { kind: 'home' }, sid: 'other-session' }, { id: 'synthetic-extension' })).toEqual({ ok: false });
  expect(pageCalls).toHaveLength(count);
});
