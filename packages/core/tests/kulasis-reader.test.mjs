import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { expect, it } from 'vitest';
import definition from '../../../lms-definitions/kulasis/definition.json' with { type: 'json' };
import { readKulasisTimetable, readKulasisCourseCode, kulasisBase, kulmsSiteFromUrl } from '../src/kulasis-reader.js';
const base = 'https://www.k.kyoto-u.ac.jp/student/la';
const parseUrl = (s, b) => new URL(s, b);
const link = '<a href="/student/la/support/top?no=fictional-no">架空の授業</a>';
it('keeps the CP932 and UTF-8 fabricated timetable variants equivalent', () => {
  const utf = readFileSync(new URL('../../../lms-definitions/kulasis/samples/timetable.html', import.meta.url), 'utf8');
  const cp932 = readFileSync(new URL('../../../lms-definitions/kulasis/samples/timetable.cp932.html', import.meta.url));
  const decoded = new globalThis.TextDecoder('shift_jis', { fatal: true }).decode(cp932);
  expect(decoded.replace('windows-31j', 'utf-8')).toBe(utf);
});
it('reads the same slots with both table orientations and a spanned meeting', () => {
  const normal = `<table><tr><th></th><th>月</th><th>火</th></tr><tr><th>1</th><td rowspan="2">${link}</td><td></td></tr><tr><th>2</th><td></td></tr></table>`;
  const transposed = `<table><tr><th></th><th>1限</th><th>2限</th></tr><tr><th>月</th><td colspan="2">${link}</td></tr><tr><th>火</th><td></td><td></td></tr></table>`;
  const first = readKulasisTimetable(definition, normal, base, parseUrl);
  expect(first[0].slots).toEqual([{ weekday: 1, period: 1 }, { weekday: 1, period: 2 }]);
  expect(readKulasisTimetable(definition, transposed, base, parseUrl)).toEqual(first);
});
it('recognizes an explicit empty grid but rejects a login/error/unknown document', () => {
  expect(readKulasisTimetable(definition, '<table><tr><th></th><th>月</th></tr><tr><th>1限</th><td></td></tr></table>', base, parseUrl)).toEqual([]);
  expect(() => readKulasisTimetable(definition, '<html></html>', base, parseUrl)).toThrow('parse-error');
  expect(() => readKulasisTimetable(definition, '<table><tr><th></th><th>月</th></tr><tr><th>1限</th><td>架空の読めない授業</td></tr></table>', base, parseUrl)).toThrow('parse-error');
});
it('reads header labels after full-width notice and spacer rows', () => {
  const banner = '<tr><td colspan="3">架空の案内</td></tr><tr><td colspan="3"></td></tr><tr><td colspan="3">架空の学期</td></tr>';
  const normal = `<table>${banner}<tr><td></td><td>月</td><td>火</td></tr><tr><td>1</td><td>${link}</td><td></td></tr></table>`;
  const transposed = `<table>${banner}<tr><td></td><td>1</td><td>2</td></tr><tr><td>月</td><td>${link}</td><td></td></tr></table>`;
  const expected = [{ courseId: 'fictional-no', name: '架空の授業', slots: [{ weekday: 1, period: 1 }], url: base + '/support/top?no=fictional-no', currentTerm: true }];
  expect(readKulasisTimetable(definition, normal, base, parseUrl)).toEqual(expected);
  expect(readKulasisTimetable(definition, transposed, base, parseUrl)).toEqual(expected);
  expect(() => readKulasisTimetable(definition, normal.replace('colspan="3"', 'colspan="unknown"'), base, parseUrl)).toThrow('parse-error');
  expect(() => readKulasisTimetable(definition, normal.replace('colspan="3"', 'colspan="3" rowspan="2"'), base, parseUrl)).toThrow('parse-error');
});
it('keeps a course support path for a different department on the allowed host', () => {
  const other = link.replace('/student/la/', '/student/other/');
  const html = `<table><tr><th></th><th>月</th></tr><tr><th>1限</th><td>${other}</td></tr></table>`;
  expect(readKulasisTimetable(definition, html, base, parseUrl)[0].url).toBe('https://www.k.kyoto-u.ac.jp/student/other/support/top?no=fictional-no');
  for (const href of ['https://user@www.k.kyoto-u.ac.jp/student/other/support/top?no=fictional-no', '/other/support/top?no=fictional-no']) {
    expect(() => readKulasisTimetable(definition, html.replace(/href="[^"]+"/, `href="${href}"`), base, parseUrl)).toThrow('parse-error');
  }
  const conflicting = html.replace('</table>', `<tr><th>2限</th><td>${link}</td></tr></table>`);
  expect(() => readKulasisTimetable(definition, conflicting, base, parseUrl)).toThrow('parse-error');
});
it('preserves the approved support code and rejects ambiguous or credential-bearing links', () => {
  const html = readFileSync(new URL('../../../lms-definitions/kulasis/samples/support.html', import.meta.url), 'utf8');
  expect(readKulasisCourseCode(html, parseUrl)).toBe('fictional-code');
  expect(readKulasisCourseCode(html + html.replace('fictional-code', 'fictional-other'), parseUrl)).toBeUndefined();
  expect(readKulasisCourseCode(html.replace('fictional-code', 'fictional-code?sid=fictional'), parseUrl)).toBeUndefined();
});
it('accepts department paths without deriving identifiers from names or login URLs', () => {
  expect(kulasisBase(base + '/top', parseUrl)).toBe(base);
  expect(kulasisBase('https://www.k.kyoto-u.ac.jp/student/u/t/entry/kouki', parseUrl)).toBe('https://www.k.kyoto-u.ac.jp/student/u/t');
  expect(kulasisBase('https://www.k.kyoto-u.ac.jp/student/logout', parseUrl)).toBeUndefined();
  expect(kulmsSiteFromUrl('https://lms.gakusei.kyoto-u.ac.jp/portal/site/fictional-site', parseUrl)).toBe('fictional-site');
  for (const value of ['https://example.test/portal/site/fictional', 'https://lms.gakusei.kyoto-u.ac.jp/portal', 'https://lms.gakusei.kyoto-u.ac.jp/portal/site/fictional?sid=fictional']) expect(kulmsSiteFromUrl(value, parseUrl)).toBeUndefined();
});
it.each(['la', 'u/t'])('keeps page sections out of the %s department base', department => {
  const departmentBase = `https://www.k.kyoto-u.ac.jp/student/${department}`;
  for (const page of ['top', 'entry/kouki', 'support/top', 'oh/top', 'syllabus/top', 'global_notice/top']) {
    expect(kulasisBase(`${departmentBase}/${page}`, parseUrl)).toBe(departmentBase);
  }
});
it.each(['https://www.k.kyoto-u.ac.jp', 'https://k.kyoto-u.ac.jp'])('keeps timetable requests and support links on %s', origin => {
  const department = origin + '/student/la';
  expect(kulasisBase(department + '/top', parseUrl)).toBe(department);
  const html = `<table><tr><th></th><th>月</th></tr><tr><th>1限</th><td>${link}</td></tr></table>`;
  const courses = readKulasisTimetable(definition, html, department, parseUrl);
  expect(courses).toMatchObject([{ courseId: 'fictional-no', slots: [{ weekday: 1, period: 1 }], url: department + '/support/top?no=fictional-no' }]);
  const absolute = html.replace('href="/student/', 'href="https://www.k.kyoto-u.ac.jp/student/');
  expect(readKulasisTimetable(definition, absolute, department, parseUrl)).toEqual(courses);
});
it.each(['http://k.kyoto-u.ac.jp', 'https://k.kyoto-u.ac.jp:444', 'https://k.kyoto-u.ac.jp.example.test', 'https://user@k.kyoto-u.ac.jp'])('rejects an unapproved KULASIS URL: %s', origin => {
  expect(kulasisBase(origin + '/student/la/top', parseUrl)).toBeUndefined();
});
it.each(['tool', 'tool-reset'])('reads the KULMS site from an authenticated %s destination', kind => {
  for (const suffix of ['', '/']) expect(kulmsSiteFromUrl(`https://lms.gakusei.kyoto-u.ac.jp/portal/site/fictional-site/${kind}/fictional-tool${suffix}`, parseUrl)).toBe('fictional-site');
});
it.each(['tool', 'tool-reset'])('rejects unsafe or unrecognized %s destination variants', kind => {
  const url = `https://lms.gakusei.kyoto-u.ac.jp/portal/site/fictional-site/${kind}/fictional-tool`;
  for (const value of [url + '?sid=fictional', url + '#fictional', url + '/extra', url.replace('https://', 'http://'),
    url.replace('https://', 'https://user@'), url.replace('.ac.jp/', '.ac.jp.example.test/'),
    url.replace('fictional-tool', 'part%2Fother'), url.replace('fictional-tool', ''), url.replace(`/${kind}/`, '/page/')]) {
    expect(kulmsSiteFromUrl(value, parseUrl)).toBeUndefined();
  }
});
