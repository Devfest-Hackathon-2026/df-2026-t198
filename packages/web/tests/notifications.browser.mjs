import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { createRequire } from 'node:module';
import { URL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { studentFixture } from '../src/shared/testing/student-fixture.ts';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'settings-browser');
const db = getFirestore(app), auth = getAuth(app);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const page = await context.newPage();
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i162-evidence';
const uid = 'notification-browser-student';
const student = db.doc(`students/${uid}`);
const errors = [];
page.on('pageerror', () => errors.push('page-error'));
async function login(target, id) {
  const token = await auth.createCustomToken(id);
  await target.evaluate(async customToken => {
    const { firebase } = await import('/src/shared/firebase.ts');
    const source = await (await globalThis.fetch('/src/shared/firebase.ts')).text();
    const sdk = await import(source.match(/from "([^"]*firebase_auth[^"]*)"/)[1]);
    await sdk.signInWithCustomToken(firebase.auth, customToken);
  }, token);
}
try {
  await auth.deleteUser(uid).catch(() => {});
  await auth.createUser({ uid, email: `${uid}@example.invalid`, emailVerified: true });
  const data = studentFixture();
  const batch = db.batch();
  for (const name of ['courses', 'assignments', 'fetchStates', 'plans', 'manualAssignments']) {
    (data[name] || []).forEach((row, i) => batch.set(student.collection(name).doc(`fake-${i}`), row));
  }
  await batch.commit();
  await student.collection('notificationSettings').doc('current').set({ enabled: false, deliveryOwner: 'extension', version: 1,
    timeZone: 'Asia/Tokyo', morningTime: '07:30', recipientUid: uid, migrationState: 'not-started', updatedAt: new Date().toISOString() });
  await student.collection('notificationStatus').doc('current').delete();
  await page.goto(`${process.env.KADAI_WEB_ORIGIN}/student`);
  await page.getByRole('button', { name: 'Googleでログイン' }).waitFor();
  await login(page, uid);
  await page.locator('.course-cell').first().waitFor();
  await mkdir(evidence, { recursive: true });
  const phase = process.argv.includes('--before') ? 'before' : 'after';
  if (phase === 'after') {
    await page.getByText('メール通知の設定', { exact: true }).click();
    const panel = page.getByRole('region', { name: 'メール通知の設定' });
    await panel.getByText('メール通知：停止中', { exact: true }).waitFor();
    await panel.getByText('まだ送信の記録はありません。', { exact: true }).waitFor();
    let puts = 0;
    page.on('request', request => { if (request.url().endsWith('/api/v1/notification-settings') && request.method() === 'PUT') puts++; });
    await page.route('**/api/v1/notification-settings', async route => {
      if (route.request().method() === 'PUT') await new Promise(resolve => globalThis.setTimeout(resolve, 250));
      await route.continue();
    });
    await panel.getByRole('button', { name: '通知を有効にする' }).evaluate(button => { button.click(); button.click(); });
    await panel.getByText('メール通知：有効', { exact: true }).waitFor();
    assert.equal(puts, 1, 'double click issues one mutation');
    const settings = (await student.collection('notificationSettings').doc('current').get()).data();
    assert.equal(settings.enabled, true); assert.equal(settings.deliveryOwner, 'cloud');
    assert.equal(settings.migrationState, 'ready'); assert.ok(Number.isFinite(Date.parse(settings.cloudSince)));
    await panel.getByRole('status').getByText('朝のまとめは次の07:30から', { exact: false }).waitFor();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
      assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
      await page.screenshot({ path: `${evidence}/cutover-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 960 });
    await page.unroute('**/api/v1/notification-settings');
    await page.reload();
    await page.getByText('メール通知の設定', { exact: true }).click();
    await panel.getByText('メール通知：有効', { exact: true }).waitFor();
    await panel.getByText('まだ送信の記録はありません。', { exact: true }).waitFor();
    await page.route('**/api/v1/notification-settings', route => route.request().method() === 'PUT' ? route.abort('failed') : route.continue());
    await panel.getByRole('button', { name: '通知を停止する' }).click();
    await panel.getByText('保存できたか確認できません。', { exact: false }).waitFor();
    assert.equal(await panel.getByRole('button', { name: '通知を有効にする' }).count(), 0);
    await page.unroute('**/api/v1/notification-settings');
    await panel.getByRole('button', { name: '状態を更新' }).click();
    await panel.getByText('メール通知：有効', { exact: true }).waitFor();
    await panel.getByRole('button', { name: '通知を停止する' }).click();
    await panel.getByText('メール通知：停止中', { exact: true }).waitFor();
    const stopped = (await student.collection('notificationSettings').doc('current').get()).data();
    assert.equal(stopped.enabled, false); assert.equal(stopped.deliveryOwner, 'cloud');
    for (const state of ['accepted', 'failed', 'unknown']) {
      await student.collection('notificationStatus').doc('current').set({ state, settingsVersion: 2,
        updatedAt: '2030-11-11T07:31:00+09:00', lastAcceptedAt: '2030-11-11T07:30:00+09:00',
        errorCode: state === 'failed' ? 'authorization-required' : state === 'unknown' ? 'outcome-unknown' : null });
      await panel.getByRole('button', { name: '状態を更新' }).click();
      await panel.getByText(state === 'accepted' ? '受信箱への到着は確認していません。' : state === 'failed' ? '送信元の接続をやり直す必要があります。' : '送信の結果が分かりません。', { exact: false }).waitFor();
      await panel.getByText('最後に送信サービスが受け付けた日時：', { exact: false }).waitFor();
    }
    // Ordinary students cannot choose another UID; sharing does not include notification settings.
    const secondContext = await browser.newContext();
    const second = await secondContext.newPage();
    const outsider = 'notification-browser-other';
    await auth.deleteUser(outsider).catch(() => {});
    await auth.createUser({ uid: outsider, email: `${outsider}@example.invalid`, emailVerified: true });
    await second.goto(`${process.env.KADAI_WEB_ORIGIN}/student`);
    await second.getByRole('button', { name: 'Googleでログイン' }).waitFor();
    assert.equal(await second.getByText('メール通知の設定', { exact: true }).count(), 0);
    await login(second, outsider);
    await second.getByText('メール通知の設定', { exact: true }).click();
    assert.equal(await second.getByRole('button', { name: '通知を有効にする' }).isEnabled(), true);
    const accessCheck = async () => second.evaluate(async owner => {
      const { firebase } = await import('/src/shared/firebase.ts');
      const token = await firebase.auth.currentUser.getIdToken();
      const response = await globalThis.fetch(`/api/v1/notification-settings?uid=${owner}`, { headers: { Authorization: `Bearer ${token}` } });
      const source = await (await globalThis.fetch('/src/shared/firebase.ts')).text();
      const sdk = await import(source.match(/from "([^"]*firebase_firestore[^"]*)"/)[1]);
      let denied = false;
      try { await sdk.getDoc(sdk.doc(firebase.db, 'students', owner, 'notificationSettings', 'current')); }
      catch { denied = true; }
      return { api: response.status, denied };
    }, uid);
    assert.deepEqual(await accessCheck(), { api: 400, denied: true });
    await db.doc(`demoAccounts/${outsider}`).set({ role: 'supporter', studentId: uid });
    await student.collection('supporters').doc(outsider).set({ scopes: ['all'], revokedAt: null });
    await second.getByRole('button', { name: '状態を更新' }).click();
    await second.getByText('このアカウントでは、実際のメール通知を設定できません。').waitFor();
    assert.deepEqual(await accessCheck(), { api: 400, denied: true });
    await login(page, outsider);
    await page.getByText('メール通知の設定', { exact: true }).click();
    await page.getByText('このアカウントでは、実際のメール通知を設定できません。').waitFor();
    assert.equal(await page.getByText('最後に送信サービスが受け付けた日時：', { exact: false }).count(), 0);
    await login(page, uid);
    await page.getByText('メール通知の設定', { exact: true }).click();
    await page.getByText('送信の結果が分かりません。', { exact: false }).waitFor();
    await secondContext.close();
    await db.doc(`demoAccounts/${outsider}`).delete();
    await auth.deleteUser(outsider);
  }
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 });
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
    await page.screenshot({ path: `${evidence}/${phase}-${width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log(phase === 'before' ? 'notification browser before: fictional screenshots captured' :
    'notification browser after: owner/other/supporter/unauthenticated, duplicate click, network failure, revisit, account switch and state labels checked; fictional screenshots captured');
} finally {
  await browser.close();
  await db.recursiveDelete(student);
  await auth.deleteUser(uid).catch(() => {});
  await deleteApp(app);
}
