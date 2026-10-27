import { expect, test, vi } from 'vitest';
import { approvalsHook } from '../approvals';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { updateStore } from '../stores';
import { forgetPlatform, rebuildRevenue, retrying, setStoreCurrency, switchToReal, takeCurrency, takeTimezone } from './common';

test('a rate-limited sync request waits Retry-After and asks again; it gives up after 5 tries', async () => {
  const statuses = [429, 429, 200];
  const asked: number[] = [];
  const fetchFn = (async () => {
    asked.push(Date.now());
    return new Response(null, { status: statuses.shift() ?? 429, headers: { 'retry-after': '2' } });
  }) as unknown as typeof fetch;
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
  try {
    const ok = retrying(fetchFn)('https://openapi.etsy.com/v3/x');
    await vi.advanceTimersByTimeAsync(4000);
    expect((await ok).status).toBe(200);
    expect(asked.slice(1).map((t, i) => t - asked[i]!)).toEqual([2000, 2000]);

    const limited = retrying(fetchFn)('https://openapi.etsy.com/v3/x');
    await vi.advanceTimersByTimeAsync(8000);
    expect((await limited).status).toBe(429);
    expect(asked).toHaveLength(8);
  } finally {
    vi.useRealTimers();
  }
});

test('a sync request rides out server errors and dropped connections (2, 4, 8, 16 s); other errors return at once', async () => {
  const replies: (number | 'drop')[] = [502, 'drop', 200, 404];
  const asked: number[] = [];
  const fetchFn = (async () => {
    asked.push(Date.now());
    const r = replies.shift() ?? 503;
    if (r === 'drop') throw new TypeError('fetch failed');
    return new Response(null, { status: r });
  }) as unknown as typeof fetch;
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
  try {
    const ok = retrying(fetchFn)('https://shop.example/wp-json/wc/v3/orders');
    await vi.advanceTimersByTimeAsync(6000);
    expect((await ok).status).toBe(200);
    expect(asked.slice(1).map((t, i) => t - asked[i]!)).toEqual([2000, 4000]);
    expect((await retrying(fetchFn)('https://shop.example/x')).status).toBe(404);

    const down = retrying(fetchFn)('https://shop.example/x');
    await vi.advanceTimersByTimeAsync(30000);
    expect((await down).status).toBe(503);
    expect(asked).toHaveLength(9);
  } finally {
    vi.useRealTimers();
  }
});

test("a store's currency changing re-syncs its ad accounts and Amazon from scratch (they were converted into the old one)", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const add = db.prepare("INSERT INTO integrations (id, kind, store_id, status, encrypted_credentials, updated_at, cursor) VALUES (?, ?, 'glow', 'connected', '', '', '2026-10-26')");
  for (const kind of ['shopify', 'meta_ads', 'google_ads', 'tiktok_ads', 'amazon']) add.run(`${kind}:glow`, kind);
  const cursors = () => Object.fromEntries(db.prepare("SELECT kind, cursor FROM integrations WHERE store_id = 'glow'").all().map((r) => [r.kind, r.cursor]));
  const currency = String(db.prepare("SELECT currency FROM stores WHERE id = 'glow'").get()?.currency);
  setStoreCurrency(db, 'glow', currency);
  expect(Object.values(cursors())).toEqual(Array(5).fill('2026-10-26'));
  setStoreCurrency(db, 'glow', currency === 'EUR' ? 'GBP' : 'EUR');
  expect(cursors()).toEqual({ shopify: '2026-10-26', meta_ads: null, google_ads: null, tiktok_ads: null, amazon: null });
});

