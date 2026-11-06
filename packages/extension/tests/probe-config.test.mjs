import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { configureManifest, loadConfig, oauthScopes } from '../build-config.mjs';
import { auditBundle } from '../bundle-audit.mjs';

describe('local probe build config', () => {
  it('builds without config and only embeds whitelisted values from valid config', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'auth-probe-config-'));
    try {
      const file = join(dir, 'config.local.json');
      expect((await loadConfig(file)).firebase.apiKey).toBe('');
      const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
      expect(configureManifest(manifest, await loadConfig(file)).oauth2).toBeUndefined();
      await writeFile(file, JSON.stringify({ oauthClientId: '123-synthetic.apps.googleusercontent.com', clientSecret: 'synthetic-secret', firebase: { apiKey: 'synthetic-api-key', private_key: 'synthetic-secret' } }));
      const config = await loadConfig(file);
      expect(JSON.stringify(config)).not.toContain('synthetic-secret');
      expect(configureManifest(manifest, config).oauth2).toEqual({ client_id: config.oauthClientId, scopes: oauthScopes });
      expect(oauthScopes).toEqual(['openid', 'email', 'https://www.googleapis.com/auth/calendar.app.created']);
      await writeFile(file, '{"synthetic-secret":');
      const invalid = await loadConfig(file);
      expect(invalid.invalidJson).toBe(true);
      expect(JSON.stringify(invalid)).not.toContain('synthetic-secret');
    } finally { await rm(dir, { recursive: true }); }
  });

  it('rejects dynamic code and script loading in generated output', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'auth-probe-audit-'));
    const file = join(dir, 'worker.js');
    const meta = { outputs: { [file]: { imports: [] } } };
    try {
      for (const code of ['eval("x")', 'new Function("x")', 'import("x")', 'importScripts("https://example.org/a.js")', 'document.createElement("script")']) {
        await writeFile(file, code);
        await expect(auditBundle(meta)).rejects.toThrow('script loading');
      }
      await writeFile(file, '(() => { const x = 1; return x; })()');
      await expect(auditBundle(meta)).resolves.toBeUndefined();
      await expect(auditBundle({ outputs: { [file]: { imports: [{ external: true }] } } })).rejects.toThrow('unresolved imports');
    } finally { await rm(dir, { recursive: true }); }
  });
});

it('limits the API host permission and CSP to the configured HTTPS origin', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
  const configured = configureManifest(manifest, { apiOrigin: 'https://api.example.invalid', oauthClientId: '' });
  expect(configured.host_permissions).toEqual([...manifest.host_permissions, 'https://api.example.invalid/*']);
  expect(configured.content_security_policy.extension_pages).toBe(`${manifest.content_security_policy.extension_pages} https://api.example.invalid`);
  for (const apiOrigin of ['invalid-synthetic-marker', 'http://api.example.invalid', 'https://name:password@api.example.invalid',
    'https://api.example.invalid/api', 'https://api.example.invalid/?x=1', 'https://api.example.invalid/#fragment']) {
    expect(() => configureManifest(manifest, { apiOrigin, oauthClientId: '' })).toThrow('apiOrigin must be an HTTPS origin');
  }
});
