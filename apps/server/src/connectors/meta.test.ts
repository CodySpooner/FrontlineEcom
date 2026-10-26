import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import type { AnalyticsSummary, Integration } from '@frontline/shared';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { adAccount, purchaseValue, syncMeta } from './meta';
import { syncShopify } from './shopify';

const key = randomBytes(32);
const TOKEN = 'EAAG_fixture_token';
const NOW = new Date('2026-10-26T18:00:00Z');

const insight = (campaign_id: string, date_start: string, spend: string, value: string) => ({
  campaign_id, campaign_name: `Campaign ${campaign_id}`, date_start, spend, impressions: '1000', clicks: '40',
  actions: [{ action_type: 'purchase', value: '3' }, { action_type: 'omni_purchase', value: '2' }],
  action_values: [{ action_type: 'omni_purchase', value }],
});

/** Fake Graph API: campaigns edge + insights edge (paged once), records requests. */
function fakeGraph(rows: ReturnType<typeof insight>[], error?: { status: number; body: unknown }) {
  const calls: { url: URL; auth: string | null }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({ url: u, auth: new Headers(init.headers).get('authorization') });
    if (error) return Response.json(error.body, { status: error.status });
    if (u.pathname.endsWith('/campaigns')) return Response.json({ data: [{ id: '201', name: 'Prospecting', effective_status: 'ACTIVE', daily_budget: '6000' }] });
    const page = u.searchParams.get('after');
    if (page) return Response.json({ data: rows.slice(1) });
    return Response.json({ data: rows.slice(0, 1), paging: rows.length > 1 ? { next: `${url}&after=p2` } : {} });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  saveIntegration(db, key, { kind: 'meta_ads', storeId: 'pawsome', values: { adAccountId: '1234567890', accessToken: TOKEN } });
  return { db, app: createApp(db, key) };
};

test('helpers: ad account ids and de-duplicated purchases', () => {
  expect(adAccount('act_123')).toBe('act_123');
  expect(adAccount(' 123 ')).toBe('act_123');
  expect(() => adAccount('my account')).toThrow('act_');
  expect(purchaseValue([{ action_type: 'purchase', value: '3' }, { action_type: 'omni_purchase', value: '2' }])).toBe(2);
  expect(purchaseValue([{ action_type: 'link_click', value: '9' }])).toBe(0);
  expect(purchaseValue(undefined)).toBe(0);
});

test('first sync backfills in chunks, stores campaigns + daily insights, feeds ad_spend', async () => {
  const { db } = setup();
  const { fetchFn, calls } = fakeGraph([insight('201', '2026-10-25', '60.00', '210.50'), insight('202', '2026-10-25', '15.00', '0'), insight('201', '2026-10-26', '58.00', '150')]);
  await syncMeta(db, key, 'pawsome', fetchFn, NOW);

  expect(calls.every((c) => c.auth === `Bearer ${TOKEN}` && !c.url.search.includes(TOKEN))).toBe(true);
  const ranges = calls.filter((c) => c.url.pathname.endsWith('/insights') && !c.url.searchParams.get('after')).map((c) => JSON.parse(c.url.searchParams.get('time_range')!));
  expect(ranges[0]).toEqual({ since: '2024-10-27', until: '2025-01-24' });
  expect(ranges.at(-1)!.until).toBe('2026-10-26');
  expect(ranges).toHaveLength(9);

  expect(db.prepare("SELECT id, name, status, daily_budget AS budget FROM campaigns WHERE store_id = 'pawsome' ORDER BY id").all().map((r) => ({ ...r }))).toEqual([
    { id: '201', name: 'Prospecting', status: 'active', budget: 60 },
    { id: '202', name: 'Campaign 202', status: 'archived', budget: 0 },
  ]);
  expect({ ...db.prepare("SELECT spend, revenue, purchases, clicks, impressions FROM campaign_daily WHERE campaign_id = '201' AND date = '2026-10-25'").get() }).toEqual({
    spend: 60, revenue: 210.5, purchases: 2, clicks: 40, impressions: 1000,
  });
  expect(db.prepare("SELECT date, ad_spend AS s FROM daily_metrics WHERE store_id = 'pawsome' ORDER BY date").all().map((r) => ({ ...r }))).toEqual([
    { date: '2026-10-25', s: 75 },
    { date: '2026-10-26', s: 58 },
  ]);
});

test('Meta spend and Shopify revenue land on the same days without overwriting each other', async () => {
  const { db, app } = setup();
  await syncMeta(db, key, 'pawsome', fakeGraph([insight('201', '2026-10-25', '50.00', '0')]).fetchFn, NOW);
  saveIntegration(db, key, { kind: 'shopify', storeId: 'pawsome', values: { shopDomain: 'pawsome.myshopify.com', accessToken: 'shpat_x' } });
  const shopify = (async (_url: string, init: RequestInit) => {
    const q = JSON.parse(String(init.body)).query as string;
    const page = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
    if (q.includes('shop {')) return Response.json({ data: { shop: { currencyCode: 'USD', ianaTimezone: 'America/Chicago' } } });
    if (q.includes('products(')) return Response.json({ data: { products: page([]) } });
    return Response.json({ data: { orders: page([{ name: '#1', createdAt: '2026-10-25T15:00:00Z', updatedAt: '2026-10-25T15:00:00Z', cancelledAt: null, test: false, displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED', currentTotalPriceSet: { shopMoney: { amount: '200.00' } }, fulfillments: [], lineItems: { nodes: [] } }]) } });
  }) as typeof fetch;
  await syncShopify(db, key, 'pawsome', shopify, NOW);
  await syncMeta(db, key, 'pawsome', fakeGraph([insight('201', '2026-10-25', '50.00', '0')]).fetchFn, NOW);
  expect({ ...db.prepare("SELECT revenue, ad_spend AS s, orders FROM daily_metrics WHERE store_id = 'pawsome' AND date = '2026-10-25'").get() }).toEqual({ revenue: 200, s: 50, orders: 1 });
  const s = (await (await app.request('/api/analytics/summary?stores=pawsome&range=7')).json()) as AnalyticsSummary;
  expect(s.totals).toMatchObject({ revenue: 200, adSpend: 50, roas: 4 });
});

test('second sync only re-pulls the attribution window', async () => {
  const { db } = setup();
  await syncMeta(db, key, 'pawsome', fakeGraph([]).fetchFn, NOW);
  const second = fakeGraph([]);
  await syncMeta(db, key, 'pawsome', second.fetchFn, new Date('2026-10-30T18:00:00Z'));
  const ranges = second.calls.filter((c) => c.url.pathname.endsWith('/insights')).map((c) => JSON.parse(c.url.searchParams.get('time_range')!));
  expect(ranges).toEqual([{ since: '2026-09-28', until: '2026-10-30' }]);
});

test('an expired token marks the integration as error and keeps demo data', async () => {
  const { db, app } = setup();
  await syncMeta(db, key, 'pawsome', fakeGraph([], { status: 400, body: { error: { message: 'Error validating access token', code: 190 } } }).fetchFn, NOW);
  const list = await (await app.request('/api/integrations?stores=pawsome')).text();
  expect(list).not.toContain(TOKEN);
  expect((JSON.parse(list) as Integration[])[0]).toMatchObject({ status: 'error', error: expect.stringContaining('rejected the access token') });
  expect(db.prepare("SELECT demo FROM stores WHERE id = 'pawsome'").get()?.demo).toBe(1);
});
