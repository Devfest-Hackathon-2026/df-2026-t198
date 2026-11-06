import process from 'node:process';
import { randomBytes } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { saveAccounts } from './seed-demo-live.mjs';

const projectId = 'project-00439085-4e2d-44c3-9a8';
const supporterUid = 'real-demo-supporter';
export function setupOptions(args, env) {
  if (args.length !== 3 || args[0] !== '--project' || args[1] !== projectId ||
    args[2] !== '--create-real-demo-supporter' ||
    ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'].some(key => key in env) ||
    ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT'].some(key => env[key] && env[key] !== projectId)) {
    throw new Error('explicit-real-supporter-setup-required');
  }
  return projectId;
}

async function findStudent(auth, db) {
  const candidates = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const user of page.users) {
      if (!user.providerData.some(provider => provider.providerId === 'google.com')) continue;
      if (!(await db.doc(`demoAccounts/${user.uid}`).get()).exists) candidates.push(user.uid);
    }
    pageToken = page.pageToken;
  } while (pageToken);
  if (candidates.length !== 1) throw new Error(`student-candidate-count=${candidates.length}`);
  return candidates[0];
}

export async function seedSupporter({ auth, db, persist, now = Date.now() }) {
  const studentUid = await findStudent(auth, db);
  const supporter = { uid: supporterUid, email: 'real-demo-supporter@example.invalid',
    password: randomBytes(24).toString('base64url') };
  const grant = db.doc(`students/${studentUid}/supporters/${supporterUid}`);
  const context = db.doc(`students/${studentUid}/sessionContext/current`);
  const profiles = [db.doc(`demoAccounts/${studentUid}`), db.doc(`demoAccounts/${supporterUid}`)];
  const targets = [grant, context, ...profiles];
  for (const ref of targets) {
    if ((await ref.get()).exists) throw new Error('setup-document-already-exists');
  }
  for (const lookup of [() => auth.getUser(supporter.uid), () => auth.getUserByEmail(supporter.email)]) {
    try { await lookup(); throw new Error('identity-exists'); }
    catch (error) {
      // SDK exceptions can include identities or credentials. Never propagate their text to the CLI.
      // eslint-disable-next-line preserve-caught-error
      if (error.code !== 'auth/user-not-found') throw new Error('supporter-identity-unavailable');
    }
  }
  const sessionContext = { lastSessionAt: null, nextSessionAt: new Date(now + 7 * 86400_000).toISOString() };
  // Save before remote mutation. Partial failures keep the file for manual inspection, never automatic cleanup.
  await persist({ projectId, origin: `https://${projectId}.web.app`, studentUid, supporter, sessionContext });
  await auth.createUser(supporter);
  await db.runTransaction(async tx => {
    for (const ref of targets) {
      if ((await tx.get(ref)).exists) throw new Error('setup-document-already-exists');
    }
    tx.create(grant, { scopes: ['all'], revokedAt: null });
    tx.create(context, sessionContext);
  });
}

async function main() {
  setupOptions(process.argv.slice(2), process.env);
  // Issue #85 authorizes exactly this separate local file, including from a linked worktree.
  const path = join(homedir(), 'dev/df-2026-t198/fixtures-local/real-demo-supporter.local.json');
  try { await lstat(path); throw new Error('credentials-file-already-exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const app = initializeApp({ projectId, credential: applicationDefault() });
  const db = getFirestore(app);
  try {
    await seedSupporter({ auth: getAuth(app), db, persist: accounts => saveAccounts(path, accounts) });
    process.stdout.write('real-supporter-created: 1 account, 1 grant, 1 session context; credentials saved locally\n');
  } finally { await db.terminate(); await deleteApp(app); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch (error) {
    // Candidate ambiguity reveals the count only. Every other failure is a fixed code.
    const count = /^student-candidate-count=\d+$/.test(error.message) ? error.message : null;
    process.stderr.write(`${count ?? 'real-supporter-setup-failed; inspect state before retrying'}\n`);
    process.exitCode = 1;
  }
}
