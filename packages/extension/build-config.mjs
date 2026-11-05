import { readFile } from 'node:fs/promises';

export const oauthScopes = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.app.created'];

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
    firebase: Object.fromEntries(['apiKey', 'authDomain', 'projectId', 'appId'].map((key) => [key, string(raw?.firebase?.[key])])),
    invalidJson,
  };
}

export function configureManifest(manifest, config) {
  const result = { ...manifest };
  if (/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(config.oauthClientId) && !config.invalidJson) {
    result.oauth2 = { client_id: config.oauthClientId, scopes: oauthScopes };
  }
  return result;
}
