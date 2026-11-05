import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Observation, ObservationResult } from '@kadai-hisho/core/ledger';
import { InvalidObservation, parseObservation } from './observation-input.js';

export interface ObservationDependencies {
  verifyToken: (token: string) => Promise<string>;
  saveObservation: (uid: string, observation: Observation) => Promise<ObservationResult>;
}
const MAX_BODY = 512 * 1024;
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}
async function receiveObservation(request: IncomingMessage, response: ServerResponse,
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
    // Never echo request bodies, authorization headers or upstream error messages.
    json(response, error instanceof InvalidObservation || error instanceof SyntaxError ? 400 : 500,
      { error: error instanceof InvalidObservation || error instanceof SyntaxError ? 'invalid-observation' : 'internal-error' });
  }
}

export function createHttpServer(dependencies?: ObservationDependencies) {
  return createServer((request, response) => {
    const path = request.url?.split('?')[0];
    if (request.method === 'POST' && path === '/api/v1/observations') {
      void receiveObservation(request, response, dependencies);
      return;
    }
    if (request.method === 'GET' && path === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Not Found\n');
  });
}
