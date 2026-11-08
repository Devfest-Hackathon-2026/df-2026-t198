import type { FetchState } from '../../../../core/src/types';

export function fetchStatus(state: FetchState, now: number) {
  return {
    stale: state.lastSucceededAt !== null && now - Date.parse(state.lastSucceededAt) >= 3 * 86400_000,
    failed: state.lastResult !== 'success',
  };
}
