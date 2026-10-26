import { expect, test } from 'vitest';
import type { Competitor, CompetitorSnapshot, PriceChange } from '@frontline/shared';
import { createApp } from './app';
import { addSnapshot, seedCompetitors } from './competitors';
import { openDb } from './db';
import { seedDemo } from './demo';

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
  addSnapshot(db, 'c1', { kind: 'price', data: { product: 'Bands', price: 25 } }, '2026-10-20T00:00:00Z');
  expect(await get<PriceChange[]>(app, '/api/competitors/price-changes?stores=peak')).toEqual([
    { competitorId: 'c1', storeId: 'peak', product: 'Bands', from: 20, to: 25, changePct: 25, at: '2026-10-20T00:00:00Z' },
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
  for (const body of [{ storeId: 'nope', name: 'X', url: 'https://x.example' }, { storeId: 'glow', name: '', url: 'https://x.example' }, { storeId: 'glow', name: 'X', url: 'javascript:alert(1)' }]) {
    expect((await app.request('/api/competitors', send('POST', body))).status, JSON.stringify(body)).toBe(400);
  }
  const c = (await (await app.request('/api/competitors', send('POST', { storeId: 'glow', name: 'X', url: 'https://x.example', notes: 'Main rival' }))).json()) as Competitor;
  expect(c).toMatchObject({ storeId: 'glow', name: 'X', notes: 'Main rival', productsTracked: 0, activeAds: 0 });
  for (const body of [{ kind: 'price', data: { product: 'A', price: -1 } }, { kind: 'ad', data: { network: 'myspace' } }, { kind: 'tweet', data: {} }, { kind: 'ad', data: { network: 'meta', format: 'image', headline: 'H', body: 'B', firstSeen: 'yesterday', lastSeen: '2026-10-01' } }]) {
    expect((await app.request(`/api/competitors/${c.id}/snapshots`, send('POST', body))).status, JSON.stringify(body)).toBe(400);
  }
  expect((await app.request('/api/competitors/nope/snapshots')).status).toBe(404);
  expect((await app.request(`/api/competitors/${c.id}`, { method: 'DELETE' })).status).toBe(204);
  expect((await app.request(`/api/competitors/${c.id}`, { method: 'DELETE' })).status).toBe(404);
});
