/** ISO 8601 date-time with an explicit timezone. */
export type IsoDateTime = string;
/** Calendar date in YYYY-MM-DD form. */
export type IsoDate = string;
export type LmsSystem = 'ynu-lms' | 'panda';
export type Submission = 'submitted' | 'not-submitted' | 'unknown';
export type FailureKind = 'not-logged-in' | 'http' | 'parse';

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

export interface Assignment {
  sourceId: string;
  courseId: string;
  title: string;
  /** Session parameters must be removed before leaving the extension. */
  url: string;
  dueAt: IsoDateTime | null;
  dueText: string;
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
  system: LmsSystem;
  fetchedAt: IsoDateTime;
  /** Only courses whose assignment list was fetched completely. */
  courses: Course[];
  assignments: Assignment[];
  failures: FetchFailure[];
}

export interface AssignmentKey {
  system: LmsSystem;
  sourceId: string;
}

export interface HistorySource {
  at: IsoDateTime;
  observation: Pick<Observation, 'system' | 'fetchedAt'>;
}

export type AssignmentHistory = HistorySource & (
  | { kind: 'new' | 'cancellation-candidate' | 'cancelled' | 'submitted' }
  | { kind: 'deadline-changed'; before: IsoDateTime | null; after: IsoDateTime | null }
  | { kind: 'title-changed'; before: string; after: string }
);

export interface LedgerAssignment {
  key: AssignmentKey;
  latest: Assignment;
  officialDeadline: {
    dueAt: IsoDateTime | null;
    dueText: string;
    url: string;
    fetchedAt: IsoDateTime;
  };
  preparationStartsAt: IsoDateTime | null;
  state: 'not-submitted' | 'submitted' | 'cancellation-candidate' | 'cancelled';
  history: AssignmentHistory[];
  reviewReasons: {
    kind: 'unreadable-deadline' | 'conflicting-deadline';
    detail: string;
  }[];
  calendarEventIds: { deadline: string | null; preparation: string | null };
}

/** Only a preparation slot agreed during a session is stored. */
export interface PreparationPlan {
  assignment: AssignmentKey;
  date: IsoDate;
  period: number;
  decidedOn: IsoDate;
  calendarEventId: string;
}

export interface FetchState {
  studentId: string;
  system: LmsSystem;
  lastSucceededAt: IsoDateTime | null;
  lastAttemptedAt: IsoDateTime | null;
  lastFailureKind: FailureKind | null;
}
