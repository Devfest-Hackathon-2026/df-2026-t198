import { json } from '../http/response.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ObservationDependencies } from '../http.js';
import { validPlanId } from '../plans/input.js';
import { SessionForbidden } from '../sessions/store.js';
import { PlanAfterDeadline, PlanConflict } from '../plans/store.js';
import { DigestUnavailable, PlanActionConflict } from './store.js';
export async function receiveDigestRequest(request: IncomingMessage, response: ServerResponse, deps?: ObservationDependencies) {
  const token = request.headers.authorization;
  if (!token?.match(/^Bearer \S+$/i)) { json(response, 401, { error: 'unauthorized' }); return; }
  if (!deps?.digest || !deps.verifyDigestToken) { json(response, 503, { error: 'unavailable' }); return; }
  let identity;
  try {
    identity = await deps.verifyDigestToken(token.slice(7));
    if (!identity.uid || identity.uid.length > 128 || (identity.uid.includes('/') || [...identity.uid].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) || ['.', '..'].includes(identity.uid)) throw new Error();
  } catch { json(response, 401, { error: 'unauthorized' }); return; }
  try {
    if (request.method === 'GET') {
      const path = request.url?.split('?')[0];
      if (path === '/api/v1/digest/delivery') { json(response, 200, await deps.digest.delivery(identity.uid)); return; }
      if (!identity.email || !/^[^\s@<>]+@[^\s@<>]+$/.test(identity.email)) { json(response, 403, { error: 'email-required' }); return; }
      json(response, 200, path === '/api/v1/digest/demo-preview'
        ? await deps.digest.read(identity.uid, identity.email, true)
        : await deps.digest.read(identity.uid, identity.email));
    } else {
      if (request.url?.split('?')[0] === '/api/v1/digest/demo-plan') {
        for await (const chunk of request) if (chunk.length) { json(response, 400, { error: 'body-not-allowed' }); return; }
        json(response, 200, await deps.digest.prepareDemo(identity.uid)); return;
      }
      const parts = request.url!.split('?')[0]!.split('/');
      const id = parts[4]!; const action = parts[5]!;
      if (!validPlanId(id) || !['done', 'later'].includes(action)) { json(response, 400, { error: 'invalid-plan' }); return; }
      const revisions = new URL(request.url!, 'http://localhost').searchParams.getAll('rev');
      const revision = Number(revisions[0]);
      if (revisions.length !== 1 || !/^[1-9]\d*$/.test(revisions[0]!) || !Number.isSafeInteger(revision)) {
        json(response, 400, { error: 'invalid-revision' }); return;
      }
      // Identity and operation are fixed by verified token and route; never accept a body.
      for await (const chunk of request) if (chunk.length) { json(response, 400, { error: 'body-not-allowed' }); return; }
      json(response, 200, await deps.digest.act(identity.uid, id, action as 'done' | 'later', revision));
    }
  } catch (error) {
    if (error instanceof DigestUnavailable) json(response, 503, { error: 'unavailable' });
    else if (error instanceof SessionForbidden) json(response, 403, { error: 'forbidden' });
    else if (error instanceof PlanActionConflict) json(response, 409, { error: 'plan-conflict', plan: error.plan });
    else if (error instanceof PlanAfterDeadline) json(response, 409, { error: 'plan-after-deadline' });
    else if (error instanceof PlanConflict) json(response, 409, { error: 'plan-conflict' });
    else json(response, 500, { error: 'internal-error' });
  }
}
