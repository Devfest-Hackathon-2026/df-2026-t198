import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { log } from 'node:console';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { documentKey } from '../../server/dist/observations/store.js';
if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.KADAI_WEB_ORIGIN ?? '') || !process.env.SESSION_DEMO_PASSWORD) throw new Error('local-session-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'session-redesign');
const db = getFirestore(app); const browser = await chromium.launch();
const before = process.argv.includes('--capture-before');
const dir = process.env.ARTIFACT_EVIDENCE_DIR || 'docs/records/2026-11-09-issue-252';
const extraScreenshots = [];
const now = new Date('2026-11-09T08:00:00Z'); const observations = []; const errors = [];
try {
  await mkdir(dir, { recursive: true });
  const ref = db.doc('students/demo-student-a');
  await ref.collection('sessionContext').doc('current').set({ lastSessionAt: '2026-11-02T06:00:00Z', nextSessionAt: '2026-11-16T06:00:00Z' });
  const template = (await ref.collection('assignments').get()).docs[0].data();
  await db.recursiveDelete(ref.collection('assignments')); await db.recursiveDelete(ref.collection('changes'));
  await db.recursiveDelete(ref.collection('courses')); await db.recursiveDelete(ref.collection('fetchStates'));
  const courses = ['情報科学入門', '基礎統計', '英語コミュニケーション'];
  for (const [index, name] of courses.entries()) {
    await ref.collection('courses').doc(`redesign-${index}`).set({ system: 'demo-lms', courseId: `course-${index}`, name, slots: [{ weekday: index + 1, period: 2 }] });
    const deadline = { kind: 'date', date: `2026-11-${10 + index * 2}`, dueText: '架空の日付', timeZone: 'Asia/Tokyo' };
    await ref.collection('assignments').doc(documentKey('demo-lms', `task-${index}`)).set({ ...template, key: { system: 'demo-lms', sourceId: `task-${index}` },
      latest: { ...template.latest, title: ['第3回 レポート', '演習シート', '発表の原稿'][index], courseId: `course-${index}`, deadline },
      officialDeadline: { ...template.officialDeadline, deadline }, reviewReasons: index === 1 ? template.reviewReasons : [], submission: 'not-submitted' });
  }
  await ref.collection('changes').doc('changed').set({ changeId: 'changed', assignmentKey: { system: 'demo-lms', sourceId: 'task-0' }, kind: 'deadline-changed',
    before: { kind: 'date', date: '2026-11-09', dueText: '架空の日付', timeZone: 'Asia/Tokyo' }, after: { kind: 'date', date: '2026-11-10', dueText: '架空の日付', timeZone: 'Asia/Tokyo' }, recordedAt: '2026-11-09T07:00:00Z', observationId: 'fictional' });
  await ref.collection('changes').doc('submitted').set({ changeId: 'submitted', assignmentKey: { system: 'demo-lms', sourceId: 'other-task' }, kind: 'submitted',
    before: 'not-submitted', after: 'submitted', recordedAt: '2026-11-09T06:00:00Z', observationId: 'fictional' });
  await ref.collection('fetchStates').doc('demo-lms').set({ studentId: 'demo-student-a', system: 'demo-lms', lastSucceededAt: now.toISOString(),
    lastAttemptedAt: now.toISOString(), lastResult: 'success', lastFailureKind: null, lastAppliedObservationId: 'fictional' });
  for (const role of ['supporter', 'student-a']) {
    const context = await browser.newContext(); const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', () => errors.push('browser-error')); await page.clock.setFixedTime(now);
    await page.goto(`${process.env.KADAI_WEB_ORIGIN}/session`);
    if (!before && role === 'supporter') for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      const name = `after-login-${width}.png`; await page.screenshot({ path: `${dir}/${name}`, fullPage: true }); extraScreenshots.push(name);
    }
    await page.getByLabel('メールアドレス').fill(`demo-${role}@example.invalid`); await page.getByLabel('パスワード').fill(process.env.SESSION_DEMO_PASSWORD);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    await page.getByRole('button', { name: 'ログアウト', exact: true }).waitFor();
    if (!before && role === 'supporter') for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      await page.locator('.rd-student-facts').first().waitFor();
      const name = `after-students-${width}.png`; await page.screenshot({ path: `${dir}/${name}`, fullPage: true }); extraScreenshots.push(name);
    }
    await page.goto(`${process.env.KADAI_WEB_ORIGIN}/session/demo-student-a`);
    await page.getByRole('heading', { name: '次の面談までの締切', exact: true }).waitFor();
    for (const width of [1280, 390]) for (const planning of [false, true]) {
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
      await page.goto(`${process.env.KADAI_WEB_ORIGIN}/session/demo-student-a${planning ? '/plan' : ''}`);
      await page.locator(planning ? '.session-timetable' : '.session-task-workspace').waitFor();
      if (!before && planning) await page.locator('.session-topic select').selectOption(JSON.stringify({ system: 'demo-lms', sourceId: 'task-2' }));
      await page.evaluate(() => globalThis.document.fonts.ready); await page.waitForTimeout(1100);
      assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
      if (!before) {
        assert.equal(await page.locator('.session-heading [aria-label="情報の取得時点"]').count(), 1);
        assert.equal(await page.locator('.rd-session-plan-fact h2').innerText(), '準備の予定');
        assert.equal(await page.locator('.rd-key').count(), 1);
        const today = page.locator('.session-timetable th.rd-is-today');
        if (planning) {
          assert.match(await today.innerText(), /今日/);
          await page.locator('.rd-plan-legend').waitFor();
          const buttonColors = await page.locator('.session-candidate button').first().evaluate(node => ({ background: globalThis.getComputedStyle(node).backgroundColor }));
          assert.equal(buttonColors.background, 'rgb(36, 86, 176)');
        } else {
          assert.equal(await page.locator('.session-next').evaluate(node => globalThis.getComputedStyle(node).backgroundColor), 'rgb(36, 86, 176)');
          assert.equal(await page.locator('.rd-deadline-day').count(), 3);
          assert.equal(await page.locator('.rd-previous-deadline').first().evaluate(node => globalThis.getComputedStyle(node).textDecorationLine), 'line-through');
        }
        await page.locator('.session-editor summary').click();
        assert.equal(await page.getByRole('button', { name: '面談日時を保存', exact: true }).evaluate(node => globalThis.getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
        await page.locator('.session-editor summary').click();
        const active = page.locator('.session-steps [aria-current="page"]');
        assert.match(await active.innerText(), planning ? /相談する/ : /確かめる/);
        assert.equal(await page.locator('.session-meta > section').count(), 3);
        const cards = await page.locator('.session-meta > section').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width }; }));
        assert.equal(width === 1280 ? Math.round(cards[0].y) === Math.round(cards[2].y) : cards[0].y < cards[1].y && cards[1].y < cards[2].y, true);
        if (!planning) {
          const main = await page.locator('[aria-labelledby="session-deadlines"]').boundingBox(); const side = await page.locator('.session-supplement').boundingBox();
          assert.ok(width === 1280 ? main.x < side.x && main.width > side.width : main.y < side.y);
          assert.equal(await page.locator('.td-table tbody tr').count(), 3);
          assert.equal(new Set(await page.locator('.td-table tbody tr').evaluateAll(rows => rows.map(row => globalThis.getComputedStyle(row).getPropertyValue('--course-band')))).size, 3);
          await page.getByText('あと1日', { exact: true }).waitFor(); await page.locator('.session-status-changed').waitFor();
          await page.locator('.session-status-review').waitFor(); await page.locator('.session-status-done').waitFor();
        }
        if (width === 390) { await page.locator('.session-steps').scrollIntoViewIfNeeded(); assert.equal(await page.locator('.session-steps a').count(), 2); }
      }
      await page.evaluate(() => globalThis.window.scrollTo(0, 0));
      const name = `${before ? 'before' : 'after'}-${role}-${planning ? 'plan' : 'check'}-${width}.png`;
      await page.screenshot({ path: `${dir}/${name}`, fullPage: true });
      observations.push({ role, planning, width, screenshot: name, status: 'pass' });
    }
    if (!before && role === 'supporter') {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`${process.env.KADAI_WEB_ORIGIN}/session/demo-student-a/plan`);
      await page.locator('.session-topic select').selectOption(JSON.stringify({ system: 'demo-lms', sourceId: 'task-2' }));
      for (let index = 0; index < 2; index++) {
        await page.locator('.session-candidate button').first().click();
        const form = page.locator('.preparation-form');
        const response = page.waitForResponse(response => response.request().method() === 'PUT' && /\/plans\//.test(response.url()));
        await form.getByRole('button', { name: '入れる', exact: true }).click();
        assert.equal((await response).status(), 200);
        await page.locator('.session-saved').waitFor();
        if (index === 0) {
          const plan = (await ref.collection('plans').where('status', '==', 'active').get()).docs[0];
          assert.ok(plan);
          await plan.ref.update({ status: 'done' });
          await page.locator('.preparation-list li[data-plan-status="done"]').waitFor();
        }
      }
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 });
        const saved = page.locator('.session-saved');
        const bounds = await saved.evaluate(node => {
          const notice = node.getBoundingClientRect(); const cell = node.closest('td').getBoundingClientRect();
          return { contained: notice.left >= cell.left && notice.right <= cell.right && notice.bottom <= cell.bottom,
            preparation: globalThis.getComputedStyle(node.closest('td').querySelector('.preparation-cell')).backgroundColor };
        });
        assert.equal(bounds.contained, true);
        assert.equal(bounds.preparation, 'rgb(255, 225, 77)');
        assert.equal(await page.locator('.preparation-list li[data-plan-status="done"]').evaluate(node => globalThis.getComputedStyle(node).borderLeftColor), 'rgb(31, 122, 85)');
        assert.equal(await page.locator('.preparation-remove').last().evaluate(node => globalThis.getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
        assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
        await page.evaluate(() => globalThis.window.scrollTo(0, 0));
        const name = `after-supporter-saved-${width}.png`;
        await page.screenshot({ path: `${dir}/${name}`, fullPage: true }); extraScreenshots.push(name);
      }
      const activePlan = page.locator('.preparation-list li[data-plan-status="active"]');
      await activePlan.getByRole('button', { name: /の準備を外す/ }).click();
      await activePlan.waitFor({ state: 'detached' });
      await page.getByRole('status').filter({ hasText: '準備の予定を外しました。' }).waitFor();
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  const evidenceFile = `${before ? 'before' : 'after'}.json`;
  await writeFile(`${dir}/${evidenceFile}`, JSON.stringify({ now, observations, browserErrors: errors }, null, 2));
  log(JSON.stringify({ observations: [{ requirement_id: 'session-layout', status: 'pass',
    observed: { views: observations.length, browserErrors: errors.length }, evidence_files: [evidenceFile, ...observations.map(row => row.screenshot), ...extraScreenshots] }] }));
} finally { await browser.close(); await db.terminate(); await deleteApp(app); }
