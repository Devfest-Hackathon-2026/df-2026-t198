import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openJudgeLogin } from './helpers/judge-login.mjs';

// Run using run-demo-browser.mjs --mobile inside the local emulator wrapper.
if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-demo-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dir = process.env.ARTIFACT_EVIDENCE_DIR || 'docs/records/2026-11-10-redesign-polish';
const phase = process.env.MOBILE_CHECK_PHASE || 'after';
assert.ok(['before', 'after'].includes(phase), 'MOBILE_CHECK_PHASE must be before or after');
const base = 'http://127.0.0.1:5177';
const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];
await mkdir(dir, { recursive: true });

async function measure(page, name, width) {
  await page.evaluate(async () => { await globalThis.document.fonts.ready; globalThis.window.scrollTo(0, 0); });
  await page.evaluate(async () => {
    const finite = globalThis.document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity);
    await Promise.all(finite.map(animation => animation.finished.catch(() => {})));
  });
  const result = await page.evaluate(() => {
    const visible = node => {
      const r = node.getBoundingClientRect(); const s = globalThis.getComputedStyle(node);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.clipPath !== 'inset(50%)' && !node.closest('.sr-only, [hidden], [aria-hidden="true"]');
    };
    const label = node => ({ tag: node.tagName, class: node.className, text: (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 90) });
    const targets = [...globalThis.document.querySelectorAll('a, button, summary, input, select')].filter(visible);
    const smallTargets = targets.filter(node => { const r = node.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).map(node => ({ ...label(node), width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height }));
    const texts = [...globalThis.document.querySelectorAll('main *')].filter(node => visible(node) && [...node.childNodes].some(child => child.nodeType === globalThis.Node.TEXT_NODE && child.textContent.trim()));
    const narrowText = texts.filter(node => {
      const s = globalThis.getComputedStyle(node); const r = node.getBoundingClientRect();
      const ranges = [...node.childNodes].filter(child => child.nodeType === globalThis.Node.TEXT_NODE && child.textContent.trim()).flatMap(child => { const range = globalThis.document.createRange(); range.selectNodeContents(child); return [...range.getClientRects()]; });
      return r.width < parseFloat(s.fontSize) * 2 && new Set(ranges.map(rect => Math.round(rect.top))).size > 1;
    }).map(label);
    const tinyText = texts.filter(node => parseFloat(globalThis.getComputedStyle(node).fontSize) < (node.closest('.course-cell span, .preparation-cell small') ? 9 : 12)).map(label);
    const bar = globalThis.document.querySelector('.app-header > .rd-bar-in');
    const items = bar ? [...bar.querySelectorAll('a, button')].filter(visible).map(node => node.getBoundingClientRect()) : [];
    const overlap = items.some((a, i) => items.slice(i + 1).some(b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
    const header = { height: bar?.getBoundingClientRect().height ?? 0, overlap, logoutCount: bar?.querySelectorAll('.rd-account-actions button').length ?? 0 };
    const next = [...globalThis.document.querySelectorAll('.rd-next .td-btn-primary, .rd-next-prepare')].find(visible);
    const nextBox = next?.getBoundingClientRect();
    const nextParent = next?.closest('.rd-next-actions')?.getBoundingClientRect();
    const stage = globalThis.document.querySelector('.rd-demo-stage:not([hidden])');
    const guide = stage?.querySelector('.rd-demo-guide')?.getBoundingClientRect();
    const windowBox = stage?.querySelector('.demo-triptych')?.getBoundingClientRect();
    const pane = stage?.querySelector('[data-selected="true"] .demo-pane-body')?.getBoundingClientRect();
    const backgrounds = { body: globalThis.getComputedStyle(globalThis.document.body).backgroundColor, app: globalThis.getComputedStyle(globalThis.document.querySelector('.app-shell')).backgroundColor };
    const scrollContainers = [...globalThis.document.querySelectorAll('.session-timetable-scroll, .calendar-scroll')].filter(visible).map(node => {
      const box = node.getBoundingClientRect();
      return { class: node.className, width: node.clientWidth, scrollWidth: node.scrollWidth, overflowX: globalThis.getComputedStyle(node).overflowX, insidePage: box.left >= 0 && box.right <= globalThis.innerWidth };
    });
    return { backgrounds, scrollContainers, overflow: Math.max(0, globalThis.document.documentElement.scrollWidth - globalThis.innerWidth), smallTargets, narrowText, tinyText, header,
      nextAction: nextBox ? { width: nextBox.width, height: nextBox.height, availableWidth: nextParent?.width } : null,
      demo: guide && windowBox ? { guideAbove: guide.bottom <= windowBox.top, paneHeight: pane?.height, viewportHeight: globalThis.innerHeight } : null };
  });
  results.push({ screen: name, width, ...result });
  process.stdout.write(`${phase} ${width} ${name}: overflow=${result.overflow} targets=${result.smallTargets.length} narrow=${result.narrowText.length} tiny=${result.tinyText.length}\n`);
  if (phase === 'after' && width === 390) await page.screenshot({ path: `${dir}/${name}-390.png`, fullPage: true, animations: 'disabled' });
}
async function login(page, role) {
  await page.goto(`${base}/demo-lms`); await openJudgeLogin(page);
  await page.getByLabel('メールアドレス').fill(`trial-${role}@example.invalid`);
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).waitFor();
}
try {
  for (const [width, height] of [[390, 844], [360, 740]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    const capture = name => measure(page, name, width);
    const status = text => page.getByRole('status').filter({ hasText: text }).waitFor();
    const tab = name => page.getByRole('navigation', { name: '体験の画面', exact: true }).getByRole('button', { name, exact: true });
    await page.goto(`${base}/demo-lms`); await page.getByRole('button', { name: '学生として試す', exact: true }).waitFor(); await capture('entry');
    await login(page, 'student');
    await page.getByRole('button', { name: 'LMSを開く', exact: true }).waitFor();
    // Reset data between viewport runs; all accounts and data are fictional.
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '体験を最初からやり直す', exact: true }).click();
    await status('体験を最初の状態に戻しました');
    await capture('demo-lms');
    await page.getByRole('button', { name: 'LMSを開く', exact: true }).click(); await status('課題を確認しました');
    await tab('LMS').click();
    const lms = page.locator('[data-demo-pane="lms"]');
    await capture('lms-courses');
    await lms.locator('.demo-course a').first().click(); await lms.locator('[data-demo-page=materials]:visible').waitFor(); await capture('lms-assignments');
    await lms.locator('.demo-task a').first().click(); await lms.locator('[data-demo-page=detail]:visible').waitFor(); await capture('lms-detail');
    const auto = page.getByLabel('自動で切り替える', { exact: false });
    await auto.uncheck(); await capture('demo-auto-off'); await auto.check();
    await page.getByRole('button', { name: '「第3回レポート（要約と引用）」の締切を1日延ばす', exact: true }).click();
    await status('LMSの締切を1日延ばしました'); await capture('demo-extended');
    await status('課題を確認しました');
    await page.locator('[data-demo-pane=student][data-selected=true]').waitFor(); await capture('demo-read-auto-student');
    await page.locator('[data-demo-pane=supporter][data-selected=true]').waitFor(); await capture('demo-read-auto-supporter');
    await tab('学生').click(); await capture('demo-student');
    await tab('支援担当').click(); await capture('demo-supporter');
    await page.getByRole('button', { name: '朝のメールを見る', exact: true }).click();
    const mail = page.getByRole('region', { name: '今日やることのメール', exact: true });
    await mail.locator('.digest-open-mail').waitFor(); await capture('mail');
    if (phase === 'after') {
      await mail.getByRole('link', { name: '終わった', exact: true }).waitFor();
      await mail.getByRole('link', { name: '後回しにする', exact: true }).waitFor();
    }
    await mail.getByRole('link', { name: /終わった/ }).first().click();
    const confirmation = page.getByRole('region', { name: '準備の予定の操作', exact: true });
    await confirmation.getByRole('button', { name: '終わった', exact: true }).waitFor(); await capture('confirmation-before');
    await confirmation.getByRole('button', { name: '終わった', exact: true }).click();
    await status('準備が終わりました'); await capture('confirmation-after');
    await page.goto(`${base}/student`);
    await page.locator('.rd-next').waitFor(); await capture('student-next');
    await page.getByRole('button', { name: '準備の予定を入れる', exact: true }).click();
    const studentForm = page.locator('.preparation-add .preparation-form');
    await studentForm.getByLabel('準備する日', { exact: true }).waitFor();
    assert.equal(await studentForm.getByLabel('準備する日', { exact: true }).evaluate(node => node === globalThis.document.activeElement), true);
    await capture('student-add-from-next');
    // Restore the input's closed state before testing its ordinary entry link.
    await page.locator('.preparation-add > summary').click();
    await page.getByRole('tab', { name: '時間割', exact: true }).click(); await capture('student-timetable');
    await page.locator('.timetable .course-cell').first().click(); await capture('student-course-detail');
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await page.getByRole('tab', { name: '準備', exact: true }).click();
    const fold = page.locator('details.rd-preparation');
    if (await fold.count() && !(await fold.evaluate(node => node.open))) await fold.locator(':scope > summary').click();
    await capture('student-preparation');
    await page.locator('.preparation-add > summary').click(); await capture('student-add-plan');
    await page.locator('.student-calendar > summary').click(); await capture('student-calendar');
    await page.locator('.rd-settings > summary').click(); await capture('student-settings');
    await page.goto(`${base}/session/trial-student`);
    await page.locator('.session-task-workspace').waitFor(); await capture('session-check');
    await page.goto(`${base}/session/trial-student/plan`);
    await page.locator('.session-timetable').waitFor(); await capture('session-consult');
    await page.locator('.session-candidate button').first().click();
    await page.locator('.session-planning .preparation-form').waitFor(); await capture('session-plan-form');
    await page.locator('.session-planning .preparation-form').getByRole('button', { name: '入れる', exact: true }).click();
    await status('準備の予定を入れました'); await capture('session-saved');
    await page.goto(`${base}/student`); await page.locator('.rd-next').waitFor();
    await page.getByRole('tab', { name: '時間割', exact: true }).click();
    await page.locator('.preparation-cell').first().click(); await capture('student-plan-detail');
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await page.getByRole('tab', { name: '準備', exact: true }).click();
    if (await fold.count() && !(await fold.evaluate(node => node.open))) await fold.locator(':scope > summary').click();
    await capture('student-active-preparation');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${base}/demo-lms`); await tab('LMS').waitFor(); await capture('demo-reduced-motion');
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await login(page, 'supporter');
    await page.goto(`${base}/session`);
    await page.getByRole('heading', { name: '担当する学生', exact: true }).waitFor(); await capture('student-picker');
    await page.goto(`${base}/session/trial-student`);
    await page.locator('.session-task-workspace').waitFor(); await capture('supporter-check');
    await page.goto(`${base}/session/trial-student/plan`);
    await page.locator('.session-timetable').waitFor(); await capture('supporter-consult');
    await page.locator('.session-candidate button').first().click();
    await page.locator('.session-planning .preparation-form').waitFor(); await capture('supporter-plan-form');
    await page.locator('.session-planning .preparation-form').getByRole('button', { name: '入れる', exact: true }).click();
    await status('準備の予定を入れました'); await capture('supporter-saved');
    await context.close();
  }
} finally {
  await browser.close();
  const file = `${dir}/mobile-check.json`;
  let previous = {}; try { previous = JSON.parse(await readFile(file, 'utf8')); } catch { /* first measurement */ }
  await writeFile(file, JSON.stringify({ ...previous, [phase]: { measuredAt: new Date().toISOString(), results: results.map(({ smallTargets, narrowText, tinyText, ...row }) => ({ ...row, smallTargets: smallTargets.length, narrowText: narrowText.length, tinyText: tinyText.length })), violations: Object.fromEntries(['smallTargets', 'narrowText', 'tinyText'].map(rule => [rule, [...new Map(results.flatMap(row => row[rule]).map(item => [JSON.stringify(item), item])).values()]])), browserErrors: errors } }, null, 2) + '\n');
}
assert.deepEqual(errors, []);
if (phase === 'after') for (const row of results) {
  assert.equal(row.backgrounds.body, row.backgrounds.app, `${row.screen}: body and app background`);
  assert.equal(row.overflow, 0, `${row.screen} ${row.width}: page overflow`);
  assert.equal(row.smallTargets.length, 0, `${row.screen} ${row.width}: small targets`);
  assert.equal(row.narrowText.length, 0, `${row.screen} ${row.width}: narrow text`);
  assert.equal(row.tinyText.length, 0, `${row.screen} ${row.width}: tiny text`);
  if (row.screen !== 'entry') assert.equal(row.header.logoutCount, 1, `${row.screen}: logout in header`);
  for (const scroll of row.scrollContainers) {
    assert.ok(scroll.insidePage, `${row.screen}: scroll container inside page`);
    if (scroll.scrollWidth > scroll.width) assert.ok(['auto', 'scroll'].includes(scroll.overflowX), `${row.screen}: wide table scrolls inside its container`);
  }
  assert.ok(row.header.height <= 64 && !row.header.overlap, `${row.screen} ${row.width}: header`);
  if (row.nextAction) assert.ok(row.nextAction.height >= 52 && row.nextAction.width >= row.nextAction.availableWidth - 1, `${row.screen}: next action`);
  if (row.demo) {
    assert.ok(row.demo.guideAbove, `${row.screen}: guide above window`);
    assert.ok(Math.abs(row.demo.paneHeight / row.demo.viewportHeight - .7) < .08, `${row.screen}: window height`);
  }
}
process.stdout.write(`Mobile ${phase}: ${results.length} screens measured\n`);
