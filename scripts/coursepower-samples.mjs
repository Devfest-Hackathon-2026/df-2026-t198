import { URL } from 'node:url';
import { readFile } from 'node:fs/promises';

const root = new URL('../lms-definitions/coursepower/', import.meta.url);
export const sampleNames = ['home', 'course-top', 'assignment-list', 'assignment-detail-open'];
export async function loadSamples() {
  const definition = JSON.parse(await readFile(new URL('definition.json', root), 'utf8'));
  const samples = await Promise.all(sampleNames.map(async (name) => {
    const expected = JSON.parse(await readFile(new URL(`samples/${name}.expected.json`, root), 'utf8'));
    const context = { utcOffset: '+09:00' };
    for (const key of expected.contextOnly ?? []) context[key] = expected[key] ?? expected.assignments[0][key];
    const data = { ...expected };
    delete data.contextOnly;
    return { name, context, expected: data, html: await readFile(new URL(`samples/${name}.html`, root), 'utf8') };
  }));
  return { definition, samples };
}

/** Three fields per assignment. A deadline matches only when both representations match. */
export function scoreM1(expected, actual) {
  const fields = [ ['title'], ['dueText', 'dueAt'], ['submission'] ];
  let correct = 0;
  for (const row of expected.assignments) {
    const matches = actual?.assignments.filter((a) => a.sourceId === row.sourceId && a.courseId === row.courseId) ?? [];
    for (const keys of fields) if (matches.length === 1 && keys.every((k) => matches[0][k] === row[k])) correct++;
  }
  const unexpected = actual?.assignments.filter((a) => !expected.assignments.some((e) => e.sourceId === a.sourceId && e.courseId === a.courseId)).length ?? 0;
  return { correct, total: expected.assignments.length * fields.length, unexpected };
}
