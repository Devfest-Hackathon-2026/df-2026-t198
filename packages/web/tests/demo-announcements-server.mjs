// Test-only entry: no production switch can select this model.
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { createRequire } from 'node:module';
import { createHttpServer } from '../../server/dist/http.js';
import { firebaseDependencies } from '../../server/dist/firebase.js';
import { createAnnouncementStore } from '../../server/dist/announcements/store.js';
import { createRuntimeBudget } from '../../server/dist/announcements/runtime-budget.js';
import { createGeminiModel } from '../../server/dist/announcements/gemini.js';

if (process.env.GCLOUD_PROJECT !== 'demo-kadai-hisho' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8085' ||
  process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9099') throw new Error('local-emulators-required');
const requireServer = createRequire(new URL('../../server/package.json', import.meta.url));
const { getFirestore } = requireServer('firebase-admin/firestore');
const dependencies = firebaseDependencies();
const evidence = process.env.ARTIFACT_EVIDENCE_DIR || '/tmp/kadai-i84-evidence';
let calls = 0;
async function fakeGenerate(request) {
  const { announcement, candidates } = JSON.parse(request.contents);
  const candidate = candidates.find(item => announcement.body.startsWith(item.title));
  const date = /\d{4}-\d{2}-\d{2}/.exec(announcement.body)?.[0];
  if (!candidate || !date) throw new Error('unexpected-fictional-notice');
  calls++;
  await mkdir(evidence, { recursive: true });
  await writeFile(`${evidence}/fake-model.json`, JSON.stringify({ model: 'fake', calls, realCalls: 0 }));
  return { text: JSON.stringify({ announcementId: announcement.announcementId, assignmentKey: candidate.assignmentKey,
    proposedDueAt: `${date}T17:00:00+09:00`, quote: announcement.body, reason: null }),
    candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, totalTokenCount: 150 } };
}
dependencies.announcements = createAnnouncementStore(getFirestore(), publicDemo =>
  createGeminiModel('demo-kadai-hisho', createRuntimeBudget(getFirestore(), new Date(), publicDemo), fakeGenerate));
const server = createHttpServer(dependencies);
server.listen(8080, '127.0.0.1');
process.on('SIGTERM', () => server.close());
