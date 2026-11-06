import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readPage } from '../src/html-reader.js';
import { validateDefinition } from '../src/definition.js';

const root = new URL('../../../lms-definitions/demo-lms/', import.meta.url);
const definition = JSON.parse(await readFile(new URL('definition.json', root), 'utf8'));
const sample = name => readFile(new URL(`samples/${name}.html`, root), 'utf8');
const context = { utcOffset: '+09:00', courseId: 'DEMO101', sourceId: 'DEMO101_TASK1' };

describe('demo LMS uses the unchanged common reader', () => {
  it('loads a distinct definition and reads both courses and their timetable slots', async () => {
    expect(validateDefinition(definition).definitionId).toBe('demo-lms');
    expect(readPage(definition, await sample('home'), context)).toEqual({
      pageType: 'home', assignments: [], courses: [
        { courseId: 'DEMO101', name: '架空の観察入門', teacher: '架空の先生A', slots: [{ dayOfWeek: 1, period: 2 }] },
        { courseId: 'DEMO202', name: '架空の表現演習', teacher: '架空の先生B', slots: [{ dayOfWeek: 4, period: 4 }] },
      ],
    });
  });
  it('reads task identities, titles and submission states from a list instead of a CoursePower table', async () => {
    const result = readPage(definition, await sample('materials'), context);
    expect(result.pageType).toBe('materials');
    expect(result.assignments).toEqual([
      { sourceId: 'DEMO101_TASK1', courseId: 'DEMO101', title: '架空の観察ノート', submission: 'not-submitted',
        statusText: '受付中', availabilityText: '公開中', dueText: null, dueAt: null },
      { sourceId: 'DEMO101_TASK2', courseId: 'DEMO101', title: '架空の振り返り', submission: 'submitted',
        statusText: '提出済み', availabilityText: '公開中', dueText: null, dueAt: null },
    ]);
  });
  it('reads the old and extended deadlines from HTML without changing the definition', async () => {
    const original = await sample('detail');
    const extended = original.replace('2026/11/12 (木)', '2026/11/13 (金)');
    for (const [html, date] of [[original, '2026-11-12'], [extended, '2026-11-13']]) {
      expect(readPage(definition, html, context).assignments).toEqual([{
        sourceId: 'DEMO101_TASK1', courseId: 'DEMO101', title: '架空の観察ノート',
        submission: 'not-submitted', statusText: '受付中',
        dueText: date.endsWith('12') ? '2026/11/12 (木) 17:00 まで' : '2026/11/13 (金) 17:00 まで',
        dueAt: `${date}T17:00:00+09:00`,
      }]);
    }
  });
  it('accepts an explicitly empty list but rejects a broken list', async () => {
    const empty = await sample('empty');
    expect(readPage(definition, empty, { ...context, courseId: 'DEMO202' }))
      .toEqual({ pageType: 'materials', courseId: 'DEMO202', assignments: [] });
    expect(() => readPage(definition, empty.replace('class="demo-empty"', ''), context)).toThrow('unreadable-page');
  });
  it('does not mistake a missing or ambiguous page for a complete list', () => {
    expect(() => readPage(definition, '<main>読み込めませんでした</main>', context)).toThrow('unreadable-page');
    expect(() => readPage(definition, '<div data-demo-page="home"></div><div data-demo-page="materials"></div>', context))
      .toThrow('unreadable-page');
  });
});
