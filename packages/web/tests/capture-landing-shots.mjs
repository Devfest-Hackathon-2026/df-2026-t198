import { openJudgeLogin } from './helpers/judge-login.mjs';
import assert from 'node:assert/strict';
import process from 'node:process';
import { log } from 'node:console';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { initialDemo } from '../../server/src/demo/initial.ts';

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
const options = { viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 1,
  locale: 'ja-JP', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' };
const studentContext = await browser.newContext(options);
const supporterContext = await browser.newContext(options);
const demo = await studentContext.newPage();
const student = await studentContext.newPage();
const session = await supporterContext.newPage();
// Keep the client after this day's real server history, without changing stored change records.
const fixedTime = '2026-11-09T23:50:00+09:00';
assert(Date.now() < Date.parse(fixedTime), 'capture clock must be later than server history; choose a new fictional capture day');
const output = new URL('../public/landing/', import.meta.url);
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i189-evidence';
const errors = [];
const shots = [];
const courses = ['文章表現', '生物学実験', '線形代数',
  '経済学入門', '社会調査法', '統計学入門'];
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
  await openJudgeLogin(page);
  await page.getByLabel('メールアドレス').fill(`trial-${role}@example.invalid`);
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await (role === 'student' ? page.getByRole('button', { name: 'LMSを開く', exact: true })
    : page.getByRole('link', { name: '面談を開く', exact: true })).waitFor();
  await page.evaluate(() => globalThis.document.fonts.ready);
}
async function capture(page, name, anchor, target) {
  await page.evaluate(() => globalThis.document.fonts.ready);
  await anchor.scrollIntoViewIfNeeded();
  let box = await anchor.boundingBox();
  if (name === 'session') {
    const heading = await page.locator('.session-heading').boundingBox();
    const primary = await page.locator('.session-primary').boundingBox();
    box = { x: box.x, y: heading.y, width: box.width, height: primary.y + primary.height - heading.y };
  }
  if (target) {
    const targetBox = await target.boundingBox();
    assert(targetBox.x >= box.x && targetBox.x + targetBox.width <= box.x + box.width &&
      targetBox.y >= box.y && targetBox.y + targetBox.height <= box.y + box.height, `${name}: highlighted deadline fits`);
  }
  // Annotation exists only in the capture page; application styles stay untouched.
  if (target) await target.evaluate(node => {
    node.style.outline = '3px solid var(--change-text)';
    node.style.outlineOffset = '3px';
  });
  const screenshot = { path: new URL(`${name}.png`, output).pathname, animations: 'disabled' };
  const buffer = name === 'session' ? await page.screenshot({ ...screenshot, clip: box }) : await anchor.screenshot(screenshot);
  shots.push({ name, viewport: page.viewportSize(), width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20),
    ...(target ? { highlighted: await target.innerText() } : {}), sha256: createHash('sha256').update(buffer).digest('hex') });
  if (target) await target.evaluate(node => { node.style.removeProperty('outline'); node.style.removeProperty('outline-offset'); });
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
  const home = demo.getByRole('region', { name: '体験用LMSの授業一覧', exact: true });
  assert.deepEqual(await home.locator('.demo-course h2').allTextContents(), courses);
  // Check all six courses without replacing the unused standalone LMS asset.
  const lmsBody = demo.locator('[data-demo-pane="lms"] .demo-pane-body');
  // Expand only this capture page's scrollbox so the asset includes all six courses.
  await lmsBody.evaluate(node => { node.style.height = 'auto'; node.style.overflow = 'visible'; });
  assert.equal(await lmsBody.evaluate(node => node.scrollHeight <= node.clientHeight), true);
  await lmsBody.evaluate(node => { node.style.removeProperty('height'); node.style.removeProperty('overflow'); });
  // The original starts just above the home panel, leaving its 36px top margin.
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
  await login(session, 'supporter');
  await session.getByRole('link', { name: '面談を開く', exact: true }).click();
  await session.getByRole('link', { name: '田中 太郎', exact: true }).click();
  await session.getByRole('heading', { name: '田中 太郎', exact: true }).waitFor();
  await session.evaluate(() => globalThis.document.fonts.ready);
  await demo.getByRole('button', { name: '「第3回レポート（要約と引用）」の締切を1日延ばす', exact: true }).click();
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
  const course = student.locator('.course-cell').filter({ hasText: courses[0] });
  await course.locator('.deadline').filter({ hasText: '11/13 17:00' }).waitFor();
  await student.getByRole('button', { name: '閉じる', exact: true }).click();
  assert.equal(await table.evaluate(node => node.scrollWidth <= node.clientWidth), true, 'all weekdays fit the captured timetable');
  await capture(student, 'student', table, course);
  const changes = session.getByRole('region', { name: '前回の面談からの変化', exact: true });
  await changes.getByText('締切が 11/12 17:00 から 11/13 17:00 に変わりました', { exact: false }).waitFor();
  await session.getByRole('region', { name: '次の面談までの締切', exact: true })
    .getByText('第3回レポート（要約と引用）', { exact: true }).waitFor();
  const changedRow = session.locator('.td-table tbody tr').filter({ hasText: '第3回レポート（要約と引用）' });
  await changedRow.getByText('11/13 17:00', { exact: false }).waitFor();
  await session.getByRole('link', { name: /① 確かめる/ }).waitFor();
  await session.getByRole('link', { name: /② 相談する/ }).waitFor();
  // Include the current two-view navigation and the deadline table in the asset.
  await capture(session, 'session', session.locator('.session-page'), changedRow);
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/capture-results.json`, JSON.stringify({ status: 'pass', fixedTime,
    viewport: options.viewport, serverClock: 'real; history timestamps may differ', shots, browserErrors: errors }, null, 2));
  log('PASS landing capture: current student/session assets, same highlighted changed deadline, six courses and two-view navigation.');
} finally {
  await browser.close();
  await db.terminate();
  await deleteApp(app);
}
