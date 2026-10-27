import { expect, test } from 'vitest';
import type { AnalyticsSummary, CampaignStats, TopProduct } from '@frontline/shared';
import { createApp } from './app';
import { openDb } from './db';
import { seedDemo } from './demo';
import { campaignStats, currentWindow, dayShifts, loadRows, platformSplit, salesShares, summarize, topProducts, totalsOf, type MetricRow } from './analytics';

const row = (storeId: string, date: string, revenue: number, adSpend: number, cogs: number, orders: number): MetricRow => ({ storeId, date, revenue, adSpend, cogs, orders });

test('totals: profit, ROAS and AOV follow DESIGN §6, zero-safe', () => {
  expect(totalsOf([row('a', '2026-10-01', 1000, 250, 300, 20), row('a', '2026-10-02', 500, 250, 150, 10)])).toEqual({
    revenue: 1500, profit: 550, adSpend: 500, roas: 3, orders: 30, aov: 50,
  });
  expect(totalsOf([])).toEqual({ revenue: 0, profit: 0, adSpend: 0, roas: 0, orders: 0, aov: 0 });
});

test('summary compares against the immediately preceding period of the same length', () => {
  const rows = [
    // previous period (Oct 19–25)
    row('a', '2026-10-19', 100, 50, 20, 2),
    row('b', '2026-10-25', 100, 50, 20, 2),
    // current period (Oct 26 – Nov 1)
    row('a', '2026-10-26', 300, 100, 60, 6),
    row('b', '2026-11-01', 100, 0, 20, 2),
    // outside both periods
    row('a', '2026-10-18', 9999, 9999, 9999, 99),
  ];
  const s = summarize(rows, { range: 7, to: '2026-11-01', storeIds: ['a', 'b'] });
  expect(s.from).toBe('2026-10-26');
  expect(s.to).toBe('2026-11-01');
  expect(s.totals).toEqual({ revenue: 400, profit: 220, adSpend: 100, roas: 4, orders: 8, aov: 50 });
  expect(s.previous).toEqual({ revenue: 200, profit: 60, adSpend: 100, roas: 2, orders: 4, aov: 50 });
  expect(s.deltas).toEqual({ revenue: 100, profit: 266.67, adSpend: 0, roas: 100, orders: 100, aov: 0 });
  expect(s.series).toHaveLength(7);
  expect(s.series[0]).toEqual({ date: '2026-10-26', revenue: 300, profit: 140, adSpend: 100, roas: 3, orders: 6, aov: 50 });
  expect(s.series[3]).toEqual({ date: '2026-10-29', revenue: 0, profit: 0, adSpend: 0, roas: 0, orders: 0, aov: 0 });
  expect(s.byStore.map((b) => [b.storeId, b.totals.revenue, b.previous.revenue, b.deltas.revenue])).toEqual([['a', 300, 100, 200], ['b', 100, 100, 0]]);
});

test('negative previous profit gives a sign-correct delta', () => {
  const s = summarize([row('a', '2026-10-31', 100, 100, 50, 1), row('a', '2026-11-01', 100, 20, 30, 1)], { range: 1 as 7, to: '2026-11-01', storeIds: ['a'] });
  // previous profit -50 → current 50: +200%
  expect(s.deltas.profit).toBe(200);
});

test('GET /api/analytics/summary filters stores and validates range', async () => {
  const db = openDb();
  seedDemo(db);
  const app = createApp(db);
  const all = (await (await app.request('/api/analytics/summary?range=30')).json()) as AnalyticsSummary;
  expect(all.storeIds).toEqual(['pawsome', 'glow', 'peak']);
  expect(all.series).toHaveLength(30);
  expect(all.totals.revenue).toBeGreaterThan(0);
  const one = (await (await app.request('/api/analytics/summary?stores=peak,nope&range=7')).json()) as AnalyticsSummary;
  expect(one.storeIds).toEqual(['peak']);
  expect(one.byStore).toHaveLength(1);
  expect(one.totals.revenue).toBeLessThan(all.totals.revenue);
  expect((await app.request('/api/analytics/summary?range=12')).status).toBe(400);
});

