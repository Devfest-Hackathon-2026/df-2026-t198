import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LandingPage } from './page';

vi.mock('../../shared/firebase', () => ({ firebase: { auth: {} } }));
const keys = ['VITE_PUBLIC_DEMO_STUDENT_EMAIL', 'VITE_PUBLIC_DEMO_STUDENT_PASSWORD',
  'VITE_PUBLIC_DEMO_SUPPORTER_EMAIL', 'VITE_PUBLIC_DEMO_SUPPORTER_PASSWORD'];
afterEach(() => vi.unstubAllEnvs());

it('offers the LMS fallback and judge guidance without shared demo settings', () => {
  for (const key of keys) vi.stubEnv(key, '');
  const html = renderToStaticMarkup(<LandingPage />);
  for (const section of ['しくみ', '課題を一か所にまとめ、支援担当と共有します', '体験する', '使い始める', '情報の扱い']) {
    expect(html).toContain(section);
  }
  expect(html).not.toContain('動く見本');
  expect(html).toContain('aria-label="締切変更の流れ"');
  expect(html).toContain('審査員の方');
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
  expect(html).not.toContain('別のブラウザか別の端末');
  expect(html).not.toContain('local-test-only');
  for (const key of keys) {
    vi.stubEnv(key, '');
    expect(renderToStaticMarkup(<LandingPage />)).not.toContain('学生として試す');
    vi.stubEnv(key, 'local-test-only');
  }
});


it('uses the restored hero sentence and one primary trial entry with a small judge guide', () => {
  const html = renderToStaticMarkup(<LandingPage />);
  expect(html).toContain('<span>学生がすることは、</span><span>いつものLMSを</span><span>開くことだけです</span>');
  expect(html).not.toContain('Your coursework');
  expect(html).toContain('class="hero-lead"');
  expect(html).toContain('class="trial-launch"');
  expect(html).toContain('class="judge-guide"');
  expect(html).not.toContain('entry-grid');
});

it('opens both synthetic screenshots in named dialogs instead of navigating to an image', () => {
  const html = renderToStaticMarkup(<LandingPage />);
  expect(html.match(/<dialog /g)).toHaveLength(2);
  expect(html.match(/拡大表示を閉じる/g)).toHaveLength(2);
  expect(html).not.toMatch(/<a[^>]*href="\/landing\//);
  for (const label of ['学生の時間割', '支援担当の面談画面']) {
    expect(html).toContain(`aria-label="${label}を拡大する"`);
  }
});

it('introduces the people before the mechanism and ends with the trial entry', () => {
  const html = renderToStaticMarkup(<LandingPage />);
  const main = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
  expect([...main.matchAll(/<section[^>]+id="([^"]+)"/g)].map(match => match[1]))
    .toEqual(['home', 'people', 'how', 'start', 'privacy', 'try']);
  expect(main.match(/class="trial-entry"/g)).toHaveLength(1);
  expect(main).toContain('やることがある日は朝にメールが届きます。');
  expect(main).toContain('次にやることを一緒に決められます。');
  expect(main).toContain('授業ごとの課題と締切を時間割にまとめ、支援担当と共有します。');
  expect(html.match(/class="flow-scene"/g)).toHaveLength(1);
  expect(html.match(/data-task="report"/g)).toHaveLength(1);
  const progress = html.slice(html.indexOf('role="progressbar"'));
  expect(progress.match(/<i /g)).toHaveLength(6);
  for (const label of ['前の段へ', '次の段へ', '一時停止する']) expect(html).toContain(`aria-label="${label}"`);
});
