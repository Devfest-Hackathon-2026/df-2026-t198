import { afterEach, expect, it, vi } from 'vitest';
import { createHttpServer, type ObservationDependencies } from '../src/http.js';
import { PlanAfterDeadline, PlanConflict } from '../src/plans/store.js';

const servers: ReturnType<typeof createHttpServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

it.each(['plan-class-conflict', 'plan-overlap', 'plan-in-past', 'plan-assignment-unavailable', 'plan-after-deadline', 'plan-conflict'] as const)('preserves %s on both save and digest routes without returning details', async code => {
  const reject = vi.fn(async () => { throw code === 'plan-after-deadline' ? new PlanAfterDeadline() : new PlanConflict(code); });
  const server = createHttpServer({ verifyToken: async () => 'fictional',
    verifyDigestToken: async () => ({ uid: 'fictional' }), plans: { save: reject },
    digest: { act: reject, prepareDemo: reject },
  } as unknown as ObservationDependencies);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('port');
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  for (const path of [`/api/v1/students/fictional/plans/${id}`, `/api/v1/plans/${id}/later?rev=1`, '/api/v1/digest/demo-plan']) {
    const save = path.includes('/students/');
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method: save ? 'PUT' : 'POST', headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
      ...(save ? { body: JSON.stringify({ assignment: { system: 'demo-lms', sourceId: 'fictional' }, date: '2030-11-11', period: 3,
        startsAt: '2030-11-11T13:00:00+09:00', endsAt: '2030-11-11T14:30:00+09:00' }) } : {}),
    });
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: code });
  }
});

it('keeps the deadline conflict compatible with existing catch paths', () => {
  expect(new PlanAfterDeadline()).toBeInstanceOf(PlanConflict);
});
