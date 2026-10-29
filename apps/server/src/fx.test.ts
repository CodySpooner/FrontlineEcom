import { expect, test, vi } from 'vitest';
import type { AnalyticsSummary, CampaignStats, TopProduct } from '@frontline/shared';
import { topProducts } from './analytics';
import { createApp } from './app';
import { switchToReal } from './connectors/common';
import { openDb } from './db';
import { seedDemo } from './demo';
import { convertRate, fxFor, historicRate, parseEcb, refreshFx, startFxLoop } from './fx';
import { getSettings, updateSettings } from './settings';

const XML = `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope><Cube><Cube time='2026-10-23'>
  <Cube currency='USD' rate='1.25'/><Cube currency='GBP' rate='0.8'/></Cube></Cube></gesmes:Envelope>`;

const ecbOnly = (url: string) => url.includes('eurofxref-daily');

const fakeEcb = () => {
  const calls: string[] = [];
  const fetchFn = (async (url: string) => {
    calls.push(url);
    return new Response(XML);
  }) as typeof fetch;
  return { fetchFn, calls };
};

test('parseEcb reads the euro reference rates', () => {
  expect(parseEcb(XML)).toEqual({ date: '2026-10-23', rates: { EUR: 1, USD: 1.25, GBP: 0.8 } });
  expect(() => parseEcb('<html>maintenance</html>')).toThrow('unexpected response');
});

test("historicRate: each day's rate, a weekend or holiday at the last one published before it", async () => {
  const hist = `<gesmes:Envelope><Cube><Cube time="2026-10-26"><Cube currency="USD" rate="1.25"/><Cube currency="GBP" rate="0.8"/></Cube>
    <Cube time="2026-10-23"><Cube currency="USD" rate="1.2"/></Cube></Cube></gesmes:Envelope>`;
  const urls: string[] = [];
  const on = await historicRate('USD', 'EUR', (async (url: string) => (urls.push(url), new Response(hist))) as typeof fetch);
  expect(urls).toEqual(['https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml']);
  expect([on('2026-10-26'), on('2026-10-25'), on('2026-10-23')]).toEqual([1 / 1.25, 1 / 1.2, 1 / 1.2]); // Sunday → Friday
  expect(on('2026-10-01')).toBeUndefined(); // nothing in the week before
  expect((await historicRate('GBP', 'EUR', (async () => new Response(hist)) as typeof fetch))('2026-10-24')).toBeUndefined(); // no GBP that Friday
});

test("currencies the ECB doesn't publish come from a second daily feed; the ECB's own rates stay", async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  db.prepare("UPDATE stores SET currency = 'AED' WHERE id = 'glow'").run(); // e.g. a Dubai Shopify store
  const urls: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(url);
    if (ecbOnly(url)) return new Response(XML);
    if (url.includes('jsdelivr')) return new Response('', { status: 503 }); // first host down: the mirror answers
    return Response.json({ date: '2026-10-26', eur: { usd: 1.3, aed: 4.59, '1inch': 5, gbp: 'x' } });
  }) as typeof fetch;
  const { rates } = await refreshFx(db, fetchFn);
  expect(urls).toEqual([
    'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml',
    'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json',
    'https://latest.currency-api.pages.dev/v1/currencies/eur.json',
    'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml', // SA-53: the first refresh loads the ECB's history
  ]);
  expect(rates).toEqual({ EUR: 1, USD: 1.25, GBP: 0.8, AED: 4.59 }); // ECB's USD wins; non-codes and non-numbers dropped
  expect(fxFor(db, ['pawsome', 'glow']).unconverted).toEqual([]);
  expect(await convertRate(db, 'AED', 'USD', fetchFn)).toBeCloseTo(1.25 / 4.59);

  // Both hosts down: the ECB's rates alone, as before.
  const ecb = fakeEcb();
  expect((await refreshFx(db, ecb.fetchFn)).rates).toEqual({ EUR: 1, USD: 1.25, GBP: 0.8 });
});

test('the rates loop only fetches while a store needs converting', async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const ecb = fakeEcb();
  startFxLoop(db, ecb.fetchFn)();
  expect(ecb.calls).toHaveLength(0); // every store is USD, like the base currency

  db.prepare("UPDATE stores SET currency = 'EUR' WHERE id = 'glow'").run();
  startFxLoop(db, ecb.fetchFn)();
  await new Promise((r) => setTimeout(r, 0));
  expect(ecb.calls.filter(ecbOnly)).toEqual(['https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml']);
  startFxLoop(db, ecb.fetchFn)(); // fresh cache: no second fetch
  expect(ecb.calls.filter(ecbOnly)).toHaveLength(1);
});

