import { expect, it } from 'vitest';
import type { Observation } from '../../core/src/types.js';
import { observationSummary } from '../src/collection-summary.js';

it('summarizes a partial fetch as counts and failure codes only', () => {
  const observation: Observation = { schemaVersion: 1, observationId: 'fictional', system: 'ynu-lms',
    definitionId: 'coursepower', definitionVersion: 3, fetchedAt: '2098-11-01T00:00:00Z',
    catalogCourses: [{ courseId: 'FICTION1', name: '架空の授業1', slots: [] }, { courseId: 'FICTION2', name: '架空の授業2', slots: [] }],
    courseResults: [{ courseId: 'FICTION1', listComplete: true, seenSourceIds: ['FICTION1_A'] },
      { courseId: 'FICTION2', listComplete: false, seenSourceIds: ['FICTION2_A', 'FICTION2_B'] }],
    assignments: [
      { sourceId: 'FICTION1_A', courseId: 'FICTION1', title: '架空の課題A', url: 'https://lms.example.test/a',
        deadline: { kind: 'unreadable', dueText: '-', timeZone: 'Asia/Tokyo' }, submission: 'not-submitted' },
      { sourceId: 'FICTION2_A', courseId: 'FICTION2', title: '架空の課題B', url: 'https://lms.example.test/b',
        deadline: { kind: 'datetime', dueAt: '2098-11-02T00:00:00+09:00', dueText: '架空', timeZone: 'Asia/Tokyo' }, submission: 'submitted' },
    ],
    failures: [{ courseId: 'FICTION2', kind: 'parse', detail: 'detail-unavailable' }] };
  const summary = observationSummary(observation);
  expect(summary).toEqual({ courses: 2, coursesComplete: 1, listed: 3, read: 2, unreadableDeadlines: 1,
    failures: { 'parse:detail-unavailable': 1 } });
  expect(JSON.stringify(summary)).not.toMatch(/FICTION|架空|example/);
});
