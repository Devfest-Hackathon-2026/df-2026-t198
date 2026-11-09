// The calendar and mail settings above the timetable, against the Auth/Firestore emulators and the real settings API.
// The extension is a recorded stand-in here; tests/student-bridge.browser.mjs in the extension covers the real one.
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
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'connect-browser');
const db = getFirestore(app), auth = getAuth(app);
const browser = await chromium.launch({ headless: true });
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-connect-evidence';
const origin = process.env.KADAI_WEB_ORIGIN;
const uid = 'connect-browser-student';
const student = db.doc(`students/${uid}`);
const calendarId = 'fictional@group.calendar.google.com';
const errors = [];

async function account(id, emailVerified = true) {
  await auth.deleteUser(id).catch(() => {});
  await auth.createUser({ uid: id, email: `${id}@example.invalid`, emailVerified });
  await db.recursiveDelete(db.doc(`students/${id}`));
  await db.doc(`demoAccounts/${id}`).delete();
  const data = studentFixture();
  const batch = db.batch();
  for (const name of ['courses', 'assignments', 'fetchStates', 'plans', 'manualAssignments']) {
    (data[name] || []).forEach((row, i) => batch.set(db.doc(`students/${id}`).collection(name).doc(`fake-${i}`), row));
  }
  await batch.commit();
}
/** `extension` is null for a browser without ToDoku, otherwise the account the stand-in reports. */
async function open(id, { extension = null, width = 1280 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 960 } });
  const page = await context.newPage();
  page.on('pageerror', () => errors.push('page-error'));
  if (extension) await page.addInitScript(account => {
    globalThis.sent = []; globalThis.replies = { 'todoku-status': { ok: true, account } };
    globalThis.chrome = { runtime: { sendMessage: (id, message, callback) => {
      globalThis.sent.push({ id, ...message });
      globalThis.setTimeout(() => callback(globalThis.replies[message.type]), 150);
    } } };
  }, extension);
  await page.goto(`${origin}/student`);
  await page.getByRole('button', { name: 'Googleでログイン' }).waitFor();
  const token = await auth.createCustomToken(id);
  await page.evaluate(async customToken => {
    const { firebase } = await import('/src/shared/firebase.ts');
    const source = await (await globalThis.fetch('/src/shared/firebase.ts')).text();
    const sdk = await import(source.match(/from "([^"]*firebase_auth[^"]*)"/)[1]);
    await sdk.signInWithCustomToken(firebase.auth, customToken);
  }, token);
  const panel = page.getByRole('region', { name: 'カレンダーとメール' });
  await panel.waitFor();
  // Both settings have finished their first check before a scenario reads the buttons.
  for (const text of ['朝のメールの状態を確かめています…', '拡張機能を確かめています…']) await panel.getByText(text).waitFor({ state: 'detached' });
  const shot = async name => {
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, `${name}: horizontal overflow`);
    await panel.screenshot({ path: `${evidence}/${name}.png` });
  };
  const sent = type => page.evaluate(wanted => globalThis.sent.filter(message => message.type === wanted), type);
  return { context, page, panel, shot, sent, buttons: () => panel.getByRole('button').allTextContents() };
}
const item = (key, change = {}) => ({ itemKey: key.repeat(64), kind: 'deadline', sourceKey: { system: 'demo-lms', sourceId: key }, calendarId,
  eventId: `event${key}`, generation: 1, desiredRevision: 1, desired: { state: 'deleted' }, appliedRevision: 1,
  appliedAt: '2030-11-10T00:00:00.000Z', lastAttemptedAt: '2030-11-10T00:00:00.000Z', lastErrorCode: null, ...change });
const integration = (connectionState = 'connected') => ({ mode: 'google', executor: 'extension', calendarId, connectionState });

