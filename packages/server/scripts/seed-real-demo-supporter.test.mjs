import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, stat, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupOptions, seedSupporter } from './seed-real-demo-supporter.mjs';
import { saveAccounts } from './seed-demo-live.mjs';

const projectId = 'project-00439085-4e2d-44c3-9a8';
const args = ['--project', projectId, '--create-real-demo-supporter'];
const google = uid => ({ uid, providerData: [{ providerId: 'google.com' }] });
function fixture(users = [google('fictional-student')], existing = []) {
  const documents = new Map(existing.map(path => [path, { existing: true }]));
  const created = [];
  const snapshot = ref => ({ exists: documents.has(ref.path) });
  const db = {
    doc: path => ({ path, get: async () => snapshot({ path }) }),
    runTransaction: async callback => {
      const writes = [];
      await callback({ get: async ref => snapshot(ref), create: (ref, data) => writes.push([ref.path, data]) });
      for (const [path] of writes) if (documents.has(path)) throw new Error('already-exists');
      for (const [path, data] of writes) { documents.set(path, data); created.push(path); }
    },
  };
  const missing = async () => { throw Object.assign(new Error('private SDK details'), { code: 'auth/user-not-found' }); };
  const auth = { listUsers: vi.fn(async () => ({ users })), getUser: vi.fn(missing),
    getUserByEmail: vi.fn(missing), createUser: vi.fn(async () => {}) };
  const persist = vi.fn(async () => {});
  const run = () => seedSupporter({ auth, db, persist, now: Date.parse('2026-11-06T07:00:00Z') });
  return { auth, db, persist, run, documents, created };
}

