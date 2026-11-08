import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DemoLogin } from './demo-login';

it('Googleの案内の前に体験用アカウントの入口を出す', () => {
  const html = renderToStaticMarkup(<DemoLogin />);
  expect(html).toContain('href="/demo-lms"');
  expect(html.indexOf('体験用LMSからログイン')).toBeLessThan(html.indexOf('Googleアカウントで使う方'));
});
