import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ObservationDependencies } from '../http.js';
import { json } from '../http/response.js';
import { SharingForbidden } from './store.js';

function validUid(uid: string) {
  return uid.length > 0 && uid.length <= 128 && uid !== '.' && uid !== '..' && !uid.includes('/') &&
    [...uid].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127);
}
export async function receiveSharingRequest(request: IncomingMessage, response: ServerResponse, dependencies?: ObservationDependencies) {
  const authorization = request.headers.authorization;
  if (!authorization?.match(/^Bearer \S+$/i)) { json(response, 401, { error: 'unauthorized' }); return; }
  if (!dependencies?.sharing) { json(response, 503, { error: 'unavailable' }); return; }
  let student: string;
  try {
    student = await dependencies.verifyToken(authorization.slice(7));
    if (!validUid(student)) throw new Error('invalid-uid');
  } catch { json(response, 401, { error: 'unauthorized' }); return; }
  try {
    if (request.method === 'GET') { json(response, 200, await dependencies.sharing.list(student)); return; }
    const path = request.url!.split('?')[0]!.split('/');
    const supporter = decodeURIComponent(path[5]!);
    if (!validUid(supporter)) { json(response, 400, { error: 'invalid-sharing-request' }); return; }
    // The identity and server timestamp never come from request data.
    for await (const chunk of request) {
      if (chunk.length) { json(response, 400, { error: 'invalid-sharing-request' }); return; }
    }
    await dependencies.sharing.change(student, supporter, path[6] === 'revoke');
    json(response, 200, { status: 'ok' });
  } catch (error) {
    if (error instanceof SharingForbidden) json(response, 403, { error: 'forbidden' });
    else if (error instanceof URIError) json(response, 400, { error: 'invalid-sharing-request' });
    else json(response, 500, { error: 'internal-error' });
  }
}
