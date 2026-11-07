import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpServer } from '../src/http.js';

describe('notification settings HTTP boundary', () => {
  const server = createHttpServer();
  let base: string;
  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('missing-port');
    base = `http://127.0.0.1:${address.port}/api/v1/notification-settings`;
  });
  afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
  it.each(['GET', 'PUT'])('rejects unauthenticated %s before settings access', async method => {
    const response = await fetch(base, { method });
    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });
});