test('funnel: period totals of sessions, add to carts, checkouts and orders', () => {
  const s = summarize(
    [
      { ...row('a', '2026-10-26', 100, 10, 30, 2), sessions: 500, addToCarts: 40, checkouts: 12 },
      { ...row('a', '2026-10-25', 100, 10, 30, 3), sessions: 400, addToCarts: 30, checkouts: 9 },
      { ...row('a', '2026-10-19', 100, 10, 30, 9), sessions: 9999 }, // previous period: not counted
    ],
    { range: 7, to: '2026-10-26', storeIds: ['a'] },
  );
  expect(s.funnel).toEqual({ sessions: 900, addToCarts: 70, checkouts: 21, orders: 5 });
});

test("funnel orders come from the store-days that report sessions, so a short traffic history doesn't inflate conversion", () => {
  const s = summarize(
    [
      { ...row('a', '2026-10-26', 100, 0, 30, 2), sessions: 500 },
      row('a', '2026-10-24', 100, 0, 30, 4), // before the store's traffic source began
      row('b', '2026-10-26', 100, 0, 30, 7), // a store with no traffic source
    ],
    { range: 7, to: '2026-10-26', storeIds: ['a', 'b'] },
  );
  expect(s.totals.orders).toBe(13);
  expect(s.funnel).toEqual({ sessions: 500, addToCarts: 0, checkouts: 0, orders: 2 });
  // No sessions anywhere: the funnel is just the orders.
  expect(summarize([row('b', '2026-10-26', 100, 0, 30, 7)], { range: 7, to: '2026-10-26', storeIds: ['b'] }).funnel.orders).toBe(7);
});

test('campaign stats over the period, folded statuses, biggest spend first; GET /api/analytics/campaigns', async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  db.prepare("INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', 'old', 'glow', 'Old test', 'deleted', 0)").run();
  db.prepare("INSERT INTO campaign_daily (network, campaign_id, date, spend, revenue, purchases, clicks, impressions) VALUES ('meta', 'old', '2026-10-01', 50, 0, 0, 10, 100)").run();
  const week = campaignStats(db, ['glow'], '2026-10-20', '2026-10-26');
  expect(week.length).toBe(5);
  expect(week.map((c) => c.spend)).toEqual([...week.map((c) => c.spend)].sort((a, b) => b - a));
  expect(week.find((c) => c.id === 'old')).toMatchObject({ status: 'archived', spend: 0, roas: 0 });
  const top = week[0]!;
  expect(top.roas).toBeCloseTo(top.revenue / top.spend, 1);
  expect(campaignStats(db, ['glow'], '2026-10-01', '2026-10-26').find((c) => c.id === 'old')).toMatchObject({ spend: 50, clicks: 10 });

  const app = createApp(db);
  const res = (await (await app.request('/api/analytics/campaigns?stores=glow,peak&range=7')).json()) as CampaignStats[];
  expect(new Set(res.map((c) => c.storeId))).toEqual(new Set(['glow', 'peak']));
  expect((await app.request('/api/analytics/campaigns?range=12')).status).toBe(400);
});

