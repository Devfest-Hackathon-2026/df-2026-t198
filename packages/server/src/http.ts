import { createServer } from 'node:http';
import type { Observation, ObservationResult } from '@kadai-hisho/core/ledger';
import { receiveObservation } from './observations/http.js';
import { receiveCalendarRequest } from './calendar/http.js';
import type { CalendarStore } from './calendar/store.js';
import { receiveSessionRequest } from './sessions/http.js';
import { receiveManualAssignmentRequest } from './manual-assignments/http.js';
import type { ManualAssignmentStore } from './manual-assignments/store.js';
import { receiveDigestRequest } from './digest/http.js';
import type { DigestStore } from './digest/store.js';
import { receivePlanRequest } from './plans/http.js';
import type { PlanStore } from './plans/store.js';
import type { SessionStore } from './sessions/store.js';
import { receiveDemoRequest } from './demo/http.js';
import type { DemoStore } from './demo/store.js';
import { receiveAnnouncement } from './announcements/http.js';
import type { createAnnouncementStore } from './announcements/store.js';
import { receiveNotificationTick, type NotificationHttpDependencies } from './notifications/http.js';
import { receiveNotificationSettings } from './notifications/settings-http.js';
import type { NotificationSettingsStore } from './notifications/settings.js';

export interface ObservationDependencies {
  verifyToken: (token: string) => Promise<string>;
  saveObservation: (uid: string, observation: Observation) => Promise<ObservationResult>;
  session?: SessionStore;
  plans?: PlanStore;
  manualAssignments?: ManualAssignmentStore;
  verifyDigestToken?: (token: string) => Promise<{ uid: string; email?: string | undefined }>;
  digest?: DigestStore;
  calendar?: CalendarStore;
  demo?: DemoStore;
  announcements?: ReturnType<typeof createAnnouncementStore>;
  notifications?: NotificationHttpDependencies;
  notificationSettings?: NotificationSettingsStore;
}
export function createHttpServer(dependencies?: ObservationDependencies) {
  return createServer((request, response) => {
    const path = request.url?.split('?')[0];
    if (path === '/api/v1/notification-settings' && (request.method === 'GET' || request.method === 'PUT')) {
      void receiveNotificationSettings(request, response, dependencies); return;
    }
    if (path === '/api/internal/notifications/tick' && request.method === 'POST') {
      void receiveNotificationTick(request, response, dependencies?.notifications); return;
    }
    if ((request.method === 'PUT' || request.method === 'DELETE') && /^\/api\/v1\/students\/[^/]+\/manual-assignments\/[^/]+$/.test(path ?? '')) {
      void receiveManualAssignmentRequest(request, response, dependencies); return;
    }
    if ((request.method === 'GET' && ['/api/v1/digest', '/api/v1/digest/delivery', '/api/v1/digest/demo-preview'].includes(path ?? '')) ||
      (request.method === 'POST' && path === '/api/v1/digest/demo-plan') ||
      (request.method === 'POST' && /^\/api\/v1\/plans\/[^/]+\/(done|later)$/.test(path ?? ''))) {
      void receiveDigestRequest(request, response, dependencies); return;
    }
    if ((request.method === 'PUT' || request.method === 'DELETE') && /^\/api\/v1\/students\/[^/]+\/plans\/[^/]+$/.test(path ?? '')) {
      void receivePlanRequest(request, response, dependencies); return;
    }
    if (request.method === 'POST' && (path === '/api/v1/demo/extend' || path === '/api/v1/demo/reset' || path === '/api/v1/demo/announce')) {
      void receiveDemoRequest(request, response, dependencies); return;
    }
    if (path === '/api/v1/calendar-sync' && (request.method === 'GET' || request.method === 'POST')) {
      void receiveCalendarRequest(request, response, dependencies); return;
    }
    if (request.method === 'POST' && path === '/api/v1/announcements') {
      void receiveAnnouncement(request, response, dependencies);
      return;
    }
    if ((request.method === 'GET' && path === '/api/v1/supporter/students') ||
      (request.method === 'PUT' && /^\/api\/v1\/students\/[^/]+\/session-context$/.test(path ?? ''))) {
      void receiveSessionRequest(request, response, dependencies);
      return;
    }
    if (request.method === 'POST' && path === '/api/v1/observations') {
      void receiveObservation(request, response, dependencies);
      return;
    }
    if (request.method === 'GET' && path === '/api/health') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found\n');
  });
}
