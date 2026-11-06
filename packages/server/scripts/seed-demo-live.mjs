import process from 'node:process';
import { log } from 'node:console';
import { randomBytes } from 'node:crypto';
import { lstat, mkdir, open } from 'node:fs/promises';
import { pathToFileURL, URL } from 'node:url';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initialDemo } from '../src/demo-initial.ts';

const projectId = 'project-00439085-4e2d-44c3-9a8';
export function liveSetupOptions(args, env) {
  if (args.length !== 3 || args[0] !== '--project' || args[1] !== projectId ||
    args[2] !== '--create-trial-accounts' ||
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

async function seed() {
  liveSetupOptions(process.argv.slice(2), process.env);
  const folder = new URL('../../../fixtures-local/', import.meta.url);
  const path = new URL('demo-accounts.local.json', folder);
  // Never read or replace a pre-existing credentials file (including a symlink).
  try { await lstat(path); throw new Error('demo-accounts-file-already-exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const db = getFirestore(app);
  try {
    const auth = getAuth(app);
    const pairs = [1, 2, 3].map(number => {
      const pair = `trial-${number}`;
      const account = role => ({ uid: `${pair}-${role}`, email: `${pair}-${role}@example.invalid`,
        password: randomBytes(24).toString('base64url') });
      return { pair, student: account('student'), supporter: account('supporter') };
    });
    // Preflight only these six identities, never enumerate unrelated people.
    for (const { student, supporter } of pairs) for (const account of [student, supporter]) {
      const profile = await db.doc(`demoAccounts/${account.uid}`).get();
      if (profile.exists) throw new Error('demo-profile-already-exists');
      for (const lookup of [() => auth.getUser(account.uid), () => auth.getUserByEmail(account.email)]) {
        try { await lookup(); throw new Error('demo-account-already-exists'); }
        catch (error) {
          // SDK errors can contain account details; keep them out of CLI output.
          // eslint-disable-next-line preserve-caught-error
          if (error.code !== 'auth/user-not-found') throw new Error('demo-account-preflight-failed');
        }
      }
    }
    await mkdir(folder, { recursive: true });
    // Persist once before remote writes so a partial failure does not lose passwords.
    await saveAccounts(path, { projectId, origin: `https://${projectId}.web.app`, pairs });
    const initial = initialDemo(Date.now());
    for (const { student, supporter } of pairs) {
      for (const { uid, email, password } of [student, supporter]) await auth.createUser({ uid, email, password });
      const batch = db.batch();
      for (const [account, role] of [[student, 'student'], [supporter, 'supporter']]) {
        batch.create(db.doc(`demoAccounts/${account.uid}`), { role, studentId: student.uid });
      }
      batch.create(db.doc(`students/${student.uid}/demo/current`), initial.data);
      batch.create(db.doc(`students/${student.uid}/supporters/${supporter.uid}`), { scopes: ['all'], revokedAt: null });
      batch.create(db.doc(`students/${student.uid}/sessionContext/current`), initial.context);
      await batch.commit();
    }
    log('Prepared three fictional demo pairs. Credentials saved locally; no ledger observations seeded.');
  } finally { await db.terminate(); await deleteApp(app); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await seed(); }
  catch { process.stderr.write('live-demo-setup-failed; inspect setup state before retrying\n'); process.exitCode = 1; }
}
