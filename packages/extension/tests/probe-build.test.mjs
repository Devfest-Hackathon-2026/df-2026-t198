import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('builds the real SDK with synthetic local config, fixed ID, local scripts and no bundled imports', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auth-probe-build-'));
  try {
    const extensionDir = join(dir, 'packages/extension');
    await mkdir(extensionDir, { recursive: true });
    // Never read the user's real config or key. Build an isolated copy with dummy values.
    for (const path of ['src', 'package.json', 'build.mjs', 'build-config.mjs', 'bundle-audit.mjs', 'manifest.json', 'options.html', 'options.css']) {
      await cp(new URL(`../${path}`, import.meta.url), join(extensionDir, path), { recursive: true });
    }
    await cp(new URL('../../core/src', import.meta.url), join(dir, 'packages/core/src'), { recursive: true });
    await symlink(fileURLToPath(new URL('../../core/node_modules', import.meta.url)), join(dir, 'packages/core/node_modules'), 'dir');
    await mkdir(join(dir, 'lms-definitions/coursepower'), { recursive: true });
    for (const name of ['definition.json', 'navigation.json']) await cp(new URL(`../../../lms-definitions/coursepower/${name}`, import.meta.url), join(dir, `lms-definitions/coursepower/${name}`));
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(extensionDir, 'node_modules'), 'dir');
    const config = {
      oauthClientId: '123-synthetic.apps.googleusercontent.com',
      apiOrigin: 'https://api.example.invalid',
      firebase: { apiKey: 'synthetic-api-key', authDomain: 'synthetic.firebaseapp.com', projectId: 'synthetic', appId: 'synthetic-app' },
    };
    await writeFile(join(extensionDir, 'config.local.json'), JSON.stringify(config));
    // The real build also runs the code-generation/script-loading audit.
    await promisify(execFile)(process.execPath, ['build.mjs'], { cwd: extensionDir });
    const manifest = JSON.parse(await readFile(join(extensionDir, 'dist/manifest.json'), 'utf8'));
    const original = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
    expect(manifest.key).toBe(original.key);
    for (const origin of ['https://lms.ynu.ac.jp', config.apiOrigin]) {
      expect(manifest.host_permissions.filter(host => host === `${origin}/*`)).toHaveLength(1);
      expect(manifest.content_security_policy.extension_pages.split(' ').filter(value => value === origin)).toHaveLength(1);
    }
    expect(manifest.oauth2).toEqual({ client_id: config.oauthClientId, scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.app.created'] });
    const source = await readFile(join(extensionDir, 'dist/service-worker.js'), 'utf8');
    expect(source).toContain(config.firebase.apiKey);
    const html = await readFile(join(extensionDir, 'dist/options.html'), 'utf8');
    expect(html).toContain('src="options.js"');
    expect(html).not.toMatch(/<script[^>]+src=['"]https?:/);
    await expect(readFile(join(extensionDir, 'dist/config.local.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true }); }
});