test('top products: real stores from line items of paid orders, demo stores split their real revenue', async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  db.prepare("UPDATE stores SET demo = 0 WHERE id = 'glow'").run();
  for (const t of ['orders', 'products']) db.prepare(`DELETE FROM ${t} WHERE store_id = 'glow'`).run();
  db.prepare("INSERT INTO products (store_id, id, title, price, compare_at, cost, inventory, status) VALUES ('glow', 'mask', 'LED Mask', 90, 0, 30, 5, 'active')").run();
  const order = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date) VALUES ('glow', ?, '', ?, ?, 'unfulfilled', 0, ?)");
  const item = db.prepare("INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES ('glow', ?, ?, ?, ?, ?)");
  order.run('#1', 180, 'paid', '2026-10-25'); item.run('#1', 'mask', 2, 180, 60);
  order.run('#2', 90, 'refunded', '2026-10-25'); item.run('#2', 'mask', 1, 90, 30);
  order.run('#3', 25, 'paid', '2026-10-24'); item.run('#3', 'gone', 1, 25, 0);
  order.run('#4', 90, 'paid', '2026-10-10'); item.run('#4', 'mask', 1, 90, 30); // before the period

  expect(topProducts(db, ['glow'], '2026-10-20', '2026-10-26', 8)).toEqual([
    // Stock comes along so a best seller's "sold out" shows without a catalog lookup; a removed product has none.
    { storeId: 'glow', productId: 'mask', title: 'LED Mask', units: 2, revenue: 180, profit: 120, inventory: 5, inventoryTracked: true, status: 'active' },
    { storeId: 'glow', productId: 'gone', title: 'Removed product', units: 1, revenue: 25, profit: 25 },
  ]);

  const demo = topProducts(db, ['peak'], '2026-10-20', '2026-10-26', 50);
  const revenue = Number(db.prepare("SELECT sum(revenue) AS r FROM daily_metrics WHERE store_id = 'peak' AND date BETWEEN '2026-10-20' AND '2026-10-26'").get()!.r);
  expect(demo.length).toBeGreaterThan(1);
  expect(Math.abs(demo.reduce((a, p) => a + p.revenue, 0) - revenue) / revenue).toBeLessThan(0.1);
  expect(demo.every((p) => p.profit < p.revenue && p.units > 0 && p.status === 'active' && typeof p.inventory === 'number')).toBe(true);
  expect(topProducts(db, ['peak'], '2026-10-20', '2026-10-26', 50)).toEqual(demo);

  const app = createApp(db);
  const both = (await (await app.request('/api/analytics/top-products?stores=glow,peak&range=7&limit=3')).json()) as TopProduct[];
  expect(both).toHaveLength(3);
  expect(both.map((p) => p.revenue)).toEqual([...both.map((p) => p.revenue)].sort((a, b) => b - a));
  expect((await app.request('/api/analytics/top-products?range=12')).status).toBe(400);
});

test('while today is in progress, the previous period\'s last day counts only the same share', () => {
  const r = (date: string, revenue: number, orders: number): MetricRow => ({ storeId: 'a', date, revenue, adSpend: 10, cogs: 0, orders });
  const rows = [r('2026-10-30', 100, 10), r('2026-10-31', 200, 20), r('2026-11-01', 100, 10), r('2026-11-02', 50, 5)];
  const full = summarize(rows, { range: 2, to: '2026-11-02', storeIds: ['a'] } as never);
  expect(full.previous).toMatchObject({ revenue: 300, orders: 30, adSpend: 20 });
  const morning = summarize(rows, { range: 2, to: '2026-11-02', storeIds: ['a'], todayFraction: 0.5 } as never);
  // 2026-10-31 (the day matching today) is halved; 2026-10-30 stays whole.
  expect(morning.previous).toMatchObject({ revenue: 200, orders: 20, adSpend: 15 });
  expect(morning.totals).toEqual(full.totals);
  expect(morning.deltas.revenue).toBe(-25);
  expect(morning.byStore[0]!.deltas.revenue).toBe(-25);
  // Per store: the share of that day's sales its orders had made by this time.
  const shared = summarize(rows, { range: 2, to: '2026-11-02', storeIds: ['a'], todayFraction: { a: 0.25 } } as never);
  expect(shared.previous).toMatchObject({ revenue: 150, orders: 15, adSpend: 12.5 });
});

test("each store's share of a day's sales by a time of day comes from its paid orders' times, else the clock", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  db.prepare("DELETE FROM orders WHERE store_id IN ('glow', 'peak')").run();
  const ord = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date) VALUES ('glow', ?, ?, ?, ?, 'fulfilled', 0, '2026-10-19')");
  ord.run('#1', '2026-10-19T08:00:00.000Z', 30, 'paid');
  ord.run('#2', '2026-10-19T20:00:00Z', 90, 'paid');
  ord.run('#3', '2026-10-19T09:00:00Z', 500, 'refunded');
  expect(salesShares(db, ['glow', 'peak'], '2026-10-19', new Date('2026-10-19T12:00:00Z'), 0.5)).toEqual({ glow: 0.25, peak: 0.5 });
});

