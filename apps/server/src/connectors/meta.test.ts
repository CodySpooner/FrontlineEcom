import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import type { AnalyticsSummary, Integration } from '@frontline/shared';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { setCampaignBudget } from './ads';
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
function fakeGraph(rows: ReturnType<typeof insight>[], error?: { status: number; body: unknown }, currency = 'USD', zone = 'America/Chicago') {
  const calls: { url: URL; auth: string | null }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push({ url: u, auth: new Headers(init.headers).get('authorization') });
    if (error) return Response.json(error.body, { status: error.status });
    if (u.searchParams.get('fields') === 'currency,timezone_name') return Response.json({ id: 'act_1234567890', currency, timezone_name: zone });
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
    return Response.json({ data: { orders: page([{ name: '#1', createdAt: '2026-10-25T15:00:00Z', updatedAt: '2026-10-25T15:00:00Z', cancelledAt: null, test: false, displayFinancialStatus: 'PAID', displayFulfillmentStatus: 'UNFULFILLED', currentTotalPriceSet: { shopMoney: { amount: '200.00' } }, fulfillments: [], id: 'gid://shopify/Order/1', lineItems: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } }]) } });
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

test("a yen ad account's daily budget is synced in yen, not hundredths of one", async () => {
  const { db } = setup();
  db.prepare("UPDATE stores SET currency = 'JPY' WHERE id = 'pawsome'").run();
  await syncMeta(db, key, 'pawsome', fakeGraph([insight('201', '2026-10-26', '5800', '15000')], undefined, 'JPY').fetchFn, NOW);
  expect(db.prepare("SELECT daily_budget AS b FROM campaigns WHERE id = '201'").get()?.b).toBe(6000);
});

test('a USD ad account on a euro store: spend, purchase value and budgets are converted into euros', async () => {
  const { db } = setup();
  db.prepare("UPDATE stores SET currency = 'EUR' WHERE id = 'pawsome'").run();
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('fx', ?)").run(JSON.stringify({ date: '2026-10-26', fetchedAt: new Date().toISOString(), rates: { EUR: 1, USD: 1.25 } }));
  await syncMeta(db, key, 'pawsome', fakeGraph([insight('201', '2026-10-26', '60.00', '210.50')]).fetchFn, NOW);
  expect({ ...db.prepare("SELECT spend, revenue FROM campaign_daily WHERE campaign_id = '201' AND date = '2026-10-26'").get() }).toEqual({ spend: 48, revenue: 168.4 });
  expect(db.prepare("SELECT daily_budget AS b FROM campaigns WHERE id = '201'").get()?.b).toBe(48);
  expect(db.prepare("SELECT ad_spend AS s FROM daily_metrics WHERE store_id = 'pawsome' AND date = '2026-10-26'").get()?.s).toBe(48);
});

test("a first sync prices each backfilled day at that day's rate; later syncs use today's", async () => {
  const { db } = setup();
  db.prepare("UPDATE stores SET currency = 'EUR' WHERE id = 'pawsome'").run();
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('fx', ?)").run(JSON.stringify({ date: '2026-10-26', fetchedAt: new Date().toISOString(), rates: { EUR: 1, USD: 1.25 } }));
  const graph = fakeGraph([insight('201', '2026-10-01', '60.00', '120'), insight('201', '2026-10-26', '60.00', '120')]).fetchFn;
  const urls: string[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    urls.push(url);
    return url.includes('eurofxref-hist') ? new Response('<Cube time="2026-09-30"><Cube currency="USD" rate="1.2"/></Cube>') : graph(url, init);
  }) as typeof fetch;
  await syncMeta(db, key, 'pawsome', fetchFn, NOW);
  const spend = () => db.prepare("SELECT date, spend, revenue FROM campaign_daily WHERE campaign_id = '201' ORDER BY date").all().map((r) => ({ ...r }));
  expect(spend()).toEqual([
    { date: '2026-10-01', spend: 50, revenue: 100 }, // Sept 30's 1.20, the last published before it
    { date: '2026-10-26', spend: 48, revenue: 96 }, // no history for it: today's 1.25
  ]);
  expect(db.prepare("SELECT daily_budget AS b FROM campaigns WHERE id = '201'").get()?.b).toBe(48); // budgets are today's

  await syncMeta(db, key, 'pawsome', fetchFn, NOW);
  expect(urls.filter((u) => u.includes('eurofxref-hist'))).toHaveLength(1); // only the first sync reads the history
});

