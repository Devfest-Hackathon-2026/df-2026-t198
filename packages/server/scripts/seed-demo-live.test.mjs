import { describe, expect, it } from 'vitest';
import { liveSetupOptions, saveAccounts } from './seed-demo-live.mjs';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
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
      expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ fictional: true });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
