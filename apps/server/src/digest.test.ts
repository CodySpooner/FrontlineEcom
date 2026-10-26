import { afterEach, expect, test, vi } from 'vitest';
import { demoDay, seedDemo } from './demo';
import { openDb } from './db';
import { sendDigest, startDigestLoop } from './digest';
import { updateSettings } from './settings';

afterEach(() => vi.useRealTimers());

const digests = (db: ReturnType<typeof openDb>) => db.prepare("SELECT title, body FROM notifications WHERE title LIKE 'Yesterday:%'").all();

test("the digest sums yesterday across stores, compares it with the day before and counts waiting approvals", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const sum = (date: string) => ['pawsome', 'glow', 'peak'].map((id) => demoDay(id, date)).reduce((a, d) => ({ revenue: a.revenue + d.revenue, orders: a.orders + d.orders }), { revenue: 0, orders: 0 });
  const [y, before] = [sum('2026-10-25'), sum('2026-10-24')];
  const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
  const pct = Math.round((y.revenue / before.revenue - 1) * 100);

  const n = sendDigest(db, new Date('2026-10-26T08:00:00'))!;
  expect(n.title).toMatch(new RegExp(`^Yesterday: \\${usd(y.revenue)} revenue, -?\\$[\\d,]+ profit$`));
  expect(n.body).toBe(`${y.orders} orders (revenue ${pct >= 0 ? '+' : ''}${pct}% vs the day before). 3 approvals waiting.`);
  expect(n.link).toBe('/');
});

test('the loop sends one digest a day from 8:00, and none while it is turned off', async () => {
  vi.useFakeTimers({ now: new Date('2026-10-26T07:00:00') });
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const stop = startDigestLoop(db, 10 * 60_000);
  expect(digests(db)).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(60 * 60_000); // 08:00
  expect(digests(db)).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(5 * 60 * 60_000);
  expect(digests(db)).toHaveLength(1);

  expect(updateSettings(db, { notifications: { digest: false } })).toMatchObject({ notifications: { digest: false } });
  await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
  expect(digests(db)).toHaveLength(1);
  updateSettings(db, { notifications: { digest: true } });
  await vi.advanceTimersByTimeAsync(10 * 60_000); // turned back on after 8:00: today's goes out at the next check
  expect(digests(db)).toHaveLength(2);
  stop();
});
