import { describe, expect, it, vi } from 'vitest';
import { liveSetupOptions, saveAccounts, seedPairs } from './seed-demo-live.mjs';
import { mkdtemp, readFile, stat, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = ['--project', 'project-00439085-4e2d-44c3-9a8', '--create-trial-accounts'];
describe('live demo setup authority and credential storage', () => {
  it('requires the exact project and explicit creation argument', () => {
    for (const input of [[], args.slice(0, 2), ['--project', 'other', args[2]], [...args, '--force']]) {
      expect(() => liveSetupOptions(input, {})).toThrow('explicit-live-demo-setup-required');
    }
    expect(liveSetupOptions(args, {})).toBe('project-00439085-4e2d-44c3-9a8');
  });
  it('accepts the separate explicit public-pair action with the same guards', () => {
    const publicArgs = [...args.slice(0, 2), '--create-public-pair'];
    expect(liveSetupOptions(publicArgs, {})).toBe(args[1]);
    for (const input of [[...publicArgs, '--create-trial-accounts'], [...publicArgs, '--force'],
      ['--project', 'other', '--create-public-pair']]) {
      expect(() => liveSetupOptions(input, {})).toThrow('explicit-live-demo-setup-required');
    }
    for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
      expect(() => liveSetupOptions(publicArgs, { [name]: '' })).toThrow('explicit-live-demo-setup-required');
    }
  });
  it('rejects mixed emulator and real-project configuration', () => {
    for (const name of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
      expect(() => liveSetupOptions(args, { [name]: 'demo-kadai-hisho' })).toThrow('explicit-live-demo-setup-required');
    }
  });
  it('writes credentials with mode 600 and never overwrites an existing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kadai-i59-test-'));
    const path = join(dir, 'accounts.json');
    try {
      await saveAccounts(path, { fictional: true });
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      await expect(saveAccounts(path, { replaced: true })).rejects.toThrow();
      const link = join(dir, 'link.json');
      await symlink(path, link);
      await expect(saveAccounts(link, {})).rejects.toThrow();
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ fictional: true });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

function fixture(existing = []) {
  const documents = new Map(existing.map(path => [path, { existing: true }]));
  const writes = [];
  const missing = async () => { throw Object.assign(new Error('synthetic private SDK detail'), { code: 'auth/user-not-found' }); };
  const auth = { getUser: vi.fn(missing), getUserByEmail: vi.fn(missing), createUser: vi.fn(async () => {}) };
  const db = {
    doc: path => ({ path, get: async () => ({ exists: documents.has(path) }) }),
    batch: () => ({ create: (ref, data) => writes.push([ref.path, data]), commit: vi.fn(async () => {
      for (const [path] of writes) if (documents.has(path)) throw new Error('already-exists');
      for (const [path, data] of writes) documents.set(path, data);
    }) }),
  };
  const persist = vi.fn(async () => {});
  const run = () => seedPairs({ auth, db, persist, publicPair: true, now: Date.parse('2026-11-08T00:00:00Z') });
  return { auth, db, persist, run, documents, writes };
}
const publicPaths = ['demoAccounts/public-1-student', 'demoAccounts/public-1-supporter',
  'students/public-1-student/demo/current', 'students/public-1-student/supporters/public-1-supporter',
  'students/public-1-student/sessionContext/current'];
describe('public pair creation', () => {
  it('persists random credentials before creating only the public pair, grant, profile and session', async () => {
    const trials = [1, 2, 3].flatMap(n => [`demoAccounts/trial-${n}-student`, `demoAccounts/trial-${n}-supporter`]);
    const f = fixture(trials);
    await f.run();
    expect(f.writes.map(([path]) => path)).toEqual(publicPaths);
    for (const path of publicPaths.slice(0, 2)) expect(f.documents.get(path)).toMatchObject({ public: true, studentId: 'public-1-student' });
    expect(f.documents.get(publicPaths[3])).toEqual({ scopes: ['all'], revokedAt: null });
    expect(f.documents.get(publicPaths[4]).nextSessionAt).toMatch(/^2026-11-/);
    const saved = f.persist.mock.calls[0][0];
    expect(saved.pairs).toHaveLength(1);
    expect(saved.pairs[0].pair).toBe('public-1');
    const accounts = [saved.pairs[0].student, saved.pairs[0].supporter];
    expect(new Set(accounts.map(a => a.password)).size).toBe(2);
    for (const account of accounts) expect(account.password).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(f.auth.createUser.mock.calls.flat()).toEqual(accounts);
    expect(f.persist.mock.invocationCallOrder[0]).toBeLessThan(f.auth.createUser.mock.invocationCallOrder[0]);
    for (const path of trials) expect(f.documents.get(path)).toEqual({ existing: true });
    expect(f.auth.getUser.mock.calls.flat()).toEqual(accounts.map(a => a.uid));
  });
  it.each(publicPaths)('stops before storing credentials or mutating Auth if %s already exists', async path => {
    const f = fixture([path]);
    await expect(f.run()).rejects.toThrow('demo-document-already-exists');
    expect(f.persist).not.toHaveBeenCalled();
    expect(f.auth.createUser).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
  });
  it.each(['getUser', 'getUserByEmail'])('refuses an existing identity or denied lookup via %s', async method => {
    for (const denied of [false, true]) {
      const f = fixture();
      if (denied) f.auth[method].mockRejectedValueOnce({ code: 'auth/insufficient-permission' });
      else f.auth[method].mockResolvedValueOnce({ uid: 'existing' });
      await expect(f.run()).rejects.toThrow('demo-account-preflight-failed');
      expect(f.persist).not.toHaveBeenCalled();
      expect(f.auth.createUser).not.toHaveBeenCalled();
    }
  });
  it('does not mutate Auth or documents if exclusive credential storage fails', async () => {
    const f = fixture();
    f.persist.mockRejectedValueOnce(new Error('file-exists'));
    await expect(f.run()).rejects.toThrow('file-exists');
    expect(f.auth.createUser).not.toHaveBeenCalled();
    expect(f.writes).toEqual([]);
  });
  it('retains saved credentials on partial failure and refuses a racing document without overwrite', async () => {
    const f = fixture();
    f.auth.createUser.mockImplementationOnce(async () => f.documents.set(publicPaths[2], { existing: true }));
    await expect(f.run()).rejects.toThrow('already-exists');
    expect(f.persist).toHaveBeenCalledOnce();
    expect(f.documents.get(publicPaths[2])).toEqual({ existing: true });
  });
  it('keeps the default trial setup separate and without a public marker', async () => {
    const f = fixture();
    await seedPairs({ auth: f.auth, db: f.db, persist: f.persist });
    expect(f.persist.mock.calls[0][0].pairs.map(p => p.pair)).toEqual(['trial-1', 'trial-2', 'trial-3']);
    expect(f.auth.createUser).toHaveBeenCalledTimes(6);
    expect(f.writes).toHaveLength(15);
    expect(f.writes.every(([, data]) => !Object.hasOwn(data, 'public'))).toBe(true);
  });
});
