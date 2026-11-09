import { openJudgeLogin } from './helpers/judge-login.mjs';
import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.KADAI_WEB_ORIGIN ?? '') || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-colors-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const phase = process.env.COURSE_COLOR_PHASE === 'before' ? 'before' : 'after';
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || 'docs/records/2026-11-09-issue-235';
const base = process.env.KADAI_WEB_ORIGIN;
const checks = []; const errors = []; const heights = [];
async function shot(page, name, width) {
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  await page.screenshot({ path: `${evidence}/${phase}-${name}-${width}.png`, fullPage: true, animations: 'disabled' });
}
const tone = locator => locator.evaluate(element => ({ index: element.getAttribute('data-course-color'),
  band: globalThis.getComputedStyle(element).getPropertyValue('--course-band').trim() }));
async function courseTones(elements, labelSelector) {
  return elements.evaluateAll((rows, selector) => rows.map(element => ({
    name: element.querySelector(selector).textContent.trim(), index: element.getAttribute('data-course-color'),
  })), labelSelector);
}
function matchesTimetable(rows, colors) {
  for (const { name, index } of rows) assert.equal(index, colors[name], `${name} matches the full-list timetable allocation`);
}
try {
  await mkdir(evidence, { recursive: true });
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', () => errors.push('browser-error'));
    await page.goto(`${base}/demo-lms`);
    await openJudgeLogin(page);
    await page.getByLabel('メールアドレス').fill('trial-student@example.invalid');
    await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    await page.getByRole('button', { name: 'LMSを開く', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
    const pane = role => page.locator(`[data-demo-pane="${role}"]`);
    const switchPane = async role => {
      if (width === 390) await page.getByRole('navigation', { name: '体験の画面', exact: true }).getByRole('button', { name: role, exact: true }).click();
    };
    await switchPane('学生');
    await pane('student').getByText('書き方を書くレポート', { exact: true }).waitFor();
    const demoTone = phase === 'after' ? await tone(pane('student').locator('[data-course-color]').first()) : null;
    const demoStudentTones = phase === 'after' ? await courseTones(pane('student').locator('.demo-observed-task'), '.course-label') : [];
    await shot(page, 'demo-student', width);
    await switchPane('支援担当');
    if (phase === 'after') {
      assert.deepEqual(await tone(pane('supporter').locator('[data-course-color]').first()), demoTone);
      assert.equal(await pane('lms').locator('[data-course-color]').count(), 0);
      checks.push(`${width}: demo student/supporter share a course color; LMS has no course colors`);
    }
    await shot(page, 'demo-supporter', width);
    const demoSupporterTones = phase === 'after' ? await courseTones(pane('supporter').locator('.session-task'), '.course-label') : [];

    await page.getByText('先生役の操作・メールの見本', { exact: true }).click();
    const preview = page.getByRole('region', { name: '今日やることのメール', exact: true });
    await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).click();
    await preview.getByRole('button', { name: /今日やること.*を開く/ }).waitFor();

    await page.goto(`${base}/student`);
    await page.locator('.student-overview').waitFor();
    const row = page.locator('.td-taskrow').filter({ hasText: '書き方を書くレポート' });
    await row.waitFor();
    if (phase === 'after') {
      assert.deepEqual(await tone(row), demoTone);
      // Event itself owns the course attribute; preparation events deliberately do not.
      const deadline = page.locator('.calendar-event[data-course-color]').filter({ hasText: '書き方を書くレポート' });
      await deadline.waitFor();
      assert.deepEqual(await tone(deadline), demoTone);
      assert.ok(await row.locator('.td-taskrow-course').evaluate(element => globalThis.getComputedStyle(element, '::before').content !== 'none'));
      checks.push(`${width}: saved calendar deadline uses the same course identity and row marker is visible`);
    }
    await shot(page, 'student', width);
    if (width === 390) await page.getByRole('tab', { name: '時間割', exact: true }).click();
    const course = page.locator('.course-cell').filter({ hasText: '書き方を書くレポート' });
    await course.waitFor();
    if (phase === 'after') {
      assert.deepEqual(await tone(course), demoTone);
      assert.notEqual(await course.evaluate(element => globalThis.getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
      checks.push(`${width}: timetable and deadline row match the demo course`);
      const timetableRows = await courseTones(page.locator('.course-cell'), 'strong');
      const colors = Object.fromEntries(timetableRows.map(({ name, index }) => [name, index]));
      assert.deepEqual(Object.keys(colors).sort(), ['レポートの書き方の書き方', 'キャンパス植物図鑑演習', 'Re:線形代数',
        '学食経済学', '自転車置き場の社会学', '90分の数理'].sort());
      assert.equal(new Set(Object.values(colors)).size, 6, 'all six demo courses use distinct colors');
      matchesTimetable(demoStudentTones, colors);
      matchesTimetable(demoSupporterTones, colors);
      matchesTimetable(await courseTones(page.locator('.td-taskrow[data-course-color]'), '.td-taskrow-course'), colors);
      matchesTimetable(await courseTones(page.locator('.calendar-event[data-course-color]'), '.muted'), colors);
      checks.push(`${width}: all six timetable courses have different colors; filtered demo panes, deadline rows and calendar match`);
      // Keep the entire allocation to compare with the session's smaller deadline subset.
      page.courseColors = colors;
      const plan = page.locator('.preparation-cell').first();
      await plan.waitFor();
      assert.equal(await plan.getAttribute('data-course-color'), null);
      assert.equal(await plan.evaluate(element => globalThis.getComputedStyle(element).borderLeftStyle), 'dashed');
      checks.push(`${width}: preparation remains a dashed uncolored cell`);
    }
    await shot(page, 'timetable', width);

    await page.goto(`${base}/session/trial-student`);
    const table = page.getByRole('table', { name: '次の面談までの課題', exact: true });
    await table.waitFor();
    const tableRow = table.getByRole('row').filter({ hasText: '書き方を書くレポート' });
    if (phase === 'after') assert.deepEqual(await tone(tableRow), demoTone);
    await tableRow.getByRole('button', { name: '書き方を書くレポート', exact: true }).click();
    await page.locator('.td-detail').waitFor();
    await page.locator('.td-detail').getByRole('link', { name: /LMSで見る/ }).waitFor();
    const frame = await page.locator('.session-task-workspace > .td-scroll-frame').boundingBox();
    const content = await table.boundingBox();
    heights.push({ width, frame: frame.height, table: content.height });
    if (phase === 'after') {
      assert.deepEqual(await tone(page.locator('.td-detail [data-course-color]').first()), demoTone);
      assert.ok(frame.height - content.height < 4, 'table frame must fit its content when the detail is taller');
      checks.push(`${width}: session table/detail match the course; table frame fits its contents`);
    }
    await shot(page, 'session', width);
    if (phase === 'after') {
      matchesTimetable(await courseTones(table.locator('tbody tr[data-course-color]'), '.course-label'), page.courseColors);
      await page.goto(`${base}/session/trial-student/plan`);
      await page.locator('.session-course').first().waitFor();
      const sessionCourses = await page.locator('.session-course').evaluateAll(rows => rows.map(element => ({
        name: element.firstChild.textContent.trim(), index: element.getAttribute('data-course-color'),
      })));
      assert.equal(sessionCourses.length, 6);
      matchesTimetable(sessionCourses, page.courseColors);
      checks.push(`${width}: session deadline subset and planning timetable use the student's full-list colors`);
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/${phase}.json`, JSON.stringify({ phase, passed: checks.length, checks, heights, browserErrors: errors.length }, null, 2));
  log(JSON.stringify({ phase, passed: checks.length, heights, browserErrors: errors.length }));
} finally { await browser.close(); }
