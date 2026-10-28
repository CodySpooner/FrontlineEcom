import type { PrSignalSet } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { upsertListing } from './catalog';
import { refreshAllOrders, refreshOrders } from './evidence';
import { rankDemand } from './facts';
import { ADAPTERS } from './sources';

const NOW = new Date('2026-10-28T10:00:00.000Z'); // a Wednesday: the week of 2026-10-25 isn't complete
beforeEach(() => (vi.useFakeTimers({ toFake: ['Date'] }), vi.setSystemTime(NOW)));
afterEach(() => vi.useRealTimers());
const post = (app: ReturnType<typeof createApp>, path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

function setup() {
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency, demo, connected) VALUES ('real', 'Real', 'shopify', 'pet', 'USD', 0, 1), ('demo', 'Demo', 'shopify', 'pet', 'USD', 1, 1)`);
  for (const s of ['real', 'demo']) db.exec(`INSERT INTO products (store_id, id, title, price) VALUES ('${s}', 'p1', 'Paw Cup', 19.99), ('${s}', 'p2', 'Paw Cup XL', 24.99)`);
  const product = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Silicone Dog Paw Cleaner Cup', origin: 'ingest', at: '2026-10-01T00:00:00.000Z' }).productId;
  return { db, product };
}
let n = 0;
function sell(db: Db, store: string, productId: string, date: string, quantity: number, status = 'paid') {
  const id = `o${++n}`;
  db.prepare(`INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES (?, ?, ?, 20, ?, 'fulfilled', ?)`).run(store, id, `${date}T12:00:00Z`, status, date);
  db.prepare('INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue) VALUES (?, ?, ?, ?, 20)').run(store, id, productId, quantity);
}
const sets = (db: Db) => db.prepare(`SELECT store_id, product_id, platform, metric, scope, origin, granularity, period_start, period_end FROM pr_signals ORDER BY store_id`).all().map((r) => ({ ...r }));
const points = (db: Db) => db.prepare('SELECT at, value FROM pr_signal_points ORDER BY at').all().map((r) => [r.at, r.value]);

test("a real store's paid orders become weekly units for the linked product; a demo store's orders never count", async () => {
  const { db, product } = setup();
  for (const s of ['real', 'demo']) {
    sell(db, s, 'p1', '2026-10-05', 2); // week of Oct 4
    sell(db, s, 'p2', '2026-10-06', 1); // a second linked store product adds to the same week
    sell(db, s, 'p1', '2026-10-20', 3); // week of Oct 18 (Oct 11 had none)
    sell(db, s, 'p1', '2026-10-21', 5, 'refunded'); // not paid
    sell(db, s, 'p1', '2026-10-27', 4); // this week, not complete
  }
  const app = createApp(db);
  const real = await post(app, `/api/pr/products/${product}/store-products?store=real`, { storeProductId: 'p1' });
  expect(real.status).toBe(201);
  expect(((await real.json()) as { ordersSet: PrSignalSet }).ordersSet).toMatchObject({ platform: 'orders', metric: 'units_sold', scope: 'product', origin: 'live', granularity: 'week', points: 3 });
  await post(app, `/api/pr/products/${product}/store-products?store=real`, { storeProductId: 'p2' });
  const demo = await post(app, `/api/pr/products/${product}/store-products?store=demo`, { storeProductId: 'p1' });
  expect(((await demo.json()) as { ordersSet: unknown }).ordersSet).toBeNull();

  expect(sets(db)).toEqual([{ store_id: 'real', product_id: product, platform: 'orders', metric: 'units_sold', scope: 'product', origin: 'live', granularity: 'week', period_start: '2026-10-04', period_end: '2026-10-18' }]);
  expect(points(db)).toEqual([['2026-10-04', 3], ['2026-10-11', 0], ['2026-10-18', 3]]);
  // A store's own orders are private: they never go into the shared facts other stores sort by.
  rankDemand(db, product, NOW);
  expect(db.prepare('SELECT demand_set_id FROM pr_product_facts WHERE product_id = ?').all(product).map((r) => r.demand_set_id)).toEqual([null]);

  // Turning a store into a demo store (or back) is honoured at the next refresh.
  db.exec(`UPDATE stores SET demo = 1 WHERE id = 'real'`);
  refreshOrders(db, 'real', product, NOW);
  expect(sets(db)).toEqual([]);
  db.exec(`UPDATE stores SET demo = 0 WHERE id = 'real'`);
  refreshAllOrders(db, NOW);
  expect(points(db)).toHaveLength(3);
  refreshAllOrders(db, NOW); // once a day
  expect(sets(db)).toHaveLength(1);

  expect((await post(app, `/api/pr/products/${product}/store-products?store=real`, { storeProductId: 'nope' })).status).toBe(404);
  expect((await post(app, `/api/pr/products/${product}/store-products`, { storeProductId: 'p1' })).status).toBe(400); // All stores
});

test('a TikTok Creative Center note keeps the link and the date, private to the store, and is never demand evidence', async () => {
  const { db, product } = setup();
  const app = createApp(db);
  const note = { platform: 'tiktok_creative_center', url: 'https://ads.tiktok.com/business/creativecenter/inspiration/topproducts/pc/en', note: 'Paw cleaners in the top 20 for Pets, US, last 7 days', observedAt: '2026-10-27' };
  const res = await post(app, `/api/pr/products/${product}/notes?store=real`, note);
  expect(res.status).toBe(201);
  expect({ ...db.prepare('SELECT store_id, platform, metric, scope, origin, note, url, retrieved_at, granularity FROM pr_signals').get() }).toEqual({
    store_id: 'real', platform: 'tiktok_creative_center', metric: 'manual_note', scope: 'product', origin: 'manual', note: note.note, url: note.url, retrieved_at: '2026-10-27T00:00:00.000Z', granularity: null,
  });
  expect(db.prepare('SELECT count(*) AS n FROM pr_signal_points').get()?.n).toBe(0);
  expect((await post(app, `/api/pr/products/${product}/notes?store=real`, { ...note, platform: 'tiktok_scraper' })).status).toBe(400);
  expect((await post(app, `/api/pr/products/${product}/notes?store=real`, { ...note, url: 'javascript:alert(1)' })).status).toBe(400);
  expect((await post(app, `/api/pr/products/${product}/notes?store=real`, { ...note, note: ' ' })).status).toBe(400);
  expect((await post(app, `/api/pr/products/${product}/notes?store=real`, { ...note, observedAt: '2027-01-01' })).status).toBe(400);
  expect((await post(app, `/api/pr/products/nope/notes?store=real`, note)).status).toBe(404);
});

test('the sources that make no call report their status from what is set up', () => {
  const { db } = setup();
  const by = Object.fromEntries(ADAPTERS.map((a) => [a.id, a.access(db, Buffer.alloc(32))]));
  expect(by).toMatchObject({ store_orders: 'verified', tiktok_creative_center: 'manual_only', supplier_feed: 'authorized_import' });
  db.exec(`UPDATE stores SET connected = 0 WHERE demo = 0`);
  expect(ADAPTERS.find((a) => a.id === 'store_orders')!.access(db, Buffer.alloc(32))).toBe('credentials_required'); // only demo stores connected
});
