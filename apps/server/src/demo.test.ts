import { expect, test } from 'vitest';
import { switchToReal } from './connectors/common';
import { openDb } from './db';
import { addDays, dayFraction, localDate } from './dates';
import { seedCompetitors } from './competitors';
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

  // The first tick fills the morning in, spread over it; only the latest order reaches the live feed (no burst).
  const morning = advanceDemoDay(db, 'glow', at(10));
  expect(morning).toEqual([expect.objectContaining({ type: 'order', storeId: 'glow', at: at(10).toISOString() })]);
  expect(day().orders.n).toBe(demoSoFar('glow', '2026-10-21', 10 / 24).orders);
  expect(day().orders.n).toBe(day().metrics.orders);
  const firstAt = db.prepare("SELECT min(created_at) AS t FROM orders WHERE store_id = 'glow' AND local_date = '2026-10-21'").get()!.t;
  expect(Date.parse(String(firstAt))).toBeLessThan(at(2).getTime());

  expect(advanceDemoDay(db, 'glow', at(18))).toEqual([expect.objectContaining({ at: at(18).toISOString() })]);
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

test('days the app was closed get their orders back, dated on their own day, without flooding the live feed', () => {
  const db = openDb();
  seedDemo(db, '2026-10-20');
  const now = new Date('2026-10-24T09:00:00');
  const events = advanceDemoDay(db, 'peak', now);
  expect(events.every((e) => now.getTime() - Date.parse(e.at) < 60_000)).toBe(true);
  const perDay = (date: string) => db.prepare('SELECT created_at FROM orders WHERE store_id = ? AND created_at >= ? AND created_at < ?')
    .all('peak', new Date(`${date}T00:00:00`).toISOString(), new Date(`${addDays(date, 1)}T00:00:00`).toISOString()).length;
  for (const date of ['2026-10-21', '2026-10-22', '2026-10-23']) expect(perDay(date), date).toBe(demoDay('peak', date).orders);
  expect(perDay('2026-10-24')).toBe(demoSoFar('peak', '2026-10-24', dayFraction('2026-10-24', now.getTime())).orders);
});

test('dayFraction reaches 1 at the end of a 23-hour DST day', () => {
  expect(dayFraction('2026-03-08', new Date('2026-03-09T00:00:00').getTime() - 60_000)).toBeGreaterThan(0.999);
  expect(dayFraction('2026-10-26', new Date('2026-10-26T12:00:00').getTime())).toBeCloseTo(0.5, 5);
});

test("the seeded budget request quotes the campaign's seeded budget, so approving it isn't refused as stale", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const budget = Number(db.prepare("SELECT daily_budget FROM campaigns WHERE id = 'pawsome-c1'").get()?.daily_budget);
  const a = db.prepare("SELECT title, action_json FROM approvals WHERE id = 'demo-appr-2'").get()!;
  expect(JSON.parse(String(a.action_json)).payload).toEqual({ campaignId: 'pawsome-c1', from: budget, to: Math.round(budget * 1.2) });
  expect(a.title).toBe(`Raise daily budget 20% ($${budget} → $${Math.round(budget * 1.2)})`);
});

test("the seeded add-products request offers only products the store doesn't sell yet", () => {
  const db = openDb();
  seedDemo(db, TODAY);
  for (const a of db.prepare("SELECT store_id, action_json FROM approvals WHERE id LIKE 'demo-appr-%'").all()) {
    const action = JSON.parse(String(a.action_json)) as { kind: string; payload: { products?: { title: string }[] } };
    if (action.kind !== 'store.add_products') continue;
    const sold = new Set(db.prepare('SELECT title FROM products WHERE store_id = ?').all(String(a.store_id)).map((p) => String(p.title)));
    expect(action.payload.products!.filter((p) => sold.has(p.title))).toEqual([]);
  }
});

test('demo stores and competitors are seeded once: deleted ones stay deleted after a restart', () => {
  const db = openDb();
  seedDemo(db, TODAY);
  seedCompetitors(db, TODAY);
  expect(count(db, 'SELECT count(*) AS n FROM competitors')).toBeGreaterThan(0);
  db.prepare('DELETE FROM competitors').run();
  for (const t of ['approvals', 'stores']) db.prepare(`DELETE FROM ${t}`).run();
  seedDemo(db, TODAY); // the next startup
  seedCompetitors(db, TODAY);
  expect([count(db, 'SELECT count(*) AS n FROM stores'), count(db, 'SELECT count(*) AS n FROM competitors')]).toEqual([0, 0]);
});
