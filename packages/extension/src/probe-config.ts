export interface ProbeConfig {
  apiOrigin?: string;
  oauthClientId: string;
  firebase: { apiKey: string; authDomain: string; projectId: string; appId: string };
  invalidJson?: boolean;
}

declare const __AUTH_PROBE_CONFIG__: ProbeConfig;

export function missingConfig(config: ProbeConfig): string[] {
  if (config.invalidJson) return ['config.local.json（JSONの書式）'];
  const missing: string[] = [];
  if (!/^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(config.oauthClientId)) missing.push('oauthClientId（Chrome拡張用）');
  for (const key of ['apiKey', 'authDomain', 'projectId', 'appId'] as const) {
    if (!config.firebase[key]) missing.push(`firebase.${key}`);
  }
  return missing;
}

export const probeConfig: ProbeConfig = typeof __AUTH_PROBE_CONFIG__ === 'undefined'
  ? { oauthClientId: '', firebase: { apiKey: '', authDomain: '', projectId: '', appId: '' } }
  : __AUTH_PROBE_CONFIG__;

export function observationApiOrigin(): string | null {
  try {
    const url = new URL(probeConfig.apiOrigin ?? '');
    return url.protocol === 'https:' && url.origin === probeConfig.apiOrigin ? url.origin : null;
  } catch { return null; }
}
