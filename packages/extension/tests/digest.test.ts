import { describe, expect, it } from 'vitest';
import { encodeMail, mailIsSafe, morningAt, japanDate } from '../src/digest.js';

const mail = { to: 'student@example.invalid', subject: '今日やること', text: '今日 3限：架空の課題の準備。', html: '<p>今日 3限：架空の課題の準備。</p>' };
const decode = (value: string) => new TextDecoder().decode(Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0)));
describe('digest mail boundary', () => {
  it('uses Japan dates and 7:30 regardless of the machine timezone', () => {
    expect(japanDate(new Date('2026-11-06T15:00:00Z'))).toBe('2026-11-07');
    expect(morningAt('2026-11-07')).toBe(Date.parse('2026-11-06T22:30:00Z'));
  });
  it('preserves Japanese subject and both bodies with only the owner as From and To', () => {
    const raw = decode(encodeMail(mail, mail.to, []));
    expect(raw).toContain('From: student@example.invalid\r\nTo: student@example.invalid');
    expect(raw).not.toMatch(/\r\n(?:Cc|Bcc|Reply-To):/i);
    const subject = raw.match(/Subject: =\?UTF-8\?B\?(.+)\?=/)![1]!;
    expect(decode(subject)).toBe(mail.subject);
    const parts = [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)\r\n--/g)];
    expect(parts.map(p => decode(p[1]!))).toEqual([mail.text, mail.html]);
  });
  it('folds long mixed-language subjects without cutting a UTF-8 character between encoded words', () => {
    const subject = `${'a'.repeat(35)}😀${'今日の準備'.repeat(20)}`;
    const raw = decode(encodeMail({ ...mail, subject }, mail.to, []));
    const words = [...raw.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
    expect(words.map(word => decode(word[1]!)).join('')).toBe(subject);
    expect(words.every(word => word[0].length <= 75)).toBe(true);
  });
  it.each(['SID=synthetic', 'Cookie: synthetic', 'Authorization: Bearer synthetic', 'access_token=synthetic',
    'password=synthetic', 'token=synthetic', 'session=synthetic', 'auth=synthetic', 'https://lms.example.invalid/?sid%3Dsynthetic', 'SID&#61;synthetic',
    'SID&amp;#x3d;synthetic', 'https://user:synthetic@lms.example.invalid/', 'synthetic-current-secret'])('rejects credential-bearing content: %s', value => {
    expect(mailIsSafe({ ...mail, html: `<a href="${value}">LMSで見る</a>` }, ['synthetic-current-secret'])).toBe(false);
  });
  it('rejects header injection and multiple recipients', () => {
    for (const to of ['student@example.invalid\r\nBcc: other@example.invalid', 'student@example.invalid,other@example.invalid']) {
      expect(mailIsSafe({ ...mail, to }, [])).toBe(false);
    }
    expect(mailIsSafe(mail, [])).toBe(true);
    expect(() => encodeMail(mail, 'other@example.invalid', [])).toThrow('unsafe-digest');
  });
});
