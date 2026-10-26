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
function fakeAmazon(status = 200, listings = true) {
  const calls: { url: URL; headers: Headers; body: string }[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    calls.push({ url: u, headers: new Headers(init.headers), body: String(init.body ?? '') });
    if (u.host === 'api.amazon.com') return Response.json({ access_token: 'Atza|access', expires_in: 3600 });
    if (status !== 200) return Response.json({ errors: [{ code: 'Unauthorized', message: 'Access to requested resource is denied.' }] }, { status });
    if (u.pathname.startsWith('/listings/')) {
      if (!listings) return Response.json({ errors: [{ code: 'Unauthorized', message: 'Access to requested resource is denied.' }] }, { status: 403 });
      const item = (sku: string, status: string[], qty?: number) => ({
        sku, summaries: [{ marketplaceId: 'ATVPDKIKX0DER', itemName: `Item ${sku}`, status, mainImage: { link: `https://m.media-amazon.com/${sku}.jpg` } }],
        offers: [{ marketplaceId: 'ATVPDKIKX0DER', offerType: 'B2B', price: { currencyCode: 'USD', amount: '18.00' } }, { marketplaceId: 'ATVPDKIKX0DER', offerType: 'B2C', price: { currencyCode: 'USD', amount: '24.99' } }],
        fulfillmentAvailability: qty === undefined ? [{ fulfillmentChannelCode: 'AMAZON_NA' }] : [{ fulfillmentChannelCode: 'DEFAULT', quantity: qty }],
      });
      return u.searchParams.get('pageToken')
        ? Response.json({ numberOfResults: 3, items: [item('MUG-1', [])] })
        : Response.json({ numberOfResults: 3, pagination: { nextToken: 'p2' }, items: [item('BOTTLE-1', ['BUYABLE', 'DISCOVERABLE'], 7), item('TENT-2', ['DISCOVERABLE'])] });
    }
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

test("Amazon as an extra channel is converted into the store's currency; an Amazon store takes its marketplace's", async () => {
  const db = setup();
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('fx', ?)").run(JSON.stringify({ date: '2026-10-23', fetchedAt: NOW.toISOString(), rates: { EUR: 1, USD: 1.25 } }));
  db.prepare("UPDATE stores SET currency = 'EUR' WHERE id = 'peak'").run(); // a TikTok Shop store in euros, selling on amazon.com too
  await syncAmazon(db, key, 'peak', fakeAmazon().fetchFn, NOW);
  expect(db.prepare("SELECT revenue FROM channel_daily WHERE store_id = 'peak' AND date = '2026-10-25'").get()?.revenue).toBe(330);
  expect(db.prepare("SELECT currency FROM stores WHERE id = 'peak'").get()?.currency).toBe('EUR');

  db.prepare("UPDATE stores SET platform = 'amazon' WHERE id = 'peak'").run();
  db.prepare("UPDATE integrations SET cursor = NULL WHERE id = 'amazon:peak'").run();
  await syncAmazon(db, key, 'peak', fakeAmazon().fetchFn, NOW);
  expect(db.prepare("SELECT currency FROM stores WHERE id = 'peak'").get()?.currency).toBe('USD');
  expect(db.prepare("SELECT revenue FROM channel_daily WHERE store_id = 'peak' AND date = '2026-10-25'").get()?.revenue).toBe(412.5);
});

test("an Amazon store's listings become its products: all of them at first, then the last two days' changes", async () => {
  const db = setup();
  db.prepare("UPDATE stores SET platform = 'amazon' WHERE id = 'peak'").run();
  const products = () => db.prepare("SELECT id, title, price, inventory, inventory_tracked AS tracked, status FROM products WHERE store_id = 'peak' AND id GLOB 'amz-*' ORDER BY id").all();
  const listingCalls = (c: { url: URL }[]) => c.filter((x) => x.url.pathname.startsWith('/listings/')).map((x) => x.url.searchParams);

  // No Product Listing role: sales still sync.
  await syncAmazon(db, key, 'peak', fakeAmazon(200, false).fetchFn, NOW);
  expect(db.prepare("SELECT status FROM integrations WHERE id = 'amazon:peak'").get()?.status).toBe('connected');
  expect(products()).toEqual([]);

  const { fetchFn, calls } = fakeAmazon();
  await syncAmazon(db, key, 'peak', fetchFn, NOW);
  expect(listingCalls(calls).map((q) => [q.get('lastUpdatedAfter'), q.get('pageToken')])).toEqual([[null, null], [null, 'p2']]); // the role came later: the whole catalog
  expect(calls.find((x) => x.url.pathname.startsWith('/listings/'))!.url.pathname).toBe('/listings/2021-08-01/items/A1SELLER');
  expect(products()).toEqual([
    { id: 'amz-BOTTLE-1', title: 'Item BOTTLE-1', price: 24.99, inventory: 7, tracked: 1, status: 'active' },
    { id: 'amz-MUG-1', title: 'Item MUG-1', price: 24.99, inventory: 0, tracked: 0, status: 'draft' },
    { id: 'amz-TENT-2', title: 'Item TENT-2', price: 24.99, inventory: 0, tracked: 0, status: 'active' }, // FBA: stock not reported here
  ]);

  // The app was closed for a week: changes since two days before the last sync, not just the last two days.
  db.prepare("UPDATE integrations SET cursor = '2026-10-19' WHERE id = 'amazon:peak'").run();
  const later = fakeAmazon();
  await syncAmazon(db, key, 'peak', later.fetchFn, NOW);
  expect(listingCalls(later.calls)[0]!.get('lastUpdatedAfter')).toBe('2026-10-17T00:00:00Z');

  // Amazon as an extra channel of another platform's store: no listings call.
  db.prepare("UPDATE stores SET platform = 'shopify' WHERE id = 'peak'").run();
  const extra = fakeAmazon();
  await syncAmazon(db, key, 'peak', extra.fetchFn, NOW);
  expect(listingCalls(extra.calls)).toEqual([]);
});

test('a catalog past the 1000-SKU search cap is read in windows from the last change seen', async () => {
  const db = setup();
  db.prepare("UPDATE stores SET platform = 'amazon' WHERE id = 'peak'").run();
  // 2500 SKUs, one change per minute; the fake applies lastUpdatedAfter (inclusive), sorts oldest first and caps at 1000.
  const all = Array.from({ length: 2500 }, (_, i) => ({ sku: `S${i}`, summaries: [{ status: ['BUYABLE'], lastUpdatedDate: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() }] }));
  const windows: (string | null)[] = [];
  const base = fakeAmazon().fetchFn;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (!u.pathname.startsWith('/listings/')) return base(url, init);
    expect([u.searchParams.get('sortBy'), u.searchParams.get('sortOrder')]).toEqual(['lastUpdatedDate', 'ASC']);
    const from = u.searchParams.get('lastUpdatedAfter');
    const hits = all.filter((l) => !from || l.summaries[0]!.lastUpdatedDate >= from).slice(0, 1000);
    const at = Number(u.searchParams.get('pageToken') ?? 0);
    if (!at) windows.push(from);
    return Response.json({ numberOfResults: hits.length, items: hits.slice(at, at + 20), ...(at + 20 < hits.length ? { pagination: { nextToken: String(at + 20) } } : {}) });
  }) as typeof fetch;
  await syncAmazon(db, key, 'peak', fetchFn, NOW);
  expect(windows).toEqual([null, all[999]!.summaries[0]!.lastUpdatedDate, all[1998]!.summaries[0]!.lastUpdatedDate]);
  expect(db.prepare("SELECT count(*) AS n FROM products WHERE store_id = 'peak' AND id GLOB 'amz-*'").get()?.n).toBe(2500);
});
