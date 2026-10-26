import { afterEach, expect, test, vi } from 'vitest';
import type { AnalyticsSummary } from '@frontline/shared';
import { createApp } from './app';
import { switchToReal } from './connectors/common';
import { addDays, dayFraction, localDate, midnight } from './dates';
import { openDb } from './db';
import { seedDemo } from './demo';

afterEach(() => vi.useRealTimers());

test("a shop's day starts at its own midnight (DST days are 25 h)", () => {
  const at = (iso: string) => Date.parse(iso);
  expect(localDate(new Date('2026-10-27T05:00:00Z'), 'America/Los_Angeles')).toBe('2026-10-26');
  expect(dayFraction('2026-10-27', at('2026-10-27T07:00:00Z'), 'America/Los_Angeles')).toBe(0);
  expect(dayFraction('2026-10-26', at('2026-10-27T05:00:00Z'), 'America/Los_Angeles')).toBeCloseTo(22 / 24);
  expect(dayFraction('2026-11-01', at('2026-11-01T19:30:00Z'), 'America/Los_Angeles')).toBeCloseTo(12.5 / 25); // fall back
  expect(dayFraction('2026-10-27', at('2026-10-27T12:00:00Z'), 'Asia/Tokyo')).toBeCloseTo(21 / 24);
  expect(dayFraction('2026-10-26', at('2026-10-27T12:00:00Z'), 'Asia/Tokyo')).toBe(1);
});

test("a connected store's analytics window ends on the shop's today, not the machine's", async () => {
  vi.useFakeTimers({ now: new Date('2026-10-27T05:00:00Z'), toFake: ['Date'] });
  const db = openDb();
  seedDemo(db, '2026-10-27');
  switchToReal(db, 'glow');
  db.prepare("UPDATE stores SET timezone = 'America/Los_Angeles' WHERE id = 'glow'").run();
  const app = createApp(db);
  const to = async (stores: string) => ((await (await app.request(`/api/analytics/summary?range=7&stores=${stores}`)).json()) as AnalyticsSummary).to;
  expect(await to('glow')).toBe('2026-10-26');
  expect(await to('pawsome')).toBe(localDate()); // demo data is dated on the machine
});

test('a day starts at its first instant even where DST starts at midnight (the day begins at 01:00)', () => {
  for (const tz of ['America/Santiago', 'America/Havana', 'Australia/Lord_Howe', 'Europe/Berlin', 'Asia/Kolkata']) {
    for (let date = '2026-01-01'; date < '2027-01-01'; date = addDays(date, 1)) {
      const start = midnight(date, tz);
      expect([localDate(new Date(start), tz), localDate(new Date(start - 1), tz)], `${tz} ${date}`).toEqual([date, addDays(date, -1)]);
    }
  }
});
