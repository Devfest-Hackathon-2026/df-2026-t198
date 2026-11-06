import { expect, it } from 'vitest';
import { isSafeMailText } from '../src/mail-safety.js';
it.each(['Cookie: fictional', 'SID: fictional', 'sid=fictional', 'jsessionid=fictional', 'session_id: fictional',
  'authorization: fictional', 'access_token=fictional', 'refresh-token: fictional', 'id_token=fictional', 'Bearer fictional',
  'Cookie%3Afictional', 'SID%253Dfictional', '%2525252541'])('rejects unsafe or excessively encoded mail text: %s', value => {
  expect(isSafeMailText(value)).toBe(false);
});
it.each(['架空の課題', 'SIDについて学ぶ', 'Cookieの仕組み', '100%の準備', '<架空&ノート>', 'https://lms.example.invalid/?id=1'])('allows ordinary text: %s', value => {
  expect(isSafeMailText(value)).toBe(true);
});
it.each(['得点の30% sid%3Dfictional', 'Cookie&#58; 設定', 'SID&amp;#x3d;fictional',
  'authorization&colon; fictional', 'sid&equals;fictional', 'https://user:fictional@lms.example.invalid/'])('rejects encoded credential markers even alongside literal percent signs: %s', value => {
  expect(isSafeMailText(value)).toBe(false);
});
it.each(['得点の30%の準備', 'Cookie&#32;の仕組み', '&#x110000;', '壊れた%XXでも普通の題名'])('allows harmless or malformed encoded text: %s', value => {
  expect(isSafeMailText(value)).toBe(true);
});
