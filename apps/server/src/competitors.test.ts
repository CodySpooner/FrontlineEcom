import { randomBytes } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import type { Competitor, CompetitorSnapshot, PriceChange } from '@frontline/shared';
import { createApp } from './app';
import { addSnapshot, priceChanges, publicFetch, seedCompetitors, startCompetitorWatch, watchCompetitorPrices } from './competitors';
import { openDb } from './db';
import { seedDemo } from './demo';
import { saveIntegration } from './integrations';

const TODAY = '2026-10-26';
const setup = () => {
  const db = openDb();
  seedDemo(db, TODAY);
  db.prepare("INSERT INTO competitors (id, store_id, name, url, created_at) VALUES ('c1', 'peak', 'X', 'https://x.example', '2026-10-01')").run();
  return { db, app: createApp(db) };
};
const send = (method: string, body?: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const get = async <T>(app: ReturnType<typeof createApp>, path: string) => (await (await app.request(path)).json()) as T;

test('demo competitors per store with tracked products and price history', async () => {
  const db = openDb();
  seedDemo(db, TODAY);
  seedCompetitors(db, TODAY);
  seedCompetitors(db, TODAY); // idempotent
  const app = createApp(db);
  const glow = await get<Competitor[]>(app, '/api/competitors?stores=glow');
  expect(glow.map((c) => [c.name, c.productsTracked])).toEqual([['Lumi Skin Lab', 3], ['DermaGlow Direct', 2]]);
  expect(glow[0]!.url).toBe('https://lumiskinlab.example');
  expect((await get<Competitor[]>(app, '/api/competitors')).length).toBe(6);
  const prices = await get<CompetitorSnapshot[]>(app, `/api/competitors/${glow[0]!.id}/snapshots?kind=price&limit=200`);
  expect(prices).toHaveLength(27);
  expect(prices.every((s) => s.kind === 'price')).toBe(true);
});

test('price changes come from consecutive snapshots of the same product, newest first', async () => {
  const { db, app } = setup();
  addSnapshot(db, 'c1', { kind: 'price', data: { product: 'Rope', price: 40 } }, '2026-10-01T00:00:00Z');
  addSnapshot(db, 'c1', { kind: 'price', data: { product: 'Rope', price: 40 } }, '2026-10-08T00:00:00Z');
  addSnapshot(db, 'c1', { kind: 'price', data: { product: 'Rope', price: 30 } }, '2026-10-15T00:00:00Z');
  addSnapshot(db, 'c1', { kind: 'price', data: { product: 'Bands', price: 20 } }, '2026-10-02T00:00:00Z');
  addSnapshot(db, 'c1', { kind: 'price', data: { product: 'Bands', price: 25, currency: 'GBP' } }, '2026-10-20T00:00:00Z');
  expect(await get<PriceChange[]>(app, '/api/competitors/price-changes?stores=peak')).toEqual([
    { competitorId: 'c1', storeId: 'peak', product: 'Bands', from: 20, to: 25, changePct: 25, at: '2026-10-20T00:00:00Z', currency: 'GBP' }, // the competitor's own
    { competitorId: 'c1', storeId: 'peak', product: 'Rope', from: 40, to: 30, changePct: -25, at: '2026-10-15T00:00:00Z' },
  ]);
  expect(await get<PriceChange[]>(app, '/api/competitors/price-changes?stores=glow')).toEqual([]);
});

test('ads count as active when seen in the last 3 days', async () => {
  const { app } = setup();
  const ad = (lastSeen: string) => ({ network: 'meta', format: 'video', headline: 'H', body: 'B', firstSeen: '2026-10-01', lastSeen });
  expect((await app.request('/api/competitors/c1/snapshots', send('POST', { kind: 'ad', data: ad('2099-01-01') }))).status).toBe(201);
  expect((await app.request('/api/competitors/c1/snapshots', send('POST', { kind: 'ad', data: ad('2000-01-01') }))).status).toBe(201);
  expect((await get<Competitor[]>(app, '/api/competitors?stores=peak'))[0]!.activeAds).toBe(1);
  const ads = await get<CompetitorSnapshot[]>(app, '/api/competitors/c1/snapshots?kind=ad');
  expect(ads.map((a) => a.kind === 'ad' && a.data.lastSeen)).toEqual(['2000-01-01', '2099-01-01']);
});

test('validation and 404s', async () => {
  const { app } = setup();
  const local = ['http://localhost:8787', 'http://192.168.1.1', 'http://0x7f000001', 'http://[::1]', 'http://router', 'http://nas.local'].map((url) => ({ storeId: 'glow', name: 'X', url }));
  for (const body of [{ storeId: 'nope', name: 'X', url: 'https://x.example' }, { storeId: 'glow', name: '', url: 'https://x.example' }, { storeId: 'glow', name: 'X', url: 'javascript:alert(1)' }, ...local]) {
    expect((await app.request('/api/competitors', send('POST', body))).status, JSON.stringify(body)).toBe(400);
  }
  const c = (await (await app.request('/api/competitors', send('POST', { storeId: 'glow', name: 'X', url: 'https://x.example', notes: 'Main rival' }))).json()) as Competitor;
  expect(c).toMatchObject({ storeId: 'glow', name: 'X', notes: 'Main rival', productsTracked: 0, activeAds: 0 });
  for (const body of [{ kind: 'price', data: { product: 'A', price: -1 } }, { kind: 'price', data: { product: 'A', price: 5, currency: 'usd' } }, { kind: 'ad', data: { network: 'myspace' } }, { kind: 'tweet', data: {} }, { kind: 'ad', data: { network: 'meta', format: 'image', headline: 'H', body: 'B', firstSeen: 'yesterday', lastSeen: '2026-10-01' } }]) {
    expect((await app.request(`/api/competitors/${c.id}/snapshots`, send('POST', body))).status, JSON.stringify(body)).toBe(400);
  }
  expect((await app.request('/api/competitors/nope/snapshots')).status).toBe(404);
  expect((await app.request(`/api/competitors/${c.id}`, { method: 'DELETE' })).status).toBe(204);
  expect((await app.request(`/api/competitors/${c.id}`, { method: 'DELETE' })).status).toBe(404);
});

test("a Shopify competitor's catalog becomes price snapshots, recorded again only when a price moves", async () => {
  const db = openDb();
  seedDemo(db, TODAY);
  db.prepare("INSERT INTO competitors (id, store_id, name, url, created_at) VALUES ('rival', 'glow', 'Rival', 'https://rival.com/collections/all', '2026-10-01T00:00:00Z')").run();
  let catalog = [
    { title: 'LED Mask', variants: [{ price: '89.00', compare_at_price: '129.00' }, { price: '79.00', compare_at_price: null }] },
    { title: 'Ice Roller', variants: [{ price: '24.00', compare_at_price: '20.00' }] },
    { title: 'Gift Card', variants: [{ price: '0.00', compare_at_price: null }] },
  ];
  const urls: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(url);
    return url.endsWith('/meta.json') ? Response.json({ name: 'Rival', currency: 'EUR' }) : Response.json({ products: catalog });
  }) as typeof fetch;
  const latest = () => db.prepare("SELECT data_json FROM competitor_snapshots WHERE competitor_id = 'rival' ORDER BY captured_at, rowid").all().map((r) => JSON.parse(String(r.data_json)));

  expect(await watchCompetitorPrices(db, 'rival', 'https://rival.com/collections/all', fetchFn, new Date('2026-10-25T09:00:00Z'))).toBe(2);
  expect(urls).toEqual(['https://rival.com/products.json?limit=250&page=1', 'https://rival.com/meta.json']); // the shop's currency
  expect(latest()).toEqual([{ product: 'LED Mask', price: 79, currency: 'EUR' }, { product: 'Ice Roller', price: 24, currency: 'EUR' }]);

  expect(await watchCompetitorPrices(db, 'rival', 'https://rival.com', fetchFn, new Date('2026-10-26T09:00:00Z'))).toBe(0);
  catalog = [{ ...catalog[0]!, variants: [{ price: '69.00', compare_at_price: '99.00' }] }, catalog[1]!];
  expect(await watchCompetitorPrices(db, 'rival', 'https://rival.com', fetchFn, new Date('2026-10-26T10:00:00Z'))).toBe(1);
  expect(latest().at(-1)).toEqual({ product: 'LED Mask', price: 69, compareAt: 99, currency: 'EUR' });
  expect(priceChanges(db, ['glow'], 50).find((c) => c.competitorId === 'rival')).toMatchObject({ product: 'LED Mask', from: 79, to: 69, currency: 'EUR' });

  const html = (async () => new Response('<html>Wix site</html>', { headers: { 'content-type': 'text/html' } })) as unknown as typeof fetch;
  expect(await watchCompetitorPrices(db, 'rival', 'https://rival.com', html)).toBeUndefined();
});

