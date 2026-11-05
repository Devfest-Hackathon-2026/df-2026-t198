import { describe, expect, it } from 'vitest';
import { stripSessionId } from '../src/index.js';

describe('stripSessionId', () => {
  it.each([
    ['https://lms.example/lms/home;SID=fake-session', 'https://lms.example/lms/home'],
    ['/home;sId=fake-session/course', '/home/course'],
    ['/home;sid=fake-session?view=week#today', '/home?view=week#today'],
    ['/home;SID=one;mode=list;sid=two/end', '/home;mode=list/end'],
    ['/home;SID=', '/home'],
    ['/home;SID=?view=week', '/home?view=week'],
    ['/home;SIDS=keep;mode=list', '/home;SIDS=keep;mode=list'],
    ['/home?next=;SID=keep#;SID=keep', '/home?next=;SID=keep#;SID=keep'],
    ['/home#;SID=keep', '/home#;SID=keep'],
    ['/home;SID=one?next=;SID=keep', '/home?next=;SID=keep'],
    ['/home;SID=one#;SID=keep', '/home#;SID=keep'],
    ['/home;SID=fake%2Fvalue/end', '/home/end'],
    ['/home?view=%E6%9C%88', '/home?view=%E6%9C%88'],
    ['', ''],
  ])('redacts only path parameters: %s', (input, expected) => {
    expect(stripSessionId(input)).toBe(expected);
  });
});
