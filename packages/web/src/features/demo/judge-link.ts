type JudgeLink = { kind: 'absent' | 'invalid' } | { kind: 'credentials'; email: string; password: string };
type LinkPage = {
  location: Pick<Location, 'hash' | 'pathname' | 'search'>;
  history: Pick<History, 'replaceState'>;
};
export const judgeLoginFailure = 'リンクでログインできませんでした。説明資料のアカウントで入ってください。';
export function hasJudgeLink(hash: string) { return hash === '#judge' || hash.startsWith('#judge='); }

export function consumeJudgeLink(page: LinkPage): JudgeLink {
  const hash = page.location.hash;
  if (!hasJudgeLink(hash)) return { kind: 'absent' };
  // Remove the credential-bearing entry before decoding or starting any async work.
  page.history.replaceState(null, '', page.location.pathname + page.location.search);
  try {
    const encoded = hash.slice('#judge='.length);
    if (encoded.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return { kind: 'invalid' };
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'email,password' ||
      !('email' in value) || typeof value.email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) ||
      !('password' in value) || typeof value.password !== 'string' || !value.password) return { kind: 'invalid' };
    return { kind: 'credentials', email: value.email, password: value.password };
  } catch { return { kind: 'invalid' }; }
}

export async function loginWithJudgeLink<AuthState extends { currentUser: unknown; authStateReady(): Promise<void> }>(
  page: LinkPage, client: { auth: AuthState; logout(): Promise<void> } | null,
  signIn: (auth: AuthState, email: string, password: string) => Promise<unknown>,
): Promise<'absent' | 'success' | 'failed'> {
  try {
    const link = consumeJudgeLink(page);
    if (link.kind === 'absent') return 'absent';
    if (!client) return 'failed';
    await client.auth.authStateReady();
    if (client.auth.currentUser) await client.logout();
    if (link.kind !== 'credentials') return 'failed';
    await signIn(client.auth, link.email, link.password);
    return 'success';
  } catch {
    // Firebase/decoder/history errors may contain credentials; never forward them.
    return 'failed';
  }
}
