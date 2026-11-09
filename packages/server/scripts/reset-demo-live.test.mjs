import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { expect, it, vi } from 'vitest';
import { liveResetOptions, resetDemoPairs } from './reset-demo-live.mjs';

const project = 'project-00439085-4e2d-44c3-9a8';
const args = ['--project', project, '--reset-demo-pairs'];
const pairs = ['trial-1', 'trial-2', 'trial-3', 'public-1'];
function fixture() {
  const profiles = new Map(pairs.flatMap(pair => ['student', 'supporter'].map(role => [
    `demoAccounts/${pair}-${role}`, { role, studentId: `${pair}-student`, ...(pair === 'public-1' ? { public: true } : {}) },
  ])));
  profiles.set('demoAccounts/unrelated-student', { role: 'student', studentId: 'unrelated-student' });
  const db = { doc: path => ({ path }), getAll: vi.fn(async (...refs) => refs.map(ref => ({
    id: ref.path.split('/').at(-1), data: () => profiles.get(ref.path),
  }))) };
  const reset = vi.fn(async () => ({ reset: true }));
  const report = vi.fn();
  const run = (dryRun = false) => resetDemoPairs({ db, reset, dryRun, report });
  return { db, profiles, reset, report, run };
}

it('requires the fixed project and one explicit dry-run or reset action', () => {
  for (const input of [[], args.slice(0, 2), ['--project', 'other', args[2]], [...args, '--dry-run'],
    [...args.slice(0, 2), '--force']]) {
    expect(() => liveResetOptions(input, {})).toThrow('explicit-live-demo-reset-required');
  }
  expect(liveResetOptions(args, {})).toEqual({ projectId: project, dryRun: false });
  expect(liveResetOptions([...args.slice(0, 2), '--dry-run'], {})).toEqual({ projectId: project, dryRun: true });
});
it('refuses emulator settings even when empty, and conflicting cloud projects', () => {
  for (const mode of ['--dry-run', '--reset-demo-pairs']) {
    for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB']) {
      expect(() => liveResetOptions(['--project', project, mode], { [key]: '' }))
        .toThrow('explicit-live-demo-reset-required');
    }
    for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
      expect(() => liveResetOptions(['--project', project, mode], { [key]: 'other' }))
        .toThrow('explicit-live-demo-reset-required');
    }
  }
});
it('dry-run reads only the eight selected demo markers, reports only four, and never resets', async () => {
  const f = fixture();
  await f.run(true);
  expect(f.db.getAll.mock.calls[0][0].path).toBe('demoAccounts/trial-1-student');
  expect(f.db.getAll.mock.calls[0].map(ref => ref.path)).toEqual(pairs.flatMap(pair =>
    ['student', 'supporter'].map(role => `demoAccounts/${pair}-${role}`)));
  expect(f.reset).not.toHaveBeenCalled();
  expect(f.report.mock.calls).toEqual([[4]]);
});
it('resets exactly the four marked owners with the existing unconditional reset operation', async () => {
  const f = fixture();
  await f.run();
  expect(f.reset.mock.calls).toEqual(pairs.map(pair => [`${pair}-student`, false]));
  expect(f.report.mock.calls).toEqual([['reset-completed: 1'], ['reset-completed: 2'],
    ['reset-completed: 3'], ['reset-completed: 4']]);
});
it('validates every pair before writing and refuses missing or mismatched markers', async () => {
  for (const [path, profile] of [
    ['demoAccounts/public-1-supporter', undefined],
    ['demoAccounts/trial-3-student', { role: 'student', studentId: 'other' }],
    ['demoAccounts/public-1-student', { role: 'student', studentId: 'public-1-student' }],
    ['demoAccounts/trial-2-supporter', { role: 'student', studentId: 'trial-2-student' }],
    ['demoAccounts/trial-1-student', { role: 'student', studentId: 'trial-1-student', public: true }],
  ]) {
    for (const dryRun of [true, false]) {
      const f = fixture();
      f.profiles.set(path, profile);
      await expect(f.run(dryRun)).rejects.toThrow('demo-pair-markers-required');
      expect(f.reset).not.toHaveBeenCalled();
      expect(f.report).not.toHaveBeenCalled();
    }
  }
});
it('stops on a failed reset, leaving the completed count without SDK details', async () => {
  const f = fixture();
  f.reset.mockResolvedValueOnce({ reset: true }).mockRejectedValueOnce(new Error('synthetic SDK detail'));
  await expect(f.run()).rejects.toThrow();
  expect(f.reset).toHaveBeenCalledTimes(2);
  expect(f.report.mock.calls).toEqual([['reset-completed: 1']]);
});

it('CLI rejects an unapproved project without printing arguments or SDK details', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./reset-demo-live.mjs', import.meta.url)),
    '--project', 'unapproved-project', '--reset-demo-pairs'], { encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('live-demo-reset-failed; inspect reset state before retrying\n');
});
