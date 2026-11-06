/** ISO 8601 date-time with an explicit timezone. */
export type IsoDateTime = string;
/** Calendar date in YYYY-MM-DD form. */
export type IsoDate = string;
export type LmsSystem = 'ynu-lms' | 'panda' | 'demo-lms';
export type Submission = 'submitted' | 'not-submitted' | 'unknown';
export type FailureKind = 'not-logged-in' | 'http' | 'parse';

/** Shared session dates; null means the date has not been set. */
export interface SessionContext {
  lastSessionAt: IsoDateTime | null;
  nextSessionAt: IsoDateTime | null;
}

export interface CourseSlot {
  /** Monday = 1, Sunday = 7. */
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Period number, starting at 1; times belong to university settings. */
  period: number;
}

export interface Course {
  courseId: string;
  name: string;
  slots: CourseSlot[];
  /** Optional course page; session parameters must be removed before sending. */
  url?: string;
  /** Omitted by older collectors; only explicit false excludes a course. */
  currentTerm?: boolean;
}

export type Deadline = { dueText: string; timeZone: string } & (
  | { kind: 'datetime'; dueAt: IsoDateTime }
  | { kind: 'date'; date: IsoDate }
  | { kind: 'none' | 'unreadable' }
);

export interface Assignment {
  sourceId: string;
  courseId: string;
  title: string;
  /** Session parameters must be removed before leaving the extension. */
  url: string;
  deadline: Deadline;
  submission: Submission;
  submittedAt?: IsoDateTime;
}

export interface FetchFailure {
  /** null means a failure for the whole system. */
  courseId: string | null;
  kind: FailureKind;
  /** No session identifiers or personal information. */
  detail: string;
}

export interface Observation {
  schemaVersion: 1;
  observationId: string;
  system: LmsSystem;
  definitionId: string;
  definitionVersion: number;
  fetchedAt: IsoDateTime;
  catalogCourses: Course[];
  courseResults: { courseId: string; listComplete: boolean; seenSourceIds: string[]; endedSourceIds?: string[] }[];
  assignments: Assignment[];
  failures: FetchFailure[];
}

export interface AssignmentKey {
  system: LmsSystem;
  sourceId: string;
}

export interface AssignmentChange {
  changeId: string;
  assignmentKey: AssignmentKey;
  kind: 'new' | 'title-changed' | 'deadline-changed' | 'submitted' |
    'cancellation-candidate' | 'cancelled' | 'restored' | 'ended';
  before: string | Deadline | null;
  after: string | Deadline | null;
  observationId: string;
  recordedAt: IsoDateTime;
}

export interface LedgerAssignment {
  key: AssignmentKey;
  latest: Assignment;
  officialDeadline: {
    deadline: Deadline;
    url: string;
    fetchedAt: IsoDateTime;
    observationId: string;
  } | null;
  preparationStartsAt: IsoDateTime | null;
  submission: Submission;
  submittedAt: IsoDateTime | null;
  presenceState: 'active' | 'cancellation-candidate' | 'cancelled' | 'ended';
  consecutiveMissingCount: number;
  lastSeenObservationId: string;
  lastSeenAt: IsoDateTime;
  reviewReasons: {
    kind: 'unreadable-deadline' | 'conflicting-deadline';
    detail: string;
  }[];
}

export interface ObservationResult {
  status: 'applied';
  changed: boolean;
  changeCount: number;
}

/** Issue #16 deliberately stores neither the payload nor a payload hash. */
export interface ObservationReceipt {
  observationId: string;
  result: ObservationResult;
}

/** Saved by the API; removing a plan leaves a tombstone for delayed retries. */
export interface PreparationPlan extends PreparationPlanInput {
  planId: string;
  title: string;
  decidedOn: IsoDate;
  timeZone: 'Asia/Tokyo';
  confirmedBy: string;
  createdByRole: 'student' | 'supporter';
  confirmedAt: IsoDateTime;
  status: 'active' | 'done' | 'cancelled';
  /** Absent on plans created before Issue #112; means no action yet. */
  changedBy?: string;
  changedAt?: IsoDateTime;
  laterResult?: 'moved' | 'no-slot';
  revision: number;
  calendarItemKey: string;
}

/** Ephemeral suggestion, never a confirmed plan or a calendar event. */
export interface PreparationCandidate {
  assignment: AssignmentKey;
  date: IsoDate;
  period: number;
}
export interface PreparationPlanInput extends PreparationCandidate {
  startsAt: IsoDateTime;
  endsAt: IsoDateTime;
}

export interface FetchState {
  studentId: string;
  system: LmsSystem;
  lastSucceededAt: IsoDateTime | null;
  lastAttemptedAt: IsoDateTime | null;
  lastFailureKind: FailureKind | null;
  lastResult: 'success' | 'partial' | 'failed';
  lastAppliedObservationId: string;
}

/** Calendar API fields owned by the application; no assignment body. */
export interface DeadlineEvent {
  summary: string;
  description: string;
  start: { date: IsoDate } | { dateTime: IsoDateTime; timeZone: string };
  end: { date: IsoDate } | { dateTime: IsoDateTime; timeZone: string };
  transparency: 'transparent';
  reminders: { useDefault: boolean };
}
export type CalendarDesired = { state: 'present'; event: DeadlineEvent } | { state: 'deleted' };
export type CalendarErrorCode = 'authorization-required' | 'calendar-unavailable' | 'event-conflict' | 'network-error';
export interface CalendarItem {
  itemKey: string;
  kind: 'deadline' | 'preparation';
  sourceKey: AssignmentKey;
  calendarId: string | null;
  eventId: string;
  generation: number;
  desiredRevision: number;
  desired: CalendarDesired;
  appliedRevision: number;
  appliedAt: IsoDateTime | null;
  lastAttemptedAt: IsoDateTime | null;
  lastErrorCode: CalendarErrorCode | null;
}
export interface CalendarReport {
  itemKey: string;
  generation: number;
  eventId: string;
  revision: number;
  errorCode: CalendarErrorCode | null;
}
export interface CalendarIntegration {
  /** Persisted mock destination; never populated by the Google executor. */
  mockEvents?: Record<string, { itemKey: string; generation: number; revision: number; event: DeadlineEvent }>;
  mode: 'google' | 'mock';
  executor: 'extension' | 'demo';
  calendarId: string;
  connectionState: 'connected' | 'reauthorization-required' | 'recovery-required';
}
