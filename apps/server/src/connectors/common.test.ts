import { expect, test, vi } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { updateStore } from '../stores';
import { rebuildRevenue, retrying, setStoreCurrency, switchToReal, takeTimezone } from './common';

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
});
