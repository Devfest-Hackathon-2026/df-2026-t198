/** Public policy requests carry neither Firebase nor LMS credentials. Fail closed. */
export async function backgroundCollectionEnabled(api: string): Promise<boolean> {
  try {
    const response = await fetch(`${api}/api/v1/collection-policy`, {
      method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error',
      referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return false;
    const policy: unknown = await response.json();
    return policy !== null && typeof policy === 'object' && !Array.isArray(policy)
      && Object.keys(policy).length === 1 && 'backgroundCollection' in policy
      && policy.backgroundCollection === 'enabled';
  } catch {
    return false;
  }
}
