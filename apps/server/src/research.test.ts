import { expect, test } from 'vitest';
import type { ApprovalRequest, Page, ProductList, ResearchProduct } from '@frontline/shared';
import { createApp } from './app';
import { openDb } from './db';
import { seedDemo } from './demo';
import { scoreProduct, seedResearch } from './research';

const setup = () => {
  const db = openDb();
  seedDemo(db);
  seedResearch(db);
  return createApp(db);
};
const send = (method: string, body?: unknown) => ({ method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const page = async (app: ReturnType<typeof createApp>, q = '') => (await (await app.request(`/api/research${q}`)).json()) as Page<ResearchProduct>;

test('scoreProduct weights margin, trend, competition and shipping', () => {
  const best = scoreProduct({ cost: 1, price: 10, trend: 300, competition: 0, shippingDays: 5 });
  expect(best).toEqual({ score: 100, scoreParts: { margin: 100, trend: 100, competition: 100, shipping: 100 } });
  expect(scoreProduct({ cost: 9, price: 10, trend: 0, competition: 100, shippingDays: 25 }).score).toBe(0);
  // 50% margin → 0.5, +100% trend → 0.5, competition 50 → 0.5, 12.5 days → 0.5
  expect(scoreProduct({ cost: 5, price: 10, trend: 100, competition: 50, shippingDays: 12.5 }).score).toBe(50);
});

test('feed defaults to best score first; tabs filter and sort', async () => {
  const app = setup();
  const all = await page(app);
  expect(all.total).toBe(30);
  const scores = all.items.map((p) => p.score);
  expect(scores).toEqual([...scores].sort((a, b) => b - a));

  const trending = (await page(app, '?tab=trending')).items.map((p) => p.trend);
  expect(trending).toEqual([...trending].sort((a, b) => b - a));
  expect((await page(app, '?tab=high_margin')).items.every((p) => p.margin >= 70)).toBe(true);
  expect((await page(app, '?tab=low_competition')).items.every((p) => p.competition <= 35)).toBe(true);
  expect((await page(app, '?tab=tiktok_viral')).items.every((p) => p.source === 'tiktok')).toBe(true);
  expect((await page(app, '?tab=shopify_winners')).items.every((p) => p.source === 'shopify')).toBe(true);
  expect((await page(app, '?niche=pet')).items.every((p) => p.niche === 'pet')).toBe(true);
  expect((await page(app, '?q=facial')).items.map((p) => p.id)).toEqual(['ice-facial-roller']);
  expect((await page(app, '?limit=5&offset=5')).items).toHaveLength(5);
  expect((await app.request('/api/research?tab=hot')).status).toBe(400);

  const roller = (await (await app.request('/api/research/ice-facial-roller')).json()) as ResearchProduct;
  expect(roller).toMatchObject({ title: 'Ice Facial Roller', price: 11.3, compareAt: 34.99, margin: 76.99 });
  expect((await app.request('/api/research/nope')).status).toBe(404);
});

test('saved lists: create, add, remove, delete', async () => {
  const app = setup();
  const list = (await (await app.request('/api/research/lists', send('POST', { name: 'Q4 winners' }))).json()) as ProductList;
  expect(list).toMatchObject({ name: 'Q4 winners', productIds: [] });
  await app.request(`/api/research/lists/${list.id}/items/mini-projector`, send('PUT'));
  const added = (await (await app.request(`/api/research/lists/${list.id}/items/ice-facial-roller`, send('PUT'))).json()) as ProductList;
  expect(added.productIds).toEqual(['mini-projector', 'ice-facial-roller']);
  const removed = (await (await app.request(`/api/research/lists/${list.id}/items/mini-projector`, send('DELETE'))).json()) as ProductList;
  expect(removed.productIds).toEqual(['ice-facial-roller']);
  expect(((await (await app.request('/api/research/lists')).json()) as ProductList[]).map((l) => l.id)).toEqual([list.id]);
  expect((await app.request(`/api/research/lists/${list.id}/items/nope`, send('PUT'))).status).toBe(404);
  expect((await app.request('/api/research/lists', send('POST', { name: ' ' }))).status).toBe(400);
  expect((await app.request(`/api/research/lists/${list.id}`, send('DELETE'))).status).toBe(204);
  expect((await app.request(`/api/research/lists/${list.id}/items/mini-projector`, send('PUT'))).status).toBe(404);
});

test('add to store creates a pending approval for the store Product Hunter', async () => {
  const app = setup();
  const res = await app.request('/api/research/pet-water-fountain/add-to-store', send('POST', { storeId: 'pawsome' }));
  expect(res.status).toBe(201);
  const a = (await res.json()) as ApprovalRequest;
  expect(a).toMatchObject({ storeId: 'pawsome', agentId: 'pawsome:product_hunter', status: 'pending', title: 'Add "Pet Water Fountain" to Pawsome Gear', action: { kind: 'store.add_products' } });
  const pending = (await (await app.request('/api/approvals?status=pending&stores=pawsome')).json()) as ApprovalRequest[];
  expect(pending[0]!.id).toBe(a.id);
  expect((await app.request('/api/research/pet-water-fountain/add-to-store', send('POST', { storeId: 'nope' }))).status).toBe(400);
});

test("add to store refuses a connected store on a platform the app can't write to, without a request", async () => {
  const db = openDb();
  seedDemo(db);
  seedResearch(db);
  const app = createApp(db);
  db.prepare("UPDATE stores SET platform = 'etsy', connected = 1, demo = 0 WHERE id = 'pawsome'").run();
  const pending = () => db.prepare("SELECT count(*) AS n FROM approvals WHERE store_id = 'pawsome' AND status = 'pending'").get()?.n;
  const before = pending();
  const res = await app.request('/api/research/pet-water-fountain/add-to-store', send('POST', { storeId: 'pawsome' }));
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBe('Products are only added automatically to Shopify and WooCommerce stores for now. Add "Pet Water Fountain" to Pawsome Gear by hand.');
  expect(pending()).toBe(before);
});

test("add to store converts the research's USD prices into the store's currency", async () => {
  const db = openDb();
  seedDemo(db);
  seedResearch(db);
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('fx', ?)").run(JSON.stringify({ date: '2026-10-23', fetchedAt: new Date().toISOString(), rates: { EUR: 1, USD: 1.25, JPY: 187.5 } }));
  const app = createApp(db);
  const add = async (currency: string) => {
    db.prepare("UPDATE stores SET currency = ? WHERE id = 'pawsome'").run(currency);
    const a = (await (await app.request('/api/research/pet-water-fountain/add-to-store', send('POST', { storeId: 'pawsome' }))).json()) as ApprovalRequest;
    return { reason: a.reason, product: (a.action.payload as { products: { price: number; compareAt: number; cost: number }[] }).products[0]! };
  };
  expect((await add('EUR')).product).toMatchObject({ price: 11.8, compareAt: 35.99, cost: 4.08 });
  const yen = (await add('JPY')).product;
  expect([yen.price, yen.cost]).toEqual([2213, 765]);
  expect(Number.isInteger(yen.compareAt)).toBe(true);
  const usd = await add('XOF'); // no rate: kept in USD, and the request says so
  expect(usd.product).toMatchObject({ price: 14.75, compareAt: 44.99, cost: 5.1 });
  expect(usd.reason).toContain('Prices are in USD');
});
