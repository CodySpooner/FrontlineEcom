import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { midnightOffset, syncAmazon } from './amazon';

const key = randomBytes(32);
const NOW = new Date('2026-10-26T18:00:00Z');
const REFRESH = 'Atzr|fixture';

/** Fake LWA + Sales API (two days of metrics). */
function fakeAmazon(status = 200) {
  const calls: { url: URL; headers: Headers; body: string }[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    calls.push({ url: u, headers: new Headers(init.headers), body: String(init.body ?? '') });
    if (u.host === 'api.amazon.com') return Response.json({ access_token: 'Atza|access', expires_in: 3600 });
    if (status !== 200) return Response.json({ errors: [{ code: 'Unauthorized', message: 'Access to requested resource is denied.' }] }, { status });
    const day = (date: string, amount: number, orderCount: number) => ({ interval: `${date}T00:00-05:00--x`, orderCount, unitCount: orderCount, orderItemCount: orderCount, totalSales: { amount, currencyCode: 'USD' } });
    return Response.json({ payload: [day('2026-10-25', 412.5, 9), day('2026-10-26', 80, 2)] });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  saveIntegration(db, key, { kind: 'amazon', storeId: 'peak', values: { sellerId: 'A1SELLER', region: 'na', marketplaceId: 'ATVPDKIKX0DER', clientId: 'amzn1.application-oa2-client.x', clientSecret: 'lwa_secret', refreshToken: REFRESH } });
  return db;
};

test('UTC offset at local midnight, across DST and half-hour zones', () => {
  expect(midnightOffset('America/Chicago', '2026-10-26')).toBe('-05:00');
  expect(midnightOffset('America/Chicago', '2026-11-01')).toBe('-05:00'); // DST ends at 02:00, midnight is still CDT
  expect(midnightOffset('America/Chicago', '2026-11-02')).toBe('-06:00');
  expect(midnightOffset('Europe/Berlin', '2026-03-29')).toBe('+01:00');
  expect(midnightOffset('Asia/Kolkata', '2026-10-26')).toBe('+05:30');
  expect(midnightOffset('UTC', '2026-10-26')).toBe('+00:00');
});

test('Amazon sync stores daily sales per channel and adds them to revenue next to platform orders', async () => {
  const db = setup();
  const { fetchFn, calls } = fakeAmazon();
  await syncAmazon(db, key, 'peak', fetchFn, NOW);

  expect(Object.fromEntries(new URLSearchParams(calls[0]!.body))).toMatchObject({ grant_type: 'refresh_token', refresh_token: REFRESH, client_secret: 'lwa_secret' });
  const sales = calls[1]!;
  expect(sales.url.host).toBe('sellingpartnerapi-na.amazon.com');
  expect(sales.headers.get('x-amz-access-token')).toBe('Atza|access');
  expect(Object.fromEntries(sales.url.searchParams)).toEqual({
    marketplaceIds: 'ATVPDKIKX0DER', interval: '2024-10-27T00:00:00-05:00--2026-10-27T00:00:00-05:00', granularity: 'Day', granularityTimeZone: 'America/Chicago',
  });
  expect(db.prepare("SELECT date, revenue, orders FROM channel_daily WHERE store_id = 'peak' ORDER BY date").all()).toEqual([
    { date: '2026-10-25', revenue: 412.5, orders: 9 },
    { date: '2026-10-26', revenue: 80, orders: 2 },
  ]);
  expect(db.prepare("SELECT revenue, orders FROM daily_metrics WHERE store_id = 'peak' AND date = '2026-10-25'").get()).toEqual({ revenue: 412.5, orders: 9 });

  // A store platform's order on the same day (e.g. TikTok Shop) adds up with Amazon's totals.
  db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date) VALUES ('peak', 'tt-1', '2026-10-25T17:00:00Z', 37.5, 'paid', 'unfulfilled', 0, '2026-10-25')").run();
  const again = fakeAmazon();
  await syncAmazon(db, key, 'peak', again.fetchFn, NOW);
  expect(again.calls[1]!.url.searchParams.get('interval')).toBe('2026-10-12T00:00:00-05:00--2026-10-27T00:00:00-05:00');
  expect(db.prepare("SELECT revenue, orders FROM daily_metrics WHERE store_id = 'peak' AND date = '2026-10-25'").get()).toEqual({ revenue: 450, orders: 10 });
});

test('Amazon: a missing sales role shows a clear error and keeps demo data', async () => {
  const db = setup();
  await syncAmazon(db, key, 'peak', fakeAmazon(403).fetchFn, NOW);
  expect(db.prepare("SELECT status, error FROM integrations WHERE id = 'amazon:peak'").get()).toEqual({ status: 'error', error: expect.stringContaining('Selling Partner Insights') });
  expect(db.prepare("SELECT demo FROM stores WHERE id = 'peak'").get()).toEqual({ demo: 1 });
});
