import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ObservationDependencies } from '../http.js';
import { InvalidAnnouncement, parseAnnouncement } from './input.js';
import { AnnouncementForbidden } from './store.js';

export async function receiveAnnouncement(request: IncomingMessage, response: ServerResponse,
  dependencies?: ObservationDependencies) {
  const json = (status: number, body: unknown) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(body));
  };
  const authorization = request.headers.authorization;
  if (!authorization?.match(/^Bearer \S+$/i)) { json(401, { error: 'unauthorized' }); return; }
  if (!dependencies?.announcements) { json(503, { error: 'unavailable' }); return; }
  let uid: string;
  try {
    uid = await dependencies.verifyToken(authorization.slice(7));
    if (!uid || uid.length > 128 || uid.includes('/') || uid === '.' || uid === '..' ||
        [...uid].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) throw new Error('invalid-uid');
  } catch { json(401, { error: 'unauthorized' }); return; }
  if (request.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    json(415, { error: 'json-required' }); return;
  }
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 64 * 1024) { json(413, { error: 'body-too-large' }); return; }
      chunks.push(Buffer.from(chunk));
    }
    const input = parseAnnouncement(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    json(200, await dependencies.announcements(uid, input));
  } catch (error) {
    if (error instanceof AnnouncementForbidden) json(403, { error: 'forbidden' });
    else if (error instanceof InvalidAnnouncement || error instanceof SyntaxError) json(400, { error: 'invalid-announcement' });
    else json(500, { error: 'internal-error' });
  }
}
