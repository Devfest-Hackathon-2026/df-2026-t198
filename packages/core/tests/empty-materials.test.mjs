import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { expect, it } from 'vitest';
import { readPage } from '../src/html-reader.js';

const definition = JSON.parse(await readFile(new URL('../../../lms-definitions/coursepower/definition.json', import.meta.url), 'utf8'));
const context = { utcOffset: '+09:00', courseId: 'synthetic-course' };
const form = '<form id="main_form" name="corsCollActionForm"></form>';
const end = '<p class="box07"><input class="cancelButton"><input class="continueButton"></p>';
const page = (content, tail = end, formHtml = form) => `<!doctype html><html><body><div class="logoutButton"></div>${formHtml}<div id="cs_centerinVox">${content}${tail}</div></body></html>`;

it.each([
  '',
  '<table class="kyozai_table"><tr><td>教材が登録されていません</td></tr></table>',
  '<table class="kyozai_table"><tr><td class="kyozaititleCell" id="SRY0000000000001">架空の資料</td></tr></table>',
])('recognizes a completed materials template with no report rows', content => {
  expect(readPage(definition, page(content), context)).toEqual({ pageType: 'materials', courseId: 'synthetic-course', assignments: [] });
});

it.each([
  page('', ''),
  page('', '<p class="box07"><input class="cancelButton"></p>'),
  page('', `${end}<div>loading</div>`),
  page('', end, ''),
])('does not declare an empty list from an incomplete or unrecognized template', html => {
  expect(() => readPage(definition, html, context)).toThrow('unreadable-page');
});