test("a store's own platform syncing in another currency drops what a second platform synced first in the old one", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  switchToReal(db, 'glow'); // a Shopify store
  db.prepare("INSERT INTO integrations (id, kind, store_id, status, encrypted_credentials, updated_at, cursor, synced_at) VALUES ('etsy:glow', 'etsy', 'glow', 'connected', '', '', '2026-10-26', '2026-10-26T10:00:00Z')").run();
  takeCurrency(db, 'glow', 'etsy', 'EUR'); // Shopify hasn't synced: the store takes Etsy's
  const order = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('glow', ?, '2026-10-26T12:00:00Z', 40, 'paid', 'fulfilled', '2026-10-26')");
  order.run('etsy-1');
  rebuildRevenue(db, 'glow', ['2026-10-26']);
  const revenue = () => db.prepare("SELECT revenue FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-26'").get()?.revenue;
  takeCurrency(db, 'glow', 'shopify', 'EUR'); // same currency: Etsy's orders add up fine
  expect(revenue()).toBe(40);
  takeCurrency(db, 'glow', 'shopify', 'USD'); // Shopify's first sync, in dollars: Etsy's euros would count as dollars
  expect(db.prepare("SELECT currency FROM stores WHERE id = 'glow'").get()?.currency).toBe('USD');
  expect(db.prepare("SELECT count(*) AS n FROM orders WHERE store_id = 'glow' AND id GLOB 'etsy-*'").get()?.n).toBe(0);
  expect(revenue()).toBe(0);
  expect(db.prepare("SELECT cursor FROM integrations WHERE id = 'etsy:glow'").get()?.cursor).toBeNull(); // read afresh if it ever fits
});

test("a real store's currency changing closes requests priced in the old one and drops its budgets until the ad sync re-reads them", () => {
  for (const change of ['sync', 'form'] as const) {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    switchToReal(db, 'glow');
    db.prepare("UPDATE stores SET currency = 'JPY' WHERE id = 'glow'").run();
    db.prepare("INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', 'c1', 'glow', 'Prospecting', 'active', 12800)").run();
    db.prepare("INSERT INTO integrations (id, kind, store_id, status, encrypted_credentials, updated_at, cursor) VALUES ('meta_ads:glow', 'meta_ads', 'glow', 'connected', '', '', '2026-10-26')").run();
    const ask = (kind: string, payload: object) => approvalsHook(db).create({ storeId: 'glow', agentId: 'glow:ad_strategist', title: kind, reason: 'r', action: { kind, payload } }).id;
    const budget = ask('ads.set_budget', { campaignId: 'c1', from: 12800, to: 16640 });
    const price = ask('store.set_price', { productId: 'p1', from: 2000, to: 2200 });
    const pause = ask('ads.pause_campaign', { campaignId: 'c1' });
    if (change === 'sync') setStoreCurrency(db, 'glow', 'USD');
    else updateStore(db, 'glow', { currency: 'USD' });
    const status = (id: string) => db.prepare('SELECT status, reason FROM approvals WHERE id = ?').get(id)!;
    expect([status(budget).status, status(price).status, status(pause).status], change).toEqual(['denied', 'denied', 'pending']);
    expect(String(status(budget).reason)).toMatch(/\[Expired: [^\]]*currency[^\]]*\]$/); // closedByApp: not the owner's no
    expect(db.prepare("SELECT daily_budget FROM campaigns WHERE id = 'c1'").get()?.daily_budget).toBe(0);
    expect(db.prepare("SELECT cursor FROM integrations WHERE store_id = 'glow'").all().every((r) => r.cursor == null)).toBe(true);
  }
  // A demo store writes nothing live: its sample requests and budgets stay.
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const pending = () => db.prepare("SELECT count(*) AS n FROM approvals WHERE store_id = 'glow' AND status = 'pending'").get()!.n;
  const before = pending();
  setStoreCurrency(db, 'glow', 'EUR');
  expect(pending()).toBe(before);
  expect(db.prepare("SELECT count(*) AS n FROM campaigns WHERE store_id = 'glow' AND daily_budget > 0").get()!.n).toBeGreaterThan(0);
});

