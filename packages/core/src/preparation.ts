import type { Course, Deadline, LmsSystem, PreparationCandidate, PreparationPlan } from './types.js';

/** Date-only deadlines include the whole day in the source's time zone. */
export function preparationAfterDeadline(startsAt: string, deadline?: Deadline | null): boolean {
  if (deadline?.kind === 'datetime') return Date.parse(startsAt) > Date.parse(deadline.dueAt);
  if (deadline?.kind === 'date') return new Date(startsAt).toLocaleDateString('sv-SE', { timeZone: deadline.timeZone }) > deadline.date;
  return false;
}

export type PreparationPeriodTimes = readonly (readonly [string, string])[];
// YNU all-university timetable, as of 2025-03-21. The 2026 table is unverified.
// Source: https://ope.ynu.ac.jp/wp-content/uploads/2025/05/zengakujikanwari250328.pdf
const ynuPeriods: PreparationPeriodTimes = [['08:50', '10:20'], ['10:30', '12:00'], ['13:00', '14:30'],
  ['14:40', '16:10'], ['16:15', '17:45'], ['17:50', '19:20'], ['19:25', '20:55']];
export const preparationPeriodTimes: Partial<Record<LmsSystem, PreparationPeriodTimes>> = {
  'ynu-lms': ynuPeriods, 'demo-lms': ynuPeriods,
};
export function preparationSlotOccupied(system: LmsSystem, date: string, period: number, plans: PreparationPlan[]) {
  const times = preparationPeriodTimes[system]?.[period - 1];
  return plans.some(plan => {
    if (plan.status !== 'active') return false;
    if (!times) return plan.date === date && plan.period === period;
    const start = Date.parse(`${date}T${times[0]}:00+09:00`);
    const end = Date.parse(`${date}T${times[1]}:00+09:00`);
    return Date.parse(plan.startsAt) < end && start < Date.parse(plan.endsAt);
  });
}

/** Same conservative candidate policy for the session screen and postponement. */
export function preparationSlots(assignment: PreparationCandidate['assignment'], dueDate: string,
  courses: Course[], now: Date, limit = 2, occupied: PreparationPlan[] = [], after?: PreparationCandidate): PreparationCandidate[] {
  courses = courses.filter(course => course.currentTerm !== false);
  const result: PreparationCandidate[] = [];
  const periods = Math.max(5, ...courses.flatMap(course => course.slots.map(slot => slot.period)));
  const cursor = new Date(`${now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })}T00:00:00Z`);
  // At most a year of candidates; farther dates do not require an unbounded server loop.
  for (let days = 0; days < 366 && result.length < limit; days++) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const date = cursor.toISOString().slice(0, 10);
    if (date >= dueDate) break;
    const weekday = cursor.getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (let period = 1; period <= periods && result.length < limit; period++) {
      if (after && (date < after.date || (date === after.date && period <= after.period))) continue;
      if (courses.some(course => course.slots.some(slot => slot.weekday === weekday && slot.period === period)) ||
        preparationSlotOccupied(assignment.system, date, period, occupied)) continue;
      result.push({ assignment, date, period });
    }
  }
  return result;
}
