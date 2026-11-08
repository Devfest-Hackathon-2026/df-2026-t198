import assert from 'node:assert/strict';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { log } from 'node:console';
import { build } from 'esbuild';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL('../src/kulasis-content.ts', import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'iife', target: 'chrome102' });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const unexpected = [];
  const course = no => `<a href="/student/${no === 1 ? 'la' : 'other'}/support/top?no=fictional-${no}">架空の授業${no}</a><div></div></div>`;
  const timetable = `<div><div><table><tr><td colspan="3">架空の案内</td></tr><tr><td colspan="3"></td></tr>
    <tr><td colspan="3">架空の学期</td></tr><tr><td></td><td>1</td><td>2</td></tr>
    <tr><td>月</td><td>${course(1)}</td><td></td></tr><tr><td>火</td><td></td><td>${course(2)}</td></tr></table></div></div>
    <script>globalThis.fixtureExecuted = true</script><img src="https://example.invalid/image" onerror="globalThis.fixtureExecuted=true">
    <iframe src="https://example.invalid/frame"></iframe><link rel="stylesheet" href="https://example.invalid/style">`;
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const known = url.origin === 'https://k.kyoto-u.ac.jp' &&
      ['/student/la/top', '/student/la/entry/kouki', '/student/la/support/top', '/student/other/support/top'].includes(url.pathname);
    if (!known) { unexpected.push(url.origin); await route.abort(); return; }
    const body = url.pathname.endsWith('/entry/kouki') ? timetable : '<html><body></body></html>';
    const bytes = Buffer.from(Array.from(body, char => char.codePointAt(0) > 127 ? `&#${char.codePointAt(0)};` : char).join(''), 'ascii');
    await route.fulfill({ status: 200, contentType: 'text/html; charset=windows-31j', body: bytes });
  });
  await page.addInitScript(() => {
    let listener, requested = false;
    globalThis.chrome = { runtime: { id: 'fictional-extension', onMessage: { addListener: fn => { listener = fn; } },
      sendMessage: async message => {
        if (message.type === 'kulasis-page-ready' && !requested) {
          requested = true;
          globalThis.setTimeout(() => listener({ type: 'kulasis-collect', observationId: 'fictional-browser', fetchedAt: '2030-11-08T00:00:00Z' },
            { id: 'fictional-extension' }, reply => { globalThis.collectionReply = reply; }), 0);
        }
        return { ok: true };
      } } };
  });
  await page.goto('https://k.kyoto-u.ac.jp/student/la/top');
  await page.addScriptTag({ content: outputFiles[0].text });
  await page.waitForFunction(() => globalThis.collectionReply, null, { timeout: 10_000 });
  const reply = await page.evaluate(() => ({ reply: globalThis.collectionReply, executed: !!globalThis.fixtureExecuted }));
  assert.equal(reply.reply.ok, true);
  assert.deepEqual(reply.reply.observation.failures, []);
  assert.deepEqual(reply.reply.observation.catalogCourses.map(course => ({ id: course.courseId, slots: course.slots })), [
    { id: 'fictional-1', slots: [{ weekday: 1, period: 1 }] }, { id: 'fictional-2', slots: [{ weekday: 2, period: 2 }] },
  ]);
  assert.equal(reply.executed, false);
  assert.deepEqual(unexpected, []);
  log(JSON.stringify({ courses: 2, slotsMatched: 2, executedScripts: 0, unexpectedRequests: 0 }));
} finally { await browser.close(); }
