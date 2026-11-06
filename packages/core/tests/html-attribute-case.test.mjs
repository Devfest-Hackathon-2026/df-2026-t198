import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { expect, it } from 'vitest';
import { readPage } from '../src/html-reader.js';
import { readFormFields, readHtmlAttribute } from '../src/html-navigation.js';

const definition = JSON.parse(await readFile(new URL('../../../lms-definitions/coursepower/definition.json', import.meta.url), 'utf8'));
const context = { utcOffset: '+09:00' };

it('reads mixed-case HTML attribute names with the unchanged declarative course definition', () => {
  const html = `<div class="weeklyCourseArea"><div class="dayBox"><div class="cpLabel">月曜日</div>
    <div class="courseCard"><div class="courseCardName"><a onClick="formSubmit('KOG901')">架空の観察</a></div>
      <div class="courseCardUser">架空の先生A</div><div class="courseCardInfo">第2限</div></div>
    <div class="courseCard"><div class="courseCardName"><a onclick="formSubmit('KOG902')">架空の表現</a></div>
      <div class="courseCardUser">架空の先生B</div><div class="courseCardInfo">第3限</div></div>
    </div></div>`;
  expect(readPage(definition, html, context).courses).toEqual([
    { courseId: 'KOG901', name: '架空の観察', teacher: '架空の先生A', slots: [{ dayOfWeek: 1, period: 2 }] },
    { courseId: 'KOG902', name: '架空の表現', teacher: '架空の先生B', slots: [{ dayOfWeek: 1, period: 3 }] },
  ]);
});

it('uses HTML attributes in material-row CSS selectors without changing their values', () => {
  const html = `<table class="kyozai_table"><tr>
    <td CLASS="kyozaititleCell" ID="REP901">レポート 架空の課題Case</td><td></td><td>公開中</td>
    <td><span class="materialLabe">未提出</span></td></tr></table>`;
  expect(readPage(definition, html, { ...context, courseId: 'KOG901' }).assignments).toEqual([
    { sourceId: 'REP901', courseId: 'KOG901', title: '架空の課題Case', dueText: null, dueAt: null,
      submission: 'not-submitted', statusText: '未提出', availabilityText: '公開中' },
  ]);
});

it('reads form attributes and successful controls with mixed-case attribute names', () => {
  const html = `<form NaMe="SyntheticForm"><input NAME="CourseId" VALUE="KOG901">
    <input name="disabled" value="skip" DISABLED><input TYPE="submit" name="submit" value="skip">
    <input TYPE="checkbox" NaMe="checked" VALUE="KeepCASE" CHECKED>
    <input type="checkbox" name="unchecked" value="skip">
    <select NAME="term"><option value="old">old</option><option SELECTED VALUE="NewCASE">new</option></select>
    <textarea NAME="memo">Keep Mixed CASE</textarea></form>`;
  expect(readFormFields(html, 'SyntheticForm', ['CourseId', 'disabled', 'submit', 'checked', 'unchecked', 'term', 'memo']))
    .toEqual({ CourseId: 'KOG901', checked: 'KeepCASE', term: 'NewCASE', memo: 'Keep Mixed CASE' });
});

it('allows a unique form ID without weakening rejection of an ambiguous form name', () => {
  const html = `<form id="info" name="SharedForm"><input name="course" value="wrong"></form>
    <form ID="main_form" NAME="SharedForm"><input NAME="course" VALUE="KeepCASE"></form>
    <form id="language" name="SharedForm"><input name="course" value="wrong"></form>`;
  expect(readFormFields(html, 'main_form', ['course'])).toEqual({ course: 'KeepCASE' });
  expect(() => readFormFields(html, 'SharedForm', ['course'])).toThrow('parse-error');
});

it('matches detail-link attribute selectors while preserving the complete handler text', () => {
  const handler = "OpenSynthetic('TaskCase_9')";
  const html = `<a onClick="${handler}" DaTa-kind="DetailCase">架空の詳細</a>`;
  expect(readHtmlAttribute(html, 'a[ONCLICK][data-kind="DetailCase"]', 'OnClick')).toBe(handler);
});

it('treats duplicate HTML attribute names as the first occurrence regardless of case', () => {
  expect(readHtmlAttribute('<a onClick="FirstCASE" onclick="SecondCASE"></a>', 'a[onclick]', 'onclick')).toBe('FirstCASE');
});

it('keeps SVG namespace attribute names case-sensitive', () => {
  const html = '<svg viewBox="0 0 10 20"><a onClick="SvgCase"></a></svg>';
  expect(readHtmlAttribute(html, 'svg', 'viewBox')).toBe('0 0 10 20');
  expect(readHtmlAttribute(html, 'svg', 'viewbox')).toBeNull();
  expect(readHtmlAttribute(html, 'svg a', 'onClick')).toBe('SvgCase');
  expect(readHtmlAttribute(html, 'svg a', 'onclick')).toBeNull();
});

it('does not execute or alter JavaScript text in HTML attributes or script elements', () => {
  const handler = 'throw new Error("MixedCaseHandler")';
  const html = `<a onClick='${handler}'></a><script>throw new Error("MixedCaseScript")</script>`;
  expect(readHtmlAttribute(html, 'a', 'onclick')).toBe(handler);
  expect(readHtmlAttribute(html, 'script', 'type')).toBeNull();
});
