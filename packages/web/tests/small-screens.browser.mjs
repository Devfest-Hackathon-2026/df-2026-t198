import assert from 'node:assert/strict';
import process from 'node:process';
import { log } from 'node:console';
import { mkdir, writeFile } from 'node:fs/promises';
import { openJudgeLogin } from './helpers/judge-login.mjs';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.KADAI_WEB_ORIGIN ?? '') || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-demo-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch();
const base = process.env.KADAI_WEB_ORIGIN;
const dir = process.env.ARTIFACT_EVIDENCE_DIR || 'docs/records/2026-11-09-issue-261';
const phase = process.env.KADAI_I261_BEFORE === '1' ? 'before' : 'after';
const observations = []; const errors = [];
async function login(page, role) {
  await page.goto(`${base}/demo-lms`); await openJudgeLogin(page);
  await page.getByLabel('メールアドレス').fill(`trial-${role}@example.invalid`);
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByRole(role === 'student' ? 'button' : 'link', { name: role === 'student' ? 'LMSを開く' : '面談を開く', exact: true }).waitFor();
}
async function shot(page, name) {
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.screenshot({ path: `${dir}/${phase}-${name}.png`, fullPage: true, animations: 'disabled' });
}
async function measures(frame, selector) {
  return frame.evaluate((node, selector) => {
    const box = node.getBoundingClientRect();
    return { width: node.clientWidth, contentWidth: node.scrollWidth, scrollLeft: node.scrollLeft,
      fields: [...node.querySelectorAll(selector)].map(field => {
        const bounds = field.getBoundingClientRect();
        return { text: field.textContent, fits: bounds.left >= box.left - 1 && bounds.right <= box.right + 1 && field.scrollWidth <= field.clientWidth + 1 };
      }) };
  }, selector);
}
try {
  await mkdir(dir, { recursive: true });
  for (const width of [1280, 390]) {
    const options = { viewport: { width, height: width === 1280 ? 800 : 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' };
    const studentContext = await browser.newContext(options); const supporterContext = await browser.newContext(options);
    const demo = await studentContext.newPage(); const student = await studentContext.newPage(); const session = await supporterContext.newPage();
    for (const page of [demo, student, session]) { page.setDefaultTimeout(15000); page.on('pageerror', () => errors.push('browser-error')); }
    await login(demo, 'student');
    demo.once('dialog', dialog => dialog.accept());
    await demo.getByRole('button', { name: '体験を最初からやり直す', exact: true }).click();
    await demo.getByRole('status').filter({ hasText: '体験を最初の状態に戻しました' }).waitFor();
    await demo.getByRole('button', { name: 'LMSを開く', exact: true }).click();
    await demo.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
    await demo.getByRole('button', { name: '「第3回レポート（要約と引用）」の締切を1日延ばす', exact: true }).click();
    await demo.getByRole('button', { name: '朝のメールを見る', exact: true }).waitFor();
    await student.goto(`${base}/student`);
    await student.locator('.student-deadlines .td-taskrow').first().waitFor();
    await student.locator('.calendar-event').first().waitFor();
    await shot(student, `student-${width}`);
    const calendar = await measures(student.locator('.calendar-scroll'), '.calendar-event, th');
    const deadlines = await measures(student.locator('.student-deadlines'), '.td-taskrow .deadline');
    const weeklyDeadline = await student.locator('.student-deadlines .td-taskrow .deadline').first().boundingBox();
    const weeklyTitle = await student.locator('.student-deadlines .td-taskrow-title').first().boundingBox();
    if (width === 390) await student.getByRole('tab', { name: '時間割', exact: true }).click();
    await shot(student, `timetable-${width}`);
    const rows = await student.locator('.timetable tbody tr').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    await login(session, 'supporter');
    await session.getByRole('link', { name: '面談を開く', exact: true }).click();
    await session.getByRole('link', { name: '田中 太郎', exact: true }).click();
    await session.locator('.td-table tbody tr').first().waitFor();
    assert.deepEqual(await session.getByRole('table', { name: '次の面談までの課題', exact: true }).getByRole('columnheader').allTextContents(), ['科目', '課題', '締切', '状況', '残り']);
    await shot(session, `session-${width}`);
    log(`Captured ${phase} student/session ${width}`);
    const table = await measures(session.locator('.session-task-workspace .td-table-wrap'), 'tbody td');
    const firstDeadline = await session.locator('.td-table tbody tr').first().locator('[data-label="締切"]').boundingBox();
    await session.locator('.td-table-select').first().click();
    await session.getByRole('heading', { name: '課題の詳細', exact: true }).waitFor();
    await session.getByRole('button', { name: '閉じる', exact: true }).click();
    const preview = demo.getByRole('region', { name: '今日やることのメール', exact: true });
    if (phase === 'after') {
      await demo.route('**/api/v1/digest/demo-plan', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }), { times: 1 });
      await demo.getByRole('button', { name: '朝のメールを見る', exact: true }).click();
      await demo.getByRole('alert').filter({ hasText: '操作が終わりませんでした' }).waitFor();
      assert.equal(await demo.locator('#demo-morning-mail').count(), 0, 'failed preparation does not claim to open mail');
    }
    let mailClicks = 1;
    await demo.getByRole('button', { name: '朝のメールを見る', exact: true }).click();
    await preview.waitFor();
    if (phase === 'before') {
      await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).click(); mailClicks++;
      await preview.getByRole('button', { name: /今日やること.*を開く/ }).click(); mailClicks++;
    }
    await preview.locator('.digest-open-mail').waitFor();
    await preview.getByRole('link', { name: '✅ 終わった', exact: true }).waitFor();
    await shot(demo, `mail-${width}`);
    // Opening an action link still asks for confirmation, without a progress write.
    const writes = [];
    demo.on('request', request => { if (/\/plans\/[^/]+\/(done|later)/.test(request.url()) && request.method() === 'POST') writes.push('progress-write'); });
    for (const [link, button] of [['✅ 終わった', '終わった'], ['🕒 後回し', '後回し']]) {
      await preview.getByRole('link', { name: link, exact: true }).click();
      await preview.getByRole('region', { name: '準備の予定の操作', exact: true }).getByRole('button', { name: button, exact: true }).waitFor();
      assert.deepEqual(writes, []);
    }
    await preview.getByRole('button', { name: '受信箱に戻る', exact: true }).click();
    await preview.getByRole('button', { name: /今日やること.*を開く/ }).waitFor();
    if (phase === 'after') await demo.getByRole('button', { name: '朝のメールを見る', exact: true }).click();
    else await preview.getByRole('button', { name: /今日やること.*を開く/ }).click();
    await preview.locator('.digest-open-mail').waitFor();
    observations.push({ width, table, calendar, deadlines, timetableRows: rows, mailClicks,
      weeklyDeadlineInViewport: weeklyDeadline.y + weeklyDeadline.height <= options.viewport.height,
      weeklyDeadlineFirst: weeklyDeadline.x < weeklyTitle.x,
      firstDeadlineInViewport: firstDeadline.y + firstDeadline.height <= options.viewport.height,
      pageFits: await student.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth) });
    await studentContext.close(); await supporterContext.close();
  }
  await writeFile(`${dir}/${phase}.json`, JSON.stringify({ observations, browserErrors: errors }, null, 2));
  assert.deepEqual(errors, []);
  for (const row of observations) {
    assert.equal(row.table.scrollLeft, 0);
    assert.ok(row.table.fields.length > 0 && row.table.fields.every(field => field.fits), `${row.width}: session deadline/status/remaining fit without horizontal scrolling`);
    assert.ok(row.deadlines.fields.length > 0 && row.deadlines.fields.every(field => field.fits), `${row.width}: weekly deadlines fit`);
    assert.ok(Math.max(...row.timetableRows) - Math.min(...row.timetableRows) <= 1, 'timetable rows stay equal');
    assert.equal(row.mailClicks, 1, 'one click from stage 4 to mail body');
    assert.equal(row.pageFits, true);
    if (row.width === 390) {
      assert.equal(row.firstDeadlineInViewport, true, 'first session deadline is in the initial viewport');
      assert.equal(row.weeklyDeadlineInViewport, true, 'weekly deadline is in the initial viewport');
      assert.equal(row.weeklyDeadlineFirst, true, 'weekly deadline comes before its title');
    }
  }
  log(`PASS ${phase}: 1280/390 deadline visibility, equal timetable rows, one-click mail and unchanged confirmations`);
} finally { await browser.close(); }
