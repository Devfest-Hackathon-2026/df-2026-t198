import assert from 'node:assert/strict';
import process from 'node:process';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { studentFitFixture } from '../src/shared/testing/student-fit-fixture.ts';
import { studentFixture } from '../src/shared/testing/student-fixture.ts';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.KADAI_WEB_ORIGIN ?? '')) throw new Error('local-emulators-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'student-fit'); const db = getFirestore(app);
const browser = await chromium.launch({ headless: true });
const base = process.env.KADAI_WEB_ORIGIN;
const phase = process.env.STUDENT_FIT_PHASE === 'before' ? 'before' : 'after';
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || 'docs/records/2026-11-09-issue-249';
const results = []; const browserErrors = [];
try {
  await mkdir(evidence, { recursive: true });
  for (const width of [1280, 390]) {
    const height = width === 1280 ? 800 : 844;
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', () => browserErrors.push('browser-error'));
    await page.goto(`${base}/demo-lms`);
    await page.locator('.demo-shell').waitFor();
    await page.getByRole('heading', { name: 'ToDokuを試す' }).waitFor();
    if (phase === 'after') {
      const judge = page.locator('.demo-judge-login');
      await judge.waitFor(); assert.equal(await judge.getAttribute('open'), null);
      assert.equal(await page.getByLabel('メールアドレス').isVisible(), false);
      await page.getByText('この版では体験版のボタンを出していません。', { exact: false }).waitFor();
      await judge.locator('summary').click();
      await page.getByLabel('メールアドレス').waitFor();
      await judge.locator('summary').click();
    } else await page.getByLabel('メールアドレス').waitFor();
    await page.screenshot({ path: `${evidence}/${phase}-demo-lms-${width}.png`, animations: 'disabled' });
    await page.goto(`${base}/student`);
    await page.getByRole('button', { name: 'Googleでログイン' }).waitFor();
    const uid = await page.evaluate(async () => {
      const { firebase } = await import('/src/shared/firebase.ts');
      const source = await (await globalThis.fetch('/src/shared/firebase.ts')).text();
      const sdk = await import(source.match(/from "([^"]*firebase_auth[^"]*)"/)[1]);
      return (await sdk.signInAnonymously(firebase.auth)).user.uid;
    });
    const student = db.collection('students').doc(uid);
    for (const extended of [false, true]) {
      const data = studentFitFixture(studentFixture(), extended); const batch = db.batch();
      data.courses.forEach((course, index) => batch.set(student.collection('courses').doc(`c${index}`), course));
      data.assignments.forEach((row, index) => batch.set(student.collection('assignments').doc(`a${index}`), row));
      await batch.commit();
      if (width === 390) await page.getByRole('tab', { name: '時間割', exact: true }).click();
      await page.locator('.course-cell').filter({ hasText: data.courses.at(-1).name }).first().waitFor();
      const table = page.locator('.timetable');
      const metrics = await table.evaluate(element => {
        const box = element.getBoundingClientRect(); const frame = element.parentElement;
        return { top: box.top, bottom: box.bottom, tableWidth: box.width,
          rowHeights: [...element.tBodies[0].rows].map(row => row.getBoundingClientRect().height),
          fits: box.left >= 0 && box.right <= globalThis.innerWidth && box.top >= 0 && box.bottom <= globalThis.innerHeight,
          scrolls: frame.scrollWidth > frame.clientWidth + 1 || frame.scrollHeight > frame.clientHeight + 1 };
      });
      results.push({ width, extended, ...metrics });
      await page.screenshot({ path: `${evidence}/${phase}-student-${extended ? 'extended' : 'weekday'}-${width}.png`, animations: 'disabled' });
      if (phase === 'after') {
        assert.equal(metrics.fits, true, 'the whole timetable is visible without scrolling');
        assert.equal(metrics.scrolls, false);
        assert.ok(Math.max(...metrics.rowHeights) - Math.min(...metrics.rowHeights) < 1, 'period rows have equal height');
        for (const course of data.courses) {
          const cell = page.getByRole('button', { name: course.name, exact: true }).first();
          assert.equal(await cell.getAttribute('title'), course.name);
          assert.ok(await cell.getAttribute('data-course-color'));
          const layout = await cell.locator('strong').evaluate(element => ({
            height: element.getBoundingClientRect().height, line: Number.parseFloat(globalThis.getComputedStyle(element).lineHeight),
          }));
          assert.ok(layout.height <= layout.line * 2 + 1, 'course names take at most two lines');
        }
        const first = page.getByRole('button', { name: data.courses[0].name, exact: true });
        assert.equal(await first.locator('.course-deadline').count(), 1);
        assert.equal(await first.locator('.course-deadline').innerText(), '11/10 · 2件');
        await first.click();
        const panel = page.getByRole('complementary', { name: `${data.courses[0].name}の課題` });
        await panel.getByRole('heading', { name: '架空の星の記録', exact: true }).waitFor();
        await panel.getByRole('button', { name: '閉じる' }).click();
        await page.evaluate(() => globalThis.scrollTo(0, 0));
      }
    }
    if (phase === 'after') {
      await student.collection('fetchStates').doc('demo-lms').set({ ...studentFixture().fetchStates[0], studentId: uid });
      await page.getByText('から更新がありません。', { exact: false }).waitFor();
      await page.waitForFunction(() => globalThis.document.querySelector('.timetable').getBoundingClientRect().bottom <= globalThis.innerHeight);
      await student.collection('fetchStates').doc('demo-lms').delete();
      const nav = page.getByRole('navigation', { name: '画面', exact: true });
      const own = page.getByRole('link', { name: '自分の面談日時を見る・変える', exact: true });
      assert.equal(await nav.getByRole('link', { name: '面談', exact: true }).count(), 0);
      assert.equal(await own.count(), 0);
      const grant = student.collection('supporters').doc('fictional-supporter');
      await grant.set({ scopes: ['all'], revokedAt: null });
      await nav.getByRole('link', { name: '面談', exact: true }).waitFor(); await own.waitFor();
      await grant.update({ revokedAt: '2026-11-09T00:00:00Z' });
      await own.waitFor({ state: 'detached' }); await nav.getByRole('link', { name: '面談', exact: true }).waitFor({ state: 'detached' });
      await db.doc(`demoAccounts/${uid}`).set({ role: 'student', studentId: uid });
      await own.waitFor();
      await db.doc(`demoAccounts/${uid}`).delete(); await own.waitFor({ state: 'detached' });
      await db.doc(`demoAccounts/${uid}`).set({ role: 'supporter', studentId: 'fictional-student' });
      await nav.getByRole('link', { name: '面談', exact: true }).waitFor();
      assert.equal(await own.count(), 0);
      await db.doc(`demoAccounts/${uid}`).delete();
      await db.doc(`students/fictional-student/supporters/${uid}`).set({ scopes: ['all'], revokedAt: null });
      await page.reload(); await nav.getByRole('link', { name: '面談', exact: true }).waitFor();
      assert.equal(await own.count(), 0);
      await db.doc(`students/fictional-student/supporters/${uid}`).delete();
      await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
      await nav.getByRole('link', { name: '面談', exact: true }).waitFor({ state: 'detached' });
    }
    await db.recursiveDelete(student); await context.close();
  }
  assert.deepEqual(browserErrors, []);
  await writeFile(`${evidence}/${phase}.json`, JSON.stringify({ results, browserErrors }, null, 2) + '\n');
  process.stdout.write(`${phase}: ${results.length} timetable measurements; browser errors ${browserErrors.length}\n`);
  if (phase === 'before') assert.ok(results.every(result => result.fits && !result.scrolls && Math.max(...result.rowHeights) - Math.min(...result.rowHeights) < 1), 'RED: timetable does not fit or has unequal rows');
} finally { await browser.close(); await db.terminate(); await deleteApp(app); }
