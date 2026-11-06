import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createDemoCalendarSync } from './demo-calendar.js';
import { createCalendarStore } from './calendar-store.js';
import { createObservationStore } from './observation-store.js';
import { createDigestStore } from './digest-store.js';
import { createPlanStore } from './plan-store.js';
import { createSessionStore } from './session-store.js';
import { createDemoStore } from './demo-store.js';
import { createAnnouncementStore } from './announcements/store.js';
import { createGeminiModel } from './announcements/gemini.js';
import { createRuntimeBudget } from './announcements/runtime-budget.js';
import type { ObservationDependencies } from './http.js';

export function firebaseDependencies() {
  const app = getApps()[0] ?? initializeApp();
  const db = getFirestore(app);
  const saveObservation = createObservationStore(db);
  const syncDemoCalendar = createDemoCalendarSync(db);
  const project = app.options.projectId ?? process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['GCLOUD_PROJECT'];
  if (!process.env['PUBLIC_WEB_ORIGIN'] && !project) throw new Error('web-origin-required');
  const dependencies: ObservationDependencies = {
    verifyDigestToken: async token => {
      const identity = await getAuth(app).verifyIdToken(token, true);
      return { uid: identity.uid, email: identity.email };
    },
    digest: createDigestStore(db, syncDemoCalendar, process.env['PUBLIC_WEB_ORIGIN'] ??
      `https://${project}.web.app`),
    verifyToken: async (token: string) => (await getAuth(app).verifyIdToken(token, true)).uid,
    saveObservation: async (uid, observation) => {
      const result = await saveObservation(uid, observation);
      await syncDemoCalendar(uid);
      return result;
    },
    calendar: createCalendarStore(db),
    session: createSessionStore(db),
    plans: createPlanStore(db, syncDemoCalendar),
    demo: createDemoStore(db),
  };
  if (process.env['ENABLE_DEMO_ANNOUNCEMENTS'] === 'true' && project) {
    dependencies.announcements = createAnnouncementStore(db, {
      generate: (announcement, candidates) => createGeminiModel(project, createRuntimeBudget(db)).generate(announcement, candidates),
    });
  }
  return dependencies;
}
