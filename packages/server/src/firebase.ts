import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { assertEmulatorEnvironment } from './runtime/environment.js';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { createDemoCalendarSync } from './demo/calendar.js';
import { createCalendarStore } from './calendar/store.js';
import { createObservationStore } from './observations/store.js';
import { createManualAssignmentStore } from './manual-assignments/store.js';
import { createDigestStore } from './digest/store.js';
import { createPlanStore } from './plans/store.js';
import { createSessionStore } from './sessions/store.js';
import { createSharingStore } from './sharing/store.js';
import { createDemoStore } from './demo/store.js';
import { createAnnouncementStore } from './announcements/store.js';
import { createGeminiModel } from './announcements/gemini.js';
import { createRuntimeBudget } from './announcements/runtime-budget.js';
import type { ObservationDependencies } from './http.js';
import { createNotificationStore } from './notifications/store.js';
import { createNotificationDispatch } from './notifications/dispatch.js';
import { createSchedulerVerifier } from './notifications/auth.js';
import { mailSenderFromEnvironment } from './notifications/mail-sender.js';
import { createNotificationSettingsStore } from './notifications/settings.js';

const shutdowns = new WeakMap<ObservationDependencies, () => Promise<void>>();

export function closeFirebaseDependencies(dependencies: ObservationDependencies): Promise<void> {
  const shutdown = shutdowns.get(dependencies);
  return shutdown ? shutdown() : Promise.reject(new Error('firebase-runtime-not-initialized'));
}

export function firebaseDependencies() {
  const existing = getApps().find(current => current.name === '[DEFAULT]');
  const configuredProject = existing?.options.projectId ?? process.env['GOOGLE_CLOUD_PROJECT'] ?? process.env['GCLOUD_PROJECT'];
  assertEmulatorEnvironment(process.env, configuredProject);
  const app = existing ?? (process.env['FIRESTORE_EMULATOR_HOST'] !== undefined
    ? initializeApp({ projectId: configuredProject! }) : initializeApp());
  const project = app.options.projectId ?? configuredProject;
  const db = getFirestore(app);
  const saveObservation = createObservationStore(db);
  const syncDemoCalendar = createDemoCalendarSync(db);
  const sender = mailSenderFromEnvironment();
  const resolveRecipient = async (uid: string) => {
    try {
      const user = await getAuth(app).getUser(uid);
      return !user.disabled && user.emailVerified ? user.email ?? null : null;
    } catch { return null; }
  };
  const dependencies: ObservationDependencies = {
    notificationSettings: createNotificationSettingsStore(db, {
      checkSender: () => sender && process.env['NOTIFICATION_SEND_ENABLED'] === 'true' ? sender.check() : Promise.resolve('preparing'),
      resolveRecipient,
    }),
    verifyDigestToken: async token => {
      const identity = await getAuth(app).verifyIdToken(token, true);
      return { uid: identity.uid, email: identity.email };
    },
    digest: createDigestStore(db, syncDemoCalendar, process.env['PUBLIC_WEB_ORIGIN']),
    verifyToken: async (token: string) => (await getAuth(app).verifyIdToken(token, true)).uid,
    saveObservation: async (uid, observation) => {
      const result = await saveObservation(uid, observation);
      await syncDemoCalendar(uid);
      return result;
    },
    calendar: createCalendarStore(db),
    session: createSessionStore(db),
    sharing: createSharingStore(db, async uid => {
      try { return (await getAuth(app).getUser(uid)).displayName; }
      catch (error) {
        if ((error as { code?: string }).code === 'auth/user-not-found') return undefined;
        throw error;
      }
    }),
    plans: createPlanStore(db, syncDemoCalendar),
    manualAssignments: createManualAssignmentStore(db, syncDemoCalendar),
    demo: createDemoStore(db),
  };
  if (process.env['ENABLE_DEMO_ANNOUNCEMENTS'] === 'true' && project) {
    dependencies.announcements = createAnnouncementStore(db, publicDemo =>
      createGeminiModel(project, createRuntimeBudget(db, new Date(), publicDemo), undefined, { timeoutMs: 45_000 }));
  }
  const audience = process.env['NOTIFICATION_OIDC_AUDIENCE'];
  const serviceAccount = process.env['NOTIFICATION_SCHEDULER_SERVICE_ACCOUNT'];
  const origin = process.env['PUBLIC_WEB_ORIGIN']?.replace(/\/+$/, '');
  if (audience && serviceAccount && origin) {
    dependencies.notifications = {
      verify: createSchedulerVerifier(audience, serviceAccount),
      tick: createNotificationDispatch(createNotificationStore(db, origin), {
        origin, enabled: process.env['NOTIFICATION_SEND_ENABLED'] === 'true',
        ...(sender ? { sender } : {}), resolveRecipient,
      }),
    };
  }
  let closing: Promise<void> | undefined;
  shutdowns.set(dependencies, () => closing ??= (async () => {
    try { await db.terminate(); }
    finally { await deleteApp(app); }
  })());
  return dependencies;
}