test("stores in different day zones each count their own today, and their own comparison day's share", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  // 03:00 UTC: Berlin is at 04:00 on the 26th, Honolulu still at 17:00 on the 25th.
  const now = Date.parse('2026-10-26T03:00:00Z');
  db.prepare("UPDATE stores SET demo = 0, currency = 'USD', timezone = ? WHERE id = ?").run('Europe/Berlin', 'glow');
  db.prepare("UPDATE stores SET demo = 0, currency = 'USD', timezone = ? WHERE id = ?").run('Pacific/Honolulu', 'peak');
  db.prepare("DELETE FROM daily_metrics WHERE store_id = 'peak'").run();
  db.prepare("DELETE FROM orders WHERE store_id = 'peak'").run();
  const day = db.prepare("INSERT INTO daily_metrics (store_id, date, revenue, ad_spend, cogs, orders) VALUES ('peak', ?, ?, 0, 0, 1)");
  day.run('2026-10-25', 100); // Honolulu's today so far
  day.run('2026-10-18', 240); // a week before: its comparison day
  day.run('2026-10-11', 999); // outside both weeks

  const w = currentWindow(db, ['glow', 'peak'], 7, now);
  expect(w.to).toBe('2026-10-26'); // the first store's today
  expect(w.rows.filter((r) => r.storeId === 'peak').map((r) => [r.date, r.revenue])).toEqual([['2026-10-19', 240], ['2026-10-26', 100]]);
  expect(w.todayFraction.peak).toBeCloseTo(17 / 24, 3); // Honolulu's clock (no orders that day)
  const peak = summarize(w.rows, { range: 7, to: w.to, storeIds: ['glow', 'peak'], todayFraction: w.todayFraction }).byStore[1]!;
  expect(peak.totals.revenue).toBe(100);
  expect(peak.previous.revenue).toBeCloseTo(170, 1); // 240 × 17/24, not a full day against a partial one
});

test("campaigns and top products cover each store's own days when stores are in different day zones", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  // 03:00 UTC: Berlin is at 04:00 on the 26th, Honolulu still at 17:00 on the 25th (one day behind).
  const now = Date.parse('2026-10-26T03:00:00Z');
  db.prepare("UPDATE stores SET demo = 0, currency = 'USD', timezone = ? WHERE id = ?").run('Europe/Berlin', 'glow');
  db.prepare("UPDATE stores SET demo = 0, currency = 'USD', timezone = ? WHERE id = ?").run('Pacific/Honolulu', 'peak');
  const { to, shift } = dayShifts(db, ['glow', 'peak'], now);
  expect([to, shift]).toEqual(['2026-10-26', { glow: 0, peak: 1 }]);

  db.prepare("INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', 'hnl', 'peak', 'Honolulu', 'active', 10)").run();
  const spend = db.prepare("INSERT INTO campaign_daily (network, campaign_id, date, spend, revenue, purchases, clicks, impressions) VALUES ('meta', 'hnl', ?, ?, 0, 0, 0, 0)");
  spend.run('2026-10-19', 7); // Honolulu's first day of its week (the 19th–25th)
  spend.run('2026-10-26', 1000); // not yet Honolulu's day
  expect(campaignStats(db, ['glow', 'peak'], '2026-10-20', to, shift).find((c) => c.id === 'hnl')!.spend).toBe(7);

  for (const t of ['orders', 'products']) db.prepare(`DELETE FROM ${t} WHERE store_id IN ('glow', 'peak')`).run();
  const order = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date) VALUES (?, ?, '', ?, 'paid', 'unfulfilled', 0, ?)");
  const item = db.prepare('INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES (?, ?, ?, 1, ?, 0)');
  order.run('peak', '#1', 30, '2026-10-19'); item.run('peak', '#1', 'rope', 30);
  order.run('glow', '#2', 50, '2026-10-19'); item.run('glow', '#2', 'mask', 50); // the day before Berlin's week
  expect(topProducts(db, ['glow', 'peak'], '2026-10-20', to, 8, shift).map((p) => [p.storeId, p.productId])).toEqual([['peak', 'rope']]);
});

