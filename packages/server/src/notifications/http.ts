import { json } from '../http/response.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface NotificationHttpDependencies {
  verify: (token: string) => Promise<void>;
  tick: () => Promise<{ dryRun: boolean; candidates: number; attempted: number }>;
}
export async function receiveNotificationTick(request: IncomingMessage, response: ServerResponse, deps?: NotificationHttpDependencies) {
  const token = request.headers.authorization;
  if (!token?.match(/^Bearer \S+$/i)) { json(response, 401, { error: 'unauthorized' }); return; }
  if (!deps) { json(response, 503, { error: 'unavailable' }); return; }
  try { await deps.verify(token.slice(7)); }
  catch { json(response, 401, { error: 'unauthorized' }); return; }
  // No request-supplied UID, address, clock or enable flag. Finish work before acknowledging the tick.
  if (request.url?.includes('?') || request.headers['transfer-encoding'] ||
    (request.headers['content-length'] && request.headers['content-length'] !== '0')) {
    json(response, 400, { error: 'body-not-allowed' }); return;
  }
  try { json(response, 200, await deps.tick()); }
  catch { json(response, 500, { error: 'notification-failed' }); }
}
