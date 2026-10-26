import { expect, test } from 'vitest';
import type { Order, Page, Product } from '@frontline/shared';
import { createApp } from './app';
import { rebuildRevenue, setOrderItems, switchToReal } from './connectors/common';
import { openDb } from './db';
import { seedDemo } from './demo';

const db = openDb();
seedDemo(db, '2026-10-26');
const app = createApp(db);
const get = async <T>(path: string) => (await (await app.request(path)).json()) as Page<T>;

test('products: store filter, search, sort by margin, computed margin', async () => {
  const all = await get<Product>('/api/products');
  expect(all.total).toBe(18);
  expect(all.items.map((p) => p.title)).toEqual([...all.items.map((p) => p.title)].sort((a, b) => a.localeCompare(b)));

  const glow = await get<Product>('/api/products?stores=glow&sort=margin&dir=desc');
  expect(glow.total).toBe(6);
  expect(glow.items.every((p) => p.storeId === 'glow')).toBe(true);
  const margins = glow.items.map((p) => p.margin);
  expect(margins).toEqual([...margins].sort((a, b) => b - a));
  const roller = glow.items.find((p) => p.title === 'Ice Facial Roller')!;
  expect(roller).toMatchObject({ price: 24.99, compareAt: 34.99, cost: 4.6, margin: 81.59, status: 'active' });

  expect((await get<Product>('/api/products?q=FOUNTAIN')).items.map((p) => p.title)).toEqual(['Pet Water Fountain']);
});

test('orders: newest first, pagination, filters, search', async () => {
  const first = await get<Order>('/api/orders?stores=peak&limit=10');
  expect(first.items).toHaveLength(10);
  expect(first.limit).toBe(10);
  const dates = first.items.map((o) => o.createdAt);
  expect(dates).toEqual([...dates].sort().reverse());
  const second = await get<Order>('/api/orders?stores=peak&limit=10&offset=10');
  expect(second.offset).toBe(10);
  expect(second.items[0]!.createdAt <= first.items[9]!.createdAt).toBe(true);
  expect(new Set([...first.items, ...second.items].map((o) => o.id)).size).toBe(20);

  const unfulfilled = await get<Order>('/api/orders?fulfillment=unfulfilled&limit=200');
  expect(unfulfilled.total).toBeGreaterThan(0);
  expect(unfulfilled.items.every((o) => o.fulfillmentStatus === 'unfulfilled' && !o.tracking && !o.trackingUrl)).toBe(true);
  // No carrier link from the platform: a tracking number opens on 17TRACK, which finds the carrier from the number.
  const shipped = (await get<Order>('/api/orders?stores=glow&fulfillment=in_transit')).items[0]!;
  expect(shipped.trackingUrl).toBe(`https://t.17track.net/en#nums=${shipped.tracking}`);
  db.prepare("UPDATE orders SET tracking_url = 'javascript:alert(1)' WHERE store_id = 'glow' AND id = ?").run(shipped.id);
  expect((await get<Order>('/api/orders?stores=glow&fulfillment=in_transit')).items[0]!.trackingUrl).toMatch(/^https:\/\/t\.17track\.net\//);

  const byTotal = await get<Order>('/api/orders?sort=total&dir=asc&limit=5');
  expect(byTotal.items.map((o) => o.total)).toEqual([...byTotal.items.map((o) => o.total)].sort((a, b) => a - b));

  const one = first.items[0]!;
  const found = await get<Order>(`/api/orders?stores=peak&q=${encodeURIComponent(one.id)}`);
  expect(found.items.map((o) => o.id)).toContain(one.id);
});

test('invalid list params are 400s', async () => {
  for (const q of ['/api/products?sort=evil;drop', '/api/products?dir=sideways', '/api/products?status=gone', '/api/orders?fulfillment=lost', '/api/orders?sort=title']) {
    expect((await app.request(q)).status, q).toBe(400);
  }
});

test("the owner's unit cost fills order lines the platform gave no cost for, now and in past orders", async () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  switchToReal(db, 'peak'); // TikTok Shop: no unit costs
  db.prepare("INSERT INTO products (store_id, id, title, price, cost, inventory, status) VALUES ('peak', 'tt-1', 'Mat', 30, 0, 5, 'active')").run();
  const order = db.prepare("INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date) VALUES ('peak', ?, '2026-10-25T12:00:00Z', 60, 'paid', 'unfulfilled', 0, '2026-10-25')");
  order.run('tt-a');
  setOrderItems(db, 'peak', 'tt-a', [{ productId: 'tt-1', quantity: 2, revenue: 60, cost: 0 }]);
  rebuildRevenue(db, 'peak', ['2026-10-25']);
  const cogs = (id: string) => db.prepare("SELECT cogs FROM orders WHERE store_id = 'peak' AND id = ?").get(id)?.cogs;
  const day = () => db.prepare("SELECT cogs FROM daily_metrics WHERE store_id = 'peak' AND date = '2026-10-25'").get()?.cogs;
  expect([cogs('tt-a'), day()]).toEqual([0, 0]);

  const app = createApp(db);
  const patch = (cost: unknown, store = 'peak') => app.request(`/api/products/${store}/tt-1`, { method: 'PATCH', body: JSON.stringify({ cost }), headers: { 'content-type': 'application/json' } });
  expect(((await (await patch(7.5)).json()) as Product).cost).toBe(7.5);
  expect([cogs('tt-a'), day()]).toEqual([15, 15]);
  await patch(8); // changed again: lines priced at the old cost follow
  expect([cogs('tt-a'), day()]).toEqual([16, 16]);

  order.run('tt-b'); // a later sync: the line takes the owner's cost
  setOrderItems(db, 'peak', 'tt-b', [{ productId: 'tt-1', quantity: 1, revenue: 30, cost: 0 }]);
  expect(cogs('tt-b')).toBe(8);

  expect((await patch(-1)).status).toBe(400);
  expect((await app.request('/api/products/peak/nope', { method: 'PATCH', body: JSON.stringify({ cost: 1 }) })).status).toBe(404);
  db.prepare("UPDATE stores SET connected = 1 WHERE id = 'glow'").run();
  db.prepare("INSERT INTO products (store_id, id, title, price, cost, inventory, status) VALUES ('glow', 'tt-1', 'X', 10, 0, 1, 'active')").run();
  expect(((await (await patch(2, 'glow')).json()) as { error: string }).error).toContain('Shopify');
});
