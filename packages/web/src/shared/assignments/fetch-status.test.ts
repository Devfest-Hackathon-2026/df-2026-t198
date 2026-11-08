import { expect, it } from 'vitest';
import type { FetchState } from '../../../../core/src/types';
import { fetchStatus } from './fetch-status';

const state: FetchState = { studentId: 'fictional', system: 'ynu-lms',
  lastAttemptedAt: '2026-11-06T15:30:00Z', lastSucceededAt: '2026-11-03T15:30:00Z',
  lastResult: 'success', lastFailureKind: null, lastAppliedObservationId: 'fictional' };

it('counts 72 elapsed hours from the last successful fetch, including the exact boundary', () => {
  expect(fetchStatus(state, Date.parse('2026-11-06T15:29:59.999Z'))).toEqual({ stale: false, failed: false });
  expect(fetchStatus(state, Date.parse('2026-11-06T15:30:00Z'))).toEqual({ stale: true, failed: false });
});
it.each(['partial', 'failed'] as const)('keeps staleness and incomplete fetching distinct: %s', lastResult => {
  const now = Date.parse('2026-11-06T15:30:00Z');
  expect(fetchStatus({ ...state, lastResult }, now)).toEqual({ stale: true, failed: true });
  expect(fetchStatus({ ...state, lastResult, lastSucceededAt: null }, now)).toEqual({ stale: false, failed: true });
});
