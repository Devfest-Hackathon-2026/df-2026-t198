import { deadlineEntries, deadlineValue, entryDeadline } from '../../shared/assignments/deadline-entries';
import { dayInZone } from '../../shared/assignments/deadline-format';
import { fetchStatus } from '../../shared/assignments/fetch-status';
import { buildSessionView, type SessionData } from './model';

export function studentSummary(data: SessionData, now: Date) {
  const deadlines = deadlineEntries(data.assignments, data.manualAssignments, now.getTime())
    .map(entryDeadline).filter(deadline => deadline?.kind === 'datetime'
      ? Date.parse(deadline.dueAt) >= now.getTime()
      : deadline?.kind === 'date' && deadline.date >= dayInZone(now, deadline.timeZone));
  const monday = new Date(`${dayInZone(now, 'Asia/Tokyo')}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  const start = monday.toISOString().slice(0, 10);
  const sunday = new Date(monday); sunday.setUTCDate(sunday.getUTCDate() + 6);
  const end = sunday.toISOString().slice(0, 10);
  const successes = data.fetchStates.map(state => state.lastSucceededAt).filter((at): at is string => at !== null)
    .sort((a, b) => Date.parse(b) - Date.parse(a));
  return {
    nearest: deadlines[0],
    deadlineOrder: deadlineValue(deadlines[0]),
    thisWeek: deadlines.filter(deadline => {
      const day = deadline?.kind === 'date' ? deadline.date : deadline?.kind === 'datetime'
        ? dayInZone(new Date(deadline.dueAt), 'Asia/Tokyo') : '';
      return day >= start && day <= end;
    }).length,
    changes: data.context.lastSessionAt ? buildSessionView(data, now).changes.length : null,
    hasPreparation: data.plans.some(plan => plan.status === 'active'),
    lastSucceededAt: successes[0],
    incomplete: data.fetchStates.some(state => {
      const status = fetchStatus(state, now.getTime());
      return status.stale || status.failed;
    }),
  };
}
