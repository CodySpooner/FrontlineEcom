import { expect, test } from 'vitest';
import { cronDueBetween, cronMatches, nextCronTime, parseCron } from './cron';

// Local-time dates (cron runs in the machine's timezone).
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);

test('parses fields, lists, ranges and steps', () => {
  const c = parseCron('*/15 9-17 * * 1-5');
  expect([...c.sets[0]!]).toEqual([0, 15, 30, 45]);
  expect([...c.sets[1]!]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
  expect([...parseCron('0 0 * * 7').sets[4]!]).toEqual([0]);
  expect([...parseCron('5,10 0 1 1 *').sets[0]!]).toEqual([5, 10]);
  for (const bad of ['* * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', 'a * * * *', '5-1 * * * *', '*/0 * * * *']) expect(() => parseCron(bad), bad).toThrow();
});

test('matches local time; restricted day-of-month OR day-of-week', () => {
  // 2026-10-26 is a Monday
  expect(cronMatches(parseCron('0 9 * * 1'), at(2026, 10, 26, 9, 0))).toBe(true);
  expect(cronMatches(parseCron('0 9 * * 1'), at(2026, 10, 27, 9, 0))).toBe(false);
  expect(cronMatches(parseCron('0 9 1 * 1'), at(2026, 10, 26, 9, 0))).toBe(true); // Monday, not the 1st
  expect(cronMatches(parseCron('0 9 1 * 1'), at(2026, 11, 1, 9, 0))).toBe(true); // the 1st, a Sunday
  expect(cronMatches(parseCron('0 9 1 * *'), at(2026, 10, 26, 9, 0))).toBe(false);
});

test('next run and due-between windows', () => {
  const daily9 = parseCron('0 9 * * *');
  expect(nextCronTime(daily9, at(2026, 10, 26, 8, 30))).toEqual(at(2026, 10, 26, 9, 0));
  expect(nextCronTime(daily9, at(2026, 10, 26, 9, 0))).toEqual(at(2026, 10, 27, 9, 0));
  expect(nextCronTime(parseCron('0 9 30 2 *'), at(2026, 10, 26))).toBeUndefined();
  expect(cronDueBetween(daily9, at(2026, 10, 26, 8, 0), at(2026, 10, 26, 10, 0))).toBe(true);
  expect(cronDueBetween(daily9, at(2026, 10, 26, 9, 0), at(2026, 10, 26, 10, 0))).toBe(false);
  expect(cronDueBetween(daily9, at(2026, 10, 25, 23, 0), at(2026, 10, 26, 8, 59))).toBe(false);
});
