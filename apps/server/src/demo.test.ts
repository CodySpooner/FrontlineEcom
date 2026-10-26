import { expect, test } from 'vitest';
import { openDb } from './db';
import { addDays, localDate } from './dates';
import { DEMO_DAYS, demoDay, seedDemo } from './demo';

const TODAY = '2026-10-26';
const count = (db: ReturnType<typeof openDb>, sql: string) => Number(db.prepare(sql).get()?.n);

test('demoDay is deterministic and funnel-shaped', () => {
  expect(demoDay('pawsome', TODAY)).toEqual(demoDay('pawsome', TODAY));
  expect(demoDay('pawsome', TODAY)).not.toEqual(demoDay('pawsome', '2026-10-25'));
  for (const id of ['pawsome', 'glow', 'peak', 'some-new-store']) {
    const d = demoDay(id, TODAY);
    expect(d.revenue).toBeGreaterThan(0);
    expect(d.sessions).toBeGreaterThanOrEqual(d.addToCarts);
    expect(d.addToCarts).toBeGreaterThanOrEqual(d.checkouts);
    expect(d.checkouts).toBeGreaterThanOrEqual(d.orders);
    expect(d.campaigns.reduce((a, c) => a + c.spend, 0)).toBeCloseTo(d.adSpend, 1);
  }
});

test('revenue trends up over two years for a growing store', () => {
  const avg = (from: string) => Array.from({ length: 28 }, (_, i) => demoDay('pawsome', new Date(Date.parse(from) + i * 864e5).toISOString().slice(0, 10)).revenue).reduce((a, b) => a + b) / 28;
  expect(avg('2026-09-28')).toBeGreaterThan(avg('2024-11-01') * 1.8);
});

test('seedDemo seeds 3 stores with 2 years of history, catalog and pending approvals', () => {
  const db = openDb();
  seedDemo(db, TODAY);
  expect(count(db, 'SELECT count(*) AS n FROM stores WHERE demo = 1')).toBe(3);
  expect(count(db, 'SELECT count(*) AS n FROM daily_metrics')).toBe(3 * DEMO_DAYS);
  expect(db.prepare('SELECT MIN(date) AS a, MAX(date) AS b FROM daily_metrics').get()).toEqual({ a: '2024-10-27', b: TODAY });
  expect(count(db, 'SELECT count(*) AS n FROM products')).toBe(18);
  expect(count(db, 'SELECT count(*) AS n FROM campaign_daily')).toBe(3 * 4 * DEMO_DAYS);
  expect(count(db, "SELECT count(*) AS n FROM approvals WHERE status = 'pending'")).toBe(3);
  const weekOrders = count(db, `SELECT sum(orders) AS n FROM daily_metrics WHERE store_id = 'glow' AND date > '2026-10-19'`);
  expect(count(db, "SELECT count(*) AS n FROM orders WHERE store_id = 'glow'")).toBe(weekOrders);
});

test('seedDemo on a later day only tops up the missing days', () => {
  const db = openDb();
  seedDemo(db, TODAY);
  seedDemo(db, '2026-10-29');
  expect(count(db, 'SELECT count(*) AS n FROM daily_metrics')).toBe(3 * (DEMO_DAYS + 3));
  expect(count(db, "SELECT count(*) AS n FROM approvals")).toBe(3);
  expect(db.prepare("SELECT revenue FROM daily_metrics WHERE store_id = 'peak' AND date = '2026-10-28'").get()?.revenue).toBe(demoDay('peak', '2026-10-28').revenue);
});

test('demo orders are never in the future and fall within their local day', () => {
  const db = openDb();
  const today = localDate();
  seedDemo(db, today);
  const now = Date.now();
  const midnight = new Date(`${addDays(today, -6)}T00:00:00`).getTime();
  const times = db.prepare('SELECT created_at FROM orders').all().map((r) => Date.parse(String(r.created_at)));
  expect(times.length).toBeGreaterThan(0);
  expect(times.every((t) => t <= now && t >= midnight)).toBe(true);
});
