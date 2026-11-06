import { expect, it, vi } from 'vitest';
import { watchSession, type SessionSource, type SessionState } from '../src/session-watch';
import { emptySession } from '../src/session-model';

function fixture() {
  let grant: (allowed: boolean) => void = () => {};
  const next: Record<string, (value: unknown) => void> = {};
  const fail: Record<string, () => void> = {};
  const stops = vi.fn();
  const source: SessionSource = {
    grant: (_student, _viewer, receive) => { grant = receive; return stops; },
    watch: (_student, collection, receive, error) => {
      next[collection] = receive as (value: unknown) => void; fail[collection] = error; return stops;
    },
  };
  const updates: SessionState[] = [];
  const stop = watchSession(source, 'student-a', 'supporter-a', state => updates.push(state));
  const ready = () => { grant(true); for (const [key, value] of Object.entries(emptySession())) next[key]?.(value); };
  return { updates, stop, ready, next, fail, grant: (allowed: boolean) => grant(allowed), stops };
}
it('waits for a grant and all data before displaying the session', () => {
  const f = fixture();
  expect(f.next).toEqual({});
  expect(f.updates.at(-1)?.status).toBe('loading');
  f.ready();
  expect(f.updates.at(-1)?.status).toBe('ready');
});
it('clears every section on revocation and ignores queued callbacks afterwards', () => {
  const f = fixture(); f.ready(); f.grant(false);
  expect(f.updates.at(-1)).toEqual({ status: 'denied', data: emptySession() });
  const count = f.updates.length;
  f.next['courses']?.([{ courseId: 'secret-from-old-student' }]); f.grant(true);
  expect(f.updates).toHaveLength(count);
  expect(f.stops).toHaveBeenCalledTimes(7);
});
it('clears previous data on listener failure and stops updates after a student switch or logout', () => {
  const f = fixture(); f.ready(); f.fail['assignments']?.();
  expect(f.updates.at(-1)).toEqual({ status: 'error', data: emptySession() });
  const switched = fixture(); switched.ready(); switched.stop();
  const count = switched.updates.length;
  switched.next['assignments']?.([{ title: 'old-data' }]);
  expect(switched.updates).toHaveLength(count);
});
