import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { log } from 'node:console';
import { createRequire } from 'node:module';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085' ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('local-emulators-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'public-demo-browser');
const db = getFirestore(app);
const browser = await chromium.launch({ headless: true });
const studentContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
const supporterContext = await browser.newContext();
const student = await studentContext.newPage();
const supporter = await supporterContext.newPage();
const base = 'http://127.0.0.1:5177';
const studentId = 'public-1-student';
const errors = [];
for (const page of [student, supporter]) {
  page.setDefaultTimeout(15000);
  page.on('pageerror', () => errors.push('browser-error'));
}
const assignments = () => db.collection(`students/${studentId}/assignments`).get();
const deadline = async () => (await assignments()).docs.find(doc => doc.data().latest.sourceId === 'DEMO101_TASK1').data().officialDeadline.deadline.dueAt;
const confirmed = () => student.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
try {
  await student.goto(`${base}/`);
  const entry = student.getByRole('region', { name: '体験版に入る', exact: true });
  await entry.getByRole('button', { name: '学生として試す', exact: true }).waitFor();
  // Since #244 the landing entry shows only the buttons; the three-pane trial needs no second browser.
  assert.doesNotMatch(await entry.innerText(), /別のブラウザか別の端末/);
  const rejectLogin = route => route.fulfill({ status: 400, contentType: 'application/json',
    body: JSON.stringify({ error: { message: 'EMAIL_NOT_FOUND' } }) });
  await student.route('**/accounts:signInWithPassword?*', rejectLogin);
  // The landing page shows only the student entry (#244); the supporter entry stays on /demo-lms.
  for (const role of ['学生']) {
    await entry.getByRole('button', { name: `${role}として試す`, exact: true }).click();
    await entry.getByRole('alert').filter({ hasText: '体験版に入れませんでした。少し待ってからもう一度押すか、説明資料のアカウントで入ってください。' }).waitFor();
    assert.doesNotMatch(await entry.innerText(), /EMAIL_NOT_FOUND|FirebaseError|auth\//);
  }
  await student.unroute('**/accounts:signInWithPassword?*', rejectLogin);
  await entry.getByRole('button', { name: '学生として試す', exact: true }).click();
  await student.waitForURL(`${base}/demo-lms`);
  await student.goBack();
  const restoredEntry = student.getByRole('button', { name: '学生として試す', exact: true });
  await restoredEntry.waitFor(); assert.equal(await restoredEntry.isEnabled(), true);
  await restoredEntry.click(); await student.waitForURL(`${base}/demo-lms`);
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).waitFor();
  assert.equal(await student.getByRole('region', { name: '体験版に入る', exact: true }).count(), 0);
  await supporter.goto(`${base}/demo-lms`);
  await supporter.getByRole('button', { name: '支援担当として試す', exact: true }).click();
  await supporter.waitForURL(`${base}/session`);
  await supporter.getByRole('link', { name: '田中 太郎', exact: true }).click();
  const deadlines = supporter.getByRole('region', { name: '次の面談までの締切' });
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await confirmed();
  await deadlines.getByText('書き方を書くレポート', { exact: true }).waitFor();
  const before = await deadline();
  await student.getByRole('button', { name: '「書き方を書くレポート」の締切を1日延ばす', exact: true }).click();
  await student.getByRole('status').filter({ hasText: 'LMSの締切を1日延ばしました' }).waitFor();
  assert.equal(await deadline(), before);
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await confirmed();
  assert.equal(Date.parse(await deadline()) - Date.parse(before), 86400_000);
  const expectedDate = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(await deadline()));
  await deadlines.getByText(expectedDate, { exact: false }).first().waitFor();
  // The server selects and reserves the separate public budget; no real model is used.
  const day = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  await db.doc(`publicAnnouncementUsage/${day}`).set({ yen: 3000, calls: 12 });
  await student.locator('.demo-more > summary').click();
  await student.getByRole('button', { name: 'お知らせを出す', exact: true }).first().click();
  await student.getByRole('status').filter({ hasText: 'お知らせを出しました' }).waitFor();
  await student.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await student.getByRole('status').filter({ hasText: '体験版で今日使えるお知らせの読み取りの回数を使い切りました' }).waitFor();
  student.once('dialog', dialog => dialog.accept());
  await student.getByRole('button', { name: '体験を最初からやり直す', exact: true }).click();
  await student.getByRole('status').filter({ hasText: '体験を最初の状態に戻しました' }).waitFor();
  assert.deepEqual((await db.doc(`publicAnnouncementUsage/${day}`).get()).data(), { yen: 3000, calls: 12 });
  assert.deepEqual(errors, []);
  log('Public demo: role buttons, fixed login failures, extension -> LMS -> live supporter update, quota message and reset passed (emulators only).');
} finally {
  await browser.close();
  await db.terminate();
  await deleteApp(app);
}
