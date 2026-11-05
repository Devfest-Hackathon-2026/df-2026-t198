import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ObservationDependencies } from './http.js';
import { InvalidSessionContext, parseSessionContext } from './session-input.js';
import { SessionForbidden } from './session-store.js';

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
function validUid(uid: string) {
  return uid.length > 0 && uid.length <= 128 && !uid.includes('/') && [...uid].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127) && uid !== '.' && uid !== '..';
}
export async function receiveSessionRequest(request: IncomingMessage, response: ServerResponse,
  dependencies?: ObservationDependencies) {
  const authorization = request.headers.authorization;
  if (!authorization?.match(/^Bearer \S+$/i)) { json(response, 401, { error: 'unauthorized' }); return; }
  if (!dependencies?.session) { json(response, 503, { error: 'unavailable' }); return; }
  let uid: string;
  try {
    uid = await dependencies.verifyToken(authorization.slice(7));
    if (!validUid(uid)) throw new Error('invalid-uid');
  } catch { json(response, 401, { error: 'unauthorized' }); return; }
  try {
    if (request.method === 'GET') {
      json(response, 200, { students: await dependencies.session.listStudents(uid) }); return;
    }
    const studentUid = decodeURIComponent(request.url!.split('?')[0]!.split('/')[4]!);
    if (!validUid(studentUid)) throw new InvalidSessionContext();
    if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
      json(response, 415, { error: 'json-required' }); return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 2048) { json(response, 413, { error: 'body-too-large' }); return; }
      chunks.push(Buffer.from(chunk));
    }
    const context = parseSessionContext(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    await dependencies.session.saveContext(uid, studentUid, context);
    json(response, 200, context);
  } catch (error) {
    if (error instanceof SessionForbidden) json(response, 403, { error: 'forbidden' });
    else if (error instanceof InvalidSessionContext || error instanceof SyntaxError || error instanceof URIError) {
      json(response, 400, { error: 'invalid-session-context' });
    } else json(response, 500, { error: 'internal-error' });
  }
}