test("funnel orders leave out a sales channel's own orders (Amazon next to the site): its shoppers aren't in the site's sessions", () => {
  const s = summarize(
    [{ ...row('a', '2026-10-26', 100, 0, 30, 9), sessions: 500, channelOrders: 6 }],
    { range: 7, to: '2026-10-26', storeIds: ['a'] },
  );
  expect(s.totals.orders).toBe(9);
  expect(s.funnel.orders).toBe(3);

  // Loaded per store-day: Amazon next to a Shopify store is a channel; an Amazon store's own sales aren't.
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const sales = db.prepare("INSERT INTO channel_daily (store_id, channel, date, revenue, orders) VALUES (?, 'amazon', '2026-10-26', 50, 4)");
  sales.run('glow');
  sales.run('peak');
  db.prepare("UPDATE stores SET platform = 'amazon' WHERE id = 'peak'").run();
  const day = (id: string) => loadRows(db, [id], 7, '2026-10-26').find((r) => r.date === '2026-10-26')?.channelOrders;
  expect([day('glow'), day('peak')]).toEqual([4, 0]);
});

test("Amazon next to the site costs the store's own cost ratio (last year) and Amazon's 15% referral, not the store's fees", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  db.prepare("DELETE FROM daily_metrics WHERE store_id = 'glow'").run();
  db.prepare("UPDATE stores SET fee_percent = 3, fee_per_order = 0.3 WHERE id = 'glow'").run();
  const day = db.prepare("INSERT INTO daily_metrics (store_id, date, revenue, cogs, orders) VALUES ('glow', ?, ?, ?, ?)");
  day.run('2026-10-25', 200, 60, 4); // the site alone
  day.run('2026-10-26', 150, 30, 3); // 100 on the site (2 orders) + 50 on Amazon (1 order)
  db.prepare("INSERT INTO channel_daily (store_id, channel, date, revenue, orders) VALUES ('glow', 'amazon', '2026-10-26', 50, 1)").run();
  const cogs = (date: string) => loadRows(db, ['glow'], 7, '2026-10-26').find((r) => r.date === date)?.cogs;
  // Cost ratio 90 / 300 = 0.3. The site's fees: 3% + $0.30 an order. Amazon's 50: 50 × (0.3 + 0.15).
  expect(cogs('2026-10-25')).toBeCloseTo(60 + 6 + 1.2);
  expect(cogs('2026-10-26')).toBeCloseTo(30 + 3 + 0.6 + 22.5);
});

test("sales by platform split a channel next to the store's own platform (Amazon, TikTok Shop) out of its totals", async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  db.prepare("DELETE FROM daily_metrics WHERE store_id = 'glow'").run();
  // 230 in 6 orders: 100 on the Shopify site (2), 50 on Amazon (1), 90 on TikTok Shop (3) less a 10 refund.
  db.prepare("INSERT INTO daily_metrics (store_id, date, revenue, cogs, orders) VALUES ('glow', '2026-10-26', 230, 0, 6)").run();
  db.prepare("INSERT INTO channel_daily (store_id, channel, date, revenue, orders) VALUES ('glow', 'amazon', '2026-10-26', 50, 1)").run();
  const order = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('glow', ?, '2026-10-26T12:00:00Z', ?, ?, 'fulfilled', ?)");
  order.run('tt-1', 40, 'paid', '2026-10-26');
  order.run('tt-2', 30, 'paid', '2026-10-26');
  order.run('tt-3', 20, 'paid', '2026-10-26');
  order.run('tt-4', 25, 'cancelled', '2026-10-26'); // not counted
  order.run('tt-5', 99, 'paid', '2026-10-01'); // before the window
  db.prepare("INSERT INTO amazon_refunds (store_id, id, order_id, amount, tax) VALUES ('glow', 'r1', 'tt-1', 8, 2)").run();
  expect(platformSplit(db, ['glow'], '2026-10-20', '2026-10-26')).toEqual([
    { platform: 'shopify', revenue: 100, orders: 2 },
    { platform: 'tiktok_shop', revenue: 80, orders: 3 },
    { platform: 'amazon', revenue: 50, orders: 1 },
  ]);
  // A TikTok Shop store's own tt- orders are its platform's.
  db.prepare("UPDATE stores SET platform = 'tiktok_shop' WHERE id = 'glow'").run();
  expect(platformSplit(db, ['glow'], '2026-10-20', '2026-10-26')).toEqual([
    { platform: 'tiktok_shop', revenue: 180, orders: 5 },
    { platform: 'amazon', revenue: 50, orders: 1 },
  ]);

  // The summary's split is over the same days and stores as its totals.
  const fresh = openDb();
  seedDemo(fresh);
  const s = (await (await createApp(fresh).request('/api/analytics/summary?stores=glow,peak&range=30')).json()) as AnalyticsSummary;
  expect(s.byPlatform!.map((p) => p.platform).sort()).toEqual(['shopify', 'tiktok_shop']);
  expect(s.byPlatform!.reduce((a, p) => a + p.revenue, 0)).toBeCloseTo(s.totals.revenue, 1);
  expect(s.byPlatform!.reduce((a, p) => a + p.orders, 0)).toBe(s.totals.orders);
});

