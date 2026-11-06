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
  it('refuses observations without a Firebase ID token', async () => {
    const response = await fetch(`${baseUrl}/api/v1/observations`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    expect(response.status).toBe(401);
  });
  it.each(['/api/health', '/api/health?probe=hosting'])('serves its health endpoint at %s', async (path) => {
    const response = await fetch(`${baseUrl}${path}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it.each([
    ['GET', '/missing'],
    ['GET', '/healthz'],
    ['GET', '/api/healthz'],
    ['GET', '/api/missing'],
    ['GET', '/api/health/extra'],
    ['POST', '/api/health'],
  ])('does not expose another endpoint: %s %s', async (method, path) => {
    const response = await fetch(`${baseUrl}${path}`, { method });
    expect(response.status).toBe(404);
  });
});
