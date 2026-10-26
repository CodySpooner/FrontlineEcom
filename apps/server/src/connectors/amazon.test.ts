import { randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { midnightOffset, setAmazonListingPrice, syncAmazon } from './amazon';

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

test('once a day the whole Amazon catalog is read again and listings that are gone are archived', async () => {
  const db = setup();
  db.prepare("UPDATE stores SET platform = 'amazon' WHERE id = 'peak'").run();
  let skus = ['A', 'B'];
  const queries: (string | null)[] = [];
  const base = fakeAmazon().fetchFn;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (!u.pathname.startsWith('/listings/')) return base(url, init);
    queries.push(u.searchParams.get('lastUpdatedAfter'));
    return Response.json({ numberOfResults: skus.length, items: skus.map((sku) => ({ sku, summaries: [{ status: ['BUYABLE'] }] })) });
  }) as typeof fetch;
  const status = () => db.prepare("SELECT id, status FROM products WHERE store_id = 'peak' AND id GLOB 'amz-*' ORDER BY id").all();

  await syncAmazon(db, key, 'peak', fetchFn, NOW);
  skus = ['A']; // B was deleted on Amazon
  await syncAmazon(db, key, 'peak', fetchFn, NOW); // same day: changes only, nothing to archive from
  expect(status()).toEqual([{ id: 'amz-A', status: 'active' }, { id: 'amz-B', status: 'active' }]);
  await syncAmazon(db, key, 'peak', fetchFn, new Date('2026-10-27T18:00:00Z')); // next day: the full pass
  expect(queries).toEqual([null, '2026-10-24T00:00:00Z', null]);
  expect(status()).toEqual([{ id: 'amz-A', status: 'active' }, { id: 'amz-B', status: 'archived' }]);
});

test('a catalog read cut short by the search cap archives nothing', async () => {
  const db = setup();
  db.prepare("UPDATE stores SET platform = 'amazon' WHERE id = 'peak'").run();
  // A bulk upload gave 1200 SKUs the same change time: windows can't get past the first 1000.
  const all = Array.from({ length: 1200 }, (_, i) => ({ sku: `S${i}`, summaries: [{ status: ['BUYABLE'], lastUpdatedDate: '2026-10-01T00:00:00Z' }] }));
  const base = fakeAmazon().fetchFn;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (!u.pathname.startsWith('/listings/')) return base(url, init);
    const hits = all.slice(0, 1000);
    const at = Number(u.searchParams.get('pageToken') ?? 0);
    return Response.json({ numberOfResults: hits.length, items: hits.slice(at, at + 20), ...(at + 20 < hits.length ? { pagination: { nextToken: String(at + 20) } } : {}) });
  }) as typeof fetch;
  await syncAmazon(db, key, 'peak', fetchFn, NOW);
  db.prepare("INSERT INTO products (store_id, id, title, price, cost, inventory, status) VALUES ('peak', 'amz-S1199', 'Live', 5, 0, 1, 'active')").run();
  await syncAmazon(db, key, 'peak', fetchFn, new Date('2026-10-27T18:00:00Z')); // the next day's full pass
  expect(db.prepare("SELECT status FROM products WHERE store_id = 'peak' AND id = 'amz-S1199'").get()?.status).toBe('active');
  const queries: (string | null)[] = [];
  await syncAmazon(db, key, 'peak', (async (url: string, init?: RequestInit) => {
    if (new URL(url).pathname.startsWith('/listings/')) queries.push(new URL(url).searchParams.get('lastUpdatedAfter'));
    return fetchFn(url, init);
  }) as typeof fetch, new Date('2026-10-27T18:10:00Z'));
  expect(queries[0]).not.toBeNull(); // the day's pass is done: back to changes only
  expect(db.prepare("SELECT count(*) AS n FROM products WHERE store_id = 'peak' AND id GLOB 'amz-*'").get()?.n).toBe(1001);
});