test('the watch checks each real competitor once a day and never the demo .example ones, nor one on this computer or network', async () => {
  vi.useFakeTimers({ now: new Date('2026-10-26T10:00:00') });
  try {
    const db = openDb();
    seedDemo(db, TODAY);
    seedCompetitors(db, TODAY);
    db.prepare("INSERT INTO competitors (id, store_id, name, url, created_at) VALUES ('rival', 'glow', 'Rival', 'https://rival.com', '2026-10-01T00:00:00Z')").run();
    db.prepare("INSERT INTO competitors (id, store_id, name, url, created_at) VALUES ('lan', 'glow', 'Router', 'http://192.168.1.1', '2026-10-01T00:00:00Z')").run(); // saved before AGT-235
    const urls: string[] = [];
    const fetchFn = (async (url: string) => {
      urls.push(url);
      return Response.json({ products: [] });
    }) as typeof fetch;
    const stop = startCompetitorWatch(db, undefined, fetchFn, 3_600_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(urls).toEqual(['https://rival.com/products.json?limit=250&page=1']);
    await vi.advanceTimersByTimeAsync(3 * 3_600_000);
    expect(urls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(12 * 3_600_000); // the next day
    expect(urls).toHaveLength(2);
    stop();
  } finally {
    vi.useRealTimers();
  }
});

test('a shop that redirects to an address on this computer or network is not followed there; a public redirect is', async () => {
  const db = openDb();
  seedDemo(db, TODAY);
  db.prepare("INSERT INTO competitors (id, store_id, name, url, created_at) VALUES ('c', 'glow', 'C', 'https://evil.com', '2026-10-01T00:00:00Z')").run();
  const urls: string[] = [];
  // Follows redirects as fetch does, unless told 'manual'.
  const fetchFn = (async function f(url: string, init?: RequestInit): Promise<Response> {
    urls.push(url);
    const to = url.startsWith('https://evil.com/') ? 'http://127.0.0.1:8787/api/settings' : url.startsWith('https://old-rival.com/') ? url.replace('old-rival.com', 'rival.com') : undefined;
    if (to) return init?.redirect === 'manual' ? new Response(null, { status: 302, headers: { location: to } }) : f(to, init);
    return Response.json(url.includes('/products.json') ? { products: [{ title: 'LED Mask', variants: [{ price: '89.00' }] }] } : {});
  }) as typeof fetch;
  await expect(watchCompetitorPrices(db, 'c', 'https://evil.com', fetchFn)).rejects.toThrow(/127\.0\.0\.1/);
  expect(urls.filter((u) => u.includes('127.0.0.1'))).toEqual([]);
  expect(await watchCompetitorPrices(db, 'c', 'https://old-rival.com', fetchFn)).toBe(1);
});

test("the watch's fetch refuses a public-looking name that points at this computer or its network", async () => {
  const fetched: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => (fetched.push(url), Response.json({})));
  try {
    const answers: Record<string, { address: string; family: number }[]> = {
      'localtest.me': [{ address: '127.0.0.1', family: 4 }],
      'lan.nip.io': [{ address: '93.184.216.34', family: 4 }, { address: '192.168.1.1', family: 4 }],
      'v6.test': [{ address: '::1', family: 6 }],
      'mapped.test': [{ address: '::ffff:127.0.0.1', family: 6 }],
      'tailnet.test': [{ address: '100.101.102.103', family: 4 }],
      'shop.com': [{ address: '93.184.216.34', family: 4 }, { address: '2606:2800:220:1::1', family: 6 }],
    };
    const f = publicFetch(async (h) => answers[h] ?? Promise.reject(new Error('ENOTFOUND')));
    for (const h of ['localtest.me', 'lan.nip.io', 'v6.test', 'mapped.test', 'tailnet.test']) await expect(f(`http://${h}/products.json`), h).rejects.toThrow(/this computer or its network/);
    expect(fetched).toEqual([]);
    await f('https://shop.com/products.json');
    await f('https://unresolved.example/products.json'); // fetch reports its own error
    expect(fetched).toEqual(['https://shop.com/products.json', 'https://unresolved.example/products.json']);
  } finally {
    vi.unstubAllGlobals();
  }
});

test("a WooCommerce competitor's prices come from its public Store API (minor units, HTML-escaped names)", async () => {
  const db = openDb();
  seedDemo(db, TODAY);
  db.prepare("INSERT INTO competitors (id, store_id, name, url, created_at) VALUES ('woo', 'glow', 'Woo Rival', 'https://woo-rival.com/shop', '2026-10-01T00:00:00Z')").run();
  const urls: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(url);
    if (url.includes('/products.json')) return new Response('<html>Not found</html>', { status: 404 });
    return Response.json([
      { name: 'Jade Roller &amp; Gua Sha', prices: { price: '1999', regular_price: '2999', currency_minor_unit: 2, currency_code: 'GBP' } },
      { name: 'Free Sample', prices: { price: '0', regular_price: '0', currency_minor_unit: 2 } },
      { name: 'Face Mist &#9999999;', prices: { price: '1450', regular_price: '1450', currency_minor_unit: 2, currency_code: 'GBP' } },
    ]);
  }) as typeof fetch;
  expect(await watchCompetitorPrices(db, 'woo', 'https://woo-rival.com/shop', fetchFn, new Date('2026-10-25T09:00:00Z'))).toBe(2);
  expect(urls).toEqual(['https://woo-rival.com/products.json?limit=250&page=1', 'https://woo-rival.com/wp-json/wc/store/v1/products?per_page=100&page=1']);
  expect(db.prepare("SELECT data_json FROM competitor_snapshots WHERE competitor_id = 'woo' ORDER BY rowid").all().map((r) => JSON.parse(String(r.data_json)))).toEqual([
    { product: 'Jade Roller & Gua Sha', price: 19.99, compareAt: 29.99, currency: 'GBP' },
    { product: 'Face Mist \ufffd', price: 14.5, currency: 'GBP' },
  ]);
});

