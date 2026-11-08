import assert from 'node:assert/strict';
import process from 'node:process';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { seedPairs } from '../../server/scripts/seed-demo-live.mjs';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '') ||
  !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
  !/^http:\/\/127\.0\.0\.1:\d+$/.test(process.env.KADAI_WEB_ORIGIN ?? '')) throw new Error('local-emulators-required');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { initializeApp, deleteApp } = requireServer('firebase-admin/app');
const { getAuth } = requireServer('firebase-admin/auth'); const { getFirestore } = requireServer('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-kadai-hisho' }, 'judge-links'); const db = getFirestore(app);
const browser = await chromium.launch({ headless: true }); const context = await browser.newContext();
const page = await context.newPage(); page.setDefaultTimeout(15000);
const base = process.env.KADAI_WEB_ORIGIN; const results = []; const messages = []; let pairs; let leakedRequest = false;
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i241-evidence';
let browserError = false;
const link = student => `${base}/demo-lms#judge=${Buffer.from(JSON.stringify({ email: student.email, password: student.password })).toString('base64url')}`;
const panes = () => page.locator('[data-demo-pane]');
const check = (name, ok) => { assert.ok(ok); results.push(name); };
try {
  await mkdir(evidence, { recursive: true });
  await seedPairs({ auth: getAuth(app), db, persist: async data => { pairs = data.pairs; } });
  const sensitive = pairs.flatMap(({ student }) => [student.email, student.password, new URL(link(student)).hash.slice(7)]);
  page.on('console', message => messages.push(message.text())); page.on('pageerror', error => { browserError = true; messages.push(error.message); });
  page.on('request', request => {
    const body = request.postData() || '';
    if (sensitive.some(value => request.url().includes(value)) ||
      (!request.url().includes('/accounts:signInWithPassword') && sensitive.some(value => body.includes(value)))) leakedRequest = true;
  });
  for (const [index, pair] of pairs.entries()) {
    await page.goto(`${base}/?judge-link-test=1`);
    await page.route('**/accounts:signInWithPassword*', async route => {
      await new Promise(resolve => globalThis.setTimeout(resolve, 300)); await route.continue();
    }, { times: 1 });
    await page.goto(link(pair.student));
    await page.getByText('ログイン中…', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'LMSを開く', exact: true }).waitFor();
    check(`pair-${index + 1}: three panes and no fragment`, await panes().count() === 3 && new URL(page.url()).hash === '');
    await page.getByRole('button', { name: 'LMSを開く', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
    check(`pair-${index + 1}: matching account`, (await db.collection(`students/${pair.student.uid}/assignments`).get()).size > 0);
    if (index === 0) {
      await page.screenshot({ path: `${evidence}/judge-workspace.png`, fullPage: true });
      await page.locator('[data-demo-pane="lms"] .demo-course a').first().click();
      await page.goBack();
      check('back within LMS is clean', new URL(page.url()).hash === '');
      await page.goBack();
      check('back returns to the preceding page', new URL(page.url()).pathname === '/' && new URL(page.url()).hash === '');
      await page.goForward();
      await page.getByRole('button', { name: 'LMSを開く', exact: true }).waitFor();
      check('forward stays clean', new URL(page.url()).hash === '');
    }
  }
  // Same-path hash navigation exercises switching while another pair is logged in.
  const previous = pairs[2].student; const target = pairs[0].student;
  await db.recursiveDelete(db.collection(`students/${target.uid}/assignments`));
  await page.goto(link(target));
  await page.getByRole('button', { name: 'LMSを開く', exact: true }).waitFor();
  await page.getByRole('button', { name: 'LMSを開く', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '課題を確認しました' }).waitFor();
  check('switches from previous pair', (await db.collection(`students/${target.uid}/assignments`).get()).size > 0 &&
    (await db.collection(`students/${previous.uid}/assignments`).get()).size > 0 && new URL(page.url()).hash === '');
  for (const hash of ['#judge=', '#judge=broken!', new URL(link({ ...target, password: 'wrong-synthetic-password' })).hash]) {
    await page.goto(`${base}/demo-lms${hash}`);
    await page.getByRole('alert').filter({ hasText: 'リンクでログインできませんでした' }).waitFor();
    check('failed link shows empty manual login', await page.getByLabel('メールアドレス').inputValue() === '' &&
      await page.getByLabel('パスワード').inputValue() === '' && await panes().count() === 0 && new URL(page.url()).hash === '');
  }
  await page.screenshot({ path: `${evidence}/judge-failure.png`, fullPage: true });
  await page.getByLabel('メールアドレス').fill(target.email);
  await page.getByLabel('パスワード').fill(target.password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  await page.getByRole('button', { name: 'LMSを開く', exact: true }).waitFor();
  check('manual login recovers after failed link', await panes().count() === 3);
  check('no browser exceptions', !browserError);
  check('no credential in console or errors', messages.every(message => sensitive.every(value => !message.includes(value))));
  check('credentials only sent to Firebase sign-in', !leakedRequest);
  const html = await page.content();
  check('no credential in DOM', sensitive.every(value => !html.includes(value)));
  await writeFile(`${evidence}/judge-links.json`, JSON.stringify({ status: 'pass', checks: results }, null, 2) + '\n');
  process.stdout.write(`judge links: ${results.length} checks passed\n`);
} catch {
  // Never print Playwright diagnostics: they can contain a credential-bearing URL.
  process.stderr.write('judge-link-browser-failed\n'); process.exitCode = 1;
} finally { await context.close(); await browser.close(); await db.terminate(); await deleteApp(app); }
