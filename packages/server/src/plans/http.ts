import { json } from '../http/response.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ObservationDependencies } from '../http.js';
import { InvalidPlan, parsePlan, validPlanId } from './input.js';
import { PlanAfterDeadline, PlanConflict } from './store.js';
import { SessionForbidden } from '../sessions/store.js';

function validUid(uid: string) { return uid.length > 0 && uid.length <= 128 && !uid.includes('/') && [...uid].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127) && uid !== '.' && uid !== '..'; }
export async function receivePlanRequest(request: IncomingMessage, response: ServerResponse, deps?: ObservationDependencies) {
  const auth = request.headers.authorization;
  if (!auth?.match(/^Bearer \S+$/i)) { json(response, 401, { error: 'unauthorized' }); return; }
  if (!deps?.plans) { json(response, 503, { error: 'unavailable' }); return; }
  let actor: string;
  try { actor = await deps.verifyToken(auth.slice(7)); if (!validUid(actor)) throw new Error(); }
  catch { json(response, 401, { error: 'unauthorized' }); return; }
  try {
    const parts = request.url!.split('?')[0]!.split('/');
    const student = decodeURIComponent(parts[4]!); const id = parts[6]!;
    if (!validUid(student) || !validPlanId(id)) throw new InvalidPlan();
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
      input = parsePlan(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    } else if (size) throw new InvalidPlan();
    json(response, 200, await deps.plans.save(actor, student, id, input));
  } catch (error) {
    if (error instanceof SessionForbidden) json(response, 403, { error: 'forbidden' });
    else if (error instanceof PlanAfterDeadline) json(response, 409, { error: 'plan-after-deadline' });
    else if (error instanceof PlanConflict) json(response, 409, { error: 'plan-conflict' });
    else if (error instanceof InvalidPlan || error instanceof SyntaxError || error instanceof URIError) json(response, 400, { error: 'invalid-plan' });
    else json(response, 500, { error: 'internal-error' });
  }
}
