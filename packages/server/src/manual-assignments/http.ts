import { json } from '../http/response.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ObservationDependencies } from '../http.js';
import { validPlanId as validManualAssignmentId } from '../plans/input.js';
import { InvalidManualAssignment, parseManualAssignment } from './input.js';
import { ManualAssignmentConflict } from './store.js';
import { SessionForbidden } from '../sessions/store.js';

function validUid(uid: string) { return uid.length > 0 && uid.length <= 128 && !uid.includes('/') && [...uid].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127) && uid !== '.' && uid !== '..'; }
export async function receiveManualAssignmentRequest(request: IncomingMessage, response: ServerResponse, deps?: ObservationDependencies) {
  const auth = request.headers.authorization;
  if (!auth?.match(/^Bearer \S+$/i)) { json(response, 401, { error: 'unauthorized' }); return; }
  if (!deps?.manualAssignments) { json(response, 503, { error: 'unavailable' }); return; }
  let actor: string;
  try { actor = await deps.verifyToken(auth.slice(7)); if (!validUid(actor)) throw new Error(); }
  catch { json(response, 401, { error: 'unauthorized' }); return; }
  try {
    const parts = request.url!.split('?')[0]!.split('/');
    const student = decodeURIComponent(parts[4]!); const id = parts[6]!;
    if (!validUid(student) || !validManualAssignmentId(id)) throw new InvalidManualAssignment();
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 4096) { json(response, 413, { error: 'body-too-large' }); return; }
      chunks.push(Buffer.from(chunk));
    }
    let input = null;
    if (request.method === 'PUT') {
      if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
        json(response, 415, { error: 'json-required' }); return;
      }
      input = parseManualAssignment(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } else if (size) throw new InvalidManualAssignment();
    json(response, 200, await deps.manualAssignments.save(actor, student, id, input));
  } catch (error) {
    if (error instanceof SessionForbidden) json(response, 403, { error: 'forbidden' });
    else if (error instanceof ManualAssignmentConflict) json(response, 409, { error: 'manual-assignment-conflict' });
    else if (error instanceof InvalidManualAssignment || error instanceof SyntaxError || error instanceof URIError) json(response, 400, { error: 'invalid-manual-assignment' });
    else json(response, 500, { error: 'internal-error' });
  }
}
