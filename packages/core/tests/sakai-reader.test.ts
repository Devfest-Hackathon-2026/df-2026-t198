import { expect, it } from 'vitest';
import definition from '../../../lms-definitions/kulms/definition.json' with { type: 'json' };
import input from '../../../lms-definitions/kulms/samples/input.json' with { type: 'json' };
import { readSakaiAssignment, readSakaiCourse, sakaiInstant } from '../src/sakai-reader.js';
const read = (submissions: unknown) => readSakaiAssignment(definition,
  { ...input.assignments.assignment_collection[0], submissions }, 'fictional-course', 'fictional-student');
it.each([undefined, null, [], [{}], [{ submitted: false }], [{ submitted: 'false', submitters: [{ id: 'fictional-student' }] }],
  [{ submitted: true, draft: true, submitters: [{ id: 'fictional-student' }] }]])('preserves unknown submission instead of inferring from status, grade or absence: %s', submissions => {
  expect(read(submissions).submission).toBe('unknown');
});
it('does not let another submitter or ambiguous records decide the current student state', () => {
  const own = { submitters: [{ id: 'fictional-student' }], submitted: true, draft: false };
  expect(read([own, { submitted: false, submitters: [{ id: 'fictional-other' }] }]).submission).toBe('submitted');
  expect(read([own, own]).submission).toBe('unknown');
});
it.each([null, {}, { epochSecond: '1920553200', nano: 0 }, { epochSecond: 1920553200000, nano: 0 },
  { epochSecond: 0, nano: -1 }, { epochSecond: 0, nano: 1e9 }, { epochSecond: 0.5, nano: 0 }])('rejects missing or invalid seconds without borrowing calendar milliseconds: %s', value => {
  expect(sakaiInstant(value)).toBeUndefined();
});
it('reads field names from data without changing HTML definitions', () => {
  expect(readSakaiCourse({ ...definition, site: { ...definition.site, name: 'fictionalName' } }, { id: 'fictional', fictionalName: '架空の授業' }).name).toBe('架空の授業');
});
it('does not transfer API extras, user IDs, grades, submitted text or attachments', () => {
  const row = { ...input.assignments.assignment_collection[0], instructions: 'fictional-private-body',
    submissions: [{ submitted: true, draft: false, submitters: [{ id: 'fictional-student' }], grade: 'fictional-grade',
      submittedText: 'fictional-submitted-text', submittedAttachments: [{ url: 'https://example.test/private' }] }] };
  const normalized = JSON.stringify(readSakaiAssignment(definition, row, 'fictional-course', 'fictional-student'));
  for (const marker of ['fictional-private-body', 'fictional-student', 'fictional-grade', 'fictional-submitted-text', 'https://example.test/private']) expect(normalized).not.toContain(marker);
});
