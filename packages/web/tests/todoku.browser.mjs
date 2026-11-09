import { openJudgeLogin } from './helpers/judge-login.mjs';
import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { log } from 'node:console';
import { createRequire } from 'node:module';
import { URL } from 'node:url';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-demo-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.KADAI_WEB_ORIGIN;
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i185-evidence';
const captureOnly = process.env.TODOKU_CAPTURE_ONLY === 'true';
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'todoku-browser');
const db = getFirestore(app);
const browser = await chromium.launch({ headless: true });
const studentContext = await browser.newContext();
const supporterContext = await browser.newContext();
const demo = await studentContext.newPage();
const student = await studentContext.newPage();
const session = await supporterContext.newPage();
const mail = await studentContext.newPage();
const errors = [];
const results = [];
for (const page of [demo, student, session, mail]) {
  page.setDefaultTimeout(15000);
  page.on('pageerror', () => errors.push('browser-error'));
}
async function login(page, role) {
  await page.goto(`${base}/demo-lms`);
  await openJudgeLogin(page);
  await page.getByLabel('メールアドレス').fill(`trial-${role}@example.invalid`);
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
}
// Inspect rendered text against its composed background, including inline mail styles.
async function contrast(page) {
  return page.locator('body').evaluate(body => {
    const rgb = value => value.match(/[\d.]+/g).map(Number);
    const composite = (front, back) => front.slice(0, 3).map((c, i) => c * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
    const luminance = color => color.slice(0, 3).map(c => {
      const v = c / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
    }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    let minimum = Infinity;
    const failures = [];
    for (const element of body.querySelectorAll('*')) {
      if (!element.checkVisibility() || element.closest('button:disabled, [aria-hidden="true"]') ||
        ![...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) continue;
      const layers = []; let ancestor = element;
      while (ancestor) { layers.unshift(rgb(globalThis.getComputedStyle(ancestor).backgroundColor)); ancestor = ancestor.parentElement; }
      const background = layers.reduce((back, front) => composite(front, back), [255, 255, 255]);
      const color = composite(rgb(globalThis.getComputedStyle(element).color), background);
      const light = [luminance(color), luminance(background)].sort((a, b) => b - a);
      const ratio = (light[0] + .05) / (light[1] + .05);
      minimum = Math.min(minimum, ratio);
      if (ratio < 4.5) failures.push({ tag: element.tagName, class: element.className, ratio });
    }
    return { minimum, failures };
  });
}
async function capture(page, name) {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 1280 ? 960 : 844 });
    await page.evaluate(() => globalThis.document.fonts.ready);
    await page.locator('.timetable-scroll, .calendar-scroll, .session-timetable-scroll').evaluateAll(nodes => {
      for (const node of nodes) node.scrollLeft = 0;
    });
    const fits = await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth);
    assert.equal(fits, true, `${name} fits ${width}px`);
    assert.equal(await page.locator('.app-header .todoku-logo').innerText(), 'ToDoku');
    const measured = await contrast(page);
    const fonts = await page.locator('body').evaluate(body => ({
      used: [...new Set([...body.querySelectorAll('*')].filter(node => node.checkVisibility())
        .flatMap(node => globalThis.getComputedStyle(node).fontFamily.split(',').map(family => family.trim().replaceAll('"', ''))))],
      loaded: [...new Set([...globalThis.document.fonts].filter(face => face.status === 'loaded')
        .map(face => face.family.replaceAll('"', '')))],
    }));
    results.push({ name, width, fits, contrast: measured, fonts });
    if (!captureOnly) {
      assert.deepEqual(measured.failures, [], `${name}: all visible text meets 4.5:1`);
      for (const family of ['BIZ UDPGothic', 'Space Grotesk', 'JetBrains Mono'].filter(family => fonts.used.includes(family))) {
        assert(fonts.loaded.includes(family), `${name}: rendered font ${family} loaded`);
      }
      assert.equal(await page.locator('body').evaluate(node => globalThis.getComputedStyle(node).backgroundColor), 'rgb(243, 240, 232)');
      assert.match(await page.locator('h1').first().evaluate(node => globalThis.getComputedStyle(node).fontFamily), /BIZ UDPGothic/);
      for (const button of await page.locator('button:visible:not(:disabled)').all()) {
        const style = await button.evaluate(node => {
          const css = globalThis.getComputedStyle(node); return { radius: css.borderRadius, color: css.color, background: css.backgroundColor };
        });
        assert.equal(style.radius, '0px');
        assert.notEqual(style.background, 'rgb(217, 64, 43)');
      }
    }
    await page.screenshot({ path: `${evidence}/${name}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 960 });
}
try {
  await mkdir(evidence, { recursive: true });
  // Capture the introduction too, including the two approved sharing descriptions.
  await demo.goto(base);
  for (const width of [1280, 390]) {
    await demo.setViewportSize({ width, height: 960 });
    await demo.evaluate(() => globalThis.document.fonts.ready);
    await demo.locator('.shot').evaluateAll(images => Promise.all(images.map(image => image.decode())));
    await demo.screenshot({ path: `${evidence}/landing-${width}.png`, fullPage: true });
  }
  await login(demo, 'student');
  await demo.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await demo.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  const preview = demo.getByRole('region', { name: '今日やることのメール', exact: true });
  await preview.getByRole('button', { name: '今日の準備の見本を用意する', exact: true }).click();
  const done = preview.getByRole('link', { name: '✅ 終わった', exact: true });
  await done.waitFor();
  await student.goto(`${base}/student`);
  await student.locator('.course-cell').filter({ hasText: 'レポートの書き方の書き方' }).click();
  await student.locator('.course-panel').waitFor();
  await student.locator('.preparation-cell').first().waitFor();
  await student.locator('.course-cell[aria-pressed="true"]').evaluate(node =>
    Promise.all(node.getAnimations().map(animation => animation.finished)));
  if (!captureOnly) {
    assert.deepEqual(await student.locator('.course-cell[aria-pressed="true"]').evaluate(node => {
      const css = globalThis.getComputedStyle(node);
      return { background: css.backgroundColor, border: css.borderColor };
    }), { background: 'rgb(255, 255, 255)', border: 'rgb(22, 21, 15)' });
    assert.equal(await student.locator('.preparation-cell').first().evaluate(node => globalThis.getComputedStyle(node).borderTopStyle), 'dashed');
  }
  await capture(student, 'student');
  await student.locator('.preparation-cell').first().click();
  await student.locator('#preparation-details').waitFor();
  await student.getByText('準備の予定を入れる', { exact: true }).click();
  await student.locator('.preparation-form').waitFor();
  await capture(student, 'preparation-plans');
  await student.locator('.course-cell').filter({ hasText: 'レポートの書き方の書き方' }).click();
  await login(session, 'supporter');
  await session.getByRole('link', { name: '面談を開く', exact: true }).click();
  await session.getByRole('link', { name: '田中 太郎', exact: true }).click();
  await session.locator('.session-heading').waitFor();
  await capture(session, 'session');
  await session.getByRole('link', { name: '② 相談する', exact: true }).click();
  await session.locator('.session-timetable').waitFor();
  await capture(session, 'session-plan');
  await capture(demo, 'demo-lms');
  await mail.goto(await done.getAttribute('href'));
  const confirmation = mail.getByRole('region', { name: '準備の予定の操作', exact: true });
  await confirmation.getByRole('button', { name: '終わった', exact: true }).waitFor();
  await capture(mail, 'student-plan-confirm');
  await confirmation.getByRole('button', { name: '終わった', exact: true }).click();
  await mail.getByRole('region', { name: '次は提出', exact: true }).waitFor();
  await capture(mail, 'student-plan-done');
  // Separate invented unreadable-deadline input covers red text on a timetable cell.
  const tasks = await db.collection('students/trial-student/assignments').get();
  const task = tasks.docs.find(doc => doc.data().latest.sourceId === 'DEMO101_TASK1');
  await task.ref.update({ reviewReasons: [{ kind: 'unreadable-deadline', detail: '' }] });
  await student.locator('.course-panel .review').waitFor();
  await capture(student, 'student-review');
  await session.getByRole('link', { name: '① 確かめる', exact: true }).click();
  await session.locator('.review-tag').first().waitFor();
  await capture(session, 'session-review');
  await demo.getByRole('button', { name: '「書き方を書くレポート」の締切を1日延ばす', exact: true }).click();
  await demo.getByRole('status').filter({ hasText: 'LMSの締切を1日延ばしました' }).waitFor();
  await demo.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await student.locator('.course-panel .deadline.changed').waitFor();
  if (!captureOnly) await student.locator('.previous-deadline').waitFor();
  await capture(student, 'student-changed');
  await capture(session, 'session-changed');
  if (!captureOnly) for (const family of ['BIZ UDPGothic', 'Space Grotesk', 'JetBrains Mono']) {
    assert(results.some(result => result.fonts.used.includes(family) && result.fonts.loaded.includes(family)), `${family} rendered in the suite`);
  }
  assert.deepEqual(errors, []);
  log(`PASS ToDoku: ${results.length} views, 1280/390px, fictional data, browser errors 0${captureOnly ? ' (before capture)' : ''}`);
} finally {
  await writeFile(`${evidence}/visual-results.json`, JSON.stringify({ captureOnly, results, errors }, null, 2));
  await browser.close();
  await db.terminate();
  await deleteApp(app);
}