try {
  await mkdir(evidence, { recursive: true });
  await account(uid);

  // 1. No extension (phone, another browser, not installed): guidance instead of a calendar button; mail still starts here.
  for (const width of [1280, 390]) {
    const view = await open(uid, { width });
    await view.panel.getByText('PCのChromeにToDokuの拡張機能を入れて、この画面を開くと設定できます。').waitFor();
    assert.deepEqual(await view.buttons(), ['朝のメールを受け取る']);
    await view.shot(`no-extension-${width}`);
    await view.context.close();
  }

  // 2. Not set up, extension present: two buttons above the timetable, one click each.
  const view = await open(uid, { extension: 'none' });
  await view.panel.getByRole('button', { name: 'Google カレンダーに予定を入れる' }).waitFor();
  assert.deepEqual(await view.buttons(), ['Google カレンダーに予定を入れる', '朝のメールを受け取る']);
  const top = async locator => (await locator.boundingBox()).y;
  assert.ok(await top(view.panel) < await top(view.page.locator('.timetable')), 'the settings must sit above the timetable');
  await view.shot('not-set-up-1280');

  // 3. A refused Google dialog: the page says so and the same button remains. A double click sends one request.
  await view.page.evaluate(() => { globalThis.replies['todoku-calendar-connect'] = { ok: false, code: 'authorization-denied' }; });
  await view.panel.getByRole('button', { name: 'Google カレンダーに予定を入れる' }).evaluate(button => { button.click(); button.click(); });
  await view.panel.getByRole('alert').getByText('Googleの許可が終わりませんでした。もう一度ボタンを押すと、やり直せます。').waitFor();
  assert.deepEqual(await view.sent('todoku-calendar-connect'), [{ id: 'ghlhpjencbpglkbjmhadcbjgjpngdhll', type: 'todoku-calendar-connect', uid }]);
  await view.shot('refused-1280');
  // 4. Another account: the connection stops with guidance.
  await view.page.evaluate(() => { globalThis.replies['todoku-calendar-connect'] = { ok: false, code: 'account-mismatch' }; });
  await view.panel.getByRole('button', { name: 'Google カレンダーに予定を入れる' }).click();
  await view.panel.getByRole('alert').getByText('この画面と拡張機能のGoogleアカウントが違うため、接続を止めました。同じアカウントのChromeで開いてください。').waitFor();
  await view.shot('other-account-1280');
  assert.equal((await student.collection('integrations').doc('calendar').get()).exists, false);

  // 5. Connected: what the extension writes through the server appears in the same place, without a reload.
  await view.page.evaluate(() => { globalThis.replies['todoku-calendar-connect'] = { ok: true, synced: true }; globalThis.replies['todoku-calendar-sync'] = { ok: true, synced: true }; });
  await view.panel.getByRole('button', { name: 'Google カレンダーに予定を入れる' }).click();
  await student.collection('integrations').doc('calendar').set(integration());
  await student.collection('calendarItems').doc('a').set(item('a'));
  await student.collection('calendarItems').doc('b').set(item('b'));
  await view.panel.getByText('連携済み', { exact: true }).waitFor();
  await view.panel.getByRole('status').getByText('Google カレンダーに予定を入れました。').waitFor();
  assert.deepEqual(await view.buttons(), ['朝のメールを受け取る']);
  await view.shot('connected-1280');

  // 6. A change saved elsewhere waits for the extension; the open page asks it to write once, without a dialog.
  await student.collection('calendarItems').doc('b').set(item('b', { desiredRevision: 2 }));
  await view.panel.getByText('同期待ち', { exact: true }).waitFor();
  await view.page.waitForFunction(() => globalThis.sent.some(message => message.type === 'todoku-calendar-sync'));
  await view.page.waitForTimeout(600);
  assert.equal((await view.sent('todoku-calendar-sync')).length, 1);
  assert.equal((await view.sent('todoku-calendar-connect')).length, 3);
  await view.shot('waiting-1280');
  // 7. A failed write and a lost Google permission are told apart, each with its next step.
  await student.collection('calendarItems').doc('b').set(item('b', { desiredRevision: 2, lastErrorCode: 'network-error' }));
  await view.panel.getByText('入れられませんでした', { exact: true }).waitFor();
  assert.deepEqual(await view.buttons(), ['もう一度試す', '朝のメールを受け取る']);
  await view.shot('failed-1280');
  await view.panel.getByRole('button', { name: 'もう一度試す' }).click();
  await view.page.waitForFunction(() => globalThis.sent.filter(message => message.type === 'todoku-calendar-sync').length === 2);
  await student.collection('integrations').doc('calendar').set(integration('reauthorization-required'));
  await view.panel.getByText('再接続が必要', { exact: true }).waitFor();
  assert.deepEqual(await view.buttons(), ['Google カレンダーにつなぎ直す', '朝のメールを受け取る']);
  await view.shot('reconnect-1280');
  await student.collection('integrations').doc('calendar').set(integration());
  await student.collection('calendarItems').doc('b').set(item('b', { desiredRevision: 2, appliedRevision: 2 }));
  await view.panel.getByText('連携済み', { exact: true }).waitFor();

  // 8. Mail: one click enables the student's own cloud notification through the real settings API.
  assert.equal((await student.collection('notificationSettings').doc('current').get()).exists, false);
  let puts = 0;
  view.page.on('request', request => { if (request.url().endsWith('/api/v1/notification-settings') && request.method() === 'PUT') puts++; });
  await view.panel.getByRole('button', { name: '朝のメールを受け取る' }).evaluate(button => { button.click(); button.click(); });
  await view.panel.getByText('受け取り中', { exact: true }).waitFor();
  await view.panel.getByRole('status').getByText('朝のまとめは次の07:30から', { exact: false }).waitFor();
  assert.equal(puts, 1);
  const settings = (await student.collection('notificationSettings').doc('current').get()).data();
  assert.deepEqual([settings.enabled, settings.deliveryOwner, settings.migrationState, settings.recipientUid], [true, 'cloud', 'ready', uid]);
  assert.deepEqual(await view.buttons(), []);
  await view.shot('both-set-1280');
  // The panel below shows the same state, and stopping there brings the button back here.
  await view.page.getByText('メール通知の設定', { exact: true }).click();
  const details = view.page.getByRole('region', { name: 'メール通知の設定' });
  await details.getByText('メール通知：有効', { exact: true }).waitFor();
  await details.getByRole('button', { name: '通知を停止する' }).click();
  await view.panel.getByRole('button', { name: '朝のメールを受け取る' }).waitFor();
  await view.context.close();
  const narrow = await open(uid, { extension: 'same', width: 390 });
  await narrow.panel.getByText('連携済み', { exact: true }).waitFor();
  await narrow.shot('connected-390');
  await narrow.context.close();

  // 9. The extension is used by another account: no calendar button, guidance instead.
  const occupied = await open(uid, { extension: 'other' });
  await student.collection('integrations').doc('calendar').delete();
  await occupied.panel.getByText('拡張機能は別のGoogleアカウントで使われています。この画面と同じアカウントのChromeで開いてください。').waitFor();
  assert.deepEqual(await occupied.buttons(), ['朝のメールを受け取る']);
  await occupied.context.close();

  // 10. Mail cannot be enabled without a confirmed address: "準備中" with the reason, and the API refuses too.
  const unverified = 'connect-browser-unverified';
  await account(unverified, false);
  const pending = await open(unverified, { extension: 'none' });
  await pending.panel.getByText('準備中', { exact: true }).waitFor();
  await pending.panel.getByText('ログインしたGoogleアカウントのメールアドレスを確認できません。今は有効にできません。').waitFor();
  assert.deepEqual(await pending.buttons(), ['Google カレンダーに予定を入れる']);
  const refusedStatus = await pending.page.evaluate(async () => {
    const { firebase } = await import('/src/shared/firebase.ts');
    const response = await globalThis.fetch('/api/v1/notification-settings', { method: 'PUT', body: JSON.stringify({ enabled: true, version: 1 }),
      headers: { Authorization: `Bearer ${await firebase.auth.currentUser.getIdToken()}`, 'Content-Type': 'application/json' } });
    return response.status;
  });
  assert.equal(refusedStatus, 409);
  assert.equal((await db.doc(`students/${unverified}/notificationSettings/current`).get()).exists, false);
  await pending.shot('mail-not-ready-1280');
  await pending.context.close();

  // 11. Demo accounts never see a control that starts a real Google connection, even with the extension installed.
  const demo = 'connect-browser-demo';
  await account(demo);
  await db.doc(`demoAccounts/${demo}`).set({ role: 'student', studentId: demo });
  const trial = await open(demo, { extension: 'none' });
  await trial.panel.getByText('体験版では、実際のGoogle カレンダーとメールにはつなぎません。').waitFor();
  assert.deepEqual(await trial.buttons(), []);
  assert.deepEqual(await trial.page.evaluate(() => globalThis.sent), []);
  await trial.shot('demo-1280');
  await trial.context.close();

  assert.deepEqual(errors, []);
  console.log('connect browser: 11/11 scenarios passed');
} finally {
  await browser.close();
  await deleteApp(app);
}
