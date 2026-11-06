import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ObservationDependencies } from './http.js';
import { DemoConflict, DemoForbidden } from './demo-store.js';

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
function validBody(value: unknown): value is { sourceId: string; expectedDueAt: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return Object.keys(data).length === 2 && typeof data['sourceId'] === 'string' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(data['sourceId']) && typeof data['expectedDueAt'] === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(data['expectedDueAt']) &&
    Number.isFinite(Date.parse(data['expectedDueAt'])) &&
    new Date(data['expectedDueAt']).toISOString() === data['expectedDueAt'];
}
export async function receiveDemoRequest(request: IncomingMessage, response: ServerResponse,
  dependencies?: ObservationDependencies) {
  const authorization = request.headers.authorization;
  if (!authorization?.match(/^Bearer \S+$/i)) { json(response, 401, { error: 'unauthorized' }); return; }
  if (!dependencies?.demo) { json(response, 503, { error: 'unavailable' }); return; }
  let uid: string;
  try {
    uid = await dependencies.verifyToken(authorization.slice(7));
    if (!uid || uid.length > 128 || uid.includes('/') || [...uid].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      uid === '.' || uid === '..') throw new Error('invalid-uid');
  } catch { json(response, 401, { error: 'unauthorized' }); return; }
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    json(response, 415, { error: 'json-required' }); return;
  }
  try {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 2048) { json(response, 413, { error: 'body-too-large' }); return; }
      chunks.push(Buffer.from(chunk));
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (request.url?.split('?')[0] === '/api/v1/demo/reset') {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
        !('onlyIfStale' in body) || typeof body.onlyIfStale !== 'boolean') {
        json(response, 400, { error: 'invalid-demo-request' }); return;
      }
      json(response, 200, await dependencies.demo.reset(uid, body.onlyIfStale)); return;
    }
    if (!validBody(body)) { json(response, 400, { error: 'invalid-demo-request' }); return; }
    json(response, 200, await (request.url?.split('?')[0] === '/api/v1/demo/announce'
      ? dependencies.demo.announce(uid, body.sourceId, body.expectedDueAt)
      : dependencies.demo.extend(uid, body.sourceId, body.expectedDueAt)));
  } catch (error) {
    if (error instanceof DemoForbidden) json(response, 403, { error: 'forbidden' });
    else if (error instanceof DemoConflict) json(response, 409, { error: 'deadline-changed' });
    else if (error instanceof SyntaxError) json(response, 400, { error: 'invalid-demo-request' });
    else json(response, 500, { error: 'internal-error' });
  }
}
