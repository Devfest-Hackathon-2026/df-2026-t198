import assert from 'node:assert/strict';
import process from 'node:process';
import { log } from 'node:console';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { initialDemo } from '../../server/src/demo-initial.ts';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-demo-required');
const base = process.env.KADAI_WEB_ORIGIN;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base ?? '')) throw new Error('local-web-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'capture-landing-shots');
const db = getFirestore(app);
const browser = await chromium.launch({ headless: true });
const options = { viewport: { width: 1184, height: 1100 }, deviceScaleFactor: 1,
  locale: 'ja-JP', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' };
const studentContext = await browser.newContext(options);
const supporterContext = await browser.newContext(options);
const demo = await studentContext.newPage();
const student = await studentContext.newPage();
const session = await supporterContext.newPage();
const fixedTime = '2026-11-09T08:40:00+09:00';
const output = new URL('../public/landing/', import.meta.url);
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i189-evidence';
const errors = [];
const shots = [];
const courses = ['レポートの書き方の書き方', 'キャンパス植物図鑑演習', 'Re:線形代数',
  '学食経済学', '自転車置き場の社会学', '90分の数理'];
for (const context of [studentContext, supporterContext]) {
  // Permit only the local fixture and the app's existing public font assets.
  await context.route('**/*', route => ['127.0.0.1', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(new URL(route.request().url()).hostname)
    ? route.continue() : route.abort());
}
for (const page of [demo, student, session]) {
  page.setDefaultTimeout(15000);
  page.on('pageerror', () => errors.push('browser-error'));
  await page.clock.setFixedTime(new Date(fixedTime));
}
async function login(page, role) {
  await page.goto(`${base}/demo-lms`);
  await page.getByLabel('メールアドレス').fill(`trial-${role}@example.invalid`);
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await (role === 'student' ? page.getByRole('button', { name: 'LMSを開く', exact: true })
    : page.getByRole('link', { name: '面談を開く', exact: true })).waitFor();
  await page.evaluate(() => globalThis.document.fonts.ready);
}
async function capture(page, name, anchor, width, height, required = [], topOffset = 0) {
  const loadedFonts = await page.evaluate(async () => {
    await globalThis.document.fonts.ready;
    return [...new Set([...globalThis.document.fonts].filter(face => face.status === 'loaded')
      .map(face => face.family.replaceAll('"', '')))];
  });
  assert(loadedFonts.includes('BIZ UDPGothic'), `${name}: Japanese font loaded`);
  assert(loadedFonts.includes('Space Grotesk'), `${name}: Latin font loaded`);
  assert.equal(await page.locator('body').evaluate(node => globalThis.getComputedStyle(node).backgroundColor), 'rgb(243, 240, 232)');
  await anchor.scrollIntoViewIfNeeded();
  const box = await anchor.boundingBox();
  const scrollY = await page.evaluate(() => globalThis.scrollY);
  const clip = { x: Math.round(box.x), y: Math.round(box.y + scrollY + topOffset), width, height };
  for (const target of required) {
    const bounds = await target.evaluate(node => {
      const range = globalThis.document.createRange();
      range.selectNodeContents(node);
      const { x, y, width, height } = range.getBoundingClientRect();
      return { x, y, width, height };
    });
    assert(bounds.x >= clip.x && bounds.x + bounds.width <= clip.x + width &&
      bounds.y + scrollY >= clip.y && bounds.y + scrollY + bounds.height <= clip.y + height,
    `${name}: required content fits the crop`);
  }
  const buffer = await page.screenshot({ path: new URL(`${name}.png`, output).pathname,
    clip, animations: 'disabled', fullPage: true });
  assert.equal(buffer.readUInt32BE(16), width, `${name} width`);
  assert.equal(buffer.readUInt32BE(20), height, `${name} height`);
  shots.push({ name, width, height, clip, loadedFonts, sha256: createHash('sha256').update(buffer).digest('hex') });
}
try {
  await mkdir(evidence, { recursive: true });
  // Reuse the standard fictional source, with dates matching the browser clock.
  // Clear only this emulator fixture so repeat runs start before the observation.
  const fixture = initialDemo(Date.parse(fixedTime));
  const owner = db.doc('students/trial-student');
  await db.recursiveDelete(owner);
  await owner.collection('demo').doc('current').set(fixture.data);
  await owner.collection('sessionContext').doc('current').set(fixture.context);
  await owner.collection('supporters').doc('trial-supporter').set({ scopes: ['all'], revokedAt: null });
  await login(demo, 'student');
  await demo.getByText('今日の準備や次に提出する課題、近い締切がない日は、メールを送りません。', { exact: true }).waitFor();
  const home = demo.getByRole('region', { name: '体験用LMSの授業一覧', exact: true });
  assert.deepEqual(await home.locator('.demo-course h2').allTextContents(), courses);
  // The original starts just above the home panel, leaving its 36px top margin.
  await capture(demo, 'lms', home, 868, 535, await home.locator('.demo-course').all(), -36);
  await demo.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await demo.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  await student.goto(`${base}/student`);
  await student.locator('.course-cell').filter({ hasText: courses[0] }).click();
  await student.locator('.course-panel').waitFor();
  await student.evaluate(() => globalThis.document.fonts.ready);
  assert.deepEqual((await student.locator('.course-cell strong').allTextContents()).sort(), [...courses].sort());
  assert.equal(await student.locator('.timetable [data-weekday="7"]').count(), 0);
  assert.equal(await student.locator('.changed, .previous-deadline').count(), 0);
  const table = student.locator('.timetable-scroll');
  assert.equal(await table.evaluate(node => node.scrollWidth <= node.clientWidth), true, 'all weekdays fit');
  await capture(student, 'student', table, 884, 635, await student.locator('.course-cell').all());
  await login(session, 'supporter');
  await session.getByRole('link', { name: '面談を開く', exact: true }).click();
  await session.getByRole('link', { name: '田中 太郎', exact: true }).click();
  await session.getByRole('heading', { name: '田中 太郎', exact: true }).waitFor();
  await session.evaluate(() => globalThis.document.fonts.ready);
  await demo.getByRole('button', { name: '「書き方を書くレポート」の締切を1日延ばす', exact: true }).click();
  await demo.getByRole('status').filter({ hasText: 'LMSの締切を1日延ばしました' }).waitFor();
  // The teacher changes the source first; the student still shows the old date.
  assert.equal(await student.locator('.previous-deadline').count(), 0);
  assert.match(await student.locator('.course-panel .deadline').first().innerText(), /11\/12 17:00/);
  await demo.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  const changed = student.locator('.course-panel .deadline.changed');
  await changed.waitFor();
  const previous = student.locator('.course-panel .previous-deadline');
  await previous.waitFor();
  assert.match(await changed.innerText(), /11\/13 17:00/);
  assert.match(await previous.innerText(), /11\/12 17:00/);
  assert.equal(await changed.evaluate(node => globalThis.getComputedStyle(node).color), 'rgb(196, 58, 38)');
  assert.match(await previous.evaluate(node => globalThis.getComputedStyle(node).textDecorationLine), /line-through/);
  await capture(student, 'updated', table, 884, 635, [previous]);
  const changes = session.getByRole('region', { name: '前回の面談からの変化', exact: true });
  await changes.getByText('締切が 11/12 17:00 から 11/13 17:00 に変わりました', { exact: false }).waitFor();
  await session.getByRole('region', { name: '次の面談までの締切', exact: true })
    .getByText('書き方を書くレポート', { exact: true }).waitFor();
  await capture(session, 'session', session.locator('.session-page'), 1072, 1005);
  const landing = await readFile(new URL('../src/landing.tsx', import.meta.url), 'utf8');
  for (const { name, width, height } of shots) {
    assert(landing.includes(`src="/landing/${name}.png"`));
    assert(landing.includes(`width="${width}" height="${height}"`));
  }
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/capture-results.json`, JSON.stringify({ status: 'pass', fixedTime,
    viewport: options.viewport, serverClock: 'real; history timestamps may differ', shots, browserErrors: errors }, null, 2));
  log('PASS landing capture: four fictional screens, original dimensions, six courses, weekday columns, red change and struck previous deadline, session history.');
} finally {
  await browser.close();
  await db.terminate();
  await deleteApp(app);
}
