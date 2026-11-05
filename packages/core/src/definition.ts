import type { Submission } from './types.js';

export const READER_VERSION = 1;
export type Pattern = 'course-id' | 'report-id' | 'report-title' | 'period';
export interface ValueRule {
  selector: string;
  ancestor?: string;
  attribute?: 'id' | 'onclick';
  pattern?: Pattern;
}
export interface Marker { selector: string; text?: string }
export interface PageCheck { present: Marker[]; empty: Marker | null }

/** Version 1 reads saved pages only. Unobserved navigation stays explicitly unset. */
export interface ReadingDefinition {
  schemaVersion: 1;
  definitionId: string;
  version: number;
  readerVersion: 1;
  pageChecks: {
    loggedIn: Marker | null;
    loggedOut: Marker | null;
    home: PageCheck;
    materials: PageCheck;
    assignmentDetail: PageCheck;
  };
  courses: {
    rows: string;
    courseId: ValueRule;
    name: ValueRule;
    teacher: ValueRule;
    day: ValueRule;
    period: ValueRule;
    materialsLink: null;
  };
  materials: {
    rows: string;
    sourceId: ValueRule;
    title: ValueRule;
    status: ValueRule;
    availability: ValueRule;
    detailLink: null;
    nextPage: null;
    listEnd: Marker | null;
  };
  assignmentDetail: { title: ValueRule; due: ValueRule; status: ValueRule };
  transforms: {
    weekdays: Record<string, number | null>;
    submission: Record<string, Submission>;
    dateFormat: 'yyyy/MM/dd (weekday) HH:mm まで';
  };
}

type Check = (value: unknown) => boolean;
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const text: Check = (v) => typeof v === 'string' && v.length > 0 && v.length <= 256
  && !/https?:|javascript:|\/\//i.test(v) && [...v].every((c) => c.charCodeAt(0) >= 32);
const oneOf = (...values: unknown[]): Check => (v) => values.includes(v);
const nullable = (check: Check): Check => (v) => v === null || check(v);
const positive: Check = (v) => Number.isSafeInteger(v) && Number(v) > 0;
function shape(required: Record<string, Check>, optional: Record<string, Check> = {}): Check {
  return (v) => object(v)
    && Object.keys(required).every((k) => Object.hasOwn(v, k))
    && Object.entries(v).every(([k, value]) => {
      const check = Object.hasOwn(required, k) ? required[k] : Object.hasOwn(optional, k) ? optional[k] : undefined;
      return check !== undefined && check(value);
    });
}
const rule = shape({ selector: text }, {
  ancestor: text, attribute: oneOf('id', 'onclick'), pattern: oneOf('course-id', 'report-id', 'report-title', 'period'),
});
const marker = shape({ selector: text }, { text });
const page = shape({
  present: (v) => Array.isArray(v) && v.length > 0 && v.length <= 8 && v.every(marker),
  empty: nullable(marker),
});
const dictionary = (check: Check): Check => (v) => object(v) && Object.keys(v).length > 0
  && Object.keys(v).length <= 32 && Object.entries(v).every(([k, x]) => text(k)
    && !['__proto__', 'prototype', 'constructor'].includes(k) && check(x));
const definition = shape({
  schemaVersion: oneOf(1), definitionId: (v) => typeof v === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(v),
  version: positive, readerVersion: oneOf(READER_VERSION),
  pageChecks: shape({ loggedIn: nullable(marker), loggedOut: nullable(marker), home: page, materials: page, assignmentDetail: page }),
  courses: shape({ rows: text, courseId: rule, name: rule, teacher: rule, day: rule, period: rule, materialsLink: oneOf(null) }),
  materials: shape({ rows: text, sourceId: rule, title: rule, status: rule, availability: rule, detailLink: oneOf(null), nextPage: oneOf(null), listEnd: nullable(marker) }),
  assignmentDetail: shape({ title: rule, due: rule, status: rule }),
  transforms: shape({ weekdays: dictionary(oneOf(null, 1, 2, 3, 4, 5, 6, 7)),
    submission: dictionary(oneOf('submitted', 'not-submitted', 'unknown')),
    dateFormat: oneOf('yyyy/MM/dd (weekday) HH:mm まで') }),
});

/** Unknown keys are rejected at every level; no executable strings or network settings. */
export function validateDefinition(value: unknown): ReadingDefinition {
  if (!definition(value)) throw new Error('invalid-definition');
  return value as ReadingDefinition;
}
