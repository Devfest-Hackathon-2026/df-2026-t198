import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { log } from 'node:console';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !process.env.SESSION_DEMO_PASSWORD) throw new Error('local-session-demo-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'session-browser');
const db = getFirestore(app);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
page.setDefaultTimeout(15000);
const dir = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i39-evidence';
const errors = [];
page.on('pageerror', () => errors.push('browser-error'));
const student = db.collection('students').doc('demo-student-a');
const grant = student.collection('supporters').doc('demo-supporter');
const contextRef = student.collection('sessionContext').doc('current');
const originalContext = (await contextRef.get()).data();
assert.ok(originalContext);
const select = async uid => {
  if (new URL(page.url()).pathname !== '/session') await page.getByRole('link', { name: '学生を選び直す', exact: true }).click();
  await page.getByRole('link', { name: `学生 ${uid}`, exact: true }).click();
};
const markerMeasurements = [];
const selectorChecks = async () => {
  assert.equal(await page.getByRole('button', { name: '一覧を更新', exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: '自分の面談を見る', exact: true }).count(), 0);
  for (const card of await page.locator('.session-students nav a').all()) {
    assert.equal(await card.locator('strong').innerText(), '学生');
    assert.match(await card.locator('.session-student-id').innerText(), /^demo-student-/);
    assert.equal(await card.locator('.session-student-id').evaluate(node => {
      const style = globalThis.getComputedStyle(node);
      return style.fontWeight === '400' && style.fontSize === '12px';
    }), true);
  }
};
const markerChecks = async row => {
  const summary = row.locator('summary');
  const layout = await summary.evaluate(node => {
    const course = node.querySelector('.eyebrow');
    return { topDifference: Math.abs(node.getBoundingClientRect().top - course.getBoundingClientRect().top),
      marker: globalThis.getComputedStyle(node, '::before').content,
      listStyle: globalThis.getComputedStyle(node).listStyleType };
  });
  assert.ok(layout.topDifference <= 4, `marker and course top differ by ${layout.topDifference}px`);
  markerMeasurements.push({ width: page.viewportSize().width, topDifference: layout.topDifference });
  assert.equal(layout.marker, '"▸"');
  assert.equal(layout.listStyle, 'none');
  await summary.focus(); await page.keyboard.press('Enter');
  assert.equal(await row.getAttribute('open') !== null, true);
  assert.equal(await summary.evaluate(node => globalThis.getComputedStyle(node, '::before').content), '"▾"');
  await page.keyboard.press('Space');
  assert.equal(await row.getAttribute('open'), null);
  await summary.evaluate(node => node.blur());
};
const removedCopy = /学生と一緒に見る画面です|学生が見せることにした|今日の面談|面談の準備|未提出/;
const deadlineRegion = () => page.getByRole('region', { name: '次の面談までの締切' });
try {
  await mkdir(dir, { recursive: true });
  const now = new Date();
  const dayInJapan = at => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(at);
  await page.clock.setFixedTime(now);
  const task = (await student.collection('assignments').get()).docs[0];
  const originalTask = task.data();
  // Six days leave at least two free weekday periods; Monday period 2 contains a class.
  await task.ref.update({ 'officialDeadline.deadline.date': dayInJapan(new Date(now.getTime() + 6 * 86400_000)) });
  await student.collection('plans').doc('fictional-promise').set({ assignment: originalTask.key,
    date: '2026-11-10', period: 3, decidedOn: originalContext.lastSessionAt.slice(0, 10), planId: 'fictional-promise', title: '架空の数学レポート', timeZone: 'Asia/Tokyo', startsAt: '2026-11-10T13:00:00+09:00', endsAt: '2026-11-10T14:30:00+09:00', confirmedBy: 'demo-supporter', createdByRole: 'supporter', confirmedAt: '2026-11-01T00:00:00Z', status: 'active', revision: 1, calendarItemKey: 'fictional' });
  const plansBefore = (await student.collection('plans').get()).size;
  const writes = [];
  page.on('request', request => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()) && /\/api\//.test(request.url())) writes.push(new URL(request.url()).pathname);
  });
  await page.goto('http://127.0.0.1:5177/session');
  await page.getByLabel('メールアドレス').fill('demo-supporter@example.invalid');
  await page.getByLabel('パスワード').fill(process.env.SESSION_DEMO_PASSWORD);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByText('学生が見せることにした授業と課題だけを出しています。').waitFor();
  await page.locator('.session-students nav a').first().waitFor();
  await selectorChecks();
  await page.screenshot({ path: `${dir}/students-wide.png`, fullPage: true });
  await select('demo-student-a');
  await deadlineRegion().getByRole('heading', { name: '架空の数学レポート' }).waitFor();
  assert.equal(new URL(page.url()).pathname, '/session/demo-student-a');
  assert.equal(await page.locator('.session-heading h1').innerText(), '学生');
  assert.equal(await page.locator('.session-heading .session-student-id').innerText(), 'demo-student-a');
  assert.doesNotMatch(await page.locator('.session-heading').textContent(), /今回|日本時間|Asia\/Tokyo/);
  assert.doesNotMatch(await page.locator('main').textContent(), /面談日時は日本時間|Asia\/Tokyo|模擬LMS/);
  assert.match(await page.locator('.session-updates').innerText(), /体験用LMS/);
  const logoutStyle = await page.locator('.session-account .logout').evaluate(node => {
    const style = globalThis.getComputedStyle(node);
    return { decoration: style.textDecorationLine, border: style.borderWidth, background: style.backgroundColor };
  });
  assert.equal(logoutStyle.decoration, 'underline');
  assert.equal(logoutStyle.border, '0px');
  assert.equal(logoutStyle.background, 'rgba(0, 0, 0, 0)');
  await page.getByRole('region', { name: '前回の面談からの変化' }).getByText(/課題が出ました/).waitFor();
  await page.getByRole('region', { name: '前回の約束' }).getByText(/3限に準備/).waitFor();
  assert.match(await deadlineRegion().innerText(), /要確認.*今回、課題の締切を読めませんでした/);
  assert.match(await deadlineRegion().innerText(), /日付のみ/);
  assert.equal(await page.getByRole('table').count(), 0);
  assert.equal(await page.locator('#session-decisions').count(), 0);
  assert.doesNotMatch(await page.locator('main').innerText(), removedCopy);
  const row = deadlineRegion().locator('details').first();
  assert.equal(await row.getByRole('link', { name: 'LMSで見る ›' }).isVisible(), false);
  await row.locator('summary').click();
  await row.getByRole('link', { name: 'LMSで見る ›' }).waitFor();
  await row.getByRole('heading', { name: '書いてあったこと' }).waitFor();
  await row.getByRole('heading', { name: 'これまでの変更' }).waitFor();
  await row.locator('summary').click();
  await markerChecks(row);
  await page.screenshot({ path: `${dir}/check-wide.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  await markerChecks(row);
  await page.screenshot({ path: `${dir}/check-narrow.png`, fullPage: true });

  await page.getByRole('link', { name: '準備する時間を相談する →', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, '/session/demo-student-a/plan');
  await page.getByRole('table', { name: '授業と準備の候補' }).waitFor();
  assert.equal(await page.locator('#session-deadlines, #session-changes').count(), 0);
  assert.equal(await page.locator('.session-candidate').count(), 2);
  assert.match(await page.locator('.session-candidate').first().innerText(), /候補/);
  // Monday period 2 contains a class and must never contain a suggestion.
  assert.equal(await page.locator('tbody tr').nth(1).locator('td').first().locator('.session-candidate').count(), 0);
  await page.getByRole('region', { name: '今日決めること' }).getByText('要確認', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '学生に確認を頼む', exact: true }).count(), 0);
  assert.equal(await page.locator('.session-candidate button').first().isEnabled(), true);
  assert.equal((await student.collection('plans').get()).size, plansBefore);
  assert.deepEqual(writes, []);
  assert.doesNotMatch(await page.locator('main').innerText(), removedCopy);
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
  await page.screenshot({ path: `${dir}/plan-narrow.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 960 });
  await page.screenshot({ path: `${dir}/plan-wide.png`, fullPage: true });
  await page.goBack();
  await deadlineRegion().waitFor();
  assert.equal(await page.getByRole('table').count(), 0);
  await page.getByRole('link', { name: '② 相談する', exact: true }).click();
  await page.reload(); // Direct planning URL must work with the existing login.
  await page.getByRole('table', { name: '授業と準備の候補' }).waitFor();
  await page.getByRole('link', { name: '① 確かめる', exact: true }).click();
  await deadlineRegion().waitFor();

  await select('demo-student-b');
  await deadlineRegion().getByRole('heading', { name: '架空の物理演習' }).waitFor();
  assert.doesNotMatch(await page.locator('main').innerText(), /架空の数学レポート/);
  await select('demo-student-a');
  await deadlineRegion().getByRole('heading', { name: '架空の数学レポート' }).waitFor();
  await page.getByText('面談日時を変える', { exact: true }).click();
  const nextInput = page.getByLabel('次の面談（日本時間）');
  const save = page.getByRole('button', { name: '面談日時を保存', exact: true });
  const before = `${dayInJapan(now)}T00:00`;
  await nextInput.fill(before); await save.click();
  await page.waitForFunction(() => !globalThis.document.getElementById('session-deadlines').parentElement.innerText.includes('日付のみ'));
  assert.equal((await contextRef.get()).data().nextSessionAt, `${before}:00+09:00`);
  await page.getByText('面談日時を変える', { exact: true }).click();
  await nextInput.fill(''); await save.click();
  await page.getByText('次の面談日時を決めると、この期間の締切が出ます。').waitFor();
  assert.equal((await contextRef.get()).data().nextSessionAt, null);
  await contextRef.set(originalContext);
  await deadlineRegion().getByRole('heading', { name: '架空の数学レポート' }).waitFor();
  await task.ref.update({ 'latest.title': '数学レポートの変更後' });
  await deadlineRegion().getByRole('heading', { name: '数学レポートの変更後' }).waitFor();
  const beforeDeadline = { kind: 'datetime', dueAt: `${dayInJapan(new Date(now.getTime() + 3 * 86400_000))}T17:00:00+09:00`,
    dueText: '架空の日時', timeZone: 'Asia/Tokyo' };
  const afterDeadline = { ...beforeDeadline, dueAt: `${dayInJapan(new Date(now.getTime() + 4 * 86400_000))}T17:00:00+09:00` };
  await task.ref.update({ 'officialDeadline.deadline': beforeDeadline });
  const format = deadline => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric',
    day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(deadline.dueAt));
  await deadlineRegion().locator('.deadline').filter({ hasText: format(beforeDeadline) }).waitFor();
  await task.ref.update({ 'officialDeadline.deadline': afterDeadline });
  await student.collection('changes').doc('fictional-extension-i67').set({ changeId: 'fictional-extension-i67',
    assignmentKey: originalTask.key, kind: 'deadline-changed', before: beforeDeadline, after: afterDeadline,
    recordedAt: now.toISOString(), observationId: 'fictional-extension-i67' });
  const changes = page.getByRole('region', { name: '前回の面談からの変化' });
  await changes.getByText(`数学レポートの変更後：締切が ${format(beforeDeadline)} から ${format(afterDeadline)} に変わりました`, { exact: false }).waitFor();
  assert.match(await changes.locator('li').first().innerText(), /数学レポートの変更後：締切が \d+\/\d+ \d+:\d+ から \d+\/\d+ \d+:\d+ に変わりました/);
  assert.doesNotMatch(await page.locator('main').textContent(), /Asia\/Tokyo|面談日時は日本時間|模擬LMS/);
  await page.screenshot({ path: `${dir}/deadline-changed-wide.png`, fullPage: true });
  await page.getByRole('link', { name: '② 相談する', exact: true }).click();
  await page.getByRole('table', { name: '授業と準備の候補' }).waitFor();
  await grant.update({ revokedAt: new Date().toISOString() });
  await page.getByRole('alert').filter({ hasText: /表示.*消しました/ }).waitFor();
  assert.doesNotMatch(await page.locator('main').innerText(), /数学レポートの変更後|日付のみ|今回、課題の締切|3限に準備/);
  assert.equal(await page.locator('table, #session-changes, #session-decisions').count(), 0);
  await page.getByRole('link', { name: '学生を選び直す', exact: true }).click();
  await page.reload();
  await page.getByRole('link', { name: '学生 demo-student-a', exact: true }).waitFor({ state: 'detached' });
  const otherGrant = db.doc('students/demo-student-b/supporters/demo-supporter');
  await otherGrant.update({ revokedAt: now.toISOString() });
  await page.reload();
  await page.getByRole('link', { name: '自分の面談を見る', exact: true }).waitFor();
  assert.equal(await page.locator('.session-students nav a').count(), 0);
  await otherGrant.update({ revokedAt: null });
  await page.reload();
  await page.locator('.session-students nav a').first().waitFor();
  await selectorChecks();
  await select('demo-student-b');
  await deadlineRegion().getByRole('heading', { name: '架空の物理演習' }).waitFor();
  await page.getByRole('link', { name: '学生', exact: true }).click();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).waitFor();
  await page.getByRole('link', { name: '面談', exact: true }).click();
  await select('demo-student-b');
  await deadlineRegion().getByRole('heading', { name: '架空の物理演習' }).waitFor();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await page.getByRole('heading', { name: '面談にログイン', exact: true }).waitFor();
  assert.doesNotMatch(await page.locator('main').innerText(), /架空の物理演習|学生 demo-student/);
  assert.deepEqual(errors, []);
  await task.ref.set(originalTask);
  const operations = [
    'secondary student IDs and no redundant selector actions', 'own session only without assigned students',
    'no internal timezone labels and trial LMS wording', 'link-style logout', 'deadline extension sentence after live update',
    'aligned disclosure and Enter/Space at 1280px and 390px', 'student selector only sharing notice', 'checking without timetable or decisions', 'row-only source details',
    'previous promises', 'planning without full deadline/change list', 'two free weekday suggestions',
    'available add buttons and no writes before choosing', 'both step links', 'browser back', 'direct URL reload',
    '390px checking and planning', 'student switch', 'session time edit and unset', 'live assignment update',
    'revocation clears planning and promises', 'revoked student removed', 'shared login across routes', 'logout clears data',
  ];
  await writeFile(`${dir}/operations.json`, JSON.stringify({ status: 'pass', operations, markerMeasurements, browserErrors: errors,
    viewport: [1280, 960, 390, 844] }, null, 2));
  log(JSON.stringify({ observations: [{ requirement_id: 'browser-operations', status: 'pass',
    observed: { operations: operations.length, browserErrors: errors.length },
    evidence_files: ['operations.json', 'students-wide.png', 'deadline-changed-wide.png', 'check-wide.png', 'check-narrow.png', 'plan-wide.png', 'plan-narrow.png'] }] }));
} finally {
  await grant.set({ scopes: ['all'], revokedAt: null });
  await db.doc('students/demo-student-b/supporters/demo-supporter').set({ scopes: ['all'], revokedAt: null });
  await student.collection('changes').doc('fictional-extension-i67').delete();
  await contextRef.set(originalContext);
  await student.collection('plans').doc('fictional-promise').delete();
  await browser.close(); await db.terminate(); await deleteApp(app);
}
