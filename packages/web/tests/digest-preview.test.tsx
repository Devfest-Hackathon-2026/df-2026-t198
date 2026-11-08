import { createRequire } from 'node:module';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { User } from 'firebase/auth';
import { afterEach, expect, it, vi } from 'vitest';
import { DigestPreview } from '../src/features/digest/preview';

vi.mock('../src/shared/firebase', () => ({ firebase: { db: {} } }));
vi.mock('firebase/firestore', () => ({ collection: vi.fn(), onSnapshot: () => () => {} }));
const requireCore = createRequire(new URL('../../core/package.json', import.meta.url));
const { parseHTML } = requireCore('linkedom');
afterEach(() => vi.unstubAllGlobals());

it('explains a deadline rejection when preparing the demo sample', async () => {
  const { window, document } = parseHTML('<html><body><div id="root"></div></body></html>');
  vi.stubGlobal('window', window); vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const fetchSample = vi.fn(async () => new Response(JSON.stringify({ error: 'plan-after-deadline' }), { status: 409 }));
  vi.stubGlobal('fetch', fetchSample);
  const host = document.getElementById('root')!;
  const root = createRoot(host);
  try {
    await act(async () => root.render(<DigestPreview user={{ uid: 'fictional', getIdToken: async () => 'synthetic' } as User} />));
    await act(async () => host.querySelector('button')!.dispatchEvent(new window.Event('click', { bubbles: true })));
    expect(fetchSample).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="status"]')?.textContent).toBe('今日の空いたコマは課題の締切より後になるため、見本を用意できませんでした。締切を確かめてください。');
    expect(host.textContent).not.toContain('先に「LMSを開く」');
  } finally { await act(async () => root.unmount()); }
});
