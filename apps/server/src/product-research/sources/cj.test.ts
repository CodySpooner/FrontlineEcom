import { randomBytes } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { classifyCj, CjError, cjListPage, syncCj, usdCents } from '../../connectors/cj';
import { openDb, type Db } from '../../db';
import { saveIntegration } from '../../integrations';
import { enqueue, runJob } from '../jobs';
import { agingRange, cjAdapter, enrichCj, enrichPass } from './cj';
import doc from './fixtures/cj-doc-examples.json';

const key = randomBytes(32);
const NOW = new Date('2026-10-28T10:00:00.000Z');
type Reply = { status?: number; body: unknown; headers?: Record<string, string> };

/** A fake CJ answering from the doc-shaped fixtures; `over` replaces a path's answer. */
function fakeCj(over: Record<string, Reply | ((u: URL, body: string) => Reply)> = {}) {
  const calls: { path: string; url: URL; token: string | null; body: string }[] = [];
  const base: Record<string, Reply> = {
    '/authentication/getAccessToken': { body: doc.token },
    '/product/listV2': { body: doc.listV2 },
    '/product/query': { body: doc.query },
    '/product/stock/getInventoryByPid': { body: doc.inventory },
    '/logistic/freightCalculate': { body: doc.freight },
  };
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace('/api2.0/v1', '');
    const body = String(init.body ?? '');
    calls.push({ path, url: u, token: new Headers(init.headers).get('CJ-Access-Token'), body });
    const o = over[path];
    const r = typeof o === 'function' ? o(u, body) : (o ?? base[path] ?? { status: 404, body: { code: 1600101, message: 'Interface not found' } });
    return Response.json(r.body, { status: r.status ?? 200, headers: r.headers ?? {} });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const setup = () => {
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency) VALUES ('pawsome', 'Pawsome', 'shopify', 'pet', 'USD')`);
  saveIntegration(db, key, { kind: 'cj', values: { apiKey: 'CJ-KEY' } });
  return db;
};
const withFetch = (fetchFn: typeof fetch) => vi.spyOn(globalThis, 'fetch').mockImplementation(fetchFn);
afterEach(() => vi.restoreAllMocks());

test("CJ's money: a price CJ doesn't show (empty, a range, text) is unknown, never 0; delivery estimates are ranges", () => {
  expect([usdCents('3.42'), usdCents(3.1), usdCents(''), usdCents('2.47 -- 3.10'), usdCents(undefined), usdCents('n/a'), usdCents(-1)]).toEqual([342, 310, null, null, null, null, null]);
  expect([agingRange('6-10'), agingRange('7'), agingRange(''), agingRange('fast')]).toEqual([[6, 10], [7, 7], null, null]);
});

test("CJ's failures are classified from its documented codes: auth stops, quota waits for the day, a rate limit waits", () => {
  const cases: [number, number | undefined, string, string][] = [
    [200, 1600001, 'Invalid API key or access token.', 'auth'],
    [200, 1600005, 'APIkey is wrong', 'auth'],
    [200, 1600014, 'Your API access has been disabled.', 'auth'],
    [401, undefined, 'HTTP 401', 'auth'],
    [429, 1600200, 'Too much request', 'rate_limit'],
    [429, 429, 'Insufficient API points. Used today: 50000, Remaining: 0, Required: 10', 'quota'],
    [200, 16900500, 'Insufficient points, please check your daily points balance', 'quota'],
    [200, 1600201, 'Quota has been used up', 'quota'],
    [200, 1602001, 'Product not found', 'not_found'],
    [200, 1600300, 'Param error', 'request'],
    [200, 1600000, 'System busy', 'server'],
    [502, undefined, 'HTTP 502', 'server'],
  ];
  expect(cases.map(([s, c, m]) => classifyCj(s, c, m))).toEqual(cases.map((x) => x[3]));
});

test('discovery: a job pages through CJ for each query and stores listings with what CJ said, as CJ said it', async () => {
  const db = setup();
  const { fetchFn, calls } = fakeCj();
  withFetch(fetchFn);
  const job = enqueue(db, { kind: 'ingest', source: 'cj', storeId: 'pawsome', queries: ['pet grooming'] }, NOW);
  expect(await runJob(db, job, cjAdapter, { key, now: () => NOW })).toBe('done');
  expect(calls.map((c) => c.path)).toEqual(['/authentication/getAccessToken', '/product/listV2']);
  expect(Object.fromEntries(calls[1]!.url.searchParams)).toEqual({ keyWord: 'pet grooming', page: '1', size: '20' });
  expect(calls[1]!.token).toBe('doc-token');
  const rows = db.prepare(`SELECT source, source_ref, origin, title, category, image_ref, currency, store_id, transform_json FROM pr_listings ORDER BY source_ref`).all();
  expect(rows.map((r) => [r.source, r.source_ref, r.origin, r.title, r.category, r.currency, r.store_id])).toEqual([
    ['cj', '1418234567890', 'ingest', 'Silicone Dog Paw Cleaner Cup', 'Grooming', 'USD', null],
    ['cj', '1418234567891', 'ingest', 'Lick Mat Slow Feeder', 'Pet Supplies', 'USD', null],
  ]);
  expect(JSON.parse(String(rows[0]!.transform_json))).toMatchObject({ listPriceUsd: '3.42', listedNum: 812, moq: 1 });
  expect(JSON.parse(String(rows[1]!.transform_json))).toMatchObject({ listPriceUsd: '' }); // "price not shown", kept as sent
  expect(db.prepare('SELECT count(*) AS n FROM pr_offers').get()?.n).toBe(0); // a list price is not an offer
  expect(db.prepare(`SELECT purpose, ok FROM pr_calls ORDER BY id`).all().map((r) => `${r.purpose}:${r.ok}`)).toEqual(['token:1', 'ingestion:1']);
  expect(JSON.parse(String(db.prepare(`SELECT quota_json FROM pr_sources WHERE id = 'cj'`).get()!.quota_json))).toMatchObject({ pointsRemaining: 49900, pointsTotal: 50000 });
  expect(cjAdapter.access(db, key)).toBe('verified');

  db.exec(`INSERT INTO stores (id, name, platform, niche, niche_detail, currency) VALUES ('barkbox', 'Bark', 'shopify', 'pet', NULL, 'USD'), ('glow', 'Glow', 'shopify', 'other', 'Crystal Healing', 'GBP')`);
  db.exec(`INSERT INTO pr_store_profiles (store_id, keywords_json, updated_at) VALUES ('barkbox', '["Lick Mat"]', '${NOW.toISOString()}')`);
  expect(cjAdapter.plan!(db)).toEqual([
    { storeId: 'pawsome', queries: ['pet grooming', 'dog accessories', 'cat toys', 'pet feeding'] },
    { storeId: 'barkbox', queries: ['lick mat'] }, // the pet queries are already planned
    { storeId: 'glow', queries: ['crystal healing'] }, // a custom niche searches the owner's words
  ]);
});

test('a refused key stops CJ with no retry, and the integration screen still shows the sync error', async () => {
  const db = setup();
  const { fetchFn, calls } = fakeCj({ '/authentication/getAccessToken': { body: { code: 1600005, result: false, message: 'APIkey is wrong, please check and try again', data: null } } });
  withFetch(fetchFn);
  expect(await runJob(db, enqueue(db, { kind: 'ingest', source: 'cj', storeId: null, queries: ['pet grooming'] }, NOW), cjAdapter, { key, now: () => NOW })).toBe('stopped');
  expect({ ...db.prepare(`SELECT status, error_kind, last_error FROM pr_sources WHERE id = 'cj'`).get() }).toEqual({ status: 'stopped', error_kind: 'auth', last_error: 'CJ: APIkey is wrong, please check and try again' });
  expect(cjAdapter.access(db, key)).toBe('credentials_required');
  await syncCj(db, key, 'null', fetchFn, NOW, 0);
  expect(db.prepare(`SELECT status, error FROM integrations WHERE id = 'cj:global'`).get()?.error).toBe('CJ: APIkey is wrong, please check and try again');
  expect(calls.every((c) => c.path === '/authentication/getAccessToken')).toBe(true);
  await expect(cjListPage(openDb(), key, { keyWord: 'x', page: 1, size: 20 }, { purpose: 'search', fetchFn, gapMs: 0 })).rejects.toThrow(/not connected/); // no key: no call
});

test("a cached token CJ refuses is replaced once (CJ's recommended flow), never in a loop", async () => {
  const db = setup();
  let refuse = 2;
  const { fetchFn, calls } = fakeCj({ '/product/listV2': (_u) => (refuse-- > 0 ? { body: { code: 1600001, message: 'Invalid API key or access token.' } } : { body: doc.listV2 }) });
  await cjListPage(db, key, { keyWord: 'cup', page: 1, size: 20 }, { purpose: 'search', fetchFn, gapMs: 0 }).catch(() => undefined); // first token, refused list
  await cjListPage(db, key, { keyWord: 'cup', page: 1, size: 20 }, { purpose: 'search', fetchFn, gapMs: 0 }); // cached token refused → one new token
  expect(calls.map((c) => c.path)).toEqual(['/authentication/getAccessToken', '/product/listV2', '/product/listV2', '/authentication/getAccessToken', '/product/listV2']);
});

test('enrich: variants, stock per warehouse and freight become live offer rows for the cheapest variant in stock', async () => {
  const db = setup();
  const { fetchFn, calls } = fakeCj();
  withFetch(fetchFn);
  await runJob(db, enqueue(db, { kind: 'ingest', source: 'cj', storeId: null, queries: ['pet grooming'] }, NOW), cjAdapter, { key, now: () => NOW });
  const id = String(db.prepare(`SELECT id FROM pr_listings WHERE source_ref = '1418234567890'`).get()!.id);
  await enrichCj(db, key, id, 'US', { purpose: 'owner', fetchFn, gapMs: 0, now: NOW });
  expect(db.prepare('SELECT source_ref, sku, weight_g FROM pr_variants ORDER BY source_ref').all().map((r) => [r.source_ref, r.sku, r.weight_g])).toEqual([
    ['V-L-BLUE', 'CJPT104-L-BLUE', 220],
    ['V-M-GREY', 'CJPT104-M-GREY', 180],
  ]);
  // The out-of-stock variant is cheaper but isn't quoted; the US warehouse is asked first, then China.
  const freight = calls.filter((c) => c.path === '/logistic/freightCalculate').map((c) => JSON.parse(c.body));
  expect(freight).toEqual([
    { startCountryCode: 'US', endCountryCode: 'US', products: [{ quantity: 1, vid: 'V-M-GREY' }] },
    { startCountryCode: 'CN', endCountryCode: 'US', products: [{ quantity: 1, vid: 'V-M-GREY' }] },
  ]);
  const offers = db.prepare(`SELECT ships_from, method, unit_cost_minor, shipping_cost_minor, currency, delivery_days_min, delivery_days_max, moq, provenance, destination, quantity, checked_at FROM pr_offers ORDER BY ships_from DESC, method`).all();
  expect(offers.map((o) => [o.ships_from, o.method, o.unit_cost_minor, o.shipping_cost_minor, o.delivery_days_min, o.delivery_days_max])).toEqual([
    ['US', 'CJPacket Ordinary', 342, 410, 6, 10],
    ['US', 'USPS+', 342, 525, 2, 5],
    ['CN', 'CJPacket Ordinary', 342, 410, 6, 10],
    ['CN', 'USPS+', 342, 525, 2, 5],
  ]);
  expect(offers.every((o) => o.provenance === 'live' && o.currency === 'USD' && o.destination === 'US' && o.quantity === 1 && o.moq === 1 && o.checked_at === NOW.toISOString())).toBe(true);
});

test('enrich: no stock anywhere, or no method to the destination, is recorded as such (what makes it Not eligible)', async () => {
  const db = setup();
  const empty = { ...doc.inventory, data: { variantInventories: doc.inventory.data.variantInventories.map((v) => ({ ...v, inventory: v.inventory.map((w) => ({ ...w, totalInventory: 0 })) })) } };
  const { fetchFn, calls } = fakeCj({ '/product/stock/getInventoryByPid': { body: empty } });
  withFetch(fetchFn);
  await runJob(db, enqueue(db, { kind: 'ingest', source: 'cj', storeId: null, queries: ['pet grooming'] }, NOW), cjAdapter, { key, now: () => NOW });
  const id = String(db.prepare(`SELECT id FROM pr_listings WHERE source_ref = '1418234567890'`).get()!.id);
  await enrichCj(db, key, id, 'US', { purpose: 'owner', fetchFn, gapMs: 0, now: NOW });
  expect(calls.some((c) => c.path === '/logistic/freightCalculate')).toBe(false);
  expect({ ...db.prepare('SELECT method, shipping_cost_minor, restrictions FROM pr_offers').get() }).toEqual({ method: null, shipping_cost_minor: null, restrictions: 'Out of stock in every warehouse' });

  const db2 = setup();
  const f2 = fakeCj({ '/logistic/freightCalculate': { body: { code: 200, result: true, message: 'Success', data: [] } } });
  withFetch(f2.fetchFn);
  await runJob(db2, enqueue(db2, { kind: 'ingest', source: 'cj', storeId: null, queries: ['pet grooming'] }, NOW), cjAdapter, { key, now: () => NOW });
  await enrichCj(db2, key, String(db2.prepare(`SELECT id FROM pr_listings WHERE source_ref = '1418234567890'`).get()!.id), 'GB', { purpose: 'owner', fetchFn: f2.fetchFn, gapMs: 0, now: NOW });
  expect(db2.prepare('SELECT restrictions FROM pr_offers ORDER BY ships_from').all().map((r) => r.restrictions)).toEqual(['No shipping method from CN to GB', 'No shipping method from US to GB']);
});

test("the enrichment pass quotes each store's ship-to for new listings, marks removed products gone and stops on auth", async () => {
  const db = setup();
  const base = fakeCj();
  withFetch(base.fetchFn);
  await runJob(db, enqueue(db, { kind: 'ingest', source: 'cj', storeId: null, queries: ['pet grooming'] }, NOW), cjAdapter, { key, now: () => NOW });
  const gone = fakeCj({ '/product/query': (u) => (u.searchParams.get('pid') === '1418234567891' ? { body: { code: 1602001, message: 'Product not found' } } : { body: doc.query }) });
  vi.restoreAllMocks();
  withFetch(gone.fetchFn);
  await enrichPass(db, key, { gapMs: 0, now: NOW });
  expect(db.prepare(`SELECT source_ref, status FROM pr_listings ORDER BY source_ref`).all().map((r) => `${r.source_ref}:${r.status}`)).toEqual(['1418234567890:active', '1418234567891:gone']);
  expect(db.prepare(`SELECT DISTINCT destination FROM pr_offers`).all().map((r) => r.destination)).toEqual(['US']); // USD store → US
  const before = gone.calls.length;
  await enrichPass(db, key, { gapMs: 0, now: NOW }); // checked within 7 days: nothing to do
  expect(gone.calls.length).toBe(before);

  db.exec(`UPDATE pr_offers SET checked_at = '2026-10-01T00:00:00.000Z'`); // due again
  const refused = fakeCj({ '/product/query': { body: { code: 1600001, message: 'Invalid API key or access token.' } }, '/authentication/getAccessToken': { body: { code: 1600005, message: 'APIkey is wrong' } } });
  vi.restoreAllMocks();
  withFetch(refused.fetchFn);
  await enrichPass(db, key, { gapMs: 0, now: NOW });
  expect(refused.calls.filter((c) => c.path === '/product/query')).toHaveLength(1); // the first refusal ends the pass
  expect({ ...db.prepare(`SELECT status, error_kind FROM pr_sources WHERE id = 'cj'`).get() }).toEqual({ status: 'stopped', error_kind: 'auth' });
});

test('one lane for every CJ call: a waiting order sync goes before waiting ingestion calls', async () => {
  const db: Db = setup();
  const order: string[] = [];
  const { fetchFn } = fakeCj({ '/product/listV2': (u) => (order.push(`list:${u.searchParams.get('keyWord')}`), { body: doc.listV2 }) });
  vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
  try {
    const page = (q: string) => cjListPage(db, key, { keyWord: q, page: 1, size: 20 }, { purpose: 'ingestion', fetchFn, gapMs: 1000 });
    const a = page('first');
    await vi.advanceTimersByTimeAsync(0);
    const b = page('second');
    const sync = syncCj(db, key, 'null', (async (url: string, init?: RequestInit) => (order.push('order-sync'), fetchFn(url, init))) as typeof fetch, NOW, 1000);
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all([a, b, sync]);
  } finally {
    vi.useRealTimers();
  }
  expect(order.indexOf('order-sync')).toBeLessThan(order.indexOf('list:second'));
});

test('CJ errors keep their code and class for the job runner', () => {
  const e = new CjError('auth', 'Invalid API key or access token.', 1600001);
  expect([e.kind, e.code, e.message]).toEqual(['auth', 1600001, 'CJ: Invalid API key or access token.']);
});