test('an approved Amazon price change merges our_price into the consumer offer and leaves the rest alone', async () => {
  const db = setup();
  db.prepare("UPDATE stores SET platform = 'amazon' WHERE id = 'peak'").run();
  db.prepare("INSERT INTO products (store_id, id, title, price, cost, inventory, status) VALUES ('peak', 'amz-MAT/1', 'Mat', 30, 10, 5, 'active')").run();
  let offer: Record<string, unknown> = { marketplace_id: 'ATVPDKIKX0DER', audience: 'ALL', currency: 'USD', our_price: [{ schedule: [{ value_with_tax: 30 }] }], minimum_seller_allowed_price: [{ schedule: [{ value_with_tax: 20 }] }] };
  const patches: unknown[] = [];
  const base = fakeAmazon().fetchFn;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (!u.pathname.startsWith('/listings/')) return base(url, init);
    expect(u.pathname).toBe('/listings/2021-08-01/items/A1SELLER/MAT%2F1');
    if (init?.method === 'PATCH') {
      patches.push(JSON.parse(String(init.body)));
      return Response.json({ sku: 'MAT/1', status: 'ACCEPTED', submissionId: 's1', issues: [] });
    }
    expect(u.searchParams.get('includedData')).toBe('summaries,attributes');
    return Response.json({ sku: 'MAT/1', summaries: [{ marketplaceId: 'ATVPDKIKX0DER', productType: 'YOGA_MAT' }], attributes: { purchasable_offer: [{ ...offer, audience: 'B2B' }, offer] } });
  }) as typeof fetch;

  await setAmazonListingPrice(db, key, 'peak', 'amz-MAT/1', { price: 27.5 }, fetchFn, NOW);
  expect(patches).toEqual([{
    productType: 'YOGA_MAT',
    patches: [{ op: 'merge', path: '/attributes/purchasable_offer', value: [{ marketplace_id: 'ATVPDKIKX0DER', currency: 'USD', audience: 'ALL', our_price: [{ schedule: [{ value_with_tax: 27.5 }] }] }] }],
  }]);
  expect(db.prepare("SELECT price, compare_at FROM products WHERE id = 'amz-MAT/1'").get()).toEqual({ price: 27.5, compare_at: null });
  expect(db.prepare("SELECT action, error FROM action_log WHERE store_id = 'peak'").all()).toEqual([{ action: 'price_change', error: null }]);

  // Refused before anything is sent: below the seller's minimum, a sale running, a compare-at price.
  await expect(setAmazonListingPrice(db, key, 'peak', 'amz-MAT/1', { price: 15 }, fetchFn, NOW)).rejects.toThrow('outside the 20–∞ price range');
  offer = { ...offer, discounted_price: [{ schedule: [{ value_with_tax: 25, start_at: '2026-10-01T00:00:00Z', end_at: '2026-11-30T00:00:00Z' }] }] };
  await expect(setAmazonListingPrice(db, key, 'peak', 'amz-MAT/1', { price: 26 }, fetchFn, NOW)).rejects.toThrow('sale price running');
  await expect(setAmazonListingPrice(db, key, 'peak', 'amz-MAT/1', { price: 26, compareAt: 35 }, fetchFn, NOW)).rejects.toThrow('no compare-at');
  expect(patches).toHaveLength(1);
  expect(db.prepare("SELECT price FROM products WHERE id = 'amz-MAT/1'").get()?.price).toBe(27.5);
});

test('an Amazon price change the API rejects says why', async () => {
  const db = setup();
  db.prepare("UPDATE stores SET platform = 'amazon' WHERE id = 'peak'").run();
  const base = fakeAmazon().fetchFn;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    if (!new URL(url).pathname.startsWith('/listings/')) return base(url, init);
    if (init?.method === 'PATCH') return Response.json({ sku: 'X', status: 'INVALID', issues: [{ code: '90220', message: "'our_price' is invalid", severity: 'ERROR' }] });
    return Response.json({ summaries: [{ productType: 'PRODUCT' }], attributes: { purchasable_offer: [{ marketplace_id: 'ATVPDKIKX0DER', currency: 'USD', our_price: [{ schedule: [{ value_with_tax: 9 }] }] }] } });
  }) as typeof fetch;
  await expect(setAmazonListingPrice(db, key, 'peak', 'amz-X', { price: 8 }, fetchFn, NOW)).rejects.toThrow("Amazon: 'our_price' is invalid");
});

