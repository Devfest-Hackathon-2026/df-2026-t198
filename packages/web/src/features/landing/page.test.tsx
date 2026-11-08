import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LandingPage } from './page';

vi.mock('../../shared/firebase', () => ({ firebase: { auth: {} } }));
const keys = ['VITE_PUBLIC_DEMO_STUDENT_EMAIL', 'VITE_PUBLIC_DEMO_STUDENT_PASSWORD',
  'VITE_PUBLIC_DEMO_SUPPORTER_EMAIL', 'VITE_PUBLIC_DEMO_SUPPORTER_PASSWORD'];
afterEach(() => vi.unstubAllEnvs());

it('offers the local example and judge guidance without shared demo settings', () => {
  for (const key of keys) vi.stubEnv(key, '');
  const html = renderToStaticMarkup(<LandingPage />);
  for (const section of ['しくみ', '使う人', '体験する', '使い始める', '情報の扱い']) {
    expect(html).toContain(section);
  }
  expect(html).toContain('ログインなし');
  expect(html).toContain('審査の方');
  expect(html).toContain('href="/demo-lms"');
  expect(html).not.toContain('学生として試す');
  expect(html).not.toContain('支援担当として試す');
  expect(html).not.toContain('class="mc hot"');
  expect(html).not.toContain('<s ');
  expect(html).not.toContain('締切が 11/11 から 11/12 に変わりました');
  expect(html).toContain('https://github.com/Devfest-Hackathon-2026/df-2026-t198');
});

it('reuses both shared entry roles without exposing configured values as text', () => {
  for (const key of keys) vi.stubEnv(key, 'local-test-only');
  const html = renderToStaticMarkup(<LandingPage />);
  expect(html).toContain('学生として試す');
  expect(html).toContain('支援担当として試す');
  expect(html).toContain('別のブラウザか別の端末');
  expect(html).not.toContain('local-test-only');
  for (const key of keys) {
    vi.stubEnv(key, '');
    expect(renderToStaticMarkup(<LandingPage />)).not.toContain('学生として試す');
    vi.stubEnv(key, 'local-test-only');
  }
});


it('uses the approved hero sentence and separate, equally placed entry roles', () => {
  const html = renderToStaticMarkup(<LandingPage />);
  expect(html).toContain('<span>学生がすることは、</span><span>いつものLMSを<br class="hero-mobile-break"/>開くことだけです</span>');
  expect(html).toContain('lang="en">Your coursework, connected.');
  expect(html).toContain('aria-labelledby="judge-title"');
  expect(html).toContain('aria-labelledby="shared-title"');
  expect(html).toContain('id="landing-demo-slot"');
  expect(html.indexOf('id="landing-demo-slot"')).toBeLessThan(html.indexOf('aria-labelledby="judge-title"'));
  expect(html).toContain('href="/session"');
});

it('opens all four synthetic screenshots in named dialogs instead of navigating to an image', () => {
  const html = renderToStaticMarkup(<LandingPage />);
  expect(html.match(/<dialog /g)).toHaveLength(4);
  expect(html.match(/拡大表示を閉じる/g)).toHaveLength(4);
  expect(html).not.toMatch(/<a[^>]*href="\/landing\//);
  for (const label of ['体験用LMSの授業一覧', '締切が変わった学生画面', '学生の時間割', '支援担当の面談画面']) {
    expect(html).toContain(`aria-label="${label}を拡大する"`);
  }
});
