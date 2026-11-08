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
  expect(html).toContain('審査の方は、説明資料のアカウントを使ってください。');
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
