import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { URL } from 'node:url';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collection, collectionGroup, deleteDoc, doc, documentId, getDocFromServer,
  getDocsFromServer, query, setDoc, setLogLevel, updateDoc, where, writeBatch,
} from 'firebase/firestore';

// The access matrix comes from docs/design.md sections 1 and 2, not the rules.
const student = 'student-a';
const sharedCollections = ['courses', 'assignments', 'changes', 'fetchStates', 'plans', 'manualAssignments'];
const sharedPaths = [...sharedCollections.map((name) => `${name}/sample`), 'sessionContext/current'];
const privatePaths = ['calendarItems/sample', 'integrations/calendar', 'observationReceipts/sample'];
const roles = [
  { name: 'owner', uid: student, shared: true, private: true },
  { name: 'allowed supporter', uid: 'allowed-supporter', shared: true, private: false },
  { name: 'unapproved supporter', uid: 'unapproved-supporter', shared: false, private: false },
  { name: 'revoked supporter', uid: 'revoked-supporter', shared: false, private: false },
  { name: 'another student', uid: 'student-b', shared: false, private: false },
  { name: 'signed out', uid: null, shared: false, private: false },
];
const grant = { scopes: ['all'], revokedAt: null };
const grants = {
  'allowed-supporter': grant,
  'second-supporter': grant,
  'revoked-supporter': { scopes: ['all'], revokedAt: '2026-11-06T00:00:00Z' },
};
const deniedPaths = [
  `students/${student}`,
  `students/${student}/futurePrivate/sample`,
  `students/${student}/sessionContext/other`,
  `students/${student}/integrations/other`,
  ...[...sharedPaths, ...privatePaths, 'supporters/allowed-supporter']
    .map((path) => `students/${student}/${path}/nested/sample`),
  'invites/sample-hash',
  'unknown/sample',
];
let env;
const databases = new Map();
const studentPath = (path) => `students/${student}/${path}`;

before(async () => {
  // Fail closed when invoked without emulators:exec; never fall back to a live project.
  assert.equal(process.env.GCLOUD_PROJECT, 'demo-kadai-hisho-rules');
  assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:\d+$/);
  setLogLevel('silent'); // Expected denials otherwise flood the test output.
  env = await initializeTestEnvironment({
    projectId: 'demo-kadai-hisho-rules',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  });
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const batch = writeBatch(db);
    batch.set(doc(db, `students/${student}/demo/current`), { courses: [] });
    batch.set(doc(db, `demoAccounts/${student}`), { role: 'student', studentId: student });
    for (const uid of [student, 'student-b']) {
      for (const path of [...sharedPaths, ...privatePaths]) {
        batch.set(doc(db, `students/${uid}/${path}`), { value: 'fictional sample' });
      }
    }
    for (const [uid, value] of Object.entries(grants)) {
      batch.set(doc(db, studentPath(`supporters/${uid}`)), value);
    }
    // A grant for another student must not grant access to student-a.
    batch.set(doc(db, 'students/student-b/supporters/unapproved-supporter'), grant);
    for (const path of deniedPaths) batch.set(doc(db, path), { value: 'private sample' });
    await batch.commit();
  });
  for (const { uid } of roles) {
    databases.set(uid, (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).firestore());
  }
});

after(async () => { await env?.cleanup(); });

async function expectRead(request, allowed) {
  if (!allowed) return assertFails(request);
  const result = await assertSucceeds(request);
  if ('exists' in result) assert.equal(result.exists(), true);
  else assert.ok(result.size > 0);
}

