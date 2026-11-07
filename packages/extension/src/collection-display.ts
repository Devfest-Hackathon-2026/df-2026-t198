const key = 'ynuCollectionDisplay';

export function collectionDisplay(value: unknown): { badge: string; title: string } {
  if (!value || typeof value !== 'object') return { badge: '', title: '' };
  const { status, finishedAt } = value as { status?: unknown; finishedAt?: unknown };
  if (status === 'running') return { badge: '…', title: 'LMSの課題を更新しています' };
  if (typeof finishedAt !== 'number' || !Number.isFinite(finishedAt)) return { badge: '', title: '' };
  const date = new Date(finishedAt);
  if (Number.isNaN(date.getTime())) return { badge: '', title: '' };
  const time = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} に`;
  if (status === 'success') return { badge: '', title: `${time}LMSの課題を更新しました` };
  if (status === 'yielded') return { badge: '', title: `${time}LMSの操作を優先して更新を中断しました` };
  if (status === 'sign-in-required') return { badge: '!', title: `${time}課題を更新できませんでした。拡張機能の設定からGoogleにログインしてください` };
  if (status === 'api-not-configured') return { badge: '!', title: `${time}課題を更新できませんでした。拡張機能の接続先の設定が必要です` };
  if (typeof status !== 'string') return { badge: '', title: '' };
  return { badge: '!', title: `${time}一部の課題を更新できませんでした。LMSを開き直してください` };
}

// Presentation failures must not change collection, delivery, or diagnostic counts.
export async function showCollectionStatus(status: string): Promise<void> {
  const value = { status, finishedAt: status === 'running' ? null : Date.now() };
  const display = collectionDisplay(value);
  await Promise.allSettled([
    Promise.resolve().then(() => chrome.storage.session.set({ [key]: value })),
    Promise.resolve().then(() => chrome.action.setBadgeText({ text: display.badge })),
    Promise.resolve().then(() => chrome.action.setBadgeBackgroundColor({ color: '#806322' })),
    Promise.resolve().then(() => chrome.action.setTitle({ title: display.title })),
  ]);
}

export function watchCollectionStatus(render: (title: string) => void): void {
  let revision = 0;
  const refresh = () => {
    const current = ++revision;
    void chrome.storage.session.get(key).then(saved => {
      if (revision === current) render(collectionDisplay(saved[key]).title);
    }).catch(() => { if (revision === current) render(''); });
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && key in changes) refresh();
  });
  refresh();
}
