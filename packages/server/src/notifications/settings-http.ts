import { json } from '../http/response.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ObservationDependencies } from '../http.js';
import { NotificationNotReady, NotificationSettingsConflict } from './settings.js';
import { SessionForbidden } from '../sessions/store.js';

export async function receiveNotificationSettings(request: IncomingMessage, response: ServerResponse, deps?: ObservationDependencies) {
  const token = request.headers.authorization;
  if (!token?.match(/^Bearer \S+$/i)) { json(response, 401, { error: 'unauthorized' }); return; }
  if (!deps?.notificationSettings) { json(response, 503, { error: 'unavailable' }); return; }
  let uid: string;
  try {
    uid = await deps.verifyToken(token.slice(7));
    if (!uid || uid.length > 128 || uid.includes('/') || [...uid].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || uid === '.' || uid === '..') throw new Error();
  } catch { json(response, 401, { error: 'unauthorized' }); return; }
  if (request.url?.includes('?')) { json(response, 400, { error: 'invalid-settings' }); return; }
  if (request.method === 'PUT' && request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    json(response, 415, { error: 'json-required' }); return;
  }
  try {
    let body = '';
    for await (const chunk of request) {
      body += Buffer.from(chunk).toString('utf8');
      if (Buffer.byteLength(body) > 1024) { json(response, 413, { error: 'body-too-large' }); return; }
    }
    if (request.method === 'GET') {
      if (body) { json(response, 400, { error: 'body-not-allowed' }); return; }
      json(response, 200, await deps.notificationSettings(uid)); return;
    }
    const input = JSON.parse(body) as Record<string, unknown> | null;
    if (!input || Object.keys(input).sort().join(',') !== 'enabled,version' || typeof input['enabled'] !== 'boolean' ||
      !Number.isSafeInteger(input['version']) || Number(input['version']) < 1) {
      json(response, 400, { error: 'invalid-settings' }); return;
    }
    json(response, 200, await deps.notificationSettings(uid, { enabled: input['enabled'], version: Number(input['version']) }));
  } catch (error) {
    const status = error instanceof SessionForbidden ? 403 : error instanceof NotificationNotReady || error instanceof NotificationSettingsConflict ? 409 : error instanceof SyntaxError ? 400 : 500;
    json(response, status, { error: status === 403 ? 'forbidden' : error instanceof NotificationNotReady ? 'notification-not-ready' :
      status === 409 ? 'settings-conflict' : status === 400 ? 'invalid-settings' : 'internal-error' });
  }
}
