import assert from 'node:assert/strict';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.KADAI_WEB_ORIGIN || 'http://127.0.0.1:5179';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('local-browser-required');
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/re-student/next-action';
const browser = await chromium.launch({ headless: true });
const checks = [];
try {
  await mkdir(evidence, { recursive: true });
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}/student`);
    await page.evaluate(async () => {
      const { default: { createElement, act } } = await import('/node_modules/.vite/deps/react.js');
      const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
      const { StudentView } = await import('/src/features/student/page.tsx');
      const { studentFixture, assignment, dated } = await import('/src/shared/testing/student-fixture.ts');
      const data = studentFixture();
      const task = assignment('架空の今日の課題', dated('2026-11-14'));
      data.assignments = [task];
      data.fetchStates[0].lastSucceededAt = '2026-11-10T07:41:00+09:00';
      data.plans = [{ planId: 'fictional-plan', assignment: task.key, title: task.latest.title, date: '2026-11-10', period: 2,
        startsAt: '2026-11-10T10:30:00+09:00', endsAt: '2026-11-10T12:00:00+09:00', decidedOn: '2026-11-09', timeZone: 'Asia/Tokyo',
        confirmedBy: 'fictional-student', createdByRole: 'supporter', confirmedAt: '2026-11-09T09:00:00+09:00', status: 'active', revision: 3, calendarItemKey: 'fictional-item' }];
      const frame = globalThis.document.createElement('div'); frame.className = 'app';
      const host = globalThis.document.createElement('main'); frame.append(host); globalThis.document.body.replaceChildren(frame);
      const root = createRoot(host);
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
      globalThis.actionCalls = [];
      const actions = { add: async () => {}, remove: async id => { globalThis.actionCalls.push(['remove', id]); },
        act: async (...args) => { globalThis.actionCalls.push(args); const plan = data.plans[0];
          if (args[1] === 'done') plan.status = 'done'; else { plan.date = '2026-11-11'; plan.startsAt = '2026-11-11T10:30:00+09:00'; plan.endsAt = '2026-11-11T12:00:00+09:00'; }
          await render(); return { outcome: args[1] === 'done' ? 'done' : 'moved', plan, demo: true }; } };
      const render = async () => act(async () => root.render(createElement(StudentView, { data: globalThis.structuredClone(data), now: Date.parse('2026-11-10T03:00:00Z'), calendar: true, actions })));
      globalThis.renderStudent = async mode => {
        data.plans[0].status = mode === 'none' ? 'cancelled' : 'active';
        data.plans[0].date = '2026-11-10'; data.plans[0].startsAt = '2026-11-10T10:30:00+09:00'; data.plans[0].endsAt = '2026-11-10T12:00:00+09:00';
        await render();
      };
      await render();
    });
    const next = page.getByRole('region', { name: '次にやること', exact: true });
    await next.getByRole('heading', { name: '今日 10:30〜12:00 に、準備をする', exact: true }).waitFor();
    assert.equal(await page.locator('details.student-calendar').getAttribute('open'), null);
    assert.equal(await page.locator('details.rd-settings').getAttribute('open'), null);
    assert.equal(await next.locator('.td-btn-primary').count(), 1);
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
    await page.screenshot({ path: `${evidence}/next-${width}.png`, fullPage: true });
    await next.getByRole('button', { name: '後回しにする', exact: true }).click();
    await next.getByRole('heading', { name: '次の準備は 11/11（水）10:30', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => globalThis.actionCalls[0]), ['fictional-plan', 'later', 3]);
    assert.equal(await next.getByRole('button').count(), 0);
    await page.evaluate(() => globalThis.renderStudent('today'));
    await next.getByRole('button', { name: '終わった', exact: true }).click();
    await next.getByRole('status').waitFor();
    assert.deepEqual(await page.evaluate(() => globalThis.actionCalls[1]), ['fictional-plan', 'done', 3]);
    await next.getByRole('button', { name: '準備の予定を入れる', exact: true }).click();
    await page.getByLabel('準備する日', { exact: true }).waitFor();
    assert.equal(await page.locator('.preparation-add').getAttribute('open'), '');
    await page.evaluate(() => globalThis.renderStudent('today'));
    if (width === 390) await page.getByRole('tab', { name: '時間割', exact: true }).click();
    const preparation = page.locator('.timetable .preparation-cell');
    assert.equal(await preparation.evaluate(cell => {
      const outer = cell.getBoundingClientRect();
      return [...cell.children].every(child => {
        const box = child.getBoundingClientRect();
        return box.left >= outer.left && box.right <= outer.right && box.bottom <= outer.bottom;
      });
    }), true, 'preparation title and author remain inside the timetable cell');
    await preparation.click();
    const detail = page.getByRole('complementary', { name: '準備の予定の詳細', exact: true });
    await detail.getByRole('button', { name: '終わった', exact: true }).waitFor();
    await detail.getByRole('button', { name: /準備を外す/ }).click();
    assert.deepEqual(await page.evaluate(() => globalThis.actionCalls[2]), ['remove', 'fictional-plan']);
    assert.deepEqual(errors, []);
    checks.push(`${width}: next action, later/done revisions and notices, add form, timetable controls, folded calendar/settings, no page overflow`);
    await page.close();
  }
  await writeFile(`${evidence}/checks.json`, JSON.stringify({ passed: checks.length, checks }, null, 2));
  process.stdout.write(JSON.stringify({ observations: [{ requirement_id: 'next-actions', status: 'pass', observed: { passed: checks.length, checks }, evidence_files: ['checks.json', 'next-1280.png', 'next-390.png'] }] }) + '\n');
} finally { await browser.close(); }
