export { stripSessionId } from './strip-session-id.js';
export type { DemoAccount, DemoAnnouncement, DemoAssignment, DemoCourse, DemoData } from './demo.js';
export type {
  Assignment,
  AssignmentChange,
  AssignmentKey,
  Course,
  CourseSlot,
  FailureKind,
  FetchFailure,
  FetchState,
  Deadline,
  IsoDate,
  IsoDateTime,
  LedgerAssignment,
  LmsSystem,
  Observation,
  ObservationReceipt,
  ObservationResult,
  PreparationPlan,
  PreparationPlanInput,
  Submission,
  SessionContext,
} from './types.js';
export { applyObservation } from './ledger.js';
export { READER_VERSION, validateDefinition } from './definition.js';
export type { ReadingDefinition, ValueRule, Marker, PageCheck } from './definition.js';
export { readPage, parseDeadline } from './html-reader.js';
export type { PageReading, ReadCourse, ReadAssignment, ReadingContext } from './reading-types.js';
export type { DeadlineEvent, CalendarDesired, CalendarErrorCode, CalendarItem, CalendarReport, CalendarIntegration } from './types.js';
export { deadlineDesired, reconcileCalendarItem, acknowledgeCalendarItem } from './calendar.js';

export { preparationSlots } from './preparation.js';