test("a real store's new timezone re-dates its orders, rebuilds both calendars' days and has Amazon re-read its daily totals", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  switchToReal(db, 'glow'); // America/Chicago
  const ord = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date) VALUES ('glow', ?, ?, ?, 'paid', 'unfulfilled', 0, ?)");
  ord.run('#1', '2026-10-25T03:30:00.000Z', 40, '2026-10-24'); // 22:30 on the 24th in Chicago, 04:30 on the 25th in London
  ord.run('#2', '2026-10-25T15:00:00.000Z', 10, '2026-10-25');
  rebuildRevenue(db, 'glow', ['2026-10-24', '2026-10-25']);
  db.prepare("INSERT INTO integrations (id, kind, store_id, encrypted_credentials, updated_at, cursor) VALUES ('amazon:glow', 'amazon', 'glow', 'x', 'now', '2026-10-26')").run();
  const days = () => db.prepare("SELECT date, revenue, orders FROM daily_metrics WHERE store_id = 'glow' AND date IN ('2026-10-24', '2026-10-25') ORDER BY date").all();
  expect(days()).toEqual([{ date: '2026-10-24', revenue: 40, orders: 1 }, { date: '2026-10-25', revenue: 10, orders: 1 }]);

  updateStore(db, 'glow', { timezone: 'Europe/London', name: 'Glow Haus UK' });
  expect(db.prepare("SELECT id, local_date FROM orders WHERE store_id = 'glow' ORDER BY id").all()).toEqual([{ id: '#1', local_date: '2026-10-25' }, { id: '#2', local_date: '2026-10-25' }]);
  expect(days()).toEqual([{ date: '2026-10-24', revenue: 0, orders: 0 }, { date: '2026-10-25', revenue: 50, orders: 2 }]);
  expect(db.prepare("SELECT cursor FROM integrations WHERE id = 'amazon:glow'").get()?.cursor).toBeNull();
  expect(db.prepare("SELECT name, timezone FROM stores WHERE id = 'glow'").get()).toEqual({ name: 'Glow Haus UK', timezone: 'Europe/London' });

  // A demo store just takes the zone: its days are seeded, not built from its orders.
  const before = db.prepare("SELECT sum(revenue) AS r FROM daily_metrics WHERE store_id = 'peak'").get()?.r;
  updateStore(db, 'peak', { timezone: 'Asia/Tokyo' });
  expect(db.prepare("SELECT sum(revenue) AS r FROM daily_metrics WHERE store_id = 'peak'").get()?.r).toBe(before);
});

test("a second platform's timezone doesn't take over from the store's own platform once that has synced", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  switchToReal(db, 'glow'); // a Shopify store
  const zone = () => db.prepare("SELECT timezone FROM stores WHERE id = 'glow'").get()?.timezone;
  takeTimezone(db, 'glow', 'woocommerce', 'UTC'); // Woo first: nothing else has synced yet, so it sets the store's days
  expect(zone()).toBe('UTC');
  db.prepare("INSERT INTO integrations (id, kind, store_id, status, settings_json, encrypted_credentials, updated_at, synced_at) VALUES ('shopify:glow', 'shopify', 'glow', 'connected', '{}', '', '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z')").run();
  takeTimezone(db, 'glow', 'shopify', 'America/Chicago');
  takeTimezone(db, 'glow', 'woocommerce', 'UTC');
  expect(zone()).toBe('America/Chicago');
  takeTimezone(db, 'glow', 'shopify', 'America/Nowhere'); // a zone this machine doesn't know: kept as it was
  expect(zone()).toBe('America/Chicago');
});

test("forgetting a platform's old shop drops its refund lines too; other platforms' stay", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  switchToReal(db, 'glow');
  const refund = db.prepare("INSERT INTO amazon_refunds (store_id, id, order_id, amount) VALUES ('glow', ?, ?, 5)");
  refund.run('tt-R1', 'tt-1');
  refund.run('amz-R2', 'amz-2');
  forgetPlatform(db, 'glow', 'tiktok_shop');
  expect(db.prepare("SELECT id FROM amazon_refunds WHERE store_id = 'glow'").all().map((r) => r.id)).toEqual(['amz-R2']);
});
