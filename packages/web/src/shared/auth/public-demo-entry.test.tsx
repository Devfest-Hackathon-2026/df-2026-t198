import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PublicDemoEntry } from './public-demo-entry';

vi.mock('../firebase', () => ({ firebase: { auth: {} } }));
const keys = ['VITE_PUBLIC_DEMO_STUDENT_EMAIL', 'VITE_PUBLIC_DEMO_STUDENT_PASSWORD',
  'VITE_PUBLIC_DEMO_SUPPORTER_EMAIL', 'VITE_PUBLIC_DEMO_SUPPORTER_PASSWORD'];
afterEach(() => vi.unstubAllEnvs());
it('shows both roles and the shared-use guidance only when all four settings exist', () => {
  for (const key of keys) vi.stubEnv(key, 'unit-test-only');
  const html = renderToStaticMarkup(<PublicDemoEntry />);
  expect(html).toContain('学生として試す');
  expect(html).toContain('支援担当として試す');
  expect(html).toContain('審査員の方は、説明資料のアカウントを使ってください。');
  expect(html).not.toContain('unit-test-only');
  for (const key of keys) {
    vi.stubEnv(key, '');
    expect(renderToStaticMarkup(<PublicDemoEntry />)).toBe('');
    vi.stubEnv(key, 'unit-test-only');
  }
});
it('hides the entry in an unconfigured build', () => {
  for (const key of keys) vi.stubEnv(key, '');
  expect(renderToStaticMarkup(<PublicDemoEntry />)).toBe('');
});
it('体験用LMSでは設定が欠けると審査用の入口を案内する', () => {
  for (const key of keys) vi.stubEnv(key, 'unit-test-only');
  for (const key of keys) {
    vi.stubEnv(key, '');
    const html = renderToStaticMarkup(<PublicDemoEntry showUnavailable />);
    expect(html).toContain('この版では体験版のボタンを出していません。審査員の方は説明資料のアカウントかリンクで入ってください。');
    expect(html).not.toContain('学生として試す');
    vi.stubEnv(key, 'unit-test-only');
  }
});
