import type { StudentData } from '../assignments/types';

export function studentFitFixture(data: StudentData, extended = false) {
  data.fetchStates = [];
  data.courses = [
    { system: 'demo-lms', courseId: 'math', name: '架空の星空観測データを使った数理と表現の基礎演習II[Patterns of Imaginary Starlight 2]', slots: [{ weekday: 1, period: 1 }] },
    { system: 'demo-lms', courseId: 'other', name: '架空の雲の図鑑制作[Imaginary Cloud Atlas Workshop]', slots: [{ weekday: 1, period: 1 }] },
    { system: 'demo-lms', courseId: 'short', name: '架空の色彩', slots: [{ weekday: 5, period: 5 }] },
    ...(extended ? [{ system: 'demo-lms' as const, courseId: 'weekend', name: '架空の週末の創作演習', slots: [{ weekday: 6 as const, period: 6 }, { weekday: 7 as const, period: 7 }] }] : []),
  ];
  data.assignments = data.assignments.slice(0, 2);
  data.assignments[0]!.latest.title = '架空の星の記録';
  data.assignments[1]!.latest.title = '架空の観測メモ';
  return data;
}