for (const role of roles) {
  test(`${role.name}: demo source and profile are owner-only and never client-writable`, async () => {
    const db = databases.get(role.uid);
    for (const path of [`students/${student}/demo/current`, `demoAccounts/${student}`]) {
      await expectRead(getDocFromServer(doc(db, path)), role.private);
      await assertFails(setDoc(doc(db, path), { role: 'student', studentId: role.uid }));
      await assertFails(deleteDoc(doc(db, path)));
      await assertFails(getDocFromServer(doc(db, `${path}/nested/sample`)));
    }
    await assertFails(getDocsFromServer(collection(db, 'demoAccounts')));
  });
  test(`${role.name}: shared documents and collection queries`, async () => {
    const db = databases.get(role.uid);
    for (const path of sharedPaths) {
      await expectRead(getDocFromServer(doc(db, studentPath(path))), role.shared);
    }
    for (const name of sharedCollections) {
      await expectRead(getDocsFromServer(collection(db, studentPath(name))), role.shared);
    }
    await expectRead(getDocsFromServer(query(collection(db, studentPath('sessionContext')),
      where(documentId(), '==', 'current'))), role.shared);
  });

  test(`${role.name}: calendar and receipts are owner-only`, async () => {
    const db = databases.get(role.uid);
    for (const path of privatePaths) {
      await expectRead(getDocFromServer(doc(db, studentPath(path))), role.private);
    }
    for (const name of ['calendarItems', 'observationReceipts']) {
      await expectRead(getDocsFromServer(collection(db, studentPath(name))), role.private);
    }
    await expectRead(getDocsFromServer(query(collection(db, studentPath('integrations')),
      where(documentId(), '==', 'calendar'))), role.private);
  });

  test(`${role.name}: grants are visible only to the owner and the named supporter`, async () => {
    const db = databases.get(role.uid);
    for (const uid of Object.keys(grants)) {
      await expectRead(getDocFromServer(doc(db, studentPath(`supporters/${uid}`))),
        role.private || role.uid === uid);
    }
    await expectRead(getDocsFromServer(collection(db, studentPath('supporters'))), role.private);
    if (role.uid && !role.private && role.uid in grants) {
      await expectRead(getDocsFromServer(query(collection(db, studentPath('supporters')),
        where(documentId(), '==', role.uid))), true);
    }
  });

  test(`${role.name}: student isolation and no access to unknown paths, nested data or invites`, async () => {
    const db = databases.get(role.uid);
    for (const path of deniedPaths) await assertFails(getDocFromServer(doc(db, path)));
    await assertFails(getDocsFromServer(collection(db, 'students')));
    await assertFails(getDocsFromServer(collection(db, 'invites')));
    await assertFails(getDocsFromServer(collectionGroup(db, 'assignments')));
    // student-b may read its own data, but no role may read an unassigned third student.
    await assertFails(getDocFromServer(doc(db, 'students/student-c/assignments/sample')));
    await expectRead(getDocFromServer(doc(db, 'students/student-b/assignments/sample')),
      role.uid === 'student-b' || role.uid === 'unapproved-supporter');
  });
}

test('missing or malformed grants never grant shared access', async () => {
  const uid = 'malformed-supporter';
  const db = env.authenticatedContext(uid).firestore();
  for (const value of [
    { scopes: ['all'] }, { revokedAt: null }, { scopes: [], revokedAt: null },
    { scopes: ['other'], revokedAt: null }, { scopes: 'all', revokedAt: null },
    { scopes: ['all'], revokedAt: '' }, { scopes: ['all'], revokedAt: false },
  ]) {
    await env.withSecurityRulesDisabled((context) =>
      setDoc(doc(context.firestore(), studentPath(`supporters/${uid}`)), value));
    await assertFails(getDocFromServer(doc(db, studentPath('assignments/sample'))));
    await assertFails(getDocsFromServer(collection(db, studentPath('assignments'))));
  }
});

test('revoking or deleting a grant blocks the same client on its next server read', async () => {
  const uid = 'temporary-supporter';
  const db = env.authenticatedContext(uid).firestore();
  const checkShared = async (allowed) => {
    await expectRead(getDocFromServer(doc(db, studentPath('assignments/sample'))), allowed);
    await expectRead(getDocsFromServer(collection(db, studentPath('assignments'))), allowed);
  };
  await env.withSecurityRulesDisabled(async (context) => {
    const permission = doc(context.firestore(), studentPath(`supporters/${uid}`));
    await setDoc(permission, grant);
    await checkShared(true);
    await updateDoc(permission, { revokedAt: '2026-11-06T01:00:00Z' });
    await checkShared(false);
    await setDoc(permission, grant);
    await checkShared(true);
    await deleteDoc(permission);
    await checkShared(false);
  });
});

// Exercise create on the exact singleton paths too, rather than merely updating a seeded doc.
const writePaths = [
  ...sharedPaths, ...privatePaths, 'supporters/allowed-supporter', 'supporters/unapproved-supporter',
].map(studentPath).concat(deniedPaths);
for (const role of roles) {
  test(`${role.name}: all direct creates, updates and deletes are denied`, async () => {
    const db = databases.get(role.uid);
    await env.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      const remove = writeBatch(adminDb);
      for (const path of writePaths) remove.delete(doc(adminDb, path));
      await remove.commit();
      for (const path of writePaths) {
        await assertFails(setDoc(doc(db, path), { value: 'client create' }));
      }
      const seed = writeBatch(adminDb);
      for (const path of writePaths) seed.set(doc(adminDb, path), { value: 'server write' });
      seed.set(doc(adminDb, studentPath('supporters/allowed-supporter')), grant);
      await seed.commit();
    });
    for (const path of writePaths) {
      await assertFails(updateDoc(doc(db, path), { value: 'client update' }));
      await assertFails(deleteDoc(doc(db, path)));
    }
  });
}
