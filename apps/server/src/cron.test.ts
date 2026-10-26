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

test('the night clocks fall back, a fixed time in the repeated hour runs once; hourly rules keep every real hour', () => {
  const tz = process.env.TZ;
  process.env.TZ = 'America/New_York'; // 2026-11-01: 02:00 EDT → 01:00 EST, so 01:00–01:59 comes round twice
  try {
    const daily = parseCron('30 1 * * *');
    expect(nextCronTime(daily, new Date('2026-11-01T05:00:00Z'))?.toISOString()).toBe('2026-11-01T05:30:00.000Z'); // 01:30 EDT
    expect(nextCronTime(daily, new Date('2026-11-01T05:30:00Z'))?.toISOString()).toBe('2026-11-02T06:30:00.000Z'); // next night
    expect(cronDueBetween(daily, new Date('2026-11-01T05:30:00Z'), new Date('2026-11-01T06:45:00Z'))).toBe(false);
    // The automation loop asks every minute: due once over the whole night, not on each tick of the second 01:xx.
    let due = 0;
    for (let t = Date.parse('2026-11-01T04:00:00Z'); t < Date.parse('2026-11-01T09:00:00Z'); t += 60_000) {
      if (cronDueBetween(daily, new Date(t), new Date(t + 60_000))) due++;
    }
    expect(due).toBe(1);
    const hourly = parseCron('0 * * * *');
    expect(nextCronTime(hourly, new Date('2026-11-01T05:00:00Z'))?.toISOString()).toBe('2026-11-01T06:00:00.000Z'); // 01:00 EST
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});

test('the night clocks spring forward, a fixed time in the skipped hour runs once, late; hourly rules skip it', () => {
  const tz = process.env.TZ;
  process.env.TZ = 'America/New_York'; // 2026-03-08: 02:00 EST → 03:00 EDT, so 02:00–02:59 never happens
  try {
    const daily = parseCron('30 2 * * *');
    expect(nextCronTime(daily, new Date('2026-03-08T05:00:00Z'))?.toISOString()).toBe('2026-03-08T07:00:00.000Z'); // 03:00 EDT
    expect(nextCronTime(daily, new Date('2026-03-08T07:00:00Z'))?.toISOString()).toBe('2026-03-09T06:30:00.000Z'); // 02:30 EDT
    const twice = parseCron('0,30 2 * * *');
    let due = 0;
    for (let t = Date.parse('2026-03-08T04:00:00Z'); t < Date.parse('2026-03-08T10:00:00Z'); t += 60_000) {
      if (cronDueBetween(twice, new Date(t), new Date(t + 60_000))) due++;
    }
    expect(due).toBe(1);
    const hourly = parseCron('30 * * * *');
    expect(nextCronTime(hourly, new Date('2026-03-08T06:30:00Z'))?.toISOString()).toBe('2026-03-08T07:30:00.000Z'); // 01:30 EST → 03:30 EDT
  } finally {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  }
});
