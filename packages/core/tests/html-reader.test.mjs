import { describe, expect, it } from 'vitest';
import { readPage, parseDeadline } from '../src/html-reader.js';
import { validateDefinition } from '../src/definition.js';
import { loadSamples, scoreM1 } from '../../../scripts/coursepower-samples.mjs';

const { definition, samples } = await loadSamples();
const home = samples.find((s) => s.name === 'home');
const materials = samples.find((s) => s.name === 'course-top');

describe('unchanged CoursePower sample oracles', () => {
  for (const sample of samples) it(sample.name, () => {
    expect(readPage(definition, sample.html, sample.context)).toStrictEqual(sample.expected);
  });
  it('the duplicated materials sample is identical', () => {
    const duplicate = samples.find((s) => s.name === 'assignment-list');
    expect(duplicate.html).toBe(materials.html);
    expect(duplicate.expected).toStrictEqual(materials.expected);
  });
});

describe('definition validation and interpretation', () => {
  it('accepts the product definition', () => expect(validateDefinition(definition)).toBe(definition));
  it.each([
    (d) => { d.script = 'throw 1'; },
    (d) => { d.materials.method = 'POST'; },
    (d) => { d.materials.host = 'https://example.test'; },
    (d) => { d.courses.name.selector = 'javascript:alert(1)'; },
    (d) => { d.courses.courseId.pattern = '(a+)+$'; },
    (d) => { d.courses.name.attribute = 'src'; },
    (d) => { d.transforms.submission['未提出'] = 'done'; },
    (d) => { d.transforms.weekdays['月曜日'] = 8; },
    (d) => { d.transforms.dateFormat = 'arbitrary'; },
    (d) => { d.readerVersion = 0; },
    (d) => { d.pageChecks.home.present = []; },
    (d) => { d.materials.nextPage = 'https://example.test'; },
    (d) => { d.transforms.submission = JSON.parse('{"__proto__":"submitted"}'); },
  ])('rejects invalid fields before parsing HTML', (mutate) => {
    const changed = globalThis.structuredClone(definition); mutate(changed);
    expect(() => readPage(changed, home.html, home.context)).toThrow('invalid-definition');
  });
  it('reads selectors from data', () => {
    const changed = globalThis.structuredClone(definition);
    changed.courses.name.selector = '.courseCardUser';
    const result = readPage(changed, home.html, home.context);
    expect(result.courses[0].name).toBe(home.expected.courses[0].teacher);
  });
  it('reads status mappings from data', () => {
    const changed = globalThis.structuredClone(definition);
    delete changed.transforms.submission['未評価'];
    expect(readPage(changed, materials.html, materials.context).assignments[0].submission).toBe('unknown');
  });
});

describe('reading boundaries (in-memory mutations, not new LMS specimens)', () => {
  it('requires a known page and rejects missing lists', () => {
    expect(() => readPage(definition, '<p>unrecognized</p>', home.context)).toThrow('unreadable-page');
    expect(() => readPage(definition, '<div class="weeklyCourseArea"></div>', home.context)).toThrow('unreadable-page');
  });
  it('does not invent context identifiers', () => {
    expect(() => readPage(definition, materials.html, { utcOffset: '+09:00' })).toThrow('missing-reading-context');
  });
  it('does not execute a handler or appended script', () => {
    const html = home.html + '<script>throw new Error("executed")</script>';
    expect(readPage(definition, html, home.context)).toStrictEqual(home.expected);
    expect(() => readPage(definition, home.html.replace('formSubmit(', 'evil('), home.context)).toThrow('unreadable-page');
  });
  it('does not return a partial list when a required title is missing', () => {
    expect(() => readPage(definition, home.html.replace('架空科目01', ''), home.context)).toThrow('unreadable-page');
  });
  it('preserves full-width characters in titles', () => {
    const html = materials.html.replace('架空課題01', '課題Ａ１');
    expect(readPage(definition, html, materials.context).assignments[0].title).toBe('課題Ａ１');
  });
  it('redacts selector parser errors', () => {
    const changed = globalThis.structuredClone(definition); changed.courses.rows = '[invalid';
    expect(() => readPage(changed, home.html, home.context)).toThrow(/^unreadable-page$/);
  });
  it.each(['2098/02/30 (日) 10:00 まで', '2098/11/13 (木) 24:01 まで', '2098/11/13', '締切なし'])('does not guess dates: %s', (text) => {
    expect(parseDeadline(text, '+09:00')).toBeNull();
  });
  it('keeps timezone in caller settings', () => {
    expect(parseDeadline('2098/11/13 (木) 11:53 まで', '+08:00')).toBe('2098-11-13T11:53:00+08:00');
    expect(() => parseDeadline('2098/11/13 (木) 11:53 まで', '+99:00')).toThrow('invalid-utc-offset');
  });
});

describe('M1 item-level scoring', () => {
  it('counts missing and incorrect fields, not just successful extractions', () => {
    expect(scoreM1(materials.expected, undefined)).toEqual({ correct: 0, total: 27, unexpected: 0 });
    const actual = globalThis.structuredClone(materials.expected);
    actual.assignments[0].title = 'wrong';
    actual.assignments[1].dueAt = '2098-01-01T00:00:00+09:00';
    actual.assignments[2].submission = 'unknown';
    expect(scoreM1(materials.expected, actual)).toEqual({ correct: 24, total: 27, unexpected: 0 });
  });
  it('counts a deadline as wrong when only its text is wrong', () => {
    const detail = samples.find((s) => s.name === 'assignment-detail-open');
    const actual = globalThis.structuredClone(detail.expected); actual.assignments[0].dueText = null;
    expect(scoreM1(detail.expected, actual)).toEqual({ correct: 2, total: 3, unexpected: 0 });
  });
  it('does not reward duplicates or invented assignments', () => {
    const actual = globalThis.structuredClone(materials.expected);
    actual.assignments.push(actual.assignments[0], { ...actual.assignments[1], sourceId: 'invented' });
    expect(scoreM1(materials.expected, actual)).toEqual({ correct: 24, total: 27, unexpected: 1 });
  });
});
