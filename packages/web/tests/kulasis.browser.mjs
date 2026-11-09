import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { readFile, mkdir } from 'node:fs/promises';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'].every(key => /^127\.0\.0\.1:\d+$/.test(process.env[key] ?? ''))) throw new Error('local-emulators-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const { getAuth } = requireServer('firebase-admin/auth');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'kulasis-browser');
const db = getFirestore(app), browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const errors = [];
page.on('pageerror', () => errors.push('browser-error'));
await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i180-evidence';
const origin = process.env.KADAI_WEB_ORIGIN;
let uid;
try {
  await mkdir(evidence, { recursive: true });
  await page.goto(origin + '/student');
  const auth = await page.evaluate(async () => {
    const { firebase } = await import('/src/shared/firebase.ts');
    const source = await (await globalThis.fetch('/src/shared/firebase.ts')).text();
    const sdk = await import(source.match(/from "([^"]*firebase_auth[^"]*)"/)[1]);
    const user = (await sdk.signInAnonymously(firebase.auth)).user;
    return { uid: user.uid, token: await user.getIdToken() };
  });
  uid = auth.uid;
  const sample = await readFile(new URL('../../../lms-definitions/kulasis/samples/timetable.cp932.html', import.meta.url));
  const support = await readFile(new URL('../../../lms-definitions/kulasis/samples/support.html', import.meta.url), 'utf8');
  // Only fabricated in-memory responses reach the collector. Real LMS network requests are blocked.
  const timetable = await page.evaluate(async ({ bytes, support, collectorPath }) => {
    const { collectKulasisObservation } = await import(collectorPath);
    return collectKulasisObservation({ pageUrl: 'https://www.k.kyoto-u.ac.jp/student/la/top',
      observationId: '18000000-0000-4000-8000-000000000001', fetchedAt: '2030-11-08T00:00:00Z', signal: new globalThis.AbortController().signal,
      resolveSite: async () => 'fictional-course',
      fetcher: async url => new globalThis.Response(String(url).includes('/entry/') ? new Uint8Array(bytes) : String(url).endsWith('1') ? support : '<html></html>') });
  }, { bytes: [...sample], support, collectorPath: `/@fs${process.cwd()}/packages/extension/src/kulasis-collection.ts` });
  assert.equal(timetable.failures.length, 0);
  const lms = JSON.parse(await readFile(new URL('../../../lms-definitions/kulms/samples/observation.expected.json', import.meta.url), 'utf8'));
  lms.observationId = randomUUID();
  lms.catalogCourses[0].name = '架空の対応済み授業';
  lms.catalogCourses.push({ courseId: 'fictional-unlinked', name: '架空の授業', slots: [], url: 'https://lms.gakusei.kyoto-u.ac.jp/portal/site/fictional-unlinked' });
  lms.courseResults.push({ courseId: 'fictional-unlinked', listComplete: true, seenSourceIds: ['fictional-unlinked-task'] });
  lms.assignments.push({ ...lms.assignments[0], courseId: 'fictional-unlinked', sourceId: 'fictional-unlinked-task', title: '架空の対応しない課題' });
  async function post(observation) {
    const result = await globalThis.fetch(`http://127.0.0.1:${process.env.KADAI_API_PORT}/api/v1/observations`, {
      method: 'POST', headers: { Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(observation) });
    assert.equal(result.status, 200);
  }
  await post(lms); await post(timetable);
  await page.locator('.course-cell').filter({ hasText: '架空の対応済み授業' }).first().waitFor();
  const meetings = page.locator('.course-cell').filter({ hasText: '架空の対応済み授業' });
  assert.equal(await meetings.count(), 2);
  assert.match(await meetings.first().innerText(), /架空の課題A/);
  const firstRow = page.locator('.timetable tbody tr').nth(0);
  assert.match(await firstRow.locator('td').nth(0).innerText(), /架空の対応済み授業/);
  assert.match(await page.locator('.timetable tbody tr').nth(2).locator('td').nth(0).innerText(), /架空の課題A/);
  await meetings.first().click();
  const panel = page.getByRole('complementary', { name: '架空の対応済み授業の課題' });
  await panel.getByRole('heading', { name: '架空の課題A', exact: true }).waitFor();
  assert.equal(await panel.getByRole('link', { name: 'LMSで授業を開く' }).getAttribute('href'), lms.catalogCourses[0].url);
  const outside = page.getByRole('heading', { name: '曜日・時限のない授業', exact: true }).locator('..');
  await outside.getByRole('button', { name: '架空の授業', exact: true }).click();
  await page.getByRole('heading', { name: '架空の対応しない課題', exact: true }).waitFor();
  await page.screenshot({ path: `${evidence}/student-wide.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: '時間割', exact: true }).click();
  await meetings.first().click();
  await panel.getByRole('heading', { name: '架空の課題A', exact: true }).waitFor();
  await page.screenshot({ path: `${evidence}/student-narrow.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.goto(`${origin}/session/${uid}/plan`);
  const sessionMeetings = page.locator('.session-course').filter({ hasText: '架空の対応済み授業' });
  await sessionMeetings.first().waitFor();
  assert.equal(await sessionMeetings.count(), 2);
  assert.match(await sessionMeetings.first().innerText(), /架空の課題A/);
  await page.getByRole('region', { name: '曜日・時限がまだ分からない授業' }).getByText('架空の対応しない課題', { exact: false }).waitFor();
  await page.screenshot({ path: `${evidence}/session-wide.png`, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('KULASIS browser: fabricated CP932 → observation API → student (1280/390px) / session; linked slots and separate unlinked task passed; browser errors 0');
} finally {
  if (uid) { await db.recursiveDelete(db.collection('students').doc(uid)); await getAuth(app).deleteUser(uid); }
  await browser.close(); await db.terminate(); await deleteApp(app);
}