test('an Etsy or WooCommerce shop next to a Shopify store is its own platform in the split, not Shopify', () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  db.prepare("DELETE FROM daily_metrics WHERE store_id = 'glow'").run();
  db.prepare("INSERT INTO daily_metrics (store_id, date, revenue, cogs, orders) VALUES ('glow', '2026-10-26', 200, 0, 3)").run();
  const order = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('glow', ?, '2026-10-26T12:00:00Z', ?, 'paid', 'fulfilled', '2026-10-26')");
  order.run('1001', 100);
  order.run('etsy-55', 60);
  order.run('woo-9', 40);
  expect(platformSplit(db, ['glow'], '2026-10-20', '2026-10-26')).toEqual([
    { platform: 'shopify', revenue: 100, orders: 1 },
    { platform: 'etsy', revenue: 60, orders: 1 },
    { platform: 'woocommerce', revenue: 40, orders: 1 },
  ]);
});

test("a TikTok Shop's orders next to the site are a channel's too: out of the funnel and of the site's per-order fee", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const order = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES (?, ?, '2026-10-26T12:00:00Z', 20, ?, 'fulfilled', '2026-10-26')");
  order.run('glow', 'tt-1', 'paid');
  order.run('glow', 'tt-2', 'paid');
  order.run('glow', 'tt-3', 'refunded'); // not in the day's orders
  order.run('glow', '1001', 'paid'); // the Shopify site's own
  order.run('peak', 'tt-9', 'paid'); // a TikTok Shop store's own orders aren't a channel
  const day = (id: string) => loadRows(db, [id], 7, '2026-10-26').find((r) => r.date === '2026-10-26')?.channelOrders;
  expect([day('glow'), day('peak')]).toEqual([2, 0]);
});

test("top products take off the refund lines (TikTok Shop, Amazon) of the product's paid orders, as store revenue does", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  db.prepare("UPDATE stores SET demo = 0 WHERE id = 'glow'").run();
  for (const t of ['orders', 'products']) db.prepare(`DELETE FROM ${t} WHERE store_id = 'glow'`).run();
  const order = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date) VALUES ('glow', ?, '', ?, 'paid', 'unfulfilled', 0, '2026-10-25')");
  const item = db.prepare("INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES ('glow', ?, ?, 1, ?, ?)");
  const refund = db.prepare("INSERT INTO amazon_refunds (store_id, id, order_id, amount, product_id) VALUES ('glow', ?, ?, ?, ?)");
  order.run('tt-1', 50); item.run('tt-1', 'tt-p', 50, 10); refund.run('r1', 'tt-1', 50, 'tt-p'); // refunded in full
  order.run('amz-2', 40); item.run('amz-2', 'amz-p', 40, 10); refund.run('r2', 'amz-2', 15, 'amz-p'); // partly
  order.run('tt-3', 30); item.run('tt-3', 'tt-q', 30, 0); refund.run('r3', 'tt-3', 5, null); // names no product: lands on none
  // Sold twice at 20; one order (20 + 5 shipping) returned in two refunds of 25 in all: only its 20 comes off.
  order.run('tt-4', 25); item.run('tt-4', 'tt-r', 20, 0); refund.run('r4', 'tt-4', 15, 'tt-r'); refund.run('r5', 'tt-4', 10, 'tt-r');
  order.run('tt-5', 20); item.run('tt-5', 'tt-r', 20, 0);
  expect(topProducts(db, ['glow'], '2026-10-20', '2026-10-26', 8).map((p) => [p.productId, p.units, p.revenue, p.profit])).toEqual([
    ['tt-q', 1, 30, 30],
    ['amz-p', 1, 25, 15],
    ['tt-r', 2, 20, 20],
    ['tt-p', 1, 0, -10],
  ]);
});
