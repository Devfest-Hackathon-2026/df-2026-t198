import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateDefinition } from '../src/definition.js';
import { readPage } from '../src/html-reader.js';

const definition = JSON.parse(await readFile(new URL('../../../lms-definitions/fictional/definition.json', import.meta.url), 'utf8'));
const context = { utcOffset: '+09:00', courseId: 'CLS42', sourceId: 'TASK7' };
const home = `<main id="courses"><article>
  <button onclick="openClass('CLS42')">Open</button><h2>Example course</h2>
  <span class="teacher">Example teacher</span><span class="day">Mon</span><span class="slot">Slot [２]</span>
</article></main>`;
const materials = `<main id="tasks"><article>
  <h2 id="TASK7">Task: Example task Ａ</h2><span class="status">Open</span><span class="availability">Always</span>
</article></main>`;

function withPattern(pattern, field = 'courseId') {
  const changed = globalThis.structuredClone(definition);
  changed.courses[field].pattern = pattern;
  return changed;
}

describe('another product uses only a new definition', () => {
  it('reads courses, call names, prefixes and slot delimiters from data', () => {
    expect(readPage(definition, home, context)).toStrictEqual({
      pageType: 'home', courses: [{ courseId: 'CLS42', name: 'Example course', teacher: 'Example teacher',
        slots: [{ dayOfWeek: 1, period: 2 }] }], assignments: [],
    });
  });
  it('reads task identifiers, labels and status mappings from data', () => {
    expect(readPage(definition, materials, context)).toStrictEqual({ pageType: 'materials', courseId: 'CLS42', assignments: [{
      sourceId: 'TASK7', courseId: 'CLS42', title: 'Example task Ａ', dueText: null, dueAt: null,
      submission: 'not-submitted', statusText: 'Open', availabilityText: 'Always',
    }] });
  });
  it('reads a detail page with different selectors', () => {
    const html = '<main id="detail"><h2>Example task Ａ</h2><p class="due">2098/11/13 (木) 11:53 まで</p><p class="status">Done</p></main>';
    expect(readPage(definition, html, context)).toStrictEqual({ pageType: 'assignment-detail', assignments: [{
      sourceId: 'TASK7', courseId: 'CLS42', title: 'Example task Ａ', dueText: '2098/11/13 (木) 11:53 まで',
      dueAt: '2098-11-13T11:53:00+09:00', submission: 'submitted', statusText: 'Done',
    }] });
  });
});

describe('bounded pattern configuration', () => {
  it.each([
    'course-id', { type: 'regex', source: '(a+)+$' },
    { type: 'prefixed-id' }, { type: 'prefixed-id', prefix: '' },
    { type: 'prefixed-id', prefix: 'A'.repeat(33) }, { type: 'prefixed-id', prefix: '(a+)+' },
    { type: 'prefixed-id', prefix: 'CLS', script: 'throw 1' },
    { type: 'after-label', label: '' }, { type: 'after-label', label: 'A'.repeat(65) },
    { type: 'after-label', label: 'Task:\n' }, { type: 'after-label', label: '<script>' },
    { type: 'number-between', before: '', after: ']' },
    { type: 'number-between', before: '[', after: 'A'.repeat(65) },
    { type: 'call-argument', name: 'openClass();evil' },
    { type: 'call-argument', name: '' },
    { type: 'call-argument', name: 42 },
    { type: 'call-argument', name: 'A'.repeat(65) },
    { type: 'call-argument', name: 'openClass', prefix: 'CLS' },
    [], Array(5).fill({ type: 'call-argument', name: 'openClass' }),
    [[{ type: 'call-argument', name: 'openClass' }]],
    [{ type: 'call-argument', name: 'openClass' }, { type: 'unknown' }],
    null,
  ])('rejects unsupported types, keys and argument shapes before reading', (pattern) => {
    expect(() => readPage(withPattern(pattern), home, context)).toThrow(/^invalid-definition$/);
  });
  it('rejects definitions targeting the previous reader', () => {
    expect(() => readPage({ ...definition, readerVersion: 1 }, home, context)).toThrow(/^invalid-definition$/);
  });
  it('accepts the maximum argument lengths and four flat steps', () => {
    for (const pattern of [
      { type: 'prefixed-id', prefix: 'A'.repeat(32) },
      { type: 'after-label', label: 'A'.repeat(64) },
      { type: 'number-between', before: 'A'.repeat(64), after: 'B'.repeat(64) },
      { type: 'call-argument', name: 'A'.repeat(64) },
      Array(4).fill({ type: 'after-label', label: 'Task:' }),
    ]) expect(validateDefinition(withPattern(pattern))).toBeDefined();
  });
});

describe('literal extraction and strict failures', () => {
  it.each([
    'otherCall(\'CLS42\')', 'openClass(\'OTHER42\')', 'openClass(\'CLS\')',
    'openClass(\'CLS42x\')', 'openClass(\'CLS42\', \'CLS43\')',
    'openClass(\'CLS42");', 'openClass(\'CLS42\'); evil()',
    'openClass(\'CLS42\') trailing', 'openClass(CLS42)',
  ])('does not accept a different or executable handler: %s', (handler) => {
    const html = home.replace("openClass('CLS42')", handler.replaceAll('"', '&quot;'));
    expect(() => readPage(definition, html, context)).toThrow(/^unreadable-page$/);
  });
  it('accepts whitespace, matching double quotes and an optional semicolon', () => {
    const html = home.replace("openClass('CLS42')", 'openClass( &quot;CLS42&quot; );');
    expect(readPage(definition, html, context).courses[0].courseId).toBe('CLS42');
  });
  it.each(['OTHER7', 'TASK', 'TASK7x', 'TASK7 TASK8'])('requires a complete prefixed numeric identifier: %s', (id) => {
    expect(() => readPage(definition, materials.replace('id="TASK7"', `id="${id}"`), context)).toThrow(/^unreadable-page$/);
  });
  it.each(['Task:Example', 'Other: Example', 'Task: '])('requires the label and a nonempty separated title: %s', (title) => {
    expect(() => readPage(definition, materials.replace('Task: Example task Ａ', title), context)).toThrow(/^unreadable-page$/);
  });
  it('treats punctuation in labels as literal text', () => {
    const changed = globalThis.structuredClone(definition);
    changed.materials.title.pattern.label = '(Task.)';
    expect(readPage(changed, materials.replace('Task:', '(Task.)'), context).assignments[0].title).toBe('Example task Ａ');
    expect(() => readPage(changed, materials.replace('Task:', 'TaskX'), context)).toThrow(/^unreadable-page$/);
  });
  it.each(['Slot [x]', 'Slot [2x]', 'Slot []', 'Slot [2', 'Slot 2]'])('requires digits within literal delimiters: %s', (slot) => {
    expect(() => readPage(definition, home.replace('Slot [２]', slot), context)).toThrow(/^unreadable-page$/);
  });
});
