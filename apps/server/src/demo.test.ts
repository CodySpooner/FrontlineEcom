import { expect, test } from 'vitest';
import { switchToReal } from './connectors/common';
import { openDb } from './db';
import { addDays, localDate } from './dates';
import { advanceDemoDay, DEMO_DAYS, demoDay, demoSoFar, seedDemo } from './demo';

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

test('demoSoFar: nothing at midnight, the full day at the end, sales step with whole orders', () => {
  const full = demoDay('glow', '2026-10-21');
  expect(demoSoFar('glow', '2026-10-21', 0)).toMatchObject({ revenue: 0, adSpend: 0, orders: 0, sessions: 0 });
  expect(demoSoFar('glow', '2026-10-21', 1)).toEqual(full);
  const half = demoSoFar('glow', '2026-10-21', 0.5);
  expect(half.orders).toBe(Math.floor(full.orders / 2));
  expect(half.revenue).toBeCloseTo((full.revenue * half.orders) / full.orders, 2);
  expect(half.adSpend).toBeCloseTo(full.adSpend / 2, 1);
  expect(half.checkouts).toBeGreaterThanOrEqual(half.orders);
});

test('advanceDemoDay adds the orders that came due, keeps orders and metrics in step, finalises yesterday', () => {
  const db = openDb();
  seedDemo(db, '2026-10-20');
  const at = (h: number) => new Date(`2026-10-21T${String(h).padStart(2, '0')}:00:00`);
  const day = () => ({
    metrics: db.prepare("SELECT revenue, orders FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-21'").get()!,
    orders: db.prepare("SELECT count(*) AS n, coalesce(sum(total), 0) AS total FROM orders WHERE store_id = 'glow' AND local_date = '2026-10-21'").get()!,
  });

  const morning = advanceDemoDay(db, 'glow', at(10));
  expect(morning.length).toBe(demoSoFar('glow', '2026-10-21', 10 / 24).orders);
  expect(morning.every((e) => e.type === 'order' && e.storeId === 'glow' && e.at === at(10).toISOString())).toBe(true);
  expect(day().orders.n).toBe(day().metrics.orders);

  const evening = advanceDemoDay(db, 'glow', at(18));
  expect(evening.length).toBe(demoSoFar('glow', '2026-10-21', 18 / 24).orders - morning.length);
  expect(advanceDemoDay(db, 'glow', at(18))).toEqual([]);
  const { metrics, orders } = day();
  expect(orders.n).toBe(metrics.orders);
  expect(Math.abs(Number(orders.total) - Number(metrics.revenue))).toBeLessThan(0.5);
  expect(new Set(db.prepare("SELECT id FROM orders WHERE store_id = 'glow'").all().map((r) => r.id)).size).toBe(Number(db.prepare("SELECT count(*) AS n FROM orders WHERE store_id = 'glow'").get()!.n));

  // The next morning, the 21st is final.
  advanceDemoDay(db, 'glow', new Date('2026-10-22T01:00:00'));
  expect(db.prepare("SELECT revenue, orders FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-21'").get()).toEqual({ revenue: demoDay('glow', '2026-10-21').revenue, orders: demoDay('glow', '2026-10-21').orders });
});

test('a day left "so far" by an earlier session is finalised on the next start', () => {
  const db = openDb();
  seedDemo(db, '2026-10-20');
  db.prepare("UPDATE daily_metrics SET revenue = 1, orders = 0 WHERE date = '2026-10-20'").run(); // as if the app quit mid-morning
  seedDemo(db, '2026-10-23');
  expect(db.prepare("SELECT revenue, orders FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-20'").get()).toEqual({ revenue: demoDay('glow', '2026-10-20').revenue, orders: demoDay('glow', '2026-10-20').orders });
});

test('a store that goes real drops its pending sample requests, so approving one never touches the live shop', () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  switchToReal(db, 'glow');
  seedDemo(db, '2026-10-26'); // a later start doesn't bring them back
  expect(db.prepare("SELECT id, store_id AS s FROM approvals WHERE id LIKE 'demo-appr-%' ORDER BY id").all()).toEqual([{ id: 'demo-appr-1', s: 'peak' }, { id: 'demo-appr-2', s: 'pawsome' }]);
});
