import { describe, expect, it } from 'vitest';
import { isSessionFound, sessionFromUrl } from '../src/session.js';

describe('YNU session boundary', () => {
  it('recognizes a session on the configured HTTPS origin', () => {
    expect(sessionFromUrl('https://lms.ynu.ac.jp/lms/home;sId=synthetic-session')).toBe('synthetic-session');
  });

  it.each([
    'https://lms.ynu.ac.jp/lms/login',
    'https://lms.ynu.ac.jp/lms/login?next=;SID=synthetic-session',
    'https://lms.ynu.ac.jp/lms/login#;SID=synthetic-session',
    'https://lms.ynu.ac.jp/lms/home;SID=',
    'https://lms.ynu.ac.jp.attacker.example/home;SID=synthetic-session',
    'http://lms.ynu.ac.jp/home;SID=synthetic-session',
    'https://lms.ynu.ac.jp:444/home;SID=synthetic-session',
    'not a URL',
  ])('does not recognize an untrusted or sessionless page: %s', (url) => {
    expect(sessionFromUrl(url)).toBeNull();
  });

  it('accepts only a session message with a nonempty string', () => {
    expect(isSessionFound({ type: 'ynu-session-found', sid: 'synthetic-session' })).toBe(true);
    for (const message of [null, {}, { type: 'other', sid: 'x' }, { type: 'ynu-session-found', sid: '' }, { type: 'ynu-session-found', sid: 1 }]) {
      expect(isSessionFound(message)).toBe(false);
    }
  });
});