describe('real demonstration supporter setup', () => {
  it('requires the exact project, explicit action, and no mixed emulator configuration', () => {
    expect(setupOptions(args, {})).toBe(projectId);
    for (const input of [[], args.slice(0, 2), ['--project', 'other', args[2]], [...args, '--force']]) {
      expect(() => setupOptions(input, {})).toThrow('explicit-real-supporter-setup-required');
    }
    for (const name of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
      expect(() => setupOptions(args, { [name]: 'other' })).toThrow('explicit-real-supporter-setup-required');
    }
  });
  it.each([0, 2])('stops before any mutation when there are %i candidates and reports only their count', async count => {
    const f = fixture(Array.from({ length: count }, (_, i) => google(`fictional-${i}`)));
    await expect(f.run()).rejects.toThrow(`student-candidate-count=${count}`);
    expect(f.persist).not.toHaveBeenCalled();
    expect(f.auth.createUser).not.toHaveBeenCalled();
    expect(f.created).toEqual([]);
  });
  it('checks all Auth pages and excludes demo profiles and password-only users', async () => {
    const f = fixture([], ['demoAccounts/trial-1-student']);
    f.auth.listUsers.mockResolvedValueOnce({ users: [google('trial-1-student')], pageToken: 'next' })
      .mockResolvedValueOnce({ users: [{ uid: 'password-only', providerData: [] }, google('fictional-student')] });
    await f.run();
    expect(f.auth.listUsers.mock.calls).toEqual([[1000, undefined], [1000, 'next']]);
    expect(f.created).toEqual(['students/fictional-student/supporters/real-demo-supporter',
      'students/fictional-student/sessionContext/current']);
    expect(f.documents.get(f.created[0])).toEqual({ scopes: ['all'], revokedAt: null });
    expect(f.documents.get(f.created[1])).toEqual({ lastSessionAt: null, nextSessionAt: '2026-11-13T07:00:00.000Z' });
    expect(f.documents.get('demoAccounts/trial-1-student')).toEqual({ existing: true });
    const saved = f.persist.mock.calls[0][0];
    expect(saved.studentUid).toBe('fictional-student');
    expect(saved.supporter.email).toBe('real-demo-supporter@example.invalid');
    expect(saved.supporter.password.length).toBeGreaterThanOrEqual(32);
    expect(f.auth.createUser).toHaveBeenCalledExactlyOnceWith(saved.supporter);
    expect(f.persist.mock.invocationCallOrder[0]).toBeLessThan(f.auth.createUser.mock.invocationCallOrder[0]);
  });
  it.each(['students/fictional-student/supporters/real-demo-supporter',
    'students/fictional-student/sessionContext/current', 'demoAccounts/real-demo-supporter'])(
    'refuses an existing document: %s', async path => {
      const f = fixture(undefined, [path]);
      await expect(f.run()).rejects.toThrow('setup-document-already-exists');
      expect(f.persist).not.toHaveBeenCalled();
      expect(f.auth.createUser).not.toHaveBeenCalled();
      expect(f.created).toEqual([]);
    });
  it.each(['getUser', 'getUserByEmail'])('refuses an existing Auth identity found through %s', async lookup => {
    const f = fixture();
    f.auth[lookup].mockResolvedValueOnce({ uid: 'existing' });
    await expect(f.run()).rejects.toThrow('supporter-identity-unavailable');
    expect(f.persist).not.toHaveBeenCalled();
    expect(f.auth.createUser).not.toHaveBeenCalled();
  });
  it('does not create the remote user if exclusive credential storage fails', async () => {
    const f = fixture();
    f.persist.mockRejectedValueOnce(new Error('file-exists'));
    await expect(f.run()).rejects.toThrow();
    expect(f.auth.createUser).not.toHaveBeenCalled();
    expect(f.created).toEqual([]);
  });
  it('keeps the three existing fictional pairs and their session documents unchanged', async () => {
    const paths = [1, 2, 3].flatMap(n => [`demoAccounts/trial-${n}-student`, `demoAccounts/trial-${n}-supporter`,
      `students/trial-${n}-student/demo/current`, `students/trial-${n}-student/sessionContext/current`,
      `students/trial-${n}-student/supporters/trial-${n}-supporter`]);
    const f = fixture(undefined, paths);
    const before = paths.map(path => [path, globalThis.structuredClone(f.documents.get(path))]);
    await f.run();
    expect(paths.map(path => [path, f.documents.get(path)])).toEqual(before);
    expect(f.created).toHaveLength(2);
    expect(f.created.every(path => path.startsWith('students/fictional-student/'))).toBe(true);
  });
  it('aborts on an Auth lookup permission failure without treating it as a missing user', async () => {
    const f = fixture();
    f.auth.getUser.mockRejectedValueOnce(Object.assign(new Error('private account details'), { code: 'auth/insufficient-permission' }));
    await expect(f.run()).rejects.toThrow('supporter-identity-unavailable');
    expect(f.persist).not.toHaveBeenCalled();
    expect(f.auth.createUser).not.toHaveBeenCalled();
  });
  it('retains saved credentials on Auth failure without creating grants or retrying', async () => {
    const f = fixture();
    f.auth.createUser.mockRejectedValueOnce(new Error('private SDK details'));
    await expect(f.run()).rejects.toThrow();
    expect(f.persist).toHaveBeenCalledOnce();
    expect(f.auth.createUser).toHaveBeenCalledOnce();
    expect(f.created).toEqual([]);
  });
  it('rechecks documents inside the transaction and leaves existing context untouched', async () => {
    const f = fixture();
    f.auth.createUser.mockImplementationOnce(async () => {
      f.documents.set('students/fictional-student/sessionContext/current', { existing: true });
    });
    await expect(f.run()).rejects.toThrow('setup-document-already-exists');
    expect(f.created).toEqual([]);
    expect(f.documents.get('students/fictional-student/sessionContext/current')).toEqual({ existing: true });
  });
  it('writes mode 600 credentials and refuses existing files and symlinks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kadai-real-supporter-test-'));
    try {
      const path = join(dir, 'account.json');
      await saveAccounts(path, { fictional: true });
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      await expect(saveAccounts(path, {})).rejects.toThrow();
      const link = join(dir, 'link.json');
      await symlink(path, link);
      await expect(saveAccounts(link, {})).rejects.toThrow();
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ fictional: true });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
