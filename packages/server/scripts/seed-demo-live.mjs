import process from 'node:process';
import { log } from 'node:console';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open } from 'node:fs/promises';
import { pathToFileURL, URL } from 'node:url';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initialDemo } from '../src/demo/initial.ts';

const projectId = 'project-00439085-4e2d-44c3-9a8';
export function liveSetupOptions(args, env) {
  if (args.length !== 3 || args[0] !== '--project' || args[1] !== projectId ||
    !['--create-trial-accounts', '--create-public-pair'].includes(args[2]) ||
    ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'].some(key => key in env) ||
    ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT'].some(key => env[key] && env[key] !== projectId)) {
    throw new Error('explicit-live-demo-setup-required');
  }
  return projectId;
}

export async function saveAccounts(path, accounts) {
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(accounts, null, 2) + '\n'); }
  finally { await file.close(); }
}

export async function seedPairs({ auth, db, persist, publicPair = false, now = Date.now() }) {
  const pairs = (publicPair ? ['public-1'] : ['trial-1', 'trial-2', 'trial-3']).map(pair => {
    const account = role => ({ uid: `${pair}-${role}`, email: `${pair}-${role}@example.invalid`,
      password: randomBytes(24).toString('base64url') });
    return { pair, student: account('student'), supporter: account('supporter') };
  });
  const initial = initialDemo(now);
  const documents = pairs.flatMap(({ student, supporter }) => [
    [db.doc(`demoAccounts/${student.uid}`), { role: 'student', studentId: student.uid,
      displayName: initial.displayName, ...(publicPair ? { public: true } : {}) }],
    [db.doc(`demoAccounts/${supporter.uid}`), { role: 'supporter', studentId: student.uid,
      ...(publicPair ? { public: true } : {}) }],
    [db.doc(`students/${student.uid}/demo/current`), initial.data],
    [db.doc(`students/${student.uid}/supporters/${supporter.uid}`), { scopes: ['all'], revokedAt: null }],
    [db.doc(`students/${student.uid}/sessionContext/current`), initial.context],
  ]);
  // Only inspect the selected pair(s), never enumerate unrelated people or trial accounts.
  for (const [ref] of documents) {
    if ((await ref.get()).exists) throw new Error('demo-document-already-exists');
  }
  for (const { student, supporter } of pairs) for (const account of [student, supporter]) {
    for (const lookup of [() => auth.getUser(account.uid), () => auth.getUserByEmail(account.email)]) {
      try { await lookup(); throw new Error('demo-account-already-exists'); }
      catch (error) {
        // SDK errors can contain account details; keep them out of CLI output.
        // eslint-disable-next-line preserve-caught-error
        if (error.code !== 'auth/user-not-found') throw new Error('demo-account-preflight-failed');
      }
    }
  }
  // Persist once before remote writes so a partial failure does not lose passwords.
  await persist({ projectId, origin: `https://${projectId}.web.app`, pairs });
  for (const { student, supporter } of pairs) {
    for (const { uid, email, password } of [student, supporter]) await auth.createUser({ uid, email, password });
  }
  const batch = db.batch();
  for (const [ref, data] of documents) batch.create(ref, data);
  await batch.commit();
}

async function seed() {
  const args = process.argv.slice(2);
  liveSetupOptions(args, process.env);
  const publicPair = args[2] === '--create-public-pair';
  const folder = new URL('../../../fixtures-local/', import.meta.url);
  const path = new URL(publicPair ? 'public-demo-accounts.local.json' : 'demo-accounts.local.json', folder);
  // Never read or replace a pre-existing credentials file (including a symlink).
  try { await lstat(path); throw new Error('demo-accounts-file-already-exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const db = getFirestore(app);
  try {
    await seedPairs({ auth: getAuth(app), db, publicPair, persist: async accounts => {
      await mkdir(folder, { recursive: true });
      await saveAccounts(path, accounts);
    } });
    log(publicPair ? 'Prepared one public demo pair. Credentials saved locally; no ledger observations seeded.'
      : 'Prepared three fictional demo pairs. Credentials saved locally; no ledger observations seeded.');
  } finally { await db.terminate(); await deleteApp(app); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await seed(); }
  catch { process.stderr.write('live-demo-setup-failed; inspect setup state before retrying\n'); process.exitCode = 1; }
}