test('multi-store analytics convert to the base currency; one store keeps its own', async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  db.prepare("UPDATE stores SET currency = 'EUR' WHERE id = 'glow'").run();
  const app = createApp(db);
  const get = async <T>(path: string) => (await (await app.request(path)).json()) as T;
  const summary = (stores: string) => get<AnalyticsSummary>(`/api/analytics/summary?range=7&stores=${stores}`);

  const glow = await summary('glow');
  const paw = await summary('pawsome');
  expect([glow.currency, paw.currency]).toEqual(['EUR', 'USD']);
  // No rates yet: the EUR store is left out and flagged rather than counted 1:1.
  const noRates = await summary('pawsome,glow');
  expect(noRates.totals.revenue).toBeCloseTo(paw.totals.revenue, 1);
  expect(noRates.unconverted).toEqual(['EUR']);
  expect((await get<CampaignStats[]>('/api/analytics/campaigns?range=7&stores=pawsome,glow')).every((x) => x.storeId === 'pawsome')).toBe(true);
  expect((await get<TopProduct[]>('/api/analytics/top-products?range=7&stores=pawsome,glow&limit=50')).every((x) => x.storeId === 'pawsome')).toBe(true);

  await refreshFx(db, fakeEcb().fetchFn);
  const both = await summary('pawsome,glow');
  expect(both.currency).toBe('USD');
  expect(both.unconverted).toBeUndefined();
  expect(both.totals.revenue).toBeCloseTo(paw.totals.revenue + glow.totals.revenue * 1.25, 0);
  expect(both.byStore.find((s) => s.storeId === 'glow')!.totals.adSpend).toBeCloseTo(glow.totals.adSpend * 1.25, 0);

  expect(updateSettings(db, { baseCurrency: 'gbp' })).toMatchObject({ baseCurrency: 'GBP' });
  const gbp = await summary('pawsome,glow');
  expect(gbp.currency).toBe('GBP');
  expect(gbp.totals.revenue).toBeCloseTo(paw.totals.revenue * 0.64 + glow.totals.revenue * 0.8, 0);
  expect((await summary('glow')).totals.revenue).toBe(glow.totals.revenue);

  const camps = await get<CampaignStats[]>('/api/analytics/campaigns?range=7&stores=glow');
  const campsGbp = await get<CampaignStats[]>('/api/analytics/campaigns?range=7&stores=pawsome,glow');
  const c = camps[0]!;
  expect(campsGbp.find((x) => x.id === c.id)).toMatchObject({ spend: expect.closeTo(c.spend * 0.8, 1), dailyBudget: expect.closeTo(c.dailyBudget * 0.8, 1) });
  const top = await get<TopProduct[]>('/api/analytics/top-products?range=7&stores=glow');
  const topGbp = await get<TopProduct[]>('/api/analytics/top-products?range=7&stores=pawsome,glow&limit=50');
  expect(topGbp.find((p) => p.productId === top[0]!.productId)!.revenue).toBeCloseTo(top[0]!.revenue * 0.8, 1);
  expect(fxFor(db, []).currency).toBe('GBP');
});

test('baseCurrency must be a 3-letter code', () => {
  const db = openDb();
  expect(getSettings(db).baseCurrency).toBe('USD');
  expect(updateSettings(db, { baseCurrency: 'dollars' })).toBe('baseCurrency must be a 3-letter ISO code');
  expect(updateSettings(db, { baseCurrency: 7 })).toBe('baseCurrency must be a 3-letter ISO code');
});

test('best sellers across currencies rank after conversion', async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  switchToReal(db, 'pawsome');
  switchToReal(db, 'glow');
  db.prepare("UPDATE stores SET currency = 'JPY' WHERE id = 'glow'").run();
  await refreshFx(db, (async () => new Response("<Cube time='2026-10-23'><Cube currency='USD' rate='1.25'/><Cube currency='JPY' rate='175'/></Cube>")) as unknown as typeof fetch);
  const order = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES (?, ?, '2026-10-25T12:00:00Z', ?, 'paid', 'unfulfilled', '2026-10-25')");
  const item = db.prepare('INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue) VALUES (?, ?, ?, 1, ?)');
  order.run('pawsome', 'o1', 5000);
  item.run('pawsome', 'o1', 'p1', 5000);
  order.run('glow', 'o2', 50000); // ¥50,000 ≈ $357
  item.run('glow', 'o2', 'g1', 50000);
  expect(topProducts(db, ['pawsome', 'glow'], '2026-10-20', '2026-10-26', 1).map((p) => [p.productId, p.revenue])).toEqual([['p1', 5000]]);
  expect(topProducts(db, ['pawsome', 'glow'], '2026-10-20', '2026-10-26', 2)[1]).toMatchObject({ productId: 'g1', revenue: 357.14 });
});

test('the rate loop notices a new currency within 10 minutes and waits an hour after a failed fetch', async () => {
  vi.useFakeTimers();
  try {
    const db = openDb();
    seedDemo(db, '2026-10-26');
    let fail = true;
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      return fail ? new Response('', { status: 503 }) : new Response(XML);
    }) as typeof fetch;
    const stop = startFxLoop(db, fetchFn);
    db.prepare("UPDATE stores SET currency = 'EUR' WHERE id = 'glow'").run(); // e.g. a Shopify sync
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls).toHaveLength(1);
    fail = false;
    await vi.advanceTimersByTimeAsync(50 * 60_000);
    expect(calls).toHaveLength(1); // an hour after the failure
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(calls.filter(ecbOnly)).toHaveLength(2);
    expect(fxFor(db, ['pawsome', 'glow']).unconverted).toEqual([]);
    stop();
  } finally {
    vi.useRealTimers();
  }
});

test('convertRate fetches rates when it has none (or day-old ones) and converts between any two published currencies', async () => {
  const db = openDb();
  const { fetchFn, calls } = fakeEcb();
  expect(await convertRate(db, 'USD', 'USD', fetchFn)).toBe(1);
  expect(calls).toHaveLength(0);
  expect(await convertRate(db, 'USD', 'GBP', fetchFn)).toBeCloseTo(0.64);
  expect(await convertRate(db, 'GBP', 'EUR', fetchFn)).toBe(1.25);
  expect(calls.filter(ecbOnly)).toHaveLength(1);
  expect(await convertRate(db, 'USD', 'VND', fetchFn)).toBeUndefined();
});
