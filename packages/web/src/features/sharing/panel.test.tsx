import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { User } from 'firebase/auth';
import { SharingControls, sharingRequest, watchSharing, type SharingData } from './panel';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), next: (_snapshot: { metadata: { fromCache: boolean } }) => { void _snapshot; }, fail: () => {}, stop: vi.fn() }));
vi.mock('../../shared/firebase', () => ({ firebase: { db: {} } }));
vi.mock('../../shared/network', () => ({ serverFetch: mocks.fetch }));
vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'),
  onSnapshot: (_path: string, _options: unknown, next: typeof mocks.next, fail: typeof mocks.fail) => {
    mocks.next = next; mocks.fail = fail; return mocks.stop;
  },
}));
const user = { uid: 'student', getIdToken: async () => 'unit-test-only' } as User;
const supporter = { uid: 'supporter', displayName: '架空の支援担当', revoked: false };
const data = { supporters: [supporter], canManage: true };
const response = (body: unknown) => ({ ok: true, json: async () => body });
afterEach(() => { vi.clearAllMocks(); });
it('hides empty and public sharing; retains the stopped supporter and the restore action', () => {
  const render = (value: SharingData) => renderToStaticMarkup(<SharingControls data={value} change={vi.fn()} />);
  expect(render({ ...data, supporters: [] })).toBe('');
  expect(render({ ...data, canManage: false })).toBe('');
  expect(render(data)).toContain('共有をやめる');
  expect(render(data)).toContain('架空の支援担当');
  expect(render({ ...data, supporters: [{ ...supporter, revoked: true }] })).toContain('もう一度共有する');
  expect(render({ ...data, supporters: [{ uid: 'known-id', revoked: false }] })).toContain('支援担当');
  expect(render({ ...data, supporters: [{ uid: 'known-id', revoked: false }] })).not.toContain('known-id');
});
it('uses an authenticated bodyless request, encodes the existing supporter and rejects unsuccessful writes', async () => {
  mocks.fetch.mockResolvedValue(response({}));
  await sharingRequest(user, { ...supporter, uid: 'a/b' });
  expect(mocks.fetch).toHaveBeenLastCalledWith('/api/v1/sharing/supporters/a%2Fb/revoke', {
    method: 'POST', cache: 'no-store', headers: { Authorization: 'Bearer unit-test-only' },
  });
  await sharingRequest(user, { ...supporter, revoked: true });
  expect(mocks.fetch.mock.calls.at(-1)![0]).toBe('/api/v1/sharing/supporters/supporter/restore');
  mocks.fetch.mockResolvedValue({ ok: false });
  await expect(sharingRequest(user, supporter)).rejects.toThrow('sharing-request-failed');
});
it('ignores cached snapshots and late responses, and clears controls after listener failure', async () => {
  const next = vi.fn();
  let resolve!: (value: unknown) => void;
  mocks.fetch.mockReturnValue(new Promise(done => { resolve = done; }));
  const stop = watchSharing(user, next);
  mocks.next({ metadata: { fromCache: true } });
  expect(mocks.fetch).not.toHaveBeenCalled();
  mocks.next({ metadata: { fromCache: false } });
  await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
  mocks.fail(); expect(next).toHaveBeenLastCalledWith(null);
  resolve(response(data)); await Promise.resolve(); await Promise.resolve();
  expect(next).toHaveBeenCalledTimes(1);
  mocks.fetch.mockResolvedValue(response(data));
  mocks.next({ metadata: { fromCache: false } });
  await vi.waitFor(() => expect(next).toHaveBeenLastCalledWith(data));
  next.mockClear(); mocks.next({ metadata: { fromCache: false } }); stop();
  await Promise.resolve(); await Promise.resolve();
  expect(next).not.toHaveBeenCalled(); expect(mocks.stop).toHaveBeenCalledOnce();
});