test("the integration says when the ad account's days run in another timezone than the store's", async () => {
  const { db, app } = setup();
  const meta = async () => (await (await app.request('/api/integrations?stores=pawsome')).json() as Integration[]).find((i) => i.kind === 'meta_ads')!;
  db.prepare("UPDATE stores SET timezone = 'Asia/Tokyo' WHERE id = 'pawsome'").run();
  await syncMeta(db, key, 'pawsome', fakeGraph([], undefined, 'USD', 'America/Phoenix').fetchFn, NOW); // neither has DST
  expect((await meta()).notice).toBe("Meta Ads reports its days in America/Phoenix, 16 h behind the store's Asia/Tokyo, so a day's ad spend covers other hours than its sales.");

  await syncMeta(db, key, 'pawsome', fakeGraph([], undefined, 'USD', 'Asia/Seoul').fetchFn, NOW); // another name, same clock
  expect((await meta()).notice).toBeUndefined();
});

test("pointing the store at another ad account drops the old account's campaigns and spend", async () => {
  const { db } = setup();
  await syncMeta(db, key, 'pawsome', fakeGraph([insight('201', '2026-10-25', '60.00', '210.50')]).fetchFn, NOW);
  saveIntegration(db, key, { kind: 'meta_ads', storeId: 'pawsome', values: { adAccountId: '999', accessToken: TOKEN } });
  const b = fakeGraph([insight('301', '2026-10-25', '20.00', '50')]).fetchFn;
  const accountB = (async (url: string, init: RequestInit) =>
    new URL(url).pathname.endsWith('/campaigns') ? Response.json({ data: [{ id: '301', name: 'Retargeting', effective_status: 'ACTIVE', daily_budget: '2000' }] }) : b(url, init)) as typeof fetch;
  await syncMeta(db, key, 'pawsome', accountB, NOW);

  expect(db.prepare("SELECT id FROM campaigns WHERE store_id = 'pawsome' AND network = 'meta'").all().map((r) => r.id)).toEqual(['301']);
  expect(db.prepare("SELECT ad_spend FROM daily_metrics WHERE store_id = 'pawsome' AND date = '2026-10-25'").get()?.ad_spend).toBe(20);
  await expect(setCampaignBudget(db, key, 'pawsome', 'meta', '201', 80, accountB)).rejects.toThrow('No meta campaign 201');

  await syncMeta(db, key, 'pawsome', accountB, NOW); // an incremental sync keeps campaigns that only age out of the window
  expect(db.prepare("SELECT count(*) AS n FROM campaigns WHERE store_id = 'pawsome' AND network = 'meta'").get()?.n).toBe(1);
});

test('a sync whose store switched currency or ad account while it read writes nothing: the next one reads afresh', async () => {
  for (const change of [
    (db: ReturnType<typeof openDb>) => db.prepare("UPDATE stores SET currency = 'EUR' WHERE id = 'pawsome'").run(),
    (db: ReturnType<typeof openDb>) => saveIntegration(db, key, { kind: 'meta_ads', storeId: 'pawsome', values: { adAccountId: '999', accessToken: TOKEN } }),
  ]) {
    const { db } = setup();
    db.prepare("UPDATE integrations SET cursor = '2026-10-20' WHERE id = 'meta_ads:pawsome'").run();
    const { fetchFn: graph } = fakeGraph([insight('201', '2026-10-25', '60.00', '210.50')]);
    const fetchFn = (async (url: string, init: RequestInit) => {
      if (new URL(url).pathname.endsWith('/insights')) change(db);
      return graph(url, init);
    }) as typeof fetch;
    await syncMeta(db, key, 'pawsome', fetchFn, NOW);
    expect(db.prepare("SELECT count(*) AS n FROM campaigns WHERE network = 'meta' AND id = '201'").get()?.n).toBe(0);
    expect(db.prepare("SELECT status FROM integrations WHERE id = 'meta_ads:pawsome'").get()?.status).toBe('connected');
  }
});