test("an Etsy competitor's prices come from the Etsy Open API, with a connected Etsy store's app key", async () => {
  const db = openDb();
  seedDemo(db, TODAY);
  const key = randomBytes(32);
  db.prepare("INSERT INTO competitors (id, store_id, name, url, created_at) VALUES ('etsy', 'pawsome', 'Etsy Rival', 'https://www.etsy.com/uk/shop/RivalCrafts?ref=shop_sugg', '2026-10-01T00:00:00Z')").run();
  const calls: { url: string; apiKey: string | null }[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, apiKey: new Headers(init?.headers).get('x-api-key') });
    if (url.includes('/shops?')) return Response.json({ count: 2, results: [{ shop_id: 5, shop_name: 'RivalCraftsCo' }, { shop_id: 7, shop_name: 'rivalcrafts' }] });
    return Response.json({ count: 2, results: [
      { title: 'Mom&#39;s Mug', price: { amount: 1999, divisor: 100, currency_code: 'USD' } },
      { title: 'Name Sign', price: { amount: 45, divisor: 1, currency_code: 'USD' } },
    ] });
  }) as typeof fetch;

  // No Etsy store connected: there's no key to read Etsy with, so nothing is fetched.
  expect(await watchCompetitorPrices(db, 'etsy', 'https://www.etsy.com/uk/shop/RivalCrafts?ref=shop_sugg', fetchFn, new Date('2026-10-25T09:00:00Z'), key)).toBeUndefined();
  expect(calls).toEqual([]);

  saveIntegration(db, key, { kind: 'etsy', storeId: 'pawsome', values: { shopId: '4455', apiKey: 'keystr', sharedSecret: 'shh', accessToken: '123.at', refreshToken: '123.rt' } });
  expect(await watchCompetitorPrices(db, 'etsy', 'https://www.etsy.com/uk/shop/RivalCrafts?ref=shop_sugg', fetchFn, new Date('2026-10-25T09:00:00Z'), key)).toBe(2);
  expect(calls).toEqual([
    { url: 'https://openapi.etsy.com/v3/application/shops?shop_name=RivalCrafts', apiKey: 'keystr:shh' },
    { url: 'https://openapi.etsy.com/v3/application/shops/7/listings/active?limit=100&offset=0', apiKey: 'keystr:shh' },
  ]);
  expect(db.prepare("SELECT data_json FROM competitor_snapshots WHERE competitor_id = 'etsy' ORDER BY rowid").all().map((r) => JSON.parse(String(r.data_json)))).toEqual([
    { product: "Mom's Mug", price: 19.99, currency: 'USD' },
    { product: 'Name Sign', price: 45, currency: 'USD' },
  ]);
});
