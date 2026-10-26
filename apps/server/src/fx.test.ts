import { expect, test } from 'vitest';
import type { AnalyticsSummary, CampaignStats, TopProduct } from '@frontline/shared';
import { createApp } from './app';
import { openDb } from './db';
import { seedDemo } from './demo';
import { fxFor, parseEcb, refreshFx, startFxLoop } from './fx';
import { getSettings, updateSettings } from './settings';

const XML = `<?xml version="1.0" encoding="UTF-8"?><gesmes:Envelope><Cube><Cube time='2026-10-23'>
  <Cube currency='USD' rate='1.25'/><Cube currency='GBP' rate='0.8'/></Cube></Cube></gesmes:Envelope>`;

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

test('the rates loop only fetches while a store needs converting', async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const ecb = fakeEcb();
  startFxLoop(db, ecb.fetchFn)();
  expect(ecb.calls).toHaveLength(0); // every store is USD, like the base currency

  db.prepare("UPDATE stores SET currency = 'EUR' WHERE id = 'glow'").run();
  startFxLoop(db, ecb.fetchFn)();
  await new Promise((r) => setTimeout(r, 0));
  expect(ecb.calls).toEqual(['https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml']);
  startFxLoop(db, ecb.fetchFn)(); // fresh cache: no second fetch
  expect(ecb.calls).toHaveLength(1);
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
  // No rates yet: counted 1:1 rather than failing.
  expect((await summary('pawsome,glow')).totals.revenue).toBeCloseTo(paw.totals.revenue + glow.totals.revenue, 1);

  await refreshFx(db, fakeEcb().fetchFn);
  const both = await summary('pawsome,glow');
  expect(both.currency).toBe('USD');
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
