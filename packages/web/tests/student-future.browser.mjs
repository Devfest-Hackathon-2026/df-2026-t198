import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { openJudgeLogin } from './helpers/judge-login.mjs';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' || !process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:') || !process.env.KADAI_DEMO_PASSWORD) throw new Error('local-only');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'student-future');
const db = getFirestore(app);
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
const phase = process.env.CLARITY_PHASE || 'after';
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-student-future';
const base = process.env.KADAI_WEB_ORIGIN;
assert.ok(base?.startsWith('http://127.0.0.1:'));
await mkdir(evidence, { recursive: true });
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  await page.goto(`${base}/demo-lms`);
  await page.getByText('ToDokuを試す', { exact: true }).waitFor();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.locator('.app-header nav').count(), 0);
    await page.screenshot({ path: `${evidence}/entry-${viewport.width}.png`, fullPage: true, animations: 'disabled' });
  }
  await openJudgeLogin(page);
  await page.getByLabel('メールアドレス').fill('trial-student@example.invalid');
  await page.getByLabel('パスワード').fill(process.env.KADAI_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  const rows = await db.collection('students/trial-student/assignments').get();
  const batch = db.batch();
  // Fictional dates relative to the current week; include four tasks and shuffle their order.
  const monday = new Date();
  monday.setUTCDate(monday.getUTCDate() + 8 - (monday.getUTCDay() || 7));
  let index = 0;
  for (const row of rows.docs) {
    const value = row.data();
    if (value.submission === 'submitted' || value.presenceState !== 'active') continue;
    const due = new Date(monday); due.setUTCDate(due.getUTCDate() + [3, 0, 2, 1][index++ % 4]);
    const deadline = { kind: 'datetime', dueAt: due.toISOString(), timeZone: 'Asia/Tokyo', dueText: '架空の締切' };
    batch.update(row.ref, { 'latest.deadline': deadline, 'officialDeadline.deadline': deadline });
  }
  await batch.commit();
  await page.goto(`${base}/student`);
  await page.locator('.upcoming').waitFor();
  const results = [];
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const heading = await page.locator('#upcoming-title').innerText();
    if (phase === 'after') {
      assert.match(heading, /^これからの締切/);
      assert.equal(await page.locator('.empty-week').count(), 0);
      const days = await page.locator('.upcoming > ul > li > time').evaluateAll(nodes => nodes.map(node => node.dateTime));
      assert.ok(days.length > 0 && days.length <= 3);
      assert.deepEqual(days, [...days].sort());
    } else assert.match(heading, /^今週の締切/);
    await page.screenshot({ path: `${evidence}/student-future-${phase}-${viewport.width}.png`, fullPage: true, animations: 'disabled' });
    assert.equal(await page.locator('.app-header nav').count(), 1);
    results.push({ width: viewport.width, heading });
  }
  await writeFile(`${evidence}/student-future-${phase}.json`, JSON.stringify({ phase, results }, null, 2));
} finally { await browser.close(); await db.terminate(); await deleteApp(app); }
