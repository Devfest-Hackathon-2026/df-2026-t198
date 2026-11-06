import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it('builds the real SDK with synthetic local config, fixed ID, local scripts and no bundled imports', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'auth-probe-build-'));
  try {
    // Never read the user's real config or key. Build an isolated copy with dummy values.
    for (const path of ['src', 'package.json', 'build.mjs', 'build-config.mjs', 'bundle-audit.mjs', 'manifest.json', 'options.html', 'options.css']) {
      await cp(new URL(`../${path}`, import.meta.url), join(dir, path), { recursive: true });
    }
    await symlink(fileURLToPath(new URL('../node_modules', import.meta.url)), join(dir, 'node_modules'), 'dir');
    const config = {
      oauthClientId: '123-synthetic.apps.googleusercontent.com',
      apiOrigin: 'https://api.example.invalid',
      firebase: { apiKey: 'synthetic-api-key', authDomain: 'synthetic.firebaseapp.com', projectId: 'synthetic', appId: 'synthetic-app' },
    };
    await writeFile(join(dir, 'config.local.json'), JSON.stringify(config));
    // The real build also runs the code-generation/script-loading audit.
    await promisify(execFile)(process.execPath, ['build.mjs'], { cwd: dir });
    const manifest = JSON.parse(await readFile(join(dir, 'dist/manifest.json'), 'utf8'));
    const original = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
    expect(manifest.key).toBe(original.key);
    expect(manifest.host_permissions).toContain('https://api.example.invalid/*');
    expect(manifest.content_security_policy.extension_pages).toContain('https://api.example.invalid');
    expect(manifest.oauth2).toEqual({ client_id: config.oauthClientId, scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.app.created'] });
    const source = await readFile(join(dir, 'dist/service-worker.js'), 'utf8');
    expect(source).toContain(config.firebase.apiKey);
    const html = await readFile(join(dir, 'dist/options.html'), 'utf8');
    expect(html).toContain('src="options.js"');
    expect(html).not.toMatch(/<script[^>]+src=['"]https?:/);
    await expect(readFile(join(dir, 'dist/config.local.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true }); }
});
