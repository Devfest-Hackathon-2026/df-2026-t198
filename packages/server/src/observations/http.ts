import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ObservationDependencies } from '../http.js';
import { InvalidObservation, parseObservation } from './input.js';
import { DemoForbidden } from '../demo/store.js';
import { json } from '../http/response.js';

const MAX_BODY = 512 * 1024;
export async function receiveObservation(request: IncomingMessage, response: ServerResponse,
  dependencies?: ObservationDependencies) {
  const authorization = request.headers.authorization;
  if (!authorization?.match(/^Bearer \S+$/i)) {
    json(response, 401, { error: 'unauthorized' }); return;
  }
  if (!dependencies) { json(response, 503, { error: 'unavailable' }); return; }
  let uid: string;
  try {
    uid = await dependencies.verifyToken(authorization.slice(7));
    if (!uid || uid.includes('/') || uid === '.' || uid === '..') throw new Error('invalid-uid');
  } catch { json(response, 401, { error: 'unauthorized' }); return; }
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    json(response, 415, { error: 'json-required' }); return;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_BODY) { json(response, 413, { error: 'body-too-large' }); return; }
      chunks.push(Buffer.from(chunk));
    }
    const observation = parseObservation(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    json(response, 200, await dependencies.saveObservation(uid, observation));
  } catch (error) {
    if (error instanceof DemoForbidden) { json(response, 403, { error: 'forbidden' }); return; }
    // Never echo request bodies, authorization headers or upstream error messages.
    json(response, error instanceof InvalidObservation || error instanceof SyntaxError ? 400 : 500,
      { error: error instanceof InvalidObservation || error instanceof SyntaxError ? 'invalid-observation' : 'internal-error' });
  }
}
