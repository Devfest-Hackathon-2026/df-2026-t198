import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CalendarReport } from '@kadai-hisho/core/calendar';
import type { ObservationDependencies } from './http.js';
import { CalendarConnectionConflict } from './calendar-store.js';
import { DemoForbidden } from './demo-store.js';

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
class InvalidCalendarRequest extends Error {}
function parse(value: unknown): { calendarId: string } | CalendarReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InvalidCalendarRequest();
  const body = value as Record<string, unknown>;
  if (Object.keys(body).length === 1 && typeof body['calendarId'] === 'string' &&
    /^[a-zA-Z0-9_-]+@group\.calendar\.google\.com$/.test(body['calendarId']) && body['calendarId'].length <= 256) {
    return { calendarId: body['calendarId'] };
  }
  if (Object.keys(body).sort().join(',') !== 'errorCode,eventId,generation,itemKey,revision' ||
    typeof body['itemKey'] !== 'string' || !/^[a-f0-9]{64}$/.test(body['itemKey']) ||
    typeof body['eventId'] !== 'string' || !/^[0-9a-v]{5,1024}$/.test(body['eventId']) ||
    !Number.isSafeInteger(body['generation']) || Number(body['generation']) < 1 ||
    !Number.isSafeInteger(body['revision']) || Number(body['revision']) < 1 ||
    !(body['errorCode'] === null || (typeof body['errorCode'] === 'string' &&
      ['authorization-required', 'calendar-unavailable', 'event-conflict', 'network-error'].includes(body['errorCode'])))) {
    throw new InvalidCalendarRequest();
  }
  return body as unknown as CalendarReport;
}
export async function receiveCalendarRequest(request: IncomingMessage, response: ServerResponse, deps?: ObservationDependencies) {
  const authorization = request.headers.authorization;
  if (!authorization?.match(/^Bearer \S+$/i)) { json(response, 401, { error: 'unauthorized' }); return; }
  if (!deps?.calendar) { json(response, 503, { error: 'unavailable' }); return; }
  let uid: string;
  try {
    uid = await deps.verifyToken(authorization.slice(7));
    if (!uid || uid.length > 128 || (uid.includes('/') || [...uid].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) || uid === '.' || uid === '..') throw new Error();
  } catch { json(response, 401, { error: 'unauthorized' }); return; }
  try {
    if (request.method === 'GET') { json(response, 200, await deps.calendar.pending(uid)); return; }
    if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
      json(response, 415, { error: 'json-required' }); return;
    }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 4096) { json(response, 413, { error: 'body-too-large' }); return; }
      chunks.push(Buffer.from(chunk));
    }
    const body = parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if ('calendarId' in body) await deps.calendar.connect(uid, body.calendarId);
    else await deps.calendar.report(uid, body);
    json(response, 200, { ok: true });
  } catch (error) {
    if (error instanceof DemoForbidden) json(response, 403, { error: 'forbidden' });
    else if (error instanceof CalendarConnectionConflict) json(response, 409, { error: 'calendar-recovery-required' });
    else if (error instanceof InvalidCalendarRequest || error instanceof SyntaxError) json(response, 400, { error: 'invalid-calendar-sync' });
    else json(response, 500, { error: 'internal-error' });
  }
}
