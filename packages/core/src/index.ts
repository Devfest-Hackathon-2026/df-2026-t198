export { stripSessionId } from './strip-session-id.js';
export type {
  Assignment,
  AssignmentHistory,
  AssignmentKey,
  Course,
  CourseSlot,
  FailureKind,
  FetchFailure,
  FetchState,
  HistorySource,
  IsoDate,
  IsoDateTime,
  LedgerAssignment,
  LmsSystem,
  Observation,
  PreparationPlan,
  Submission,
} from './types.js';
export { READER_VERSION, validateDefinition } from './definition.js';
export type { ReadingDefinition, ValueRule, Marker, PageCheck } from './definition.js';
export { readPage, parseDeadline } from './html-reader.js';
export type { PageReading, ReadCourse, ReadAssignment, ReadingContext } from './reading-types.js';
