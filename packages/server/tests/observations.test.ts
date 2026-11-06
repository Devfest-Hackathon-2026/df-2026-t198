import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpServer } from '../src/http.js';
import { parseObservation } from '../src/observation-input.js';
import { documentKey } from '../src/observation-store.js';
import { observation } from './observation-fixture.js';

const verifyToken = vi.fn(async () => 'verified-student');
const saveObservation = vi.fn(async () => ({ status: 'applied' as const, changed: true, changeCount: 1 }));
const server = createHttpServer({ verifyToken, saveObservation });
let base: string;
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing-port');
  base = `http://127.0.0.1:${address.port}/api/v1/observations`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => { vi.clearAllMocks(); });
function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json',
    Authorization: 'Bearer unit-test-credential', ...headers }, body: JSON.stringify(body) });
}

describe('observation API boundary', () => {
  it('takes the owner only from verified authentication', async () => {
    const result = await post(observation());
    expect(result.status).toBe(200);
    expect(saveObservation).toHaveBeenCalledWith('verified-student', observation());
    expect(result.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects an invalid token before reading or saving the observation', async () => {
    verifyToken.mockRejectedValueOnce(new Error('upstream-private-message'));
    const result = await post(observation());
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ error: 'unauthorized' });
    expect(saveObservation).not.toHaveBeenCalled();
  });
  it.each(['uid', 'studentId', 'SID', 'Cookie', 'access_token'])('rejects the extra property %s', async key => {
    const result = await post({ ...observation(), [key]: 'synthetic-marker' });
    expect(result.status).toBe(400);
    expect(await result.json()).toEqual({ error: 'invalid-observation' });
    expect(saveObservation).not.toHaveBeenCalled();
  });
  it.each([
    'https://example.invalid/tasks;SID=synthetic-marker',
    'https://example.invalid/tasks?%53%49%44=synthetic-marker',
    'https://example.invalid/tasks?session_id=synthetic-marker',
    'https://example.invalid/tasks#access_token=synthetic-marker',
    'https://example.invalid/tasks?next=%253BSID%253Dsynthetic-marker',
    'https://example.invalid/tasks?next=%25253BSID%25253Dsynthetic-marker',
    'https://user:synthetic-marker@example.invalid/tasks',
    'javascript:alert(1)',
  ])('rejects a credential-bearing or unsafe assignment URL (%#)', async url => {
    const body = observation(); body.assignments[0]!.url = url;
    expect((await post(body)).status).toBe(400);
    expect(saveObservation).not.toHaveBeenCalled();
  });
  it('rejects nested secrets, credentials in free text, and raw failure messages', async () => {
    const original = observation();
    const bodies = [
      { ...original, assignments: [{ ...original.assignments[0], cookie: 'synthetic-marker' }] },
      { ...original, catalogCourses: [{ ...original.catalogCourses[0], name: 'Cookie: synthetic-marker' }] },
      { ...original, failures: [{ courseId: null, kind: 'http', detail: 'raw upstream error' }] },
    ];
    for (const body of bodies) expect((await post(body)).status).toBe(400);
    expect(saveObservation).not.toHaveBeenCalled();
  });
  it('rejects invalid JSON, media types and oversized bodies', async () => {
    expect((await fetch(base, { method: 'POST', headers: { Authorization: 'Bearer unit-test-credential',
      'Content-Type': 'application/json' }, body: '{' })).status).toBe(400);
    expect((await post(observation(), { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await post('x'.repeat(512 * 1024))).status).toBe(413);
    expect(saveObservation).not.toHaveBeenCalled();
  });
  it('never exposes storage errors', async () => {
    saveObservation.mockRejectedValueOnce(new Error('upstream-private-message'));
    const response = await post(observation());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal-error' });
  });
});

describe('observation wire validation', () => {
  it('encodes document key tuples without path separators or delimiter collisions', () => {
    expect(documentKey('demo-lms', '../fictional/task')).toMatch(/^[0-9a-f]{64}$/);
    expect(documentKey('demo-lms', 'a-b')).not.toBe(documentKey('demo-lms-a', 'b'));
  });
  it('accepts date/time, date-only, explicit none, and unreadable separately', () => {
    for (const deadline of [
      { kind: 'datetime', dueAt: '2026-11-12T13:00:00+09:00' },
      { kind: 'date', date: '2026-11-12' }, { kind: 'none' }, { kind: 'unreadable' },
    ]) {
      const body = observation();
      const input = { ...body, assignments: [{ ...body.assignments[0],
        deadline: { ...deadline, dueText: '', timeZone: 'Asia/Tokyo' } }] };
      expect(parseObservation(input)).toEqual(input);
    }
  });
  it('rejects duplicate IDs, missing list evidence, impossible dates and unknown versions', () => {
    const body = observation();
    const invalid = [
      { ...body, schemaVersion: 2 }, { ...body, system: 'unrecognized' },
      { ...body, observationId: '../other-student' },
      { ...body, assignments: [...body.assignments, ...body.assignments] },
      { ...body, courseResults: [...body.courseResults, ...body.courseResults] },
      { ...body, courseResults: [] },
      { ...body, fetchedAt: '2026-02-30T10:00:00+09:00' },
      { ...body, assignments: [{ ...body.assignments[0], deadline:
        { kind: 'date', date: '2026-02-30', dueText: '', timeZone: 'Asia/Tokyo' } }] },
    ];
    for (const value of invalid) expect(() => parseObservation(value)).toThrow('invalid-observation');
  });
  it('rejects arrays where the contract requires literal strings', () => {
    const body = observation();
    const failure = { courseId: 'fictional/course', kind: 'http', detail: 'http-error' };
    const invalid = [
      { ...body, system: ['demo-lms'] },
      { ...body, assignments: [{ ...body.assignments[0], submission: ['submitted'] }] },
      ...['courseId', 'kind', 'detail'].map(key => ({ ...body,
        failures: [{ ...failure, [key]: [failure[key as keyof typeof failure]] }] })),
    ];
    for (const value of invalid) expect(() => parseObservation(value)).toThrow('invalid-observation');
  });
});


describe('授業の参照URL', () => {
  it('安全なURLを受け取り、URLのない従来の観測も受け取る', () => {
    const body = observation();
    const url = 'https://example.invalid/course?id=fictional';
    const withUrl = { ...body, catalogCourses: body.catalogCourses.map(course => ({ ...course, url })) };
    expect(parseObservation(withUrl)).toEqual(withUrl);
    expect(parseObservation(body)).toEqual(body);
  });
  it.each([
    'https://example.invalid/course;SID=synthetic-marker',
    'https://example.invalid/course?SID=synthetic-marker',
    'https://example.invalid/course?%53%49%44=synthetic-marker',
    'https://example.invalid/course%3BSID%3Dsynthetic-marker',
    'https://example.invalid/course?access_token=synthetic-marker',
    'https://example.invalid/course?auth=synthetic-marker',
    'https://user:synthetic-marker@example.invalid/course',
    'https://example.invalid/course#synthetic-marker',
    'javascript:alert(1)', '', null,
  ])('認証情報や不正な授業URLを拒否する (%s)', url => {
    const body = observation();
    expect(() => parseObservation({ ...body,
      catalogCourses: body.catalogCourses.map(course => ({ ...course, url })),
    })).toThrow('invalid-observation');
  });
});
