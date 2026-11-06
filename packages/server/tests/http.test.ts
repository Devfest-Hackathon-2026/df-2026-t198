import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpServer } from '../src/http.js';

const server = createHttpServer();
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing test port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe('HTTP server', () => {
  it.each(['/healthz', '/api/healthz', '/api/healthz?probe=hosting'])('serves its health endpoint at %s', async (path) => {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it.each([
    ['GET', '/missing'],
    ['GET', '/healthz/extra'],
    ['POST', '/healthz'],
    ['GET', '/api/missing'],
    ['GET', '/api/healthz/extra'],
    ['POST', '/api/healthz'],
  ])('does not expose another endpoint: %s %s', async (method, path) => {
    const response = await fetch(`${baseUrl}${path}`, { method });
    expect(response.status).toBe(404);
  });
});
