import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createCalendarStore } from './calendar-store.js';
import { createObservationStore } from './observation-store.js';
import { createSessionStore } from './session-store.js';
import { createAnnouncementStore } from './announcements/store.js';
import { createGeminiModel } from './announcements/gemini.js';
import { createRuntimeBudget } from './announcements/runtime-budget.js';
import type { ObservationDependencies } from './http.js';

export function firebaseDependencies() {
  const app = getApps()[0] ?? initializeApp();
  const db = getFirestore(app);
  const dependencies: ObservationDependencies = {
    verifyToken: async (token: string) => (await getAuth(app).verifyIdToken(token, true)).uid,
    saveObservation: createObservationStore(db),
    calendar: createCalendarStore(db),
    session: createSessionStore(db),
  };
  const project = app.options.projectId ?? process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['GCLOUD_PROJECT'];
  if (process.env['ENABLE_DEMO_ANNOUNCEMENTS'] === 'true' && project) {
    dependencies.announcements = createAnnouncementStore(db, {
      generate: (announcement, candidates) => createGeminiModel(project, createRuntimeBudget(db)).generate(announcement, candidates),
    });
  }
  return dependencies;
}
