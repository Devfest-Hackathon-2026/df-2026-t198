import { assignmentLmsLink } from '@kadai-hisho/core';
import type { LedgerAssignment, LmsSystem } from '../../core/src/types';
import navigation from '../../../lms-definitions/coursepower/navigation.json';

const navigationBySystem: Partial<Record<LmsSystem, { statefulSession: boolean; home: string }>> = { 'ynu-lms': navigation };
export function LmsSourceLink({ item, courseName = '授業', label = 'LMSで見る ›' }:
  { item: LedgerAssignment; courseName?: string; label?: string }) {
  const link = assignmentLmsLink(item.latest.url, courseName, item.latest.title,
    navigationBySystem[item.key.system], (value, base) => new URL(value, base));
  if (!link) return null;
  return <><a href={link.url} target="_blank" rel="noreferrer">{label}</a>
    {link.route && <p className="muted">道順：{link.route}</p>}</>;
}
