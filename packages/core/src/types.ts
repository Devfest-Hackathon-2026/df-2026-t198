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
  courseResults: { courseId: string; listComplete: boolean; seenSourceIds: string[] }[];
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
    'cancellation-candidate' | 'cancelled' | 'restored';
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
  presenceState: 'active' | 'cancellation-candidate' | 'cancelled';
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

/** Only a preparation slot agreed during a session is stored. */
export interface PreparationPlan {
  assignment: AssignmentKey;
  date: IsoDate;
  period: number;
  decidedOn: IsoDate;
  calendarEventId: string;
}

/** Ephemeral suggestion, never a confirmed plan or a calendar event. */
export interface PreparationCandidate {
  assignment: AssignmentKey;
  date: IsoDate;
  period: number;
}

/** Request body shape only; delivery and student confirmation are not implemented. */
export interface PreparationConfirmationRequest {
  candidates: PreparationCandidate[];
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
