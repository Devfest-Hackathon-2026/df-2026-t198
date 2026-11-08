import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.KADAI_WEB_ORIGIN ?? '') || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-qa-required');
// Match fixture dates to the optional browser clock when replaying another weekday.
const now = process.env.KADAI_JUDGE_QA_NOW ? Date.parse(process.env.KADAI_JUDGE_QA_NOW) : Date.now();
assert.ok(Number.isFinite(now), 'KADAI_JUDGE_QA_NOW must be a valid datetime');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'judge-qa'); const db = getFirestore(app);
const browser = await chromium.launch({ headless: true });
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i130-browser';
const base = process.env.KADAI_WEB_ORIGIN; const ref = db.doc('students/trial-student');
const results = []; const errors = [];
// Independent expected values for the demo's published timetable; do not read form values
// or import the production table, so incorrect prefilling still fails this check.
const periodTimes = [['08:50', '10:20'], ['10:30', '12:00'], ['13:00', '14:30'],
  ['14:40', '16:10'], ['16:15', '17:45'], ['17:50', '19:20'], ['19:25', '20:55']];
const selectedCandidates = [];
async function check(name, run) {
  try { await run(); results.push({ name, status: 'pass' }); }
  catch (error) { results.push({ name, status: 'fail', reason: error.message.split('\n')[0] }); }
}
async function inViewport(locator) {
  assert.equal(await locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.right <= globalThis.innerWidth && box.top >= 0 && box.bottom <= globalThis.innerHeight;
  }), true, 'control fits the visible viewport');
}
async function login(page, role) {
  await page.goto(`${base}/demo-lms`);
  await page.getByLabel('メールアドレス').fill(`trial-${role}@example.invalid`);
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.route('**/accounts:signInWithPassword*', async route => {
    await new Promise(resolve => globalThis.setTimeout(resolve, 300)); await route.continue();
  }, { times: 1 });
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await check(`${page.viewportSize().width}: ${role} sees login in progress`, async () => {
    const button = page.getByRole('button', { name: 'ログイン中…', exact: true });
    await button.waitFor(); assert.equal(await button.isDisabled(), true);
  });
  await page.getByRole('link', { name: role === 'student' ? '学生の画面を開く' : '面談を開く', exact: true }).waitFor();
}
const list = page => page.getByRole('region', { name: '入れた準備の予定', exact: true });
try {
  await mkdir(evidence, { recursive: true });
  const demoRef = ref.collection('demo').doc('current'); const demo = (await demoRef.get()).data();
  for (const course of demo.courses) for (const task of course.assignments) task.dueAt = new Date(now + (task.submission === 'submitted' ? 2 : 14) * 86400000).toISOString();
  await demoRef.set(demo);
  await ref.collection('sessionContext').doc('current').update({ nextSessionAt: new Date(now + 15 * 86400000).toISOString() });
  for (const width of [1280, 390]) {
    const studentContext = await browser.newContext({ viewport: { width, height: 900 } });
    const supporterContext = await browser.newContext({ viewport: { width, height: 900 } });
    const student = await studentContext.newPage(); const supporter = await supporterContext.newPage();
    for (const page of [student, supporter]) {
      page.setDefaultTimeout(8000); page.on('pageerror', () => errors.push('browser-error'));
      if (process.env.KADAI_JUDGE_QA_NOW) await page.clock.setFixedTime(new Date(now));
    }
    await db.recursiveDelete(ref.collection('plans'));
    await login(student, 'student');
    await student.getByRole('button', { name: 'LMSを開く', exact: true }).click();
    await student.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
    await student.goto(`${base}/student`); await student.locator('.timetable').waitFor({ state: 'attached' });
    await check(`${width}: submitted deadlines, scroll hints and date navigation`, async () => {
      const calendar = student.getByRole('region', { name: '締切のカレンダー', exact: true });
      // #177 added a second submitted task; both badges and their date navigation must work.
      for (const title of ['第3回 ふりかえり', '日替わり定食の値段しらべ']) {
        const submitted = calendar.locator('.calendar-event.submitted').filter({ has: student.getByText(title, { exact: true }) });
        await submitted.getByText('出せました', { exact: true }).waitFor();
        const day = await submitted.evaluate(element => element.closest('[data-date]').dataset.date);
        if (width === 390) await calendar.getByRole('button', { name: `${Number(day.slice(5, 7))}/${Number(day.slice(8))}の締切へ`, exact: true }).click();
        else assert.equal(await calendar.locator('.calendar-navigation').count(), 0);
        assert.equal(await submitted.evaluate(element => {
          const box = element.getBoundingClientRect(); const parent = element.closest('.calendar-scroll').getBoundingClientRect();
          return box.left >= parent.left && box.right <= parent.right;
        }), true, 'the selected deadline is horizontally visible');
      }
      assert.equal(await calendar.locator('.calendar-event.submitted').count(), 2);
      if (width === 390) await calendar.getByRole('button', { name: '今日へ', exact: true }).click();
      assert.equal(await calendar.locator('.calendar-scroll').evaluate(element => Math.round(element.scrollLeft)), 0);
      assert.equal(await calendar.locator('.td-scroll-frame').getAttribute('data-right'), String(width === 390));
      assert.equal(await student.locator('.scroll-hint').count(), 0);
      assert.equal(await student.getByText('朱色は、今変わった締切の目印です。しばらくすると元の色に戻ります。', { exact: true }).count(), 0);
    });
    await check(`${width}: period labels stay visible after horizontal scrolling`, async () => {
      if (width === 390) await student.getByRole('tab', { name: '時間割', exact: true }).click();
      const region = student.locator('.timetable-scroll');
      await region.evaluate(element => { element.scrollLeft = element.scrollWidth; });
      assert.equal(await region.locator('tbody th').first().evaluate(element => {
        const box = element.getBoundingClientRect(); const outer = element.closest('.timetable-scroll').getBoundingClientRect();
        return box.left >= outer.left && box.right <= outer.right;
      }), true);
    });
    if (width === 390) await student.getByRole('tab', { name: '準備', exact: true }).click();
    await login(supporter, 'supporter');
    await supporter.goto(`${base}/session/trial-student/plan`); await supporter.locator('.session-candidate button').first().waitFor();
    const candidate = supporter.locator('.session-candidate button').first();
    const label = await candidate.getAttribute('aria-label');
    const match = /^(\d{4}-\d{2}-\d{2}) (\d+)限に入れる$/.exec(label ?? '');
    assert.ok(match, 'candidate names its date and period');
    const period = Number(match[2]);
    assert.ok(periodTimes[period - 1], 'candidate has a known demo period');
    const [start, end] = periodTimes[period - 1];
    selectedCandidates.push({ width, date: match[1], period, start, end });
    await candidate.click();
    const form = supporter.locator('.preparation-form'); await form.waitFor();
    await check(`${width}: candidate focuses its prefilled form and save button`, async () => {
      assert.equal(await form.getByLabel('開始時刻', { exact: true }).inputValue(), start);
      assert.equal(await form.getByLabel('終了時刻', { exact: true }).inputValue(), end);
      assert.equal(await form.evaluate(element => element.contains(globalThis.document.activeElement)), true);
      await inViewport(form.getByRole('button', { name: '入れる', exact: true }));
    });
    await supporter.screenshot({ path: `${evidence}/candidate-${width}.png`, fullPage: true });
    await check(`${width}: known period mismatch is explained`, async () => {
      await form.getByLabel('開始時刻', { exact: true }).fill('07:00');
      await form.getByText(`${period}限の時刻は${start}〜${end}です。指定した時刻がこのコマからはみ出しています。時限と時刻を確かめてください。`, { exact: true }).waitFor();
    });
    await form.getByLabel('開始時刻', { exact: true }).fill(start);
    await form.getByLabel('終了時刻', { exact: true }).fill(end);
    await form.getByRole('button', { name: '入れる', exact: true }).click();
    await list(student).getByText('支援担当が入れました', { exact: true }).waitFor();
    await check(`${width}: supporter sees saved notice after form closes`, async () => {
      await supporter.getByRole('status').filter({ hasText: '準備の予定を入れました' }).waitFor();
    });
    const saved = (await ref.collection('plans').get()).docs[0].data();
    // Same title, shuffled document IDs, two times on the same day: sorting must use date then time.
    for (const [index, offset, start, end, period] of [[1, 5, '13:00', '14:30', 3], [2, 3, '13:00', '14:30', 3], [3, 3, '08:50', '10:20', 1]]) {
      const date = new Date(now + offset * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' });
      const planId = `13000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      await ref.collection('plans').doc(planId).set({ ...saved, planId, date, period,
        status: index === 1 ? 'done' : 'active', ...(index === 2 ? { laterResult: 'moved' } : {}),
        startsAt: `${date}T${start}:00+09:00`, endsAt: `${date}T${end}:00+09:00` });
    }
    for (const [role, page] of [['student', student], ['supporter', supporter]]) {
      await page.waitForFunction(() => globalThis.document.querySelectorAll('.preparation-list li').length === 4);
      await check(`${width}: ${role} chronological cards include visible state and controls`, async () => {
        const times = await list(page).locator('li time').evaluateAll(nodes => nodes.map(node => node.dateTime));
        assert.deepEqual(times, [...times].sort());
        assert.equal(await page.locator('.preparation-mobile-progress').count(), 0);
        const row = list(page).locator('li').first(); await row.scrollIntoViewIfNeeded();
        for (const button of await row.getByRole('button').all()) await inViewport(button);
        assert.match(await row.innerText(), /限/);
        assert.equal(await list(page).locator('li').filter({ hasText: '終わった（LMSへの提出は別）' }).count(), 1);
        assert.equal(await list(page).locator('li').filter({ hasText: '後回しにした' }).count(), 1);
        assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
      });
      await list(page).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${evidence}/${role}-${width}.png`, fullPage: true });
    }
    await check(`${width}: adding then removing leaves only the latest notice`, async () => {
      await student.getByText('準備の予定を入れる', { exact: true }).click();
      const add = student.locator('.preparation-form');
      await add.getByLabel('準備する日', { exact: true }).fill(saved.date);
      await add.getByLabel('時間割の時限', { exact: true }).fill('4');
      await add.getByLabel('開始時刻', { exact: true }).fill('14:40');
      await add.getByLabel('終了時刻', { exact: true }).fill('16:10');
      await add.getByRole('button', { name: '入れる', exact: true }).click();
      await student.getByRole('status').filter({ hasText: '準備の予定を入れました' }).waitFor();
      await list(student).getByRole('button', { name: /準備を外す/ }).first().click();
      await student.getByRole('status').filter({ hasText: '準備の予定を外しました' }).waitFor();
      assert.equal(await student.getByRole('status').filter({ hasText: /準備の予定を(入れ|外し)ました/ }).count(), 1);
    });
    await ref.collection('sessionContext').doc('current').update({ lastSessionAt: `${saved.decidedOn}T09:00:00+09:00` });
    await student.goto(`${base}/session/trial-student`); await student.locator('.session-heading').waitFor();
    await check(`${width}: checking labels preparation and sorts promises`, async () => {
      await student.getByRole('heading', { name: '入れた準備の予定', exact: true }).waitFor();
      const promises = student.locator('#session-promises').locator('..');
      const dates = await promises.locator('time').evaluateAll(nodes => nodes.map(node => node.dateTime));
      assert.ok(dates.length >= 3); assert.deepEqual(dates, [...dates].sort());
    });
    await check(`${width}: own session omits student picker and addresses the student`, async () => {
      assert.equal(await student.getByRole('link', { name: '学生を選び直す', exact: true }).count(), 0);
      assert.equal(await student.getByText('日本時間です。学生はどの準備の予定も外せます。', { exact: true }).count(), 0);
      await student.getByRole('link', { name: '② 相談する', exact: true }).click();
      assert.equal(await student.getByText('授業以外の予定は、学生と確かめてください。', { exact: true }).count(), 0);
    });
    await student.goto(`${base}/student/plan?id=invalid&do=done&rev=1`);
    const invalidLinkText = '準備の予定のリンクを確かめてください。';
    const confirmation = student.getByRole('region', { name: '準備の予定の操作', exact: true });
    await confirmation.getByRole('status').filter({ hasText: invalidLinkText }).waitFor();
    assert.deepEqual(await confirmation.getByRole('status').allTextContents(), [invalidLinkText]);
    const planCount = await list(student).locator('li').count();
    await list(student).getByRole('button', { name: /準備を外す/ }).first().click();
    await student.getByRole('status').filter({ hasText: '準備の予定を外しました' }).waitFor();
    await check(`${width}: a later operation replaces the mail link result`, async () => {
      // Wait for the saved cancellation to reach the page, so a data refresh cannot revive the old notice.
      await student.waitForFunction(count => globalThis.document.querySelectorAll('.preparation-list li').length === count - 1, planCount);
      assert.equal(await student.getByText(invalidLinkText, { exact: true }).count(), 0);
      assert.deepEqual(await student.getByRole('status').allTextContents(), ['準備の予定を外しました。']);
      await confirmation.getByRole('link', { name: '時間割を見る', exact: true }).waitFor();
    });
    await student.goto(`${base}/demo-lms`); await student.getByRole('button', { name: 'LMSを開く', exact: true }).waitFor();
    await student.screenshot({ path: `${evidence}/demo-lms-${width}.png`, fullPage: true });
    const preview = student.getByRole('region', { name: '今日やることのメール', exact: true });
    await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).click();
    await preview.getByRole('button', { name: /今日やること.*を開く/ }).click();
    await preview.getByRole('link', { name: /終わった/, exact: false }).click();
    await preview.getByRole('region', { name: '準備の予定の操作', exact: true })
      .getByRole('button', { name: '終わった', exact: true }).click();
    await preview.getByRole('status').filter({ hasText: '準備が終わりました' }).waitFor();
    await student.getByRole('button', { name: /の締切を1日延ばす/ }).first().click();
    await student.getByRole('status').filter({ hasText: 'LMSの締切を1日延ばしました' }).waitFor();
    await check(`${width}: next LMS operation clears the email action notice`, async () => {
      assert.equal(await preview.getByText('準備が終わりました。LMSへの提出は別に行ってください。', { exact: true }).count(), 0);
      // Only operation notices are replaced; the confirmation's current plan state stays readable.
      assert.deepEqual(await preview.getByRole('status').allTextContents(), ['今の状態：終わった（LMSへの提出は別）']);
    });
    await studentContext.close(); await supporterContext.close();
  }
  assert.deepEqual(errors, []);
  assert.equal(results.length, 28, 'all existing QA checks ran');
  await writeFile(`${evidence}/operations.json`, JSON.stringify({ now: new Date(now).toISOString(), selectedCandidates, results, browserErrors: errors.length }, null, 2));
  log(JSON.stringify({ passed: results.filter(result => result.status === 'pass').length, failed: results.filter(result => result.status === 'fail').length, results }));
  assert.equal(results.filter(result => result.status === 'fail').length, 0);
} finally { await browser.close(); await db.terminate(); await deleteApp(app); }
