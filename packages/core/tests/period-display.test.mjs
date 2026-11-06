import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { expect, it } from 'vitest';
import { readPage } from '../src/html-reader.js';

const definition = JSON.parse(await readFile(new URL('../../../lms-definitions/coursepower/definition.json', import.meta.url), 'utf8'));
const detail = await readFile(new URL('../../../lms-definitions/coursepower/samples/assignment-detail-open.html', import.meta.url), 'utf8');
const context = { utcOffset: '+09:00', courseId: 'synthetic-course', sourceId: 'synthetic-report' };
const period = /<span class="red3">[\s\S]*?<\/span>/;

it('preserves a literal period placeholder without inventing a datetime', () => {
  const result = readPage(definition, detail.replace(period, '-'), context).assignments[0];
  expect(result.dueText).toBe('-');
  expect(result.dueAt).toBeNull();
});

it('still uses the highlighted deadline rather than surrounding period text', () => {
  const result = readPage(definition, detail.replace('<span class="red3">', '開始日時の表示 <span class="red3">'), context).assignments[0];
  expect(result.dueText).toBe('2098/11/13 (木) 11:53 まで');
  expect(result.dueAt).toBe('2098-11-13T11:53:00+09:00');
});

it('does not fabricate a placeholder when the period field is missing', () => {
  const result = readPage(definition, detail.replace('提出期間', '別の情報'), context).assignments[0];
  expect(result.dueText).toBeNull();
  expect(result.dueAt).toBeNull();
});

it('does not select one value from duplicate period fields', () => {
  const html = detail.replace('</tbody>', '<tr><th>提出期間</th><td>-</td></tr></tbody>');
  const result = readPage(definition, html, context).assignments[0];
  expect(result.dueText).toBeNull();
  expect(result.dueAt).toBeNull();
});
