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
    for (const path of ['icons', 'src', 'package.json', 'build.mjs', 'build-config.mjs', 'bundle-audit.mjs', 'manifest.json', 'options.html', 'options.css', 'popup.html', 'popup.css']) {
      await cp(new URL(`../${path}`, import.meta.url), join(extensionDir, path), { recursive: true });
    }
    await cp(new URL('../../core/src', import.meta.url), join(dir, 'packages/core/src'), { recursive: true });
    await symlink(fileURLToPath(new URL('../../core/node_modules', import.meta.url)), join(dir, 'packages/core/node_modules'), 'dir');
    await mkdir(join(dir, 'lms-definitions/coursepower'), { recursive: true });
    for (const name of ['definition.json', 'navigation.json']) await cp(new URL(`../../../lms-definitions/coursepower/${name}`, import.meta.url), join(dir, `lms-definitions/coursepower/${name}`));
    await mkdir(join(dir, 'lms-definitions/kulms'), { recursive: true });
    await cp(new URL('../../../lms-definitions/kulms/definition.json', import.meta.url), join(dir, 'lms-definitions/kulms/definition.json'));
    await mkdir(join(dir, 'lms-definitions/kulasis'), { recursive: true });
    await cp(new URL('../../../lms-definitions/kulasis/definition.json', import.meta.url), join(dir, 'lms-definitions/kulasis/definition.json'));
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
    expect(manifest.name).toBe('ToDoku');
    expect(manifest.description).toContain('ToDoku');
    const popup = await readFile(join(extensionDir, 'dist/popup.html'), 'utf8');
    expect(popup).toContain('<title>ToDoku</title>');
    expect(popup).toContain('<h1>ToDoku</h1>');
    const icons = { 16: 'icons/todoku-icon-16.png', 48: 'icons/todoku-icon-48.png', 128: 'icons/todoku-icon-128.png' };
    expect(manifest.icons).toEqual(icons);
    expect(manifest.action).toEqual({ default_popup: 'popup.html', default_icon: icons });
    for (const [size, path] of Object.entries(icons)) {
      const built = await readFile(join(extensionDir, 'dist', path));
      expect(built).toEqual(await readFile(new URL(`../${path}`, import.meta.url)));
      expect(built.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(built.readUInt32BE(16)).toBe(Number(size));
      expect(built.readUInt32BE(20)).toBe(Number(size));
    }
    expect(await readFile(join(extensionDir, 'dist/popup.html'), 'utf8')).toContain('src="popup.js"');
    expect(await readFile(join(extensionDir, 'dist/popup.js'), 'utf8')).toContain('chrome.tabs.create');
    expect(await readFile(join(extensionDir, 'dist/popup.css'), 'utf8')).toContain('button');
    expect(manifest.key).toBe(original.key);
    expect(manifest.permissions).toContain('alarms');
    for (const origin of ['https://lms.ynu.ac.jp', 'https://gmail.googleapis.com', config.apiOrigin]) {
      expect(manifest.host_permissions.filter(host => host === `${origin}/*`)).toHaveLength(1);
      expect(manifest.content_security_policy.extension_pages.split(' ').filter(value => value === origin)).toHaveLength(1);
    }
    expect(manifest.host_permissions).toContain('https://lms.gakusei.kyoto-u.ac.jp/*');
    expect(manifest.content_scripts).toContainEqual({ matches: ['https://lms.gakusei.kyoto-u.ac.jp/*'], js: ['kulms-content.js'], run_at: 'document_idle' });
    expect(await readFile(join(extensionDir, 'dist/kulms-content.js'), 'utf8')).toContain('same-origin');
    expect(manifest.host_permissions).toContain('https://www.k.kyoto-u.ac.jp/*');
    expect(manifest.content_scripts).toContainEqual({ matches: ['https://www.k.kyoto-u.ac.jp/student/*'], js: ['kulasis-content.js'], run_at: 'document_idle' });
    expect(await readFile(join(extensionDir, 'dist/kulasis-content.js'), 'utf8')).toContain('shift_jis');
    expect(manifest.content_security_policy.extension_pages.split(' ')).toContain('https://lms.gakusei.kyoto-u.ac.jp');
    expect(manifest.oauth2).toEqual({ client_id: config.oauthClientId, scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.app.created', 'https://www.googleapis.com/auth/gmail.send'] });
    const source = await readFile(join(extensionDir, 'dist/service-worker.js'), 'utf8');
    expect(source).toContain(config.firebase.apiKey);
    const html = await readFile(join(extensionDir, 'dist/options.html'), 'utf8');
    expect(html).toContain('<title>ToDokuの設定</title>');
    expect(html).toContain('<h1>ToDokuの設定</h1>');
    expect(html).toContain('src="options.js"');
    expect(html).not.toMatch(/<script[^>]+src=['"]https?:/);
    await expect(readFile(join(extensionDir, 'dist/config.local.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true }); }
});
