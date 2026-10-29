import { expect, test, vi } from 'vitest';
import type { Agent, AnalyticsSummary, Order, Page, Product, Store, TopProduct } from '@frontline/shared';
import { createApp } from './app';
import { openDb } from './db';
import { seedDemo } from './demo';
import { deleteStore } from './stores';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const setup = () => {
  const db = openDb();
  seedDemo(db);
  return { db, app: createApp(db) };
};
const send = (method: string, body: unknown) => ({ method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
/** PATCH /api/stores/:id sends the version it read (settings ST-08a). */
const patch = async (app: ReturnType<typeof createApp>, id: string, body: object) =>
  app.request(`/api/stores/${id}`, send('PATCH', { version: ((await (await app.request(`/api/stores/${id}`)).json()) as Store).version ?? 0, ...body }));

test("a store made after one was deleted never takes its id, so it starts clear of the old one's sync history", async () => {
  const { app } = setup();
  const make = async () => ((await (await app.request('/api/stores', send('POST', { name: 'Volt Lab', platform: 'shopify', niche: 'tech' }))).json()) as Store).id;
  expect(await make()).toBe('volt-lab');
  await app.request('/api/stores/volt-lab', { method: 'DELETE' });
  expect(await make()).toBe('volt-lab-2');
  await app.request('/api/stores/peak', { method: 'DELETE' }); // a showcase store too
  expect(((await (await app.request('/api/stores', send('POST', { name: 'Peak', platform: 'shopify', niche: 'fitness' }))).json()) as Store).id).toBe('peak-2');
});

test('create → get → update → delete a store', async () => {
  const { app } = setup();
  const res = await app.request('/api/stores', send('POST', { name: 'Glow Haus', platform: 'etsy', niche: 'beauty', nicheDetail: 'K-beauty' }));
  expect(res.status).toBe(201);
  const store = (await res.json()) as Store;
  expect(store).toEqual({ id: 'glow-haus', name: 'Glow Haus', platform: 'etsy', niche: 'beauty', nicheDetail: 'K-beauty', currency: 'USD', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, color: '#ff2a3a', connected: false, version: 1 });
  const squad = (await (await app.request('/api/agents?stores=glow-haus')).json()) as Agent[];
  expect(squad).toHaveLength(8);

  const dup = (await (await app.request('/api/stores', send('POST', { name: 'Glow Haus', platform: 'etsy', niche: 'beauty' }))).json()) as Store;
  expect(dup.id).toBe('glow-haus-2');

  expect(await (await app.request('/api/stores/glow-haus')).json()).toEqual(store);
  const upd = await patch(app, 'glow-haus', { name: 'Glow Haus EU', color: '#00ff88' });
  expect(await upd.json()).toMatchObject({ id: 'glow-haus', name: 'Glow Haus EU', color: '#00ff88', platform: 'etsy' });

  expect((await app.request('/api/stores/glow-haus', { method: 'DELETE' })).status).toBe(204);
  expect((await app.request('/api/stores/glow-haus')).status).toBe(404);
  expect((await app.request('/api/stores/glow-haus', { method: 'DELETE' })).status).toBe(404);
});

test('a new store starts in demo mode with analytics history', async () => {
  const { app } = setup();
  await app.request('/api/stores', send('POST', { name: 'Volt Lab', platform: 'shopify', niche: 'tech' }));
  const s = (await (await app.request('/api/analytics/summary?stores=volt-lab&range=7')).json()) as AnalyticsSummary;
  expect(s.totals.revenue).toBeGreaterThan(0);
  expect(s.series.slice(0, -1).every((p) => p.orders > 0)).toBe(true);
  expect(s.series.at(-1)!.orders).toBeGreaterThanOrEqual(0); // Today's partial day can be empty just after midnight.
});

test('invalid store bodies are rejected with a message', async () => {
  const { app } = setup();
  const bad = [
    {},
    { name: '', platform: 'shopify', niche: 'pet' },
    { name: 'X', platform: 'ebay', niche: 'pet' },
    { name: 'X', platform: 'shopify', niche: 'cars' },
    { name: 'X', platform: 'shopify', niche: 'pet', color: 'red' },
    { name: 'X', platform: 'shopify', niche: 'pet', timezone: 'Mars/Base' },
  ];
  for (const body of bad) {
    const res = await app.request('/api/stores', send('POST', body));
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
  }
  expect((await app.request('/api/stores', { method: 'POST', body: 'not json' })).status).toBe(400);
  expect((await patch(app, 'nope', { name: 'Y' })).status).toBe(404);
  expect((await patch(app, 'pawsome', { niche: 'cars' })).status).toBe(400);
  for (const fee of [{ feePercent: 80 }, { feePercent: '5' }, { feePerOrder: -1 }]) expect((await patch(app, 'pawsome', fee)).status).toBe(400);
});

test('deleting a store removes its metrics', async () => {
  const { db, app } = setup();
  await app.request('/api/stores/peak', { method: 'DELETE' });
  expect(db.prepare("SELECT count(*) AS n FROM daily_metrics WHERE store_id = 'peak'").get()?.n).toBe(0);
});

test("a new store without a timezone gets the owner's machine timezone", async () => {
  const app = createApp(openDb());
  const res = await app.request('/api/stores', { method: 'POST', body: JSON.stringify({ name: 'Tide Co', platform: 'shopify', niche: 'outdoor' }), headers: { 'content-type': 'application/json' } });
  expect(res.status).toBe(201);
  expect(((await res.json()) as Store).timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
});

test("a demo store the owner creates gets its niche's products and orders that match its KPIs", async () => {
  vi.useFakeTimers({ now: new Date('2026-10-26T15:00:00'), toFake: ['Date'] });
  try {
    const { app } = setup();
    const store = (await (await app.request('/api/stores', send('POST', { name: 'Volt Lab', platform: 'shopify', niche: 'tech' }))).json()) as Store;
    const products = (await (await app.request(`/api/products?stores=${store.id}`)).json()) as Page<Product>;
    const orders = (await (await app.request(`/api/orders?stores=${store.id}`)).json()) as Page<Order>;
    const summary = (await (await app.request(`/api/analytics/summary?range=7&stores=${store.id}`)).json()) as AnalyticsSummary;
    expect(products.total).toBeGreaterThan(0);
    // No built-in tech demo store: its products come from the tech side of the research catalog, not another niche's.
    expect(products.items.map((p) => p.title)).toEqual(expect.arrayContaining(['Mini Projector', 'Magnetic Phone Mount']));
    expect(products.items.map((p) => p.title).join()).not.toMatch(/Dog|Pet|Leash|Harness/);
    expect(orders.total).toBe(summary.totals.orders); // seeded orders cover exactly the last 7 days
    const beauty = (await (await app.request('/api/stores', send('POST', { name: 'Dewy', platform: 'etsy', niche: 'beauty' }))).json()) as Store;
    expect(((await (await app.request(`/api/products?stores=${beauty.id}`)).json()) as Page<Product>).items.map((p) => p.title)).toContain('Heated Eyelash Curler');
  } finally {
    vi.useRealTimers();
  }
});

test("the owner's fee estimate is saved on the store and comes off its profit", async () => {
  const { app } = setup();
  const summary = async () => ((await (await app.request('/api/analytics/summary?stores=pawsome&range=30')).json()) as AnalyticsSummary).totals;
  const before = await summary();
  const res = await patch(app, 'pawsome', { feePercent: 9.5, feePerOrder: 0.25 });
  expect(await res.json()).toMatchObject({ id: 'pawsome', feePercent: 9.5, feePerOrder: 0.25 });
  const after = await summary();
  expect(after.revenue).toBe(before.revenue);
  expect(after.profit).toBeCloseTo(before.profit - before.revenue * 0.095 - before.orders * 0.25, 1);

  const top = async () => ((await (await app.request('/api/analytics/top-products?stores=pawsome&range=30&limit=1')).json()) as TopProduct[])[0]!;
  const product = await top();
  await patch(app, 'pawsome', { feePercent: 0 });
  const gross = await top();
  expect(product.profit).toBeCloseTo(gross.profit - gross.revenue * 0.095, 1); // per product: the % only

  const reset = await patch(app, 'pawsome', { feePercent: 0, feePerOrder: 0 });
  expect(await reset.json()).not.toHaveProperty('feePercent');
  expect((await summary()).profit).toBe(before.profit);
});

test("deleting a store deletes its creatives' rendered files, and no one else's", () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  const dir = mkdtempSync(join(tmpdir(), 'frontline-media-'));
  const add = (id: string, storeId: string, media: string) => {
    db.prepare("INSERT INTO creatives (id, store_id, agent_id, kind, headline, primary_text, media_url, source, created_at) VALUES (?, ?, 'ads', 'video', 'h', 't', ?, 'higgsfield', '2026-10-26T00:00:00Z')").run(id, storeId, media);
  };
  for (const f of ['a.mp4', 'b.jpg', 'keep.mp4']) writeFileSync(join(dir, f), 'x');
  add('c1', 'peak', '/api/creatives/media/a.mp4');
  add('c2', 'peak', '/api/creatives/media/b.jpg');
  add('c3', 'peak', 'data:image/png;base64,AAAA'); // a demo render: no file
  add('c4', 'peak', '/api/creatives/media/..%2Fsecret.key'); // never outside the folder
  add('c5', 'glow', '/api/creatives/media/keep.mp4');
  expect(deleteStore(db, 'peak', dir)).toBe(true);
  expect(readdirSync(dir)).toEqual(['keep.mp4']);
});