test('FBA listings get their stock from the FBA Inventory API, and keep it when the listing alone is read again', async () => {
  const db = setup();
  db.prepare("UPDATE stores SET platform = 'amazon' WHERE id = 'peak'").run();
  const fbaQueries: URLSearchParams[] = [];
  let fbaUnits = 12;
  const base = fakeAmazon().fetchFn;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.pathname === '/fba/inventory/v1/summaries') {
      fbaQueries.push(u.searchParams);
      return Response.json({ payload: { granularity: {}, inventorySummaries: fbaUnits === 12 ? [
        { sellerSku: 'FBA-1', inventoryDetails: { fulfillableQuantity: fbaUnits } },
        { sellerSku: 'MFN-1', inventoryDetails: { fulfillableQuantity: 0 } }, // moved to merchant fulfilment; its listing's count stands
      ] : [] } });
    }
    if (u.pathname.startsWith('/listings/')) {
      return Response.json({ numberOfResults: 2, items: [
        { sku: 'FBA-1', summaries: [{ status: ['BUYABLE'] }], fulfillmentAvailability: [{ fulfillmentChannelCode: 'AMAZON_NA' }] },
        { sku: 'MFN-1', summaries: [{ status: ['BUYABLE'] }], fulfillmentAvailability: [{ fulfillmentChannelCode: 'DEFAULT', quantity: 3 }] },
      ] });
    }
    return base(url, init);
  }) as typeof fetch;
  const stock = () => db.prepare("SELECT id, inventory, inventory_tracked AS tracked FROM products WHERE store_id = 'peak' AND id GLOB 'amz-*' ORDER BY id").all();

  await syncAmazon(db, key, 'peak', fetchFn, NOW);
  expect(fbaQueries[0]!.get('details')).toBe('true');
  expect([fbaQueries[0]!.get('granularityType'), fbaQueries[0]!.get('granularityId'), fbaQueries[0]!.get('startDateTime')]).toEqual(['Marketplace', 'ATVPDKIKX0DER', null]);
  expect(stock()).toEqual([{ id: 'amz-FBA-1', inventory: 12, tracked: 1 }, { id: 'amz-MFN-1', inventory: 3, tracked: 1 }]);

  // Later the same day: the listing comes back changed but its FBA stock didn't move, so it keeps its 12.
  fbaUnits = 0;
  await syncAmazon(db, key, 'peak', fetchFn, NOW);
  expect(fbaQueries[1]!.get('startDateTime')).toBe('2026-10-24T00:00:00Z');
  expect(stock()).toEqual([{ id: 'amz-FBA-1', inventory: 12, tracked: 1 }, { id: 'amz-MFN-1', inventory: 3, tracked: 1 }]);
});

test('without the Amazon Fulfillment role, FBA listings stay "not tracked" and the sync goes on', async () => {
  const db = setup();
  db.prepare("UPDATE stores SET platform = 'amazon' WHERE id = 'peak'").run();
  const base = fakeAmazon().fetchFn;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.pathname === '/fba/inventory/v1/summaries') return Response.json({ errors: [{ code: 'Unauthorized', message: 'Access to requested resource is denied.' }] }, { status: 403 });
    if (u.pathname.startsWith('/listings/')) return Response.json({ numberOfResults: 1, items: [{ sku: 'FBA-1', summaries: [{ status: ['BUYABLE'] }], fulfillmentAvailability: [{ fulfillmentChannelCode: 'AMAZON_NA' }] }] });
    return base(url, init);
  }) as typeof fetch;
  await syncAmazon(db, key, 'peak', fetchFn, NOW);
  expect(db.prepare("SELECT status, error FROM integrations WHERE id = 'amazon:peak'").get()).toEqual({ status: 'connected', error: null });
  expect(db.prepare("SELECT inventory, inventory_tracked AS tracked FROM products WHERE id = 'amz-FBA-1'").get()).toEqual({ inventory: 0, tracked: 0 });
});

