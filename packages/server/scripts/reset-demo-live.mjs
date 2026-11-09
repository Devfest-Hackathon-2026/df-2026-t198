import process from 'node:process';
import { log } from 'node:console';
import { pathToFileURL } from 'node:url';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'project-00439085-4e2d-44c3-9a8';
const pairs = ['trial-1', 'trial-2', 'trial-3', 'public-1'];

export function liveResetOptions(args, env) {
  if (args.length !== 3 || args[0] !== '--project' || args[1] !== projectId ||
    !['--dry-run', '--reset-demo-pairs'].includes(args[2]) ||
    ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB'].some(key => key in env) ||
    ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT'].some(key => env[key] && env[key] !== projectId)) {
    throw new Error('explicit-live-demo-reset-required');
  }
  return { projectId, dryRun: args[2] === '--dry-run' };
}

export async function resetDemoPairs({ db, reset, dryRun, report = log }) {
  const refs = pairs.flatMap(pair => ['student', 'supporter'].map(role => db.doc(`demoAccounts/${pair}-${role}`)));
  const profiles = await db.getAll(...refs);
  const owners = [];
  for (const [index, pair] of pairs.entries()) {
    const student = profiles[index * 2];
    const supporter = profiles[index * 2 + 1];
    for (const [profile, role] of [[student, 'student'], [supporter, 'supporter']]) {
      const data = profile.data();
      if (profile.id !== `${pair}-${role}` || data?.role !== role || data.studentId !== student.id ||
        (pair === 'public-1' ? data.public !== true : data.public !== undefined)) {
        throw new Error('demo-pair-markers-required');
      }
    }
    owners.push(student.id);
  }
  if (dryRun) { report(owners.length); return; }
  let completed = 0;
  for (const uid of owners) {
    // Preserve all guards, cleanup and sharing behavior of "start over" in the app.
    await reset(uid, false);
    report(`reset-completed: ${++completed}`);
  }
}

async function main() {
  const options = liveResetOptions(process.argv.slice(2), process.env);
  // Use the built server implementation; run the server build before this CLI.
  const { createDemoStore } = await import('../dist/demo/store.js');
  const app = initializeApp({ projectId: options.projectId, credential: applicationDefault() });
  const db = getFirestore(app);
  try {
    await resetDemoPairs({ db, reset: createDemoStore(db).reset, dryRun: options.dryRun });
  } finally { await db.terminate(); await deleteApp(app); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main(); }
  catch { process.stderr.write('live-demo-reset-failed; inspect reset state before retrying\n'); process.exitCode = 1; }
}
