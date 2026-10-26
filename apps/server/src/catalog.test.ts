import { expect, test } from 'vitest';
import type { Order, Page, Product } from '@frontline/shared';
import { createApp } from './app';
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
  expect(unfulfilled.items.every((o) => o.fulfillmentStatus === 'unfulfilled' && !o.tracking)).toBe(true);

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