test("an Amazon store's daily sessions come from the Sales and Traffic report: asked for once a day, collected when ready", async () => {
  const db = setup();
  db.prepare("UPDATE stores SET platform = 'amazon' WHERE id = 'peak'").run();
  let status = 'IN_PROGRESS';
  const reportCalls: { call: string; body?: unknown; token: string | null }[] = [];
  const doc = gzipSync(JSON.stringify({ salesAndTrafficByDate: [
    { date: '2026-10-24', salesByDate: { unitsOrdered: 3 }, trafficByDate: { browserSessions: 100, mobileAppSessions: 20, sessions: 120 } },
    { date: '2026-10-25', trafficByDate: { sessions: 95 } },
  ] }));
  const base = fakeAmazon().fetchFn;
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    if (u.host === 'reports.s3.example.com') {
      reportCalls.push({ call: `GET ${u.pathname}`, token: new Headers(init.headers).get('x-amz-access-token') });
      return new Response(doc);
    }
    if (!u.pathname.startsWith('/reports/')) return base(url, init);
    reportCalls.push({ call: `${init.method ?? 'GET'} ${u.pathname}`, ...(init.body ? { body: JSON.parse(String(init.body)) } : {}), token: new Headers(init.headers).get('x-amz-access-token') });
    if (u.pathname === '/reports/2021-06-30/reports') return Response.json({ reportId: 'R1' }, { status: 202 });
    if (u.pathname === '/reports/2021-06-30/reports/R1') return Response.json({ reportId: 'R1', processingStatus: status, ...(status === 'DONE' ? { reportDocumentId: 'D1' } : {}) });
    return Response.json({ reportDocumentId: 'D1', url: 'https://reports.s3.example.com/D1?sig=x', compressionAlgorithm: 'GZIP' });
  }) as typeof fetch;
  const sessions = () => db.prepare("SELECT date, sessions FROM daily_metrics WHERE store_id = 'peak' AND sessions > 0 ORDER BY date").all();

  await syncAmazon(db, key, 'peak', fetchFn, NOW); // asks for two years
  await syncAmazon(db, key, 'peak', fetchFn, NOW); // not ready yet
  expect(sessions()).toEqual([]);
  status = 'DONE';
  await syncAmazon(db, key, 'peak', fetchFn, NOW); // collects it
  await syncAmazon(db, key, 'peak', fetchFn, NOW); // nothing more today
  expect(reportCalls).toEqual([
    { call: 'POST /reports/2021-06-30/reports', token: 'Atza|access', body: {
      reportType: 'GET_SALES_AND_TRAFFIC_REPORT', marketplaceIds: ['ATVPDKIKX0DER'], dataStartTime: '2024-10-27', dataEndTime: '2026-10-26',
      reportOptions: { dateGranularity: 'DAY', asinGranularity: 'PARENT' },
    } },
    { call: 'GET /reports/2021-06-30/reports/R1', token: 'Atza|access' },
    { call: 'GET /reports/2021-06-30/reports/R1', token: 'Atza|access' },
    { call: 'GET /reports/2021-06-30/documents/D1', token: 'Atza|access' },
    { call: 'GET /D1', token: null }, // the presigned link gets no token
  ]);
  expect(sessions()).toEqual([{ date: '2026-10-24', sessions: 120 }, { date: '2026-10-25', sessions: 95 }]);
  // Sales sync on top without touching them.
  expect(db.prepare("SELECT revenue, sessions FROM daily_metrics WHERE store_id = 'peak' AND date = '2026-10-25'").get()).toEqual({ revenue: 412.5, sessions: 95 });

  // The next day: the days since three before the last report.
  await syncAmazon(db, key, 'peak', fetchFn, new Date('2026-10-27T18:00:00Z'));
  expect(reportCalls.at(-1)).toMatchObject({ call: 'POST /reports/2021-06-30/reports', body: { dataStartTime: '2026-10-23', dataEndTime: '2026-10-27' } });
});

