import { createPublicKey, verify, type JsonWebKeyInput } from 'node:crypto';

interface Claims { iss?: string; aud?: string; sub?: string; email?: string; email_verified?: boolean; exp?: number; iat?: number }
type GoogleKey = JsonWebKeyInput['key'] & { kid: string; alg: string; use: string };
/** Google-only RS256 verifier. Never takes a key URL or an issuer from the request. */
export function createSchedulerVerifier(audience: string, serviceAccount: string,
  fetchKeys: typeof fetch = fetch, clock: () => Date = () => new Date()) {
  let keys: GoogleKey[] = [], validUntil = 0, unknownKidRefreshAfter = 0;
  let refreshing: Promise<void> | undefined;
  const refreshKeys = (now: number): Promise<void> => {
    refreshing ??= (async () => {
      const response = await fetchKeys('https://www.googleapis.com/oauth2/v3/certs', {
        signal: AbortSignal.timeout(5000), redirect: 'error',
      });
      if (!response.ok) throw new Error('unauthorized');
      const body = await response.json() as { keys: GoogleKey[] };
      if (!Array.isArray(body.keys)) throw new Error('unauthorized');
      keys = body.keys;
      const seconds = Number(response.headers.get('cache-control')?.match(/max-age=(\d+)/)?.[1] ?? 0);
      validUntil = now + Math.min(seconds, 3600) * 1000;
    })().finally(() => { refreshing = undefined; });
    return refreshing;
  };
  const findKey = (kid: string) => keys.find(k => k.kid === kid && k.kty === 'RSA' && k.alg === 'RS256' && k.use === 'sig');
  return async (token: string): Promise<void> => {
    if (!audience || !serviceAccount.endsWith('.gserviceaccount.com') || token.length > 16_384) throw new Error('unauthorized');
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p))) throw new Error('unauthorized');
    const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString()) as { alg?: string; kid?: string; crit?: unknown };
    const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()) as Claims;
    const now = clock().getTime();
    if (header.alg !== 'RS256' || !header.kid || header.crit ||
      !['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss ?? '') ||
      claims.aud !== audience || claims.email !== serviceAccount || claims.email_verified !== true ||
      !/^\d+$/.test(claims.sub ?? '') || !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat) ||
      claims.exp! * 1000 <= now || claims.iat! * 1000 > now + 60_000 || claims.exp! <= claims.iat! ||
      claims.exp! - claims.iat! > 3900) throw new Error('unauthorized');
    if (now >= validUntil) await refreshKeys(now);
    let key = findKey(header.kid);
    if (!key && (refreshing || now >= unknownKidRefreshAfter)) {
      // Share concurrent refreshes; failed attempts also consume the cooldown.
      if (!refreshing) unknownKidRefreshAfter = now + 60_000;
      await refreshKeys(now);
      key = findKey(header.kid);
    }
    if (!key || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key, format: 'jwk' }),
      Buffer.from(parts[2]!, 'base64url'))) throw new Error('unauthorized');
  };
}
