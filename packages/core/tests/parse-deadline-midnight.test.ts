import { expect, it } from 'vitest';
import { parseDeadline } from '../src/html-reader.js';

it.each([
  ['2098/11/13 (木) 24:00 まで', '2098-11-14'],
  ['2098/04/30 (水) 24:00 まで', '2098-05-01'],
  ['2098/12/31 (水) 24:00 まで', '2099-01-01'],
  ['2024/02/28 (水) 24:00 まで', '2024-02-29'],
  ['2024/02/29 (木) 24:00 まで', '2024-03-01'],
  ['2023/02/28 (火) 24:00 まで', '2023-03-01'],
  ['2100/02/28 (日) 24:00 まで', '2100-03-01'],
  ['2000/02/28 (月) 24:00 まで', '2000-02-29'],
  ['0099/12/31 (木) 24:00 まで', '0100-01-01'],
])('normalizes only valid 24:00 deadlines across calendar boundaries: %s', (input, date) => {
  expect(parseDeadline(input, '+09:00')).toBe(`${date}T00:00:00+09:00`);
});

it.each(['+08:00', '-07:00', '+14:00'])('preserves the caller offset for next-day midnight: %s', offset => {
  expect(parseDeadline('2098/12/31 (水) 24:00 まで', offset)).toBe(`2099-01-01T00:00:00${offset}`);
});

it.each([
  '2023/02/29 (水) 24:00 まで',
  '2024/02/30 (金) 24:00 まで',
  '2024/04/31 (水) 24:00 まで',
  '2024/13/01 (水) 24:00 まで',
  '0000/12/31 (水) 24:00 まで',
  '9999/12/31 (水) 24:00 まで',
  '2098/11/13 (木) 24:01 まで',
  '2098/11/13 (木) 25:00 まで',
  '2098/11/13 (木) 24:60 まで',
])('does not normalize invalid dates or times into valid deadlines: %s', input => {
  expect(parseDeadline(input, '+09:00')).toBeNull();
});
