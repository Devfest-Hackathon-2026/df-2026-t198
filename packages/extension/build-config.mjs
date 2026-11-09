import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { calendarScopes, gmailScope } from './src/auth/scopes.ts';

export const oauthScopes = [...calendarScopes, gmailScope];

export async function loadConfig(path = 'config.local.json') {
  let raw = {};
  let invalidJson = false;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') invalidJson = true;
  }
  const string = (value) => typeof value === 'string' ? value.trim() : '';
  // Only documented public web config is embedded. Never copy extra fields (e.g. client secrets).
  return {
    oauthClientId: string(raw?.oauthClientId),
    apiOrigin: apiOrigin(string(raw?.apiOrigin)),
    firebase: Object.fromEntries(['apiKey', 'authDomain', 'projectId', 'appId'].map((key) => [key, string(raw?.firebase?.[key])])),
    invalidJson,
  };
}

function apiOrigin(value) {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new Error('apiOrigin must be an HTTPS origin'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('apiOrigin must be an HTTPS origin');
  }
  return url.origin;
}

export function configureManifest(manifest, config) {
  const result = { ...manifest };
  const origins = ['https://lms.ynu.ac.jp'];
  if (config.apiOrigin) origins.push(apiOrigin(config.apiOrigin));
  const uniqueOrigins = [...new Set(origins)];
  result.host_permissions = [...new Set([...manifest.host_permissions, ...uniqueOrigins.map(origin => `${origin}/*`)])];
  result.content_security_policy = { ...manifest.content_security_policy,
    extension_pages: `${manifest.content_security_policy.extension_pages} ${uniqueOrigins.join(' ')}` };
  if (/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(config.oauthClientId) && !config.invalidJson) {
    result.oauth2 = { client_id: config.oauthClientId, scopes: oauthScopes };
  }
  // Only the student page of this build's Firebase project may start the calendar connection (D46).
  const origin = studentOrigin(config);
  if (origin) result.externally_connectable = { matches: [`${origin}/*`] };
  return result;
}

export function studentOrigin(config) {
  const projectId = config.firebase?.projectId ?? '';
  return !config.invalidJson && /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ? `https://${projectId}.web.app` : null;
}