test("an ad account moved to another store takes its campaigns and spend along (the old store's days lose them)", async () => {
  const { db } = setup();
  const { fetchFn } = fakeGraph([insight('201', '2026-10-25', '60.00', '210.50')]);
  await syncMeta(db, key, 'pawsome', fetchFn, NOW);
  db.prepare("DELETE FROM integrations WHERE id = 'meta_ads:pawsome'").run();
  saveIntegration(db, key, { kind: 'meta_ads', storeId: 'glow', values: { adAccountId: '1234567890', accessToken: TOKEN } });
  await syncMeta(db, key, 'glow', fetchFn, NOW);
  const spend = (store: string) => db.prepare("SELECT ad_spend FROM daily_metrics WHERE store_id = ? AND date = '2026-10-25'").get(store)?.ad_spend;
  expect(db.prepare("SELECT store_id FROM campaigns WHERE network = 'meta' AND id = '201'").get()?.store_id).toBe('glow');
  expect([spend('glow'), spend('pawsome')]).toEqual([60, 0]);
});

test('a campaign the account stops listing (deleted on Meta) shows as archived with no budget', async () => {
  const { db } = setup();
  const { fetchFn: graph } = fakeGraph([insight('201', '2026-10-25', '60.00', '210.50')]);
  let listed = true;
  const fetchFn = (async (url: string, init: RequestInit) =>
    !listed && new URL(url).pathname.endsWith('/campaigns') ? Response.json({ data: [] }) : graph(url, init)) as typeof fetch;
  await syncMeta(db, key, 'pawsome', fetchFn, NOW);
  const campaign = () => db.prepare("SELECT status, daily_budget FROM campaigns WHERE network = 'meta' AND id = '201'").get();
  expect(campaign()).toEqual({ status: 'active', daily_budget: 60 });
  listed = false;
  await syncMeta(db, key, 'pawsome', fetchFn, NOW);
  expect(campaign()).toEqual({ status: 'archived', daily_budget: 0 });
});

test('a budget change needs a campaign with a daily budget of its own (not a lifetime one, nor one on its ad sets)', async () => {
  const { db } = setup();
  const { fetchFn } = fakeGraph([insight('201', '2026-10-25', '60.00', '210.50')]);
  await syncMeta(db, key, 'pawsome', fetchFn, NOW);
  db.prepare("UPDATE campaigns SET daily_budget = 0 WHERE network = 'meta' AND id = '201'").run();
  const writes = fakeGraph([]);
  await expect(setCampaignBudget(db, key, 'pawsome', 'meta', '201', 80, writes.fetchFn)).rejects.toThrow(/no daily budget/);
  expect(writes.calls).toHaveLength(0);
});

test("an ad account ahead of the computer is asked for its own today (its zone as the last sync saw it)", async () => {
  const { db } = setup();
  await syncMeta(db, key, 'pawsome', fakeGraph([], undefined, 'USD', 'Pacific/Kiritimati').fetchFn, NOW);
  const next = fakeGraph([], undefined, 'USD', 'Pacific/Kiritimati');
  // 11:00 UTC: still the 26th on any machine up to UTC+12, already the 27th in Kiritimati (UTC+14).
  await syncMeta(db, key, 'pawsome', next.fetchFn, new Date('2026-10-27T11:00:00Z'));
  const ranges = next.calls.filter((c) => c.url.pathname.endsWith('/insights')).map((c) => JSON.parse(c.url.searchParams.get('time_range')!));
  expect(ranges.at(-1).until).toBe('2026-10-28');
});