test("an Amazon store's orders fill the orders page and top products; revenue stays Amazon's daily totals", async () => {
  const db = setup();
  db.prepare("UPDATE stores SET platform = 'amazon' WHERE id = 'peak'").run();
  const queries: URLSearchParams[] = [];
  let limited = true;
  const order = (orderId: string, fulfillmentStatus: string, createdTime: string, extra: Record<string, unknown> = {}) => ({
    orderId, createdTime, lastUpdatedTime: createdTime, salesChannel: { marketplaceId: 'ATVPDKIKX0DER' },
    fulfillment: { fulfillmentStatus, fulfilledBy: 'MERCHANT' },
    proceeds: { grandTotal: { amount: '30.00', currencyCode: 'USD' } },
    orderItems: [{ orderItemId: '1', quantityOrdered: 2, product: { sellerSku: 'MUG-1', price: { unitPrice: { amount: '12.50', currencyCode: 'USD' } } } }],
    ...extra,
  });
  const base = fakeAmazon().fetchFn;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (u.pathname !== '/orders/2026-01-01/orders') return base(url, init);
    queries.push(u.searchParams);
    if (!u.searchParams.get('paginationToken')) {
      return Response.json({
        orders: [order('111-1', 'SHIPPED', '2026-10-25T15:00:00Z', { packages: [{ packageReferenceId: '1', trackingNumber: '1Z999' }] }), order('111-2', 'PENDING', '2026-10-26T15:00:00Z')],
        pagination: { nextToken: 'n2' }, lastUpdatedBefore: '2026-10-26T17:58:00Z',
      });
    }
    if (limited) return Response.json({ errors: [{ code: 'QuotaExceeded', message: 'You exceeded your quota for the requested resource.' }] }, { status: 429 });
    return Response.json({
      orders: [order('111-3', 'CANCELLED', '2026-10-26T16:00:00Z'), order('111-4', 'UNSHIPPED', '2026-10-26T17:00:00Z', { fulfillment: { fulfillmentStatus: 'UNSHIPPED', fulfilledBy: 'AMAZON' } })],
      lastUpdatedBefore: '2026-10-26T17:58:00Z',
    });
  }) as typeof fetch;
  const orders = () => db.prepare("SELECT id, local_date AS day, total, status, fulfillment_status AS f, supplier, tracking FROM orders WHERE store_id = 'peak' ORDER BY id").all();

  // The rate limit cuts the first read short after a page: what it got is in, and the next sync carries on from its page token.
  await syncAmazon(db, key, 'peak', fetchFn, NOW);
  expect([queries[0]!.get('lastUpdatedAfter'), queries[0]!.get('includedData'), queries[0]!.get('marketplaceIds')]).toEqual(['2026-09-26T18:00:00.000Z', 'PROCEEDS,FULFILLMENT,PACKAGES', 'ATVPDKIKX0DER']);
  expect(orders()).toEqual([{ id: 'amz-111-1', day: '2026-10-25', total: 30, status: 'paid', f: 'fulfilled', supplier: null, tracking: '1Z999' }]); // 111-2 isn't paid for yet
  limited = false;
  await syncAmazon(db, key, 'peak', fetchFn, NOW);
  expect([queries[2]!.get('paginationToken'), queries[2]!.get('lastUpdatedAfter')]).toEqual(['n2', '2026-09-26T18:00:00.000Z']);
  expect(orders()).toEqual([
    { id: 'amz-111-1', day: '2026-10-25', total: 30, status: 'paid', f: 'fulfilled', supplier: null, tracking: '1Z999' },
    { id: 'amz-111-3', day: '2026-10-26', total: 30, status: 'refunded', f: 'unfulfilled', supplier: null, tracking: null },
    { id: 'amz-111-4', day: '2026-10-26', total: 30, status: 'paid', f: 'unfulfilled', supplier: 'Amazon FBA', tracking: null },
  ]);
  expect(db.prepare("SELECT product_id, quantity, revenue FROM order_items WHERE store_id = 'peak' AND order_id = 'amz-111-1'").all()).toEqual([{ product_id: 'amz-MUG-1', quantity: 2, revenue: 25 }]);
  // Revenue and order counts are still Amazon's daily totals, not counted twice.
  expect(db.prepare("SELECT revenue, orders FROM daily_metrics WHERE store_id = 'peak' AND date = '2026-10-25'").get()).toEqual({ revenue: 412.5, orders: 9 });

  // The read is complete: the next one starts where Amazon said this one ended.
  await syncAmazon(db, key, 'peak', fetchFn, NOW);
  expect([queries[3]!.get('lastUpdatedAfter'), queries[3]!.get('paginationToken')]).toEqual(['2026-10-26T17:58:00Z', null]);
  // Reconnected (the cursor starts over): so does the read.
  db.prepare("UPDATE integrations SET cursor = NULL WHERE id = 'amazon:peak'").run();
  await syncAmazon(db, key, 'peak', fetchFn, NOW);
  expect(queries.at(-2)!.get('lastUpdatedAfter')).toBe('2026-09-26T18:00:00.000Z');
});
